// #/review — the routes that need a person: no date, a guessed year, unknown
// type, possible duplicates, no country. Suggestions are worked out here from
// the rest of the trip (an undated US trail gets the date of the drive that
// passes it), never applied without a click.
import { store, api, loadRoutes, needsReview, esc, $, toast, fmtDate, fmtKm } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { resolveStyle } from '../lib/style.js';
import { typeById, TYPES } from '../lib/types.js';
import { haversineKm, unionBbox, bboxIntersects, greatCircle } from '../lib/geo.js';
import { findMissingTravel } from '../lib/travel.js';
import { loadCountries, countriesFor } from '../lib/countries.js';
import { routeEditor } from './route-editor.js';

const QUEUES = [
  { id: 'travel', label: 'Missing travel', test: () => false },
  { id: 'nodate', label: 'No date', test: (r) => !r.date },
  { id: 'guess', label: 'Date guessed', test: (r) => r.date_source === 'suggested' },
  { id: 'dup', label: 'Possible duplicates', test: (r) => r.review && r.review.possibleDuplicateName },
  { id: 'type', label: 'Unknown type', test: (r) => r.type === 'other' },
  { id: 'country', label: 'No country', test: (r) => !r.country && r.type !== 'flight' },
];

// Nearest dated route that passes within 25 km of this one's start.
export function suggestDate(route, routes) {
  if (!route.coords || !route.coords.length) return null;
  const start = route.coords[0];
  const box = [start[0] - 0.4, start[1] - 0.3, start[0] + 0.4, start[1] + 0.3];
  let best = null;
  for (const o of routes) {
    if (o.id === route.id || !o.date || o.date_source === 'suggested' || !bboxIntersects(o.bbox, box)) continue;
    const step = Math.max(1, Math.floor(o.coords.length / 400));
    for (let i = 0; i < o.coords.length; i += step) {
      const d = haversineKm(start, o.coords[i]);
      if (d < 25 && (!best || d < best.km)) best = { km: d, date: o.date, via: o };
    }
  }
  return best;
}

