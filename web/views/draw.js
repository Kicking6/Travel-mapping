// #/draw — draw a route by hand, Google-Maps style. Click to add points; each
// leg follows roads, paths, hiking trails or cycle routes (OSRM on
// routing.openstreetmap.de and BRouter on brouter.de — free, open-source,
// OpenStreetMap), or runs straight, or is drawn freehand with the mouse.
// Drag a point to move it; drag the line to add a via point; click a point
// for options. Underneath: the street map with roads on, OpenTopoMap, or
// satellite imagery (Esri World Imagery, Sentinel-2 cloudless) — only here,
// never on the album maps. An image (a park map, a screenshot) can be laid
// over the map and pinned by its corners to trace from.
import { store, api, loadRoutes, esc, $, toast, fmtKm } from '../app.js';
import { createAtlas, classify } from '../map/atlas.js';
import { resolveStyle } from '../lib/style.js';
import { TYPES, typeById } from '../lib/types.js';
import { buildRoute } from '../lib/gpx.js';
import { lengthKm, haversineKm, unionBbox, simplify } from '../lib/geo.js';
import { loadCountries, countriesFor } from '../lib/countries.js';

const PROFILES = [
  { id: 'car', label: 'Roads (driving)', osrm: 'routed-car', help: 'Follows the road network.' },
  { id: 'foot', label: 'Paths (walking)', osrm: 'routed-foot', help: 'Footpaths, pavements and quiet roads.' },
  { id: 'hike', label: 'Hiking trails', brouter: 'hiking-mountain', help: 'Mountain and hiking trails, graded paths (BRouter).' },
  { id: 'bike', label: 'Cycle routes', osrm: 'routed-bike', help: 'Cycleways and bike-friendly roads.' },
  { id: 'straight', label: 'Straight lines', help: 'Boats, off-trail, anything with no path.' },
  { id: 'freehand', label: 'Freehand (draw)', help: 'Press and drag on the map to draw. Hold Space to pan.' },
];
const DEFAULT_PROFILE = { drive: 'car', taxi: 'car', bus: 'car', walk: 'hike', bike: 'bike', ski: 'straight', boat: 'straight', train: 'straight', flight: 'straight', other: 'car' };
const SPEED = { drive: 70, taxi: 50, bus: 50, train: 80, boat: 25, walk: 4.5, bike: 16, ski: 12, flight: 750, other: 40 }; // km/h for legs with no router estimate

const BASES = [
  { id: 'map', label: 'Map' },
  { id: 'topo', label: 'Topo', tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), maxzoom: 17,
    attribution: 'Topo: © <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (CC-BY-SA), SRTM' },
  { id: 'sat', label: 'Satellite', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19,
    attribution: 'Imagery © <a href="https://www.esri.com" target="_blank">Esri</a>, Maxar, Earthstar Geographics, GIS User Community' },
  { id: 's2', label: 'Sentinel-2', tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'], maxzoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless 2024</a> by EOX (modified Copernicus data), CC BY-NC-SA' },
];
const VIEW_PREF = 'ta-draw-view';

