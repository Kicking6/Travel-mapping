// Trip Atlas — app shell: router, store, API client, small UI helpers.
// Views live in web/views/*.js and export render(el, params) → optional cleanup fn.
import { decodePolyline } from './lib/geo.js';

// ── API ──────────────────────────────────────────────────────────────────
export async function api(method, path, body, opts = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined && !(body instanceof Blob) && typeof body !== 'string' ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : (opts.headers || {}),
    body: body === undefined ? undefined : body instanceof Blob || typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (res.status === 401) { location.href = '/'; throw new Error('Signed out'); }
  const data = res.status === 304 ? null : await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 304) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return { status: res.status, data, headers: res.headers };
}

// ── Store ────────────────────────────────────────────────────────────────
// One copy of the trip for the whole app. Routes carry decoded geometry
// (`coords`) once, so the map, the list and the exporter share it.
export const store = {
  me: null, trip: {}, legs: [], styles: [], maps: [], routes: [], places: [], version: 0,
  _etag: null, _listeners: new Set(),
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  emit(what) { for (const fn of this._listeners) fn(what); },
  route(id) { return this.routes.find((r) => r.id === id); },
  style(id) { return this.styles.find((s) => s.id === id) || this.styles[0]; },
};

export async function loadBootstrap() {
  const { data } = await api('GET', '/api/bootstrap');
  Object.assign(store, { me: data.me, trip: data.trip, legs: data.legs, styles: data.styles, maps: data.maps, feedback: data.feedback });
  window.TA_USER = data.me;
  paintFeedbackBadge();
  store.emit('bootstrap');
}

export async function loadRoutes(force = false) {
  const headers = !force && store._etag ? { 'If-None-Match': store._etag } : {};
  const { status, data, headers: h } = await api('GET', '/api/routes', undefined, { headers });
  if (status === 304) return false;
  store._etag = h.get('ETag');
  store.version = data.version;
  store.routes = data.routes.map((r) => ({ ...r, coords: decodePolyline(r.geom), coordsLo: r.geom_lo ? decodePolyline(r.geom_lo) : null }));
  const p = await api('GET', '/api/places');
  store.places = p.data.places;
  store.emit('routes');
  updateReviewCount();
  return true;
}

// New reports (for an admin) plus unread replies, on the Feedback button and menu item.
function paintFeedbackBadge() {
  const f = store.feedback || {}, n = (f.adminNewFeedback || 0) + (f.unreadReplies || 0);
  for (const id of ['navFeedback', 'menuFeedback']) { const el = document.getElementById(id); if (el) { el.hidden = !n; el.textContent = n; } }
}
window.addEventListener('ta:feedback-counts', paintFeedbackBadge);
window.addEventListener('ta:feedback-submitted', () => import('./views/feedback.js').then((m) => m.refreshCounts()));

export const needsReview = (r) => !r.date || r.date_source === 'suggested' || r.type === 'other' || (r.review && r.review.possibleDuplicateName);
function updateReviewCount() {
  const n = store.routes.filter((r) => !r.hidden && needsReview(r)).length;
  const el = document.getElementById('navReview');
  el.hidden = !n; el.textContent = n;
}

// Leg a route belongs to: pinned leg_id, else the leg whose dates contain it.
export function legFor(r) {
  if (r.leg_id) return store.legs.find((l) => l.id === r.leg_id) || null;
  if (!r.date) return null;
  return store.legs.find((l) => l.start_date && l.end_date && r.date >= l.start_date && r.date <= l.end_date) || null;
}