export async function render(el, params) {
  let queue = params[0] && QUEUES.some((q) => q.id === params[0]) ? params[0] : null;
  const selected = new Set();

  el.innerHTML = `<div class="ws">
    <aside class="ws-panel">
      <div class="ws-panel-head"><div class="row-between"><strong>Needs a look</strong><span class="muted" id="total"></span></div>
        <div class="chip-row" id="queues"></div><div id="bulk"></div></div>
      <div class="ws-panel-body" id="list"></div>
    </aside>
    <section class="ws-map"><div class="map" id="map"></div></section>
    <aside class="ws-drawer" id="drawer" hidden></aside>
  </div>`;
  const atlas = await createAtlas($('#map', el), { spec: resolveStyle(store.styles[0].spec) });
  const drawer = $('#drawer', el);

  // Missing travel: jumps the trip has no route for (usually flights), with airport suggestions.
  let gaps = [];
  const DISMISS = 'ta-dismissed-gaps';
  const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(DISMISS) || '[]')); } catch (_) { return new Set(); } };
  const gapKey = (g) => `${g.d0}|${g.d1}|${Math.round(g.km / 10)}`;
  async function computeGaps() {
    const airports = await fetch('/data/airports.json').then((r) => r.json());
    const d = dismissed();
    gaps = findMissingTravel(store.routes, store.places, { minKm: 400, airports }).filter((g) => !d.has(gapKey(g)))
      .sort((a, b) => a.d0.localeCompare(b.d0));
    draw();
  }
  computeGaps();

  function counts() { return Object.fromEntries(QUEUES.map((q) => [q.id, q.id === 'travel' ? gaps.length : store.routes.filter((r) => !r.hidden && q.test(r)).length])); }

  function drawTravel() {
    $('#bulk', el).innerHTML = '<p class="help">Moves of 400 km+ with nothing recorded in between — usually a flight. Check the suggested airports, then add it (layovers: edit the line on the next screen).</p>';
    $('#list', el).innerHTML = gaps.length ? `<table class="rt"><colgroup><col><col style="width:128px"></colgroup><tbody>${gaps.map((g, i) => `<tr class="row" data-gap="${i}">
      <td title="${esc(g.from)} → ${esc(g.to)}"><strong>${esc(fmtDate(g.d0))}${g.d1 !== g.d0 ? ' – ' + esc(fmtDate(g.d1)) : ''}</strong> · ${g.km.toLocaleString()} km
        <div class="help">${esc(g.from)}</div><div class="help">→ ${esc(g.to)}</div></td>
      <td>${g.suggest ? `<button class="btn sm primary" data-addflight="${i}" title="${esc(g.suggest.fromName)} → ${esc(g.suggest.toName)}">✈ ${g.suggest.from} → ${g.suggest.to}</button>` : ''}<button class="btn ghost sm" data-dismiss="${i}" title="Not a missing flight — hide it">Not missing</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty"><h3>Nothing missing</h3><p>Every big move has a route.</p></div>';
    atlas.setRoutes(store.routes.filter((r) => !r.hidden));
    atlas.setDimmed([]);
  }

  function draw() {
    const c = counts();
    if (!queue || !c[queue]) queue = (QUEUES.find((q) => c[q.id]) || QUEUES[0]).id;
    $('#total', el).textContent = `${store.routes.filter((r) => !r.hidden && needsReview(r)).length} routes`;
    $('#queues', el).innerHTML = QUEUES.map((q) => `<button class="chip filter-chip ${q.id === queue ? 'on' : ''}" data-q="${q.id}">${esc(q.label)} ${c[q.id]}</button>`).join('');
    if (queue === 'travel') { drawTravel(); return; }
    const q = QUEUES.find((x) => x.id === queue);
    const items = store.routes.filter((r) => !r.hidden && q.test(r));
    const bulk = $('#bulk', el);
    bulk.innerHTML = '';
    if (queue === 'nodate' && items.length) bulk.innerHTML = `<button class="btn sm" id="applyAll">Use every suggested date</button>`;
    if (queue === 'country' && items.length) bulk.innerHTML = `<button class="btn sm primary" id="detect">Detect countries for all ${items.length}</button>`;
    if (queue === 'type' && items.length) bulk.innerHTML = `<div class="filter-row"><select class="select sm" id="bulkType">${TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select><button class="btn sm" id="setType">Set all ${items.length}</button></div>`;

    const sugg = new Map();
    if (queue === 'nodate' || queue === 'guess') for (const r of items) sugg.set(r.id, suggestDate(r, store.routes));

    $('#list', el).innerHTML = items.length ? `<table class="rt"><colgroup><col><col style="width:150px"></colgroup><tbody>${items.map((r) => {
      const s = sugg.get(r.id);
      const t = typeById(r.type);
      return `<tr class="row ${selected.has(r.id) ? 'sel' : ''}" data-id="${r.id}" data-route-id="${r.id}"><td title="${esc(r.source_name || r.name)}"><span class="type-dot" style="background:${t.color}"></span>${esc(r.name)}
        <div class="help">${r.date ? esc(fmtDate(r.date)) + ' · ' : ''}${fmtKm(r.distance_km)} km${r.review?.possibleDuplicateName ? ` · like “${esc(r.review.possibleDuplicateName)}”` : ''}</div></td>
        <td>${s ? `<button class="btn sm" data-use="${r.id}" data-date="${s.date}" title="Within ${Math.round(s.km)} km of “${esc(s.via.name)}”">${esc(fmtDate(s.date))}</button>` : queue === 'nodate' ? '<span class="help">no nearby route</span>' : ''}</td></tr>`;
    }).join('')}</tbody></table>` : `<div class="empty"><h3>All clear</h3><p>Nothing in “${esc(q.label)}”.</p></div>`;

    atlas.setRoutes(store.routes.filter((r) => !r.hidden));
    atlas.setDimmed(store.routes.filter((r) => !items.includes(r)).map((r) => r.id));
    atlas.setSelection([...selected]);
    if (!selected.size && items.length) atlas.fit(unionBbox(items.map((r) => r.bbox)));

    const applyAll = $('#applyAll', el);
    if (applyAll) applyAll.onclick = async () => {
      const byDate = new Map();
      for (const [id, s] of sugg) if (s) (byDate.get(s.date) || byDate.set(s.date, []).get(s.date)).push(id);
      for (const [date, ids] of byDate) await api('PATCH', '/api/routes', { ids, fields: { date } });
      toast(`Dated ${[...byDate.values()].flat().length} routes`);
      await loadRoutes(true);
    };
    const detect = $('#detect', el);
    if (detect) detect.onclick = async () => {
      detect.disabled = true; detect.textContent = 'Loading boundaries…';
      try {
        const countries = await loadCountries();
        const by = new Map();
        for (const r of items) { const c = countriesFor(countries, r.coordsLo || r.coords); if (c) (by.get(c) || by.set(c, []).get(c)).push(r.id); }
        for (const [country, ids] of by) await api('PATCH', '/api/routes', { ids, fields: { country } });
        toast(`Set the country on ${[...by.values()].flat().length} routes`);
        await loadRoutes(true);
      } catch (e) { toast(e.message, 'err'); detect.disabled = false; }
    };
    const setType = $('#setType', el);
    if (setType) setType.onclick = async () => {
      await api('PATCH', '/api/routes', { ids: items.map((r) => r.id), fields: { type: $('#bulkType', el).value } });
      await loadRoutes(true);
    };
  }

  function openEditor() {
    const ids = [...selected].filter((id) => store.route(id));
    if (!ids.length) { drawer.hidden = true; return; }
    drawer.hidden = false;
    routeEditor(drawer, ids.map((id) => store.route(id)), {
      onClose: () => { selected.clear(); drawer.hidden = true; draw(); },
      onSaved: () => loadRoutes(true),
      onDeleted: () => { selected.clear(); loadRoutes(true); },
      onLineSaved: () => atlas.setRoutes(store.routes.filter((r) => !r.hidden)),
    });
    requestAnimationFrame(() => atlas.map.resize());
  }

  const root = el.firstElementChild; // #view persists across pages — never listen on it
  root.addEventListener('click', async (e) => {
    const q = e.target.closest('[data-q]');
    if (q) { queue = q.dataset.q; selected.clear(); drawer.hidden = true; history.replaceState(null, '', `#/review/${queue}`); draw(); return; }
    const add = e.target.closest('[data-addflight]');
    if (add) { const g = gaps[+add.dataset.addflight]; location.hash = `#/import?flight=${encodeURIComponent(`${g.d1} ${g.suggest.from} ${g.suggest.to}`)}`; return; }
    const dis = e.target.closest('[data-dismiss]');
    if (dis) { const d = dismissed(); d.add(gapKey(gaps[+dis.dataset.dismiss])); try { localStorage.setItem(DISMISS, JSON.stringify([...d])); } catch (_) { /* private mode */ } gaps.splice(+dis.dataset.dismiss, 1); draw(); return; }
    const gr = e.target.closest('[data-gap]');
    if (gr) { const g = gaps[+gr.dataset.gap]; atlas.setActive(greatCircle(g.a, g.b, 64), { color: '#b3261e', width: 3, head: 5 }); atlas.fit([Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1])]); return; }
    const use = e.target.closest('[data-use]');
    if (use) {
      e.stopPropagation();
      await api('PATCH', '/api/routes', { ids: [+use.dataset.use], fields: { date: use.dataset.date } });
      toast('Dated');
      await loadRoutes(true);
      return;
    }
    const tr = e.target.closest('tr.row');
    if (tr) {
      const id = +tr.dataset.id;
      if (e.metaKey || e.ctrlKey) selected.has(id) ? selected.delete(id) : selected.add(id); else { selected.clear(); selected.add(id); }
      draw(); openEditor();
      const r = store.route(id);
      const twin = r.review?.possibleDuplicateOf && store.route(r.review.possibleDuplicateOf);
      atlas.fit(unionBbox([r.bbox, twin && twin.bbox]));
    }
  });
  atlas.on('select', (id) => { if (id) { selected.clear(); selected.add(id); draw(); openEditor(); } });
  const off = store.on((w) => { if (w === 'routes') { draw(); if (selected.size) openEditor(); } });
  draw();
  return () => { off(); atlas.destroy(); };
}