const key6 = ([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
const legCache = new Map(); // profile|a|b → Promise<{coords, dur}>

async function fetchLeg(profile, a, b, signal) {
  const p = PROFILES.find((x) => x.id === profile);
  if (p && p.brouter) {
    // BRouter knows trail grades and SAC scales, so it follows real hiking paths.
    const r = await fetch(`https://brouter.de/brouter?lonlats=${key6(a)}|${key6(b)}&profile=${p.brouter}&alternativeidx=0&format=geojson`, { signal });
    if (!r.ok) throw new Error(`Hiking router: ${r.status}`);
    const j = await r.json();
    const f = j.features && j.features[0];
    const c = f && f.geometry.coordinates;
    if (!c || c.length < 2) throw new Error('No trail between those points');
    return { coords: c.map(([x, y]) => [x, y]), dur: (f.properties && +f.properties['total-time']) || null };
  }
  const r = await fetch(`https://routing.openstreetmap.de/${p.osrm}/route/v1/driving/${key6(a)};${key6(b)}?overview=full&geometries=geojson`, { signal });
  if (!r.ok) throw new Error(`Routing service: ${r.status}`);
  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(j.message || 'No route between those points');
  return { coords: j.routes[0].geometry.coordinates, dur: j.routes[0].duration };
}
// A whole list of points through one profile, leg by leg.
export async function routeVia(profile, pts, signal) {
  if (!['car', 'foot', 'hike', 'bike'].includes(profile) || pts.length < 2) return pts.slice();
  const out = [];
  for (let i = 1; i < pts.length; i++) { const { coords } = await fetchLeg(profile, pts[i - 1], pts[i], signal); out.push(...(out.length ? coords.slice(1) : coords)); }
  return out;
}

const fmtDur = (s) => { if (!s) return '—'; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
const onHandle = (ev) => ev.target && ev.target.closest && ev.target.closest('.wp-marker, .img-handle, .maplibregl-popup');

export async function render(el) {
  let view = { base: 'map', labels: true, trails: true, mine: true, imagery: 1 };
  try { view = { ...view, ...JSON.parse(localStorage.getItem(VIEW_PREF) || '{}') }; } catch (_) { /* private mode */ }
  view.roads = view.base !== 'topo'; // roads always start on in draw mode (topo draws its own)
  const saveView = () => { try { localStorage.setItem(VIEW_PREF, JSON.stringify({ base: view.base, labels: view.labels, trails: view.trails, mine: view.mine, imagery: view.imagery })); } catch (_) { /* private mode */ } };

  let wps = [];            // [{ lngLat }]
  let legs = [];           // legs[i] joins wps[i] → wps[i+1]: { profile, free?: coords }
  let legCoords = [], legDur = [], legErr = [];
  let type = 'drive', mode = DEFAULT_PROFILE.drive;
  let gen = 0, quietUntil = 0;
  const undo = [], redo = [];
  const hush = () => { quietUntil = performance.now() + 350; }; // swallow the click that ends a drag

  el.innerHTML = `<div class="ws ws-2"><aside class="ws-panel"><div class="ws-panel-body draw-panel">
      <div class="row-between"><a class="btn ghost sm" href="#/map">← Map</a><span class="help">Draw a route</span></div>
      <div class="draw-search"><input class="input" id="q" type="search" placeholder="Search a place, trail head, hut…" autocomplete="off"><div class="draw-results" id="results" hidden></div></div>
      <div class="field"><label for="name">Name</label><input class="input" id="name" placeholder="e.g. Trolltunga hike"></div>
      <div class="field draw-when"><label for="date">Date <span class="req" id="dateReq">needed to place it in the album</span></label>
        <div class="date-line"><button type="button" class="btn sm" id="dateBack" title="One day earlier" aria-label="One day earlier">‹</button><input class="input" type="date" id="date"><button type="button" class="btn sm" id="dateFwd" title="One day later" aria-label="One day later">›</button></div>
        <div class="chips" id="dateChips" hidden></div>
        <span class="hint" id="dateHint"></span></div>
      <div class="field"><label for="type">Type</label><select class="select" id="type">${TYPES.map((t) => `<option value="${t.id}" ${t.id === type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="mode">Snap new legs to</label><select class="select" id="mode">${PROFILES.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select><span class="hint" id="modeHelp"></span></div>
      <div class="draw-tools">
        <button class="btn sm" id="undo" title="Undo (⌘Z)">Undo</button><button class="btn sm" id="redo" title="Redo (⇧⌘Z)">Redo</button>
        <button class="btn sm" id="reverse" title="Swap start and end">Reverse</button><button class="btn sm" id="loop" title="Join the end back to the start">Close loop</button>
        <button class="btn sm" id="outback" title="Come back the same way">Out &amp; back</button><button class="btn sm" id="fitLine" title="Zoom to the route">Zoom to</button>
        <button class="btn sm ghost" id="clear">Clear</button>
      </div>
      <div class="kpi"><div><b id="km">0</b><span>km</span></div><div><b id="time">—</b><span>est. time</span></div><div><b id="up">—</b><span>m up</span></div><div><b id="down">—</b><span>m down</span></div></div>
      <div class="elev" id="elev" hidden><svg id="elevSvg" viewBox="0 0 300 80" preserveAspectRatio="none"></svg><div class="help" id="elevNote"></div></div>
      <div class="help" id="status"></div>
      <div class="legs" id="legs"></div>
      <details class="field"><summary class="help" style="cursor:pointer">Notes</summary><textarea class="input" id="notes" rows="3" placeholder="Anything to remember about this route"></textarea></details>
      <div class="draw-save"><button class="btn primary" id="save" disabled>Save route</button><button class="btn" id="saveMore" disabled title="Save, then start a new one here">Save &amp; draw another</button></div>
      <details class="draw-overlay"><summary><strong>Trace from an image</strong> <span class="help">park map, screenshot, aerial photo</span></summary>
        <p class="help">Lay a picture over the map, then drag its corners onto matching spots (the middle handle moves it). It stays in this browser tab only — nothing is uploaded.</p>
        <input type="file" id="imgFile" accept="image/*">
        <div id="imgCtl" hidden>
          <label class="range-line"><span>Opacity</span><input type="range" id="imgOp" min="0.1" max="1" step="0.05" value="0.7"><output id="imgOpOut">0.7</output></label>
          <div class="toolbar"><button class="btn sm" id="imgLock">Lock corners</button><button class="btn sm ghost" id="imgRemove">Remove image</button></div>
        </div>
      </details>
      <p class="help">Keys: ⌘Z undo · ⇧⌘Z redo · Delete removes the last point · right-click a point removes it · Esc closes menus.</p>
      <p class="help">Routing: OSRM (routing.openstreetmap.de) and BRouter (brouter.de) on OpenStreetMap; place search by Photon (komoot); elevation by Open-Meteo. Free community services — fair use.</p>
    </div></aside>
    <section class="ws-map draw-map"><div class="map" id="map"></div>
      <div class="map-float tl draw-view">
        <div class="seg" id="bases">${BASES.map((b) => `<button type="button" data-base="${b.id}" class="${b.id === view.base ? 'on' : ''}">${esc(b.label)}</button>`).join('')}</div>
        <div class="draw-toggles">
          <label class="switch"><input type="checkbox" id="vRoads" ${view.roads ? 'checked' : ''}><span class="track"></span>Roads</label>
          <label class="switch"><input type="checkbox" id="vLabels" ${view.labels ? 'checked' : ''}><span class="track"></span>Names</label>
          <label class="switch" title="Footpaths and tracks from OpenStreetMap (zoom in)"><input type="checkbox" id="vTrails" ${view.trails ? 'checked' : ''}><span class="track"></span>Trails</label>
          <label class="switch" title="Routes already saved — outlined in white so they stand out on any map"><input type="checkbox" id="vMine" ${view.mine ? 'checked' : ''}><span class="track"></span>Our routes <span class="help">(${store.routes.filter((r) => !r.hidden).length})</span></label>
        </div>
        <label class="range-line" id="imageryLine" ${view.base === 'map' ? 'hidden' : ''}><span>Imagery</span><input type="range" id="vImagery" min="0.2" max="1" step="0.05" value="${view.imagery}"><output>${Math.round(view.imagery * 100)}%</output></label>
      </div>
      <div class="map-float bl draw-hint" id="hint">Click the map to start.</div>
    </section></div>`;

  let styleId = null;
  try { styleId = JSON.parse(localStorage.getItem('ta-explore') || '{}').styleId; } catch (_) { /* private mode */ }
  const baseSpec = resolveStyle((store.styles.find((s) => s.id === styleId) || store.styles[0]).spec);
  // The draw page's own look: full detail, roads and names on, nothing fancy.
  function drawSpec() {
    const s = structuredClone(baseSpec);
    const img = view.base !== 'map';
    s.detail = { ...s.detail, coastline: 'osm', baseLevel: 0, routeSimplify: 0 };
    s.projection = 'mercator'; s.terrain3d.show = false;
    s.layers.roads = { ...s.layers.roads, show: view.roads, density: 'all' };
    s.layers.ferries.show = true;
    s.labels = { ...s.labels, show: view.labels, density: 'all', ...(img ? { color: '#ffffff', halo: '#1b1b1b' } : {}) };
    s.routeFx.glow.show = false; s.routeFx.arrows.show = false;
    s.routeOpacity = 0.6;
    return s;
  }

  const atlas = await createAtlas($('#map', el), { spec: drawSpec() });
  const map = atlas.map;
  const others = store.routes.filter((r) => !r.hidden);
  atlas.setVisible([]); // existing routes are drawn by our own layers below — the atlas's faded ones vanish into dark maps
  atlas.setPlaces(store.places);
  atlas.fit(unionBbox(others.map((r) => r.bbox)), { duration: 0 });

  // ── Base map, roads, trails, imagery ────────────────────────────────────
  const ours = (id) => id.startsWith('ta-') || id.startsWith('draw-');
  // Just under our route lines (the atlas's shading layers sit lower, under the water).
  const firstTa = () => ['ta-glow', 'ta-casing'].find((id) => map.getLayer(id));
  // Imagery goes under the roads, borders and names, so "Satellite" is a hybrid when those are on.
  const firstAboveImagery = () => (map.getStyle().layers.find((l) => !ours(l.id) && /^(roads|road-labels|poi-labels|labels-|countries|states|ferries)/.test(classify(l))) || {}).id || firstTa();
  const vectorSource = () => { const l = map.getStyle().layers.find((x) => x['source-layer'] === 'transportation'); return l && l.source; };

  function paintRoads() {
    // Roads that read at every zoom — the style's single width is tuned for albums, not for drawing.
    const img = view.base !== 'map';
    for (const l of map.getStyle().layers) {
      if (l.type !== 'line' || ours(l.id)) continue;
      const c = classify(l);
      if (c === 'roads-major') {
        map.setPaintProperty(l.id, 'line-color', img ? '#ffd54f' : '#e0a24a');
        map.setPaintProperty(l.id, 'line-width', ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.5, 10, 1.3, 14, 3.5, 18, 12]);
      } else if (c === 'roads-minor') {
        map.setPaintProperty(l.id, 'line-color', img ? 'rgba(255,255,255,0.85)' : '#b9b1a3');
        map.setPaintProperty(l.id, 'line-width', ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.3, 13, 0.9, 16, 3, 18, 8]);
      }
    }
  }
  function syncImagery() {
    const b = BASES.find((x) => x.id === view.base);
    if (map.getLayer('draw-base')) map.removeLayer('draw-base');
    if (map.getSource('draw-base')) map.removeSource('draw-base');
    if (b && b.tiles) {
      map.addSource('draw-base', { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution });
      map.addLayer({ id: 'draw-base', type: 'raster', source: 'draw-base', paint: { 'raster-opacity': view.imagery, 'raster-fade-duration': 150 } }, firstAboveImagery());
    }
    const src = vectorSource();
    if (map.getLayer('draw-trails')) map.removeLayer('draw-trails');
    if (src && view.trails) {
      map.addLayer({ id: 'draw-trails', type: 'line', source: src, 'source-layer': 'transportation', minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': view.base === 'map' ? '#a0522d' : '#ffab91', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 1.8, 17, 3], 'line-dasharray': [2, 1.6], 'line-opacity': 0.9 } }, firstTa());
    }
    $('#imageryLine', el).hidden = view.base === 'map';
  }
  async function applyView() {
    await atlas.setSpec(drawSpec());
    paintRoads();
    syncImagery();
    atlas.setVisible([]);
    syncMine();
    saveView();
  }
  paintRoads(); syncImagery();

  $('#bases', el).onclick = async (e) => {
    const b = e.target.closest('[data-base]'); if (!b) return;
    view.base = b.dataset.base;
    // Topo has its own roads and names; satellite wants ours on top (hybrid).
    view.roads = view.labels = view.base !== 'topo';
    $('#vRoads', el).checked = view.roads; $('#vLabels', el).checked = view.labels;
    el.querySelectorAll('[data-base]').forEach((x) => x.classList.toggle('on', x === b));
    await applyView();
  };
  $('#vRoads', el).onchange = (e) => { view.roads = e.target.checked; applyView(); };
  $('#vLabels', el).onchange = (e) => { view.labels = e.target.checked; applyView(); };
  $('#vTrails', el).onchange = (e) => { view.trails = e.target.checked; syncImagery(); saveView(); };
  $('#vMine', el).onchange = (e) => { view.mine = e.target.checked; syncMine(); saveView(); };
  $('#vImagery', el).oninput = (e) => {
    view.imagery = +e.target.value; e.target.nextElementSibling.textContent = `${Math.round(view.imagery * 100)}%`;
    if (map.getLayer('draw-base')) map.setPaintProperty('draw-base', 'raster-opacity', view.imagery);
    saveView();
  };

  // ── Our drawing layers ──────────────────────────────────────────────────
  const EMPTY = { type: 'FeatureCollection', features: [] };
  for (const id of ['draw-legs', 'draw-rubber', 'draw-stroke', 'draw-hover']) map.addSource(id, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'draw-casing', type: 'line', source: 'draw-legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw-legs', filter: ['!', ['get', 'pending']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4.5 } });
  map.addLayer({ id: 'draw-pending', type: 'line', source: 'draw-legs', filter: ['get', 'pending'], paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'draw-hit', type: 'line', source: 'draw-legs', paint: { 'line-color': '#000000', 'line-width': 16, 'line-opacity': 0 } });
  map.addLayer({ id: 'draw-rubber', type: 'line', source: 'draw-rubber', paint: { 'line-color': '#16202b', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.6 } });
  map.addLayer({ id: 'draw-stroke', type: 'line', source: 'draw-stroke', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#16202b', 'line-width': 3 } });
  map.addLayer({ id: 'draw-hover', type: 'circle', source: 'draw-hover', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#16202b', 'circle-stroke-width': 2.5 } });

  // Routes already saved: white-cased lines in their type colour, so they read on the dark, light and satellite maps alike.
  const mineData = () => ({ type: 'FeatureCollection', features: store.routes.filter((r) => !r.hidden).map((r) => ({ type: 'Feature', properties: { id: r.id, name: r.name || '', date: r.date || '', color: typeById(r.type).color, flight: r.type === 'flight' }, geometry: { type: 'LineString', coordinates: r.coords } })) });
  map.addSource('draw-mine', { type: 'geojson', data: mineData() });
  map.addLayer({ id: 'draw-mine-casing', type: 'line', source: 'draw-mine', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 12, 6], 'line-opacity': 0.9 } }, 'draw-casing');
  map.addLayer({ id: 'draw-mine-line', type: 'line', source: 'draw-mine', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 12, 3.5] } }, 'draw-casing');
  const syncMine = () => { for (const id of ['draw-mine-casing', 'draw-mine-line']) map.setLayoutProperty(id, 'visibility', view.mine ? 'visible' : 'none'); };
  syncMine();
  const mineTip = new window.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'mine-tip' });
  map.on('mousemove', 'draw-mine-line', (e) => {
    if (e.originalEvent.buttons) return;
    const p = e.features[0].properties;
    mineTip.setLngLat(e.lngLat).setHTML(`<strong>${esc(p.name)}</strong><br><span class="help">${p.date ? esc(p.date) : 'no date yet'}</span>`).addTo(map);
  });
  map.on('mouseleave', 'draw-mine-line', () => mineTip.remove());

  const color = () => typeById(type).color;
  const fullLine = () => { const out = []; legCoords.forEach((c) => { if (c) out.push(...(out.length ? c.slice(1) : c)); }); return out.length ? out : wps.map((w) => w.lngLat); };

  function drawLegs() {
    const feats = legs.map((l, i) => {
      const c = legCoords[i] || [wps[i].lngLat, wps[i + 1].lngLat];
      return { type: 'Feature', properties: { i, color: color(), pending: !legCoords[i] }, geometry: { type: 'LineString', coordinates: c } };
    });
    map.getSource('draw-legs').setData({ type: 'FeatureCollection', features: feats });
  }

  // ── History ─────────────────────────────────────────────────────────────
  const snap = () => JSON.stringify({ wps: wps.map((w) => w.lngLat), legs });
  const restore = (s) => { const o = JSON.parse(s); wps = o.wps.map((lngLat) => ({ lngLat })); legs = o.legs; recompute(); };
  function remember() { undo.push(snap()); if (undo.length > 200) undo.shift(); redo.length = 0; }
  const doUndo = () => { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); };
  const doRedo = () => { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); };

  // ── Points ──────────────────────────────────────────────────────────────
  let markers = [], popup = null;
  const closePopup = () => { if (popup) { popup.remove(); popup = null; } };
  function drawMarkers() {
    markers.forEach((m) => m.remove());
    markers = wps.map((w, i) => {
      const node = document.createElement('div');
      const last = i === wps.length - 1 && wps.length > 1;
      node.className = `wp-marker ${i === 0 ? 'start' : last ? 'end' : 'via'}`;
      node.textContent = i === 0 ? 'A' : last ? 'B' : '';
      node.title = `Point ${i + 1} — drag to move, click for options, right-click to remove`;
      const m = new window.maplibregl.Marker({ element: node, draggable: true }).setLngLat(w.lngLat).addTo(map);
      let moved = false, before = null;
      m.on('dragstart', () => { moved = true; before = snap(); closePopup(); });
      m.on('drag', () => { const p = m.getLngLat(); w.lngLat = [p.lng, p.lat]; previewAround(i); });
      m.on('dragend', () => { hush(); undo.push(before); redo.length = 0; recompute(); });
      node.addEventListener('click', (e) => { e.stopPropagation(); if (moved) { moved = false; return; } pointMenu(i); });
      node.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); removePoint(i); });
      return m;
    });
  }
  // While a point is dragged, the legs touching it go straight (freehand keeps its shape) until it's dropped.
  function previewAround(i) {
    for (const j of [i - 1, i]) if (j >= 0 && j < legs.length) legCoords[j] = legs[j].free ? [wps[j].lngLat, ...legs[j].free.slice(1, -1), wps[j + 1].lngLat] : null;
    drawLegs();
  }
  const profileOpts = (cur) => PROFILES.map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  function pointMenu(i) {
    closePopup();
    const html = `<div class="wp-menu"><strong>Point ${i + 1}</strong><span class="help">${wps[i].lngLat[1].toFixed(5)}, ${wps[i].lngLat[0].toFixed(5)}</span>
      ${i < legs.length ? `<label class="help">Next leg <select class="select sm" data-legmode>${profileOpts(legs[i].profile)}</select></label>` : ''}
      <div class="toolbar">${i > 0 && i < wps.length - 1 ? '<button class="btn sm" data-split>End the route here</button>' : ''}<button class="btn sm danger" data-remove>Remove point</button></div></div>`;
    popup = new window.maplibregl.Popup({ offset: 14, closeOnClick: true, maxWidth: '260px' }).setLngLat(wps[i].lngLat).setHTML(html).addTo(map);
    const pe = popup.getElement();
    pe.querySelector('[data-remove]').onclick = () => { closePopup(); removePoint(i); };
    const lm = pe.querySelector('[data-legmode]');
    if (lm) lm.onchange = () => { setLegMode(i, lm.value); closePopup(); };
    const sp = pe.querySelector('[data-split]');
    if (sp) sp.onclick = () => { closePopup(); remember(); wps = wps.slice(0, i + 1); legs = legs.slice(0, i); toast('Trimmed after this point — Undo brings the rest back'); recompute(); };
  }
  function setLegMode(i, profile) {
    remember();
    legs[i] = profile === 'freehand' ? { profile, free: legCoords[i] || [wps[i].lngLat, wps[i + 1].lngLat] } : { profile };
    recompute();
  }
  function removePoint(i) {
    remember();
    if (wps.length <= 2) { wps.splice(i, 1); legs = []; }
    else if (i === 0) { wps.shift(); legs.shift(); }
    else if (i === wps.length - 1) { wps.pop(); legs.pop(); }
    else {
      const a = legs[i - 1], b = legs[i];
      const merged = a.free || b.free
        ? { profile: 'freehand', free: [...(legCoords[i - 1] || [wps[i - 1].lngLat, wps[i].lngLat]), ...(legCoords[i] || [wps[i].lngLat, wps[i + 1].lngLat]).slice(1)] }
        : { profile: a.profile };
      wps.splice(i, 1); legs.splice(i - 1, 2, merged);
    }
    recompute();
  }
  function addPoint(lngLat, profile = mode) {
    remember();
    if (wps.length) legs.push(profile === 'freehand' ? { profile, free: [wps[wps.length - 1].lngLat, lngLat] } : { profile });
    wps.push({ lngLat });
    recompute();
  }

  // ── Routing ─────────────────────────────────────────────────────────────
  // Router requests are never cancelled: a finished one stays cached, so a leg
  // that was in flight when the next click came still lands.
  function leg(i) {
    const l = legs[i], a = wps[i].lngLat, b = wps[i + 1].lngLat;
    if (l.profile === 'freehand' && l.free) return Promise.resolve({ coords: [a, ...l.free.slice(1, -1), b], dur: null });
    if (l.profile === 'straight' || l.profile === 'freehand') return Promise.resolve({ coords: [a, b], dur: null });
    const k = `${l.profile}|${key6(a)}|${key6(b)}`;
    if (!legCache.has(k)) {
      const p = fetchLeg(l.profile, a, b);
      legCache.set(k, p);
      p.catch(() => legCache.delete(k)); // a failure is retried next time
    }
    return legCache.get(k);
  }
  async function recompute() {
    const g = ++gen;
    closePopup();
    drawMarkers();
    legCoords = legs.map(() => null); legDur = legs.map(() => null); legErr = legs.map(() => null);
    ascent = descent = null; $('#elev', el).hidden = true;
    drawLegs(); stats(); drawLegList(); if (typeof dateChips === 'function') dateChips();
    map.getSource('draw-rubber').setData(EMPTY);
    const pending = legs.map((_, i) => leg(i).then((r) => {
      if (g !== gen) return;
      // Routers start at the nearest path; join the gap to the point itself, like Google's dotted connector.
      const a = wps[i].lngLat, b = wps[i + 1].lngLat, c = r.coords;
      legCoords[i] = [...(haversineKm(a, c[0]) > 0.003 ? [a] : []), ...c, ...(haversineKm(b, c[c.length - 1]) > 0.003 ? [b] : [])];
      legDur[i] = r.dur; drawLegs();
    }, (e) => {
      if (g !== gen) return;
      legCoords[i] = [wps[i].lngLat, wps[i + 1].lngLat]; legErr[i] = e.message; drawLegs();
    }));
    $('#status', el).textContent = legs.some((l) => !['straight', 'freehand'].includes(l.profile)) ? 'Finding the way…' : '';
    await Promise.all(pending);
    if (g !== gen) return;
    const errs = legErr.filter(Boolean);
    $('#status', el).innerHTML = errs.length ? `<span class="status-err">${esc(errs[0])} — that leg is drawn straight. Move a point or change its mode.</span>` : '';
    stats(); drawLegList(); elevation(g);
  }

  // ── Stats, legs list, elevation ─────────────────────────────────────────
  let ascent = null, descent = null;
  function stats() {
    const line = fullLine();
    const km = wps.length > 1 ? lengthKm(line) : 0;
    $('#km', el).textContent = fmtKm(km);
    let secs = 0;
    legs.forEach((l, i) => { const lk = legCoords[i] ? lengthKm(legCoords[i]) : 0; secs += legDur[i] || (lk / SPEED[type]) * 3600; });
    if (type === 'walk' && ascent != null) secs = (km / 5 + ascent / 600) * 3600; // Naismith's rule for hikes
    $('#time', el).textContent = wps.length > 1 ? fmtDur(secs) : '—';
    $('#up', el).textContent = ascent != null ? Math.round(ascent).toLocaleString() : '—';
    $('#down', el).textContent = descent != null ? Math.round(descent).toLocaleString() : '—';
    $('#save', el).disabled = $('#saveMore', el).disabled = wps.length < 2;
    $('#hint', el).textContent = mode === 'freehand' ? 'Drag on the map to draw · hold Space to pan'
      : !wps.length ? 'Click the map to start.' : wps.length === 1 ? 'Click to add the next point.' : 'Click to extend · drag the line to reshape · drag points to move';
  }
  function drawLegList() {
    if (!legs.length) { $('#legs', el).innerHTML = ''; return; }
    const label = (i) => (i === 0 ? 'A' : i === wps.length - 1 ? 'B' : String(i + 1));
    $('#legs', el).innerHTML = `<div class="section-title">Legs</div>` + legs.map((l, i) => `<div class="leg-row">
        <span class="leg-n">${label(i)} → ${label(i + 1)}</span>
        <select class="select sm" data-leg="${i}">${profileOpts(l.profile)}</select>
        <span class="leg-km">${legCoords[i] ? fmtKm(lengthKm(legCoords[i])) + ' km' : '…'}${legErr[i] ? ` <span class="status-err" title="${esc(legErr[i])}">!</span>` : ''}</span></div>`).join('') +
      (legs.length > 1 ? `<button class="btn sm ghost" id="allMode">Use “${esc(PROFILES.find((p) => p.id === mode).label)}” for every leg</button>` : '');
    const all = $('#allMode', el);
    if (all) all.onclick = () => { remember(); legs = legs.map((l, i) => (mode === 'freehand' ? { profile: mode, free: legCoords[i] || [wps[i].lngLat, wps[i + 1].lngLat] } : { profile: mode })); recompute(); };
  }
  $('#legs', el).onchange = (e) => { const s = e.target.closest('[data-leg]'); if (s) setLegMode(+s.dataset.leg, s.value); };

  let elevPts = null;
  async function elevation(g) {
    const line = fullLine();
    elevPts = null;
    if (wps.length < 2 || line.length < 2) return;
    // ≤100 evenly spaced samples along the line — one Open-Meteo request.
    const cum = [0]; for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversineKm(line[i - 1], line[i]));
    const total = cum[cum.length - 1], n = Math.min(100, Math.max(2, Math.ceil(total * 10) + 1));
    const pts = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const d = (total * k) / (n - 1);
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const f = cum[j + 1] > cum[j] ? Math.min(1, (d - cum[j]) / (cum[j + 1] - cum[j])) : 0;
      pts.push({ d, c: [line[j][0] + (line[j + 1][0] - line[j][0]) * f, line[j][1] + (line[j + 1][1] - line[j][1]) * f] });
    }
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p.c[1].toFixed(5)).join(',')}&longitude=${pts.map((p) => p.c[0].toFixed(5)).join(',')}`);
      if (!r.ok) return;
      const { elevation: ev } = await r.json();
      if (g !== gen || !Array.isArray(ev) || ev.length !== pts.length) return;
      pts.forEach((p, i) => { p.e = ev[i]; });
      elevPts = pts;
      // Climbs counted over a 3 m deadband so terrain-model noise doesn't add up.
      let up = 0, down = 0, ref = ev[0];
      for (const e of ev) { if (e - ref > 3) { up += e - ref; ref = e; } else if (ref - e > 3) { down += ref - e; ref = e; } }
      ascent = up; descent = down;
      drawElevation(); stats();
    } catch (_) { /* elevation is a nice-to-have */ }
  }
  function drawElevation() {
    const pts = elevPts, svg = $('#elevSvg', el);
    const lo = Math.min(...pts.map((p) => p.e)), hi = Math.max(...pts.map((p) => p.e)), span = Math.max(20, hi - lo), D = pts[pts.length - 1].d || 1;
    const x = (d) => (d / D) * 300, y = (e) => 76 - ((e - lo) / span) * 68;
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join('');
    svg.innerHTML = `<path d="${path}L300,80L0,80Z" fill="var(--accent-tint)" stroke="none"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><line id="elevCursor" x1="0" x2="0" y1="0" y2="80" stroke="var(--ink)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
    $('#elevNote', el).textContent = `${Math.round(lo).toLocaleString()} – ${Math.round(hi).toLocaleString()} m above sea level · hover to find a spot on the map`;
    $('#elev', el).hidden = false;
  }
  $('#elevSvg', el).addEventListener('mousemove', (e) => {
    if (!elevPts) return;
    const r = e.currentTarget.getBoundingClientRect(), D = elevPts[elevPts.length - 1].d || 1, d = ((e.clientX - r.left) / r.width) * D;
    const p = elevPts.reduce((a, b) => (Math.abs(b.d - d) < Math.abs(a.d - d) ? b : a));
    const cur = $('#elevCursor', el); cur.setAttribute('x1', (p.d / D) * 300); cur.setAttribute('x2', (p.d / D) * 300); cur.setAttribute('visibility', 'visible');
    $('#elevNote', el).textContent = `${fmtKm(p.d)} km · ${Math.round(p.e).toLocaleString()} m`;
    map.getSource('draw-hover').setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p.c } });
  });
  $('#elevSvg', el).addEventListener('mouseleave', () => { map.getSource('draw-hover').setData(EMPTY); const c = $('#elevCursor', el); if (c) c.setAttribute('visibility', 'hidden'); });

  // ── Map gestures: click, drag the line, freehand, rubber band ───────────
  map.on('mousedown', () => { $('#results', el).hidden = true; });
  // A click that wobbles a few pixels (trackpads, tired hands) is still a click: MapLibre's own
  // 'click' ignores anything over 3 px and pans instead, which feels like "the map won't draw".
  let down = null, lastAdd = 0;
  map.on('mousedown', (e) => {
    const onLine = mode !== 'freehand' && map.queryRenderedFeatures(e.point, { layers: ['draw-hit'] }).length;
    down = e.originalEvent.button === 0 && !onLine && !onHandle(e.originalEvent) ? { x: e.point.x, y: e.point.y, t: performance.now(), ll: e.lngLat } : null;
  });
  map.on('mouseup', (e) => {
    const d = down; down = null;
    if (!d || mode === 'freehand' || spaceDown || performance.now() < quietUntil || onHandle(e.originalEvent)) return;
    if (Math.hypot(e.point.x - d.x, e.point.y - d.y) > 10 || performance.now() - d.t > 700) return;
    lastAdd = performance.now();
    addPoint([d.ll.lng, d.ll.lat]);
  });
  map.on('click', (e) => {
    if (performance.now() - lastAdd < 300 || performance.now() < quietUntil || onHandle(e.originalEvent)) return;
    addPoint([e.lngLat.lng, e.lngLat.lat]); // touch screens
  });
  // Press on the line (and drag): a new via point there, Google-Maps style.
  map.on('mousedown', 'draw-hit', (e) => {
    if (mode === 'freehand' || e.originalEvent.button !== 0 || onHandle(e.originalEvent)) return;
    const f = e.features && e.features[0]; if (!f) return;
    e.preventDefault();
    const i = f.properties.i, pt = [e.lngLat.lng, e.lngLat.lat];
    remember();
    const l = legs[i];
    let halves = [{ profile: l.profile }, { profile: l.profile }];
    if (l.free) {
      const c = legCoords[i] || l.free;
      let k = 0, best = Infinity; c.forEach((q, n) => { const d = haversineKm(q, pt); if (d < best) { best = d; k = n; } });
      halves = [{ profile: 'freehand', free: [...c.slice(0, k + 1), pt] }, { profile: 'freehand', free: [pt, ...c.slice(k + 1)] }];
    }
    wps.splice(i + 1, 0, { lngLat: pt });
    legs.splice(i, 1, ...halves);
    legCoords.splice(i, 1, null, null);
    const ghost = new window.maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'wp-marker via' }) }).setLngLat(pt).addTo(map);
    const move = (ev) => { wps[i + 1].lngLat = [ev.lngLat.lng, ev.lngLat.lat]; ghost.setLngLat(ev.lngLat); previewAround(i + 1); };
    map.on('mousemove', move);
    window.addEventListener('mouseup', () => { map.off('mousemove', move); ghost.remove(); hush(); recompute(); }, { once: true });
  });
  map.on('mouseenter', 'draw-hit', () => { if (mode !== 'freehand') map.getCanvas().style.cursor = 'grab'; });
  map.on('mouseleave', 'draw-hit', () => { map.getCanvas().style.cursor = ''; });

  // Freehand: press, drag, release. Space held = pan instead.
  let stroke = null, lastPx = null, spaceDown = false;
  const endStroke = () => {
    if (!stroke) return;
    const s = stroke; stroke = null;
    map.getSource('draw-stroke').setData(EMPTY);
    if (s.length < 3) return; // a click, not a stroke — the click handler adds a point
    hush();
    remember();
    const pts = simplify(s, 2);
    if (!wps.length) wps.push({ lngLat: pts[0] });
    legs.push({ profile: 'freehand', free: [wps[wps.length - 1].lngLat, ...pts] });
    wps.push({ lngLat: pts[pts.length - 1] });
    recompute();
  };
  map.on('mousedown', (e) => {
    if (mode !== 'freehand' || spaceDown || e.originalEvent.button !== 0 || onHandle(e.originalEvent)) return;
    e.preventDefault();
    stroke = [[e.lngLat.lng, e.lngLat.lat]]; lastPx = e.point;
    window.addEventListener('mouseup', endStroke, { once: true });
  });
  map.on('mousemove', (e) => {
    if (stroke) {
      if (Math.hypot(e.point.x - lastPx.x, e.point.y - lastPx.y) < 3) return;
      stroke.push([e.lngLat.lng, e.lngLat.lat]); lastPx = e.point;
      const from = wps.length ? [wps[wps.length - 1].lngLat] : [];
      map.getSource('draw-stroke').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...from, ...stroke] } });
      return;
    }
    // The rubber band from the last point to the cursor.
    if (wps.length && mode !== 'freehand' && !e.originalEvent.buttons) {
      map.getSource('draw-rubber').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [wps[wps.length - 1].lngLat, [e.lngLat.lng, e.lngLat.lat]] } });
    }
  });
  map.getCanvas().addEventListener('mouseleave', () => { if (map.getSource('draw-rubber')) map.getSource('draw-rubber').setData(EMPTY); });
  const setMode = (m) => {
    mode = m; $('#mode', el).value = m;
    $('#modeHelp', el).textContent = PROFILES.find((p) => p.id === m).help;
    if (m === 'freehand') map.dragPan.disable(); else map.dragPan.enable();
    el.querySelector('.draw-map').classList.toggle('freehand', m === 'freehand');
    map.getSource('draw-rubber').setData(EMPTY);
    stats(); drawLegList();
  };
  setMode(mode);

  // ── Search (Photon, OpenStreetMap) ──────────────────────────────────────
  let searchCtl = null, results = [];
  const runSearch = async () => {
    const q = $('#q', el).value.trim(), box = $('#results', el);
    if (q.length < 3) { box.hidden = true; return; }
    if (searchCtl) searchCtl.abort();
    searchCtl = new AbortController();
    const c = map.getCenter();
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`, { signal: searchCtl.signal });
      const j = await r.json();
      results = j.features || [];
      box.innerHTML = results.length ? results.map((f, i) => {
        const p = f.properties, sub = [p.city || p.county, p.state, p.country].filter(Boolean).join(', ');
        return `<div class="draw-result"><button type="button" data-go="${i}"><strong>${esc(p.name || p.street || 'Unnamed')}</strong><span class="help">${esc([p.osm_value && p.osm_value.replace(/_/g, ' '), sub].filter(Boolean).join(' · '))}</span></button><button type="button" class="btn sm" data-add="${i}" title="Add as the next point">＋ point</button></div>`;
      }).join('') : '<p class="help" style="padding:8px">Nothing found.</p>';
      box.hidden = false;
    } catch (e) { if (e.name !== 'AbortError') { box.innerHTML = '<p class="help" style="padding:8px">Search is unavailable right now.</p>'; box.hidden = false; } }
  };
  let searchTimer = null;
  $('#q', el).oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 300); };
  $('#q', el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); runSearch(); } if (e.key === 'Escape') $('#results', el).hidden = true; };
  $('#results', el).onclick = (e) => {
    const go = e.target.closest('[data-go]'), add = e.target.closest('[data-add]');
    if (!go && !add) return;
    const f = results[+(go ? go.dataset.go : add.dataset.add)];
    if (!f) return;
    const [x, y] = f.geometry.coordinates;
    if (f.properties.extent) { const [w, n, ea, s] = f.properties.extent; map.fitBounds([[w, s], [ea, n]], { padding: 60, maxZoom: 15 }); } else map.flyTo({ center: [x, y], zoom: Math.max(map.getZoom(), 13) });
    if (add) addPoint([x, y]);
    $('#results', el).hidden = true;
  };

  // ── Image overlay (trace from a picture) ────────────────────────────────
  let img = null; // { url, corners: [tl,tr,br,bl], handles: Marker[], locked }
  function placeImage(url, w, h) {
    removeImage();
    const cv = map.getCanvas().getBoundingClientRect();
    const boxH = Math.min(cv.height * 0.7, (cv.width * 0.6 * h) / w), bw = (boxH * w) / h;
    const cx = cv.width / 2, cy = cv.height / 2;
    const px = [[cx - bw / 2, cy - boxH / 2], [cx + bw / 2, cy - boxH / 2], [cx + bw / 2, cy + boxH / 2], [cx - bw / 2, cy + boxH / 2]];
    const corners = px.map((p) => { const l = map.unproject(p); return [l.lng, l.lat]; });
    map.addSource('draw-img', { type: 'image', url, coordinates: corners });
    map.addLayer({ id: 'draw-img', type: 'raster', source: 'draw-img', paint: { 'raster-opacity': +$('#imgOp', el).value, 'raster-fade-duration': 0 } }, 'draw-casing');
    img = { url, corners, handles: [], locked: false };
    const handles = corners.map((c, k) => {
      const node = Object.assign(document.createElement('div'), { className: 'img-handle', title: 'Drag onto a matching spot on the map' });
      const m = new window.maplibregl.Marker({ element: node, draggable: true }).setLngLat(c).addTo(map);
      m.on('drag', () => { const p = m.getLngLat(); img.corners[k] = [p.lng, p.lat]; map.getSource('draw-img').setCoordinates(img.corners); });
      m.on('dragend', hush);
      return m;
    });
    // The middle handle moves the whole picture.
    const mid = Object.assign(document.createElement('div'), { className: 'img-handle move', title: 'Drag to move the picture' });
    const centre = () => [img.corners.reduce((a, c) => a + c[0], 0) / 4, img.corners.reduce((a, c) => a + c[1], 0) / 4];
    const mm = new window.maplibregl.Marker({ element: mid, draggable: true }).setLngLat(centre()).addTo(map);
    let start = null;
    mm.on('dragstart', () => { start = { c: centre(), corners: img.corners.map((c) => c.slice()) }; });
    mm.on('drag', () => {
      const p = mm.getLngLat(), dx = p.lng - start.c[0], dy = p.lat - start.c[1];
      img.corners = start.corners.map(([x, y]) => [x + dx, y + dy]);
      map.getSource('draw-img').setCoordinates(img.corners);
      img.corners.forEach((c, k) => handles[k].setLngLat(c));
    });
    mm.on('dragend', hush);
    handles.forEach((hd) => hd.on('dragend', () => mm.setLngLat(centre())));
    img.handles = [...handles, mm];
    $('#imgCtl', el).hidden = false;
    $('#imgLock', el).textContent = 'Lock corners';
  }
  function removeImage() {
    if (!img) return;
    img.handles.forEach((hd) => hd.remove());
    if (map.getLayer('draw-img')) map.removeLayer('draw-img');
    if (map.getSource('draw-img')) map.removeSource('draw-img');
    URL.revokeObjectURL(img.url);
    img = null;
    $('#imgCtl', el).hidden = true;
    $('#imgFile', el).value = '';
  }
  $('#imgFile', el).onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const probe = new Image();
    probe.onload = () => placeImage(url, probe.naturalWidth, probe.naturalHeight);
    probe.onerror = () => { URL.revokeObjectURL(url); toast('That file is not an image the browser can open', 'err'); };
    probe.src = url;
  };
  $('#imgOp', el).oninput = (e) => { $('#imgOpOut', el).textContent = e.target.value; if (map.getLayer('draw-img')) map.setPaintProperty('draw-img', 'raster-opacity', +e.target.value); };
  $('#imgLock', el).onclick = () => {
    if (!img) return;
    img.locked = !img.locked;
    img.handles.forEach((hd) => { hd.getElement().hidden = img.locked; });
    $('#imgLock', el).textContent = img.locked ? 'Unlock corners' : 'Lock corners';
  };
  $('#imgRemove', el).onclick = removeImage;

  // ── Date: picker, ‹ › nudges, and the dates of saved routes passing nearby ──
  const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const shiftDay = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  function dateUI() {
    const d = $('#date', el).value, ts = store.trip && store.trip.trip_start;
    $('#dateReq', el).hidden = !!d;
    const day = d && ts ? Math.round((Date.parse(d) - Date.parse(ts)) / 86400000) + 1 : null;
    $('#dateHint', el).textContent = d ? `${fmtDay(d)}${day > 0 ? ` · day ${day} of the trip` : ''}` : '';
  }
  function dateChips() {
    const box = $('#dateChips', el), at = wps.length ? wps[0].lngLat : null;
    if (!at) { box.hidden = true; return; }
    const near = [];
    for (const r of store.routes) {
      if (!r.date || r.hidden) continue;
      let best = Infinity;
      const c = r.coordsLo || r.coords;
      for (let i = 0; i < c.length; i += Math.max(1, Math.floor(c.length / 400))) { const k = haversineKm(at, c[i]); if (k < best) best = k; }
      if (best < 25) near.push({ date: r.date, name: r.name, km: best });
    }
    near.sort((a, b) => a.km - b.km);
    const seen = new Set(), pick = near.filter((n) => !seen.has(n.date) && seen.add(n.date)).slice(0, 4);
    box.hidden = !pick.length;
    box.innerHTML = pick.length ? `<span class="help">Saved routes near the start:</span>${pick.map((n) => `<button type="button" class="chip" data-d="${n.date}" title="${esc(n.name || '')}">${esc(fmtDay(n.date).replace(/^\w+, /, ''))}</button>`).join('')}` : '';
  }
  $('#date', el).oninput = dateUI;
  $('#dateBack', el).onclick = () => { const i = $('#date', el); i.value = shiftDay(i.value || (store.trip && store.trip.trip_start) || new Date().toISOString().slice(0, 10), i.value ? -1 : 0); dateUI(); };
  $('#dateFwd', el).onclick = () => { const i = $('#date', el); i.value = shiftDay(i.value || (store.trip && store.trip.trip_start) || new Date().toISOString().slice(0, 10), i.value ? 1 : 0); dateUI(); };
  $('#dateChips', el).onclick = (e) => { const b = e.target.closest('[data-d]'); if (b) { $('#date', el).value = b.dataset.d; dateUI(); } };
  dateUI();

  // ── Panel controls ──────────────────────────────────────────────────────
  $('#type', el).onchange = (e) => { type = e.target.value; setMode(DEFAULT_PROFILE[type] || 'car'); drawLegs(); };
  $('#mode', el).onchange = (e) => setMode(e.target.value);
  $('#undo', el).onclick = doUndo;
  $('#redo', el).onclick = doRedo;
  $('#clear', el).onclick = () => { if (!wps.length) return; remember(); wps = []; legs = []; recompute(); };
  const flip = (l) => (l.free ? { ...l, free: l.free.slice().reverse() } : { ...l });
  $('#reverse', el).onclick = () => { if (wps.length < 2) return; remember(); wps.reverse(); legs = legs.reverse().map(flip); recompute(); };
  $('#loop', el).onclick = () => { if (wps.length < 2) return; addPoint(wps[0].lngLat.slice()); };
  $('#outback', el).onclick = () => {
    if (wps.length < 2) return;
    remember();
    wps = wps.concat(wps.slice(0, -1).reverse().map((w) => ({ lngLat: w.lngLat.slice() })));
    legs = legs.concat(legs.slice().reverse().map(flip));
    recompute();
  };
  $('#fitLine', el).onclick = () => {
    const line = fullLine(); if (!line.length) return;
    atlas.fit([Math.min(...line.map((p) => p[0])), Math.min(...line.map((p) => p[1])), Math.max(...line.map((p) => p[0])), Math.max(...line.map((p) => p[1]))], { maxZoom: 16 });
  };

  async function save(again) {
    const line = fullLine();
    if (wps.length < 2 || line.length < 2) return;
    const name = $('#name', el).value.trim() || `${typeById(type).label.split(' /')[0]} route`;
    const r = buildRoute(line, { fileName: name, type, sourceKind: 'manual' });
    r.name = name;
    const date = $('#date', el).value;
    if (!date && !confirm('No date set — this will sit under “No date yet” until you add one.\n\nSave without a date?')) { $('#date', el).focus(); return; }
    r.date = date || null; r.date_source = date ? 'manual' : null;
    const how = [...new Set(legs.map((l) => PROFILES.find((p) => p.id === l.profile).label))].join(', ');
    r.notes = [$('#notes', el).value.trim(), `Drawn by hand (${how})${ascent != null ? ` · ↑${Math.round(ascent)} m ↓${Math.round(descent)} m` : ''}`].filter(Boolean).join('\n');
    try { r.country = countriesFor(await loadCountries(), line); } catch (_) { /* optional */ }
    $('#save', el).disabled = $('#saveMore', el).disabled = true;
    try {
      await api('POST', '/api/routes/import', { routes: [r] });
      await loadRoutes(true);
      toast(`Saved “${name}”`);
      if (!again) { location.hash = '#/map'; return; }
      // Stay here; the saved route joins the faded ones.
      map.getSource('draw-mine').setData(mineData());
      remember(); wps = []; legs = []; $('#name', el).value = ''; $('#notes', el).value = '';
      recompute();
    } catch (e) { toast(e.message, 'err'); stats(); }
  }
  $('#save', el).onclick = () => save(false);
  $('#saveMore', el).onclick = () => save(true);

  const onKey = (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select');
    if (e.code === 'Space' && !typing) {
      if (e.type === 'keydown' && !spaceDown) { spaceDown = true; if (mode === 'freehand') map.dragPan.enable(); }
      if (e.type === 'keyup') { spaceDown = false; if (mode === 'freehand') map.dragPan.disable(); }
      e.preventDefault();
      return;
    }
    if (e.type !== 'keydown' || typing) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    else if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && wps.length) { e.preventDefault(); removePoint(wps.length - 1); }
    else if (e.key === 'Escape') { closePopup(); $('#results', el).hidden = true; }
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);

  recompute();
  return () => {
    document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey);
    if (img) URL.revokeObjectURL(img.url);
    atlas.destroy();
  };
}