// The one filter used by the map page, album maps and the exporter.
export function applyFilter(routes, f = {}) {
  const inc = new Set(f.include || []), exc = new Set(f.exclude || []);
  return routes.filter((r) => {
    if (exc.has(r.id)) return false;
    if (inc.has(r.id)) return true;
    if (r.hidden) return false;
    if (f.from && (!r.date || r.date < f.from)) return false;
    if (f.to && (!r.date || r.date > f.to)) return false;
    if (f.types && f.types.length && !f.types.includes(r.type)) return false;
    if (f.legs && f.legs.length) { const l = legFor(r); if (!l || !f.legs.includes(l.id)) return false; }
    if (f.countries && f.countries.length && !(r.country || '').split(',').some((c) => f.countries.includes(c.trim()))) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!`${r.name} ${r.notes || ''} ${r.country || ''} ${r.region || ''} ${r.source_name || ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

// ── UI helpers ───────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}

export function modal({ title, body, actions = [{ label: 'Close' }], wide = false }) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'ds-modal-backdrop';
    bd.innerHTML = `<div class="ds-modal" role="dialog" aria-modal="true" style="${wide ? 'max-width:min(1100px,96vw)' : ''}">
      <div class="ds-modal-head"><span>${esc(title)}</span><button class="btn ghost sm" data-x aria-label="Close">✕</button></div>
      <div class="ds-modal-body"></div><div class="ds-modal-foot"></div></div>`;
    const bodyEl = $('.ds-modal-body', bd);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    const foot = $('.ds-modal-foot', bd);
    const close = (v) => { bd.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.onclick = () => close(a.value ?? a.label);
      foot.append(b);
    }
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    $('[data-x]', bd).onclick = () => close(null);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(null); });
    document.body.append(bd);
    const first = $('input, select, textarea', bodyEl) || $('.btn.primary', foot);
    if (first) first.focus();
  });
}

export const confirm = (title, text, label = 'Confirm', danger = false) =>
  modal({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Cancel', value: false }, { label, value: true, primary: !danger, danger }] });

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00Z');
  return dt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export const fmtKm = (n) => (n == null ? '' : n >= 100 ? Math.round(n).toLocaleString('en-NZ') : n.toFixed(1));

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Router ───────────────────────────────────────────────────────────────
const VIEWS = {
  map: () => import('./views/explore.js'),
  album: () => import('./views/album.js'),
  import: () => import('./views/import.js'),
  review: () => import('./views/review.js'),
  draw: () => import('./views/draw.js'),
  photos: () => import('./views/photos.js'),
  film: () => import('./views/film.js'),
  styles: () => import('./views/styles.js'),
  settings: () => import('./views/settings.js'),
  feedback: () => import('./views/feedback.js'),
};

let cleanup = null;
async function route() {
  const [name = 'map', ...params] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const load = VIEWS[name] || VIEWS.map;
  for (const a of $$('#nav a')) a.classList.toggle('active', a.dataset.nav === name);
  if (cleanup) { try { cleanup(); } catch (_) { /* view already gone */ } cleanup = null; }
  const el = $('#view');
  el.innerHTML = '<div class="page"><div class="empty"><span class="spinner"></span></div></div>';
  document.body.classList.toggle('app-full', ['map', 'album', 'styles', 'review', 'draw', 'film'].includes(name) && !(name === 'album' && !params.length));
  try {
    const mod = await load();
    el.innerHTML = '';
    cleanup = (await mod.render(el, params)) || null;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="page"><div class="empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p></div></div>`;
  }
}

function wireMenu() {
  const btn = $('#userMenuBtn'), menu = $('#userMenu');
  btn.onclick = (e) => { e.stopPropagation(); const open = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', open); };
  document.addEventListener('click', () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
}

async function start() {
  wireMenu();
  $('#feedbackTopBtn').addEventListener('click', (e) => { e.stopPropagation(); if (window.TA_FEEDBACK) window.TA_FEEDBACK.arm(); });
  await loadBootstrap();
  const me = store.me;
  $('#menuName').textContent = me.name || me.email.split('@')[0];
  $('#menuEmail').textContent = me.email;
  $('#avatarInitials').textContent = (me.name || me.email).slice(0, 1).toUpperCase();
  $('#tripName').textContent = store.trip.trip_name || 'Trip Atlas';
  await loadRoutes();
  window.addEventListener('hashchange', route);
  route();
  // Pick up the other person's edits when this tab comes back into focus.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) Promise.all([loadBootstrap(), loadRoutes()]).catch(() => {});
  });
}

start().catch((e) => {
  $('#view').innerHTML = `<div class="page"><div class="empty"><h3>Couldn't load the trip</h3><p>${esc(e.message)}</p></div></div>`;
});
