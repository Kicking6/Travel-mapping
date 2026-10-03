// The trip film's timeline — pure (no DOM, no map), so preview and render use
// the same frames and node --test covers the maths.
//
//   buildTimeline(routes, photos, opts) → { duration, frame(t) }
//   frame(t) → { camera {center, zoom, bearing, pitch}, done: Set(routeIds),
//                active {id, coords} | null, caption, km, card, photo }
//
// Pacing: routes are grouped (day | week | leg). Each group gets screen time
// in proportion to √(distance) — a 600 km drive day takes longer than a
// stroll, but not 100× longer — scaled to the requested length. Between
// groups the camera glides; a long jump (a flight) zooms out and back in.
import { haversineKm, unionBbox } from './geo.js';

const TILE = 512;
const mx = (lon) => ((lon + 180) / 360) * TILE;
const my = (lat) => { const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE; };
const unx = (x) => (x / TILE) * 360 - 180;
const uny = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILE))) * 180) / Math.PI;

// Camera that frames a bbox in a W×H viewport with `pad` px margin.
export function cameraFor(bbox, W, H, pad = 60, maxZoom = 12) {
  const [w, s, e, n] = bbox;
  const x0 = mx(w), x1 = mx(e), y0 = my(n), y1 = my(s);
  const dx = Math.max(x1 - x0, 1e-6), dy = Math.max(y1 - y0, 1e-6);
  const zoom = Math.max(0.5, Math.min(maxZoom, Math.log2(Math.min((W - 2 * pad) / dx, (H - 2 * pad) / dy))));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom };
}

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Glide from camera a to b; zoom out mid-way when the jump is wide.
export function glide(a, b, t, W) {
  const e = smooth(Math.max(0, Math.min(1, t)));
  const zmin = Math.min(a.zoom, b.zoom);
  const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy) * 2 ** zmin;     // screen px at the lower zoom
  const bump = Math.max(0, Math.log2(dist / (W * 0.7)));
  return { cx: lerp(a.cx, b.cx, e), cy: lerp(a.cy, b.cy, e), zoom: lerp(a.zoom, b.zoom, e) - bump * Math.sin(Math.PI * e) };
}

function cumulative(coords) {
  const c = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) c[i] = c[i - 1] + haversineKm(coords[i - 1], coords[i]);
  return c;
}
// The first fraction f of a line, by distance (binary search on cumulative km).
export function sliceLine(coords, cum, f) {
  if (f >= 1) return coords;
  const target = cum[cum.length - 1] * Math.max(0, f);
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
  if (lo === 0) return [coords[0]];
  const a = coords[lo - 1], b = coords[lo], seg = cum[lo] - cum[lo - 1] || 1, k = (target - cum[lo - 1]) / seg;
  return [...coords.slice(0, lo), [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]];
}

const weekKey = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

/**
 * routes: [{id, name, date, type, coords, bbox, distance_km, started_at}]
 * photos: [{id, date, taken_at, lat, lon, route_id, caption}]
 * opts: { W, H, seconds, group: 'day'|'week'|'leg', legFor(route), photoSeconds, intro, outro, pitch, drift, title }
 */
