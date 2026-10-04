// #/draw — add a route by hand: click points on the map; the line follows
// roads, walking paths or cycle routes (OSRM on routing.openstreetmap.de,
// FOSSGIS fair-use servers), or straight lines for boats and off-trail hikes.
// Drag a point to move it, click it to remove it.
import { store, api, loadRoutes, esc, $, toast, fmtKm } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { resolveStyle } from '../lib/style.js';
import { TYPES, typeById } from '../lib/types.js';
import { buildRoute } from '../lib/gpx.js';
import { lengthKm, unionBbox } from '../lib/geo.js';
import { loadCountries, countriesFor } from '../lib/countries.js';

const PROFILES = [
  { id: 'car', label: 'Follow roads (driving)', osrm: 'routed-car' },
  { id: 'foot', label: 'Follow paths (walking)', osrm: 'routed-foot' },
  { id: 'hike', label: 'Follow hiking trails (mountains)', brouter: 'hiking-mountain' },
  { id: 'bike', label: 'Follow cycle routes', osrm: 'routed-bike' },
  { id: 'straight', label: 'Straight lines (boats, off-trail)', osrm: null },
];
const DEFAULT_PROFILE = { drive: 'car', taxi: 'car', bus: 'car', walk: 'hike', bike: 'bike', ski: 'straight', boat: 'straight', train: 'straight', flight: 'straight', other: 'car' };

export async function routeVia(profile, pts, signal) {
  const p = PROFILES.find((x) => x.id === profile);
  if (p && p.brouter && pts.length > 1) {
    // BRouter (open source, brouter.de): knows trail grades and SAC scales, so it follows real hiking paths.
    const r = await fetch(`https://brouter.de/brouter?lonlats=${pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join('|')}&profile=${p.brouter}&alternativeidx=0&format=geojson`, { signal });
    if (!r.ok) throw new Error(`Hiking router: ${r.status}`);
    const j = await r.json();
    const c = j.features && j.features[0] && j.features[0].geometry.coordinates;
    if (!c || c.length < 2) throw new Error('No trail between those points');
    return c.map(([x, y]) => [x, y]);
  }
  if (!p || !p.osrm || pts.length < 2) return pts.slice();
  const url = `https://routing.openstreetmap.de/${p.osrm}/route/v1/driving/${pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(';')}?overview=full&geometries=geojson`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Routing service: ${r.status}`);
  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(j.message || 'No route between those points');
  return j.routes[0].geometry.coordinates;
}

export async function render(el) {
  const waypoints = []; // { lngLat:[lon,lat], marker }
  let line = [], controller = null, type = 'drive', profile = 'car';

  el.innerHTML = `<div class="ws ws-2"><aside class="ws-panel"><div class="ws-panel-body" style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
      <div class="row-between"><a class="btn ghost sm" href="#/map">← Map</a><span class="help">Draw a route</span></div>
      <p class="help">Click the map to add points. Drag a point to move it; click a point to remove it.</p>
      <div class="field"><label>Name</label><input class="input" id="name" placeholder="e.g. Ferry to Lofoten"></div>
      <div class="field-row"><div class="field"><label>Date</label><input class="input" type="date" id="date"></div>
        <div class="field"><label>Type</label><select class="select" id="type">${TYPES.map((t) => `<option value="${t.id}" ${t.id === type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Line</label><select class="select" id="profile">${PROFILES.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></div>
      <div class="kpi"><div><b id="km">0</b><span>km</span></div><div><b id="pts">0</b><span>points</span></div></div>
      <div class="help" id="status"></div>
      <div class="toolbar"><button class="btn sm" id="undo">Undo</button><button class="btn sm" id="reverse">Reverse</button><button class="btn sm" id="clear">Clear</button></div>
      <button class="btn primary" id="save" disabled>Save route</button>
      <p class="help">Open-source routing on OpenStreetMap: OSRM (routing.openstreetmap.de) for roads, paths and bikes; BRouter (brouter.de) for hiking trails. Both are free community services — fair use.</p>
    </div></aside>
    <section class="ws-map"><div class="map" id="map"></div></section></div>`;

  const atlas = await createAtlas($('#map', el), { spec: resolveStyle(store.styles[0].spec) });
  const others = store.routes.filter((r) => !r.hidden);
  atlas.setRoutes(others);
  atlas.setDimmed(others.map((r) => r.id));
  atlas.fit(unionBbox(others.map((r) => r.bbox)), { duration: 0 });
  atlas.map.getCanvas().style.cursor = 'crosshair';

  const color = () => typeById(type).color;
  async function recompute() {
    $('#pts', el).textContent = waypoints.length;
    $('#save', el).disabled = waypoints.length < 2;
    const pts = waypoints.map((w) => w.lngLat);
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      $('#status', el).textContent = pts.length > 1 && profile !== 'straight' ? 'Finding the way…' : '';
      line = await routeVia(profile, pts, controller.signal);
      $('#status', el).textContent = '';
    } catch (e) {
      if (e.name === 'AbortError') return;
      line = pts.slice();
      $('#status', el).innerHTML = `<span class="status-err">${esc(e.message)} — drawing straight lines.</span>`;
    }
    atlas.setActive(line.length ? line : null, { color: color(), width: 4, head: 0 });
    $('#km', el).textContent = fmtKm(lengthKm(line));
  }

  function addPoint(lngLat, at = waypoints.length) {
    const node = document.createElement('div');
    node.className = 'wp-marker';
    const marker = new window.maplibregl.Marker({ element: node, draggable: true }).setLngLat(lngLat).addTo(atlas.map);
    const wp = { lngLat, marker };
    marker.on('dragend', () => { const p = marker.getLngLat(); wp.lngLat = [p.lng, p.lat]; recompute(); });
    node.addEventListener('click', (e) => { e.stopPropagation(); marker.remove(); waypoints.splice(waypoints.indexOf(wp), 1); recompute(); });
    waypoints.splice(at, 0, wp);
    recompute();
  }

  atlas.map.on('click', (e) => addPoint([e.lngLat.lng, e.lngLat.lat]));
  $('#type', el).onchange = (e) => { type = e.target.value; profile = DEFAULT_PROFILE[type] || 'car'; $('#profile', el).value = profile; recompute(); };
  $('#profile', el).onchange = (e) => { profile = e.target.value; recompute(); };
  $('#undo', el).onclick = () => { const w = waypoints.pop(); if (w) { w.marker.remove(); recompute(); } };
  $('#clear', el).onclick = () => { while (waypoints.length) waypoints.pop().marker.remove(); recompute(); };
  $('#reverse', el).onclick = () => { waypoints.reverse(); recompute(); };
  $('#save', el).onclick = async () => {
    if (line.length < 2) return;
    const name = $('#name', el).value.trim() || `${typeById(type).label.split(' /')[0]} route`;
    const r = buildRoute(line, { fileName: name, type, sourceKind: 'manual' });
    r.name = name;
    const date = $('#date', el).value;
    r.date = date || null; r.date_source = date ? 'manual' : null;
    try { r.country = countriesFor(await loadCountries(), line); } catch (_) { /* optional */ }
    try {
      await api('POST', '/api/routes/import', { routes: [r] });
      await loadRoutes(true);
      toast(`Saved “${name}”`);
      location.hash = '#/map';
    } catch (e) { toast(e.message, 'err'); }
  };
  return () => atlas.destroy();
}