export function buildTimeline(routes, photos = [], opts = {}) {
  const W = opts.W || 1920, H = opts.H || 1080;
  const list = routes.filter((r) => r.date && r.coords && r.coords.length > 1)
    .slice().sort((a, b) => (a.date + (a.started_at || '')).localeCompare(b.date + (b.started_at || '')) || a.id - b.id);
  if (!list.length) return { duration: 0, frame: () => null, groups: [] };

  const keyOf = opts.group === 'day' ? (r) => r.date : opts.group === 'leg' && opts.legFor ? (r) => { const l = opts.legFor(r); return l ? 'leg-' + l.id : 'w-' + weekKey(r.date); } : (r) => weekKey(r.date);
  const groups = [];
  for (const r of list) {
    const k = keyOf(r);
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, routes: [] });
    groups[groups.length - 1].routes.push(r);
  }
  const all = cameraFor(unionBbox(list.map((r) => r.bbox)), W, H, 80);
  const pad = Math.round(Math.min(W, H) * 0.12);
  for (const g of groups) {
    g.km = g.routes.reduce((a, r) => a + (r.distance_km || 0), 0);
    g.cam = cameraFor(unionBbox(g.routes.map((r) => r.bbox)), W, H, pad, 11.5);
    g.photos = photos.filter((p) => p.lat != null && g.routes.some((r) => r.id === p.route_id || (!p.route_id && r.date === p.date)))
      .sort((a, b) => String(a.taken_at || a.date).localeCompare(String(b.taken_at || b.date))).slice(0, opts.maxPhotosPerGroup || 3);
  }

  // Time budget: intro + outro + glides + photo holds fixed; drawing gets the rest by √km.
  const intro = opts.intro ?? 3, outro = opts.outro ?? 4, photoSec = opts.photoSeconds ?? 2.2;
  const glideFor = (a, b) => Math.min(2.4, 0.7 + Math.hypot(b.cx - a.cx, b.cy - a.cy) * 2 ** Math.min(a.zoom, b.zoom) / (W * 6));
  let prev = all, fixed = intro + outro;
  for (const g of groups) { g.glide = glideFor(prev, g.cam); prev = g.cam; fixed += g.glide + g.photos.length * photoSec; }
  const weights = groups.map((g) => Math.sqrt(Math.max(0.5, g.km)));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const drawBudget = Math.max(groups.length * 0.6, (opts.seconds || 90) - fixed);
  groups.forEach((g, i) => { g.draw = Math.max(0.6, (weights[i] / wsum) * drawBudget); });

  // Lay the events out.
  const events = [];
  let t = 0;
  events.push({ kind: 'intro', t0: 0, t1: intro, from: all, to: all });
  t = intro;
  prev = all;
  let kmSoFar = 0;
  for (const g of groups) {
    events.push({ kind: 'glide', t0: t, t1: t + g.glide, from: prev, to: g.cam, g });
    t += g.glide;
    const gkm = g.routes.reduce((a, r) => a + Math.max(0.05, r.distance_km || 0), 0);
    let tr = t;
    for (const r of g.routes) {
      const d = (g.draw * Math.max(0.05, r.distance_km || 0)) / gkm;
      events.push({ kind: 'draw', t0: tr, t1: tr + d, cam: g.cam, route: r, cum: cumulative(r.coords), km0: kmSoFar, g });
      tr += d; kmSoFar += r.distance_km || 0;
    }
    t += g.draw;
    for (const p of g.photos) { events.push({ kind: 'photo', t0: t, t1: t + photoSec, cam: g.cam, photo: p, g, km0: kmSoFar }); t += photoSec; }
    prev = g.cam;
  }
  events.push({ kind: 'outro', t0: t, t1: t + outro, from: prev, to: all, km0: kmSoFar });
  const duration = t + outro;

  // done-set per event index, built once so frame(t) is O(log n).
  const doneBefore = [];
  const acc = [];
  for (const e of events) { doneBefore.push(acc.length); if (e.kind === 'draw') acc.push(e.route.id); }

  const pitch = opts.pitch || 0, drift = opts.drift ? 6 : 0;
  const toCam = (c, tt) => ({ center: [unx(c.cx), uny(c.cy)], zoom: c.zoom, bearing: drift ? Math.sin(tt / 9) * drift : 0, pitch });

  function frame(tt) {
    tt = Math.max(0, Math.min(duration - 1e-6, tt));
    let lo = 0, hi = events.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (events[mid].t0 <= tt) lo = mid; else hi = mid - 1; }
    const e = events[lo], f = (tt - e.t0) / Math.max(1e-6, e.t1 - e.t0);
    const done = new Set(acc.slice(0, doneBefore[lo]));
    const out = { t: tt, done, active: null, caption: null, km: e.km0 || 0, card: null, photo: null, progress: tt / duration };
    if (e.kind === 'intro') { out.camera = toCam(all, tt); out.card = { kind: 'title', f }; }
    else if (e.kind === 'outro') { out.camera = toCam(glide(e.from, e.to, Math.min(1, f * 1.6), W), tt); out.card = { kind: 'end', f }; out.km = e.km0; }
    else if (e.kind === 'glide') {
      out.camera = toCam(glide(e.from, e.to, f, W), tt);
      const r0 = e.g.routes[0];
      out.caption = { date: r0.date, name: e.g.routes.length > 1 ? `${e.g.routes.length} journeys` : r0.name, f };
      out.km = (events.find((x) => x.kind === 'draw' && x.g === e.g) || { km0: 0 }).km0;
    } else if (e.kind === 'draw') {
      out.camera = toCam(e.cam, tt);
      out.active = { id: e.route.id, type: e.route.type, coords: sliceLine(e.route.coords, e.cum, smooth(f) * 0.3 + f * 0.7) };
      out.caption = { date: e.route.date, name: e.route.name, f: 1 };
      out.km = e.km0 + (e.route.distance_km || 0) * f;
    } else if (e.kind === 'photo') {
      out.camera = toCam(e.cam, tt);
      out.photo = { ...e.photo, f };
      out.caption = { date: e.photo.date, name: e.photo.caption || '', f: 1 };
    }
    return out;
  }
  return { duration, frame, groups, events };
}

export const FILM_SIZES = [
  { id: '1080p', label: '1080p — 16:9 (YouTube, TV)', w: 1920, h: 1080 },
  { id: '4k', label: '4K — 16:9', w: 3840, h: 2160 },
  { id: 'square', label: 'Square 1080 (Instagram post)', w: 1080, h: 1080 },
  { id: 'portrait45', label: 'Portrait 4:5 (Instagram)', w: 1080, h: 1350 },
  { id: 'vertical', label: 'Vertical 9:16 (Reels, TikTok, Stories)', w: 1080, h: 1920 },
  { id: '720p', label: '720p — quick draft', w: 1280, h: 720 },
];
