// The map. One instance drives the Map page, the album editor, the style
// editor and (offscreen, at print resolution) the exporter — so what you see
// is what prints.
//
// Every route is ONE feature in ONE GeoJSON source. The legacy app added a
// source + layer + three event handlers per route (hundreds of layers), which
// is why it froze; colour/width come from the style spec, selection and
// hover are feature-state.
import { BASEMAPS, PLACE_KINDS } from '../lib/style.js';
import { typeById } from '../lib/types.js';

const maplibregl = window.maplibregl;
const styleCache = new Map();

async function fetchBasemap(id) {
  const bm = BASEMAPS.find((b) => b.id === id) || BASEMAPS[0];
  if (!styleCache.has(bm.id)) styleCache.set(bm.id, fetch(bm.url).then((r) => { if (!r.ok) throw new Error('Basemap failed to load'); return r.json(); }));
  return structuredClone(await styleCache.get(bm.id));
}

// Lowest admin_level a boundary layer draws: walk its filter for admin_level
// comparisons ("==", "<=", "in", or the expression form). Positron's
// "boundary_3" is states (3–4), "boundary_2" countries; Liberty uses
// different ids, so the filter is the reliable signal.
function boundaryLevel(l) {
  let min = Infinity;
  (function walk(x) {
    if (!Array.isArray(x)) return;
    const i = x.findIndex((v) => v === 'admin_level' || (Array.isArray(v) && v[0] === 'get' && v[1] === 'admin_level'));
    if (i >= 0) {
      const op = x[0];
      const nums = x.slice(i + 1).flat().filter((n) => typeof n === 'number');
      if (op === '<=' || op === '<') min = Math.min(min, 0);
      else if (nums.length) min = Math.min(min, ...nums);
    }
    x.forEach(walk);
  })(l.filter);
  if (min === Infinity) return /disputed|country|_2\b/.test(l.id) ? 2 : 4;
  if (min === 0) return /state|province|_3|_4/.test(l.id) ? 4 : 2;
  return min;
}

// ── Basemap layer classification (OpenMapTiles schema, shared by all three
// OpenFreeMap styles). Classify by source-layer and filter, not layer id, so
// switching basemap never leaves a knob pointing at a layer that isn't there.
function classify(l) {
  const sl = l['source-layer'] || '';
  const f = JSON.stringify(l.filter || '') + ' ' + l.id;
  if (l.type === 'background') return 'background';
  if (sl === 'water' && l.type === 'fill') return 'water';
  if (sl === 'waterway' && l.type === 'line') return 'waterway';
  if (sl === 'boundary') return boundaryLevel(l) <= 2 ? 'countries' : 'states';
  if (sl === 'transportation') return /ferry/.test(f) ? 'ferries' : /motorway|trunk|primary/.test(f) && !/minor|service|track|path|street|tertiary|secondary/.test(l.id) ? 'roads-major' : 'roads-minor';
  if (sl === 'transportation_name') return 'road-labels';
  if (sl === 'park' || (sl === 'landcover' && /wood|forest|grass/.test(f)) || /park/.test(l.id)) return l.type === 'symbol' ? 'poi-labels' : 'parks';
  if (sl === 'landcover' || sl === 'landuse') return 'landuse';
  if (sl === 'building') return 'buildings';
  if (sl === 'aeroway') return 'aeroway';
  if (sl === 'place' && l.type === 'symbol') {
    if (/continent|country/.test(f)) return 'labels-country';
    if (/state|province/.test(f)) return 'labels-state';
    if (/city/.test(f) && !/town|village|hamlet|suburb/.test(l.id)) return 'labels-city';
    return 'labels-minor';
  }
  if (sl === 'water_name') return 'labels-water';
  if (l.type === 'symbol') return 'poi-labels';
  return 'other';
}

const LABEL_LEVEL = { countries: ['labels-country'], cities: ['labels-country', 'labels-state', 'labels-city', 'labels-water'], all: null };

function setP(map, id, prop, val) { try { map.setPaintProperty(id, prop, val); } catch (_) { /* layer lacks that property */ } }
function setL(map, id, prop, val) { try { map.setLayoutProperty(id, prop, val); } catch (_) { /* layer lacks that property */ } }
const vis = (b) => (b ? 'visible' : 'none');

function applyBase(map, spec) {
  const layers = map.getStyle().layers;
  const lv = spec.layers;
  for (const l of layers) {
    if (l.id.startsWith('ta-')) continue;
    const c = classify(l);
    let show = true;
    switch (c) {
      case 'background': setP(map, l.id, 'background-color', spec.background || spec.land); break;
      case 'water': setP(map, l.id, 'fill-color', spec.water); setP(map, l.id, 'fill-outline-color', spec.water); break;
      case 'waterway': setP(map, l.id, 'line-color', spec.water); break;
      case 'landuse': show = false; break;
      case 'aeroway': show = false; break;
      case 'parks': show = lv.parks.show; if (l.type === 'fill') { setP(map, l.id, 'fill-color', lv.parks.color); setP(map, l.id, 'fill-opacity', 0.7); } break;
      case 'buildings': show = lv.buildings.show; break;
      case 'countries': show = lv.countries.show; setP(map, l.id, 'line-color', lv.countries.color); setP(map, l.id, 'line-width', lv.countries.width); setP(map, l.id, 'line-dasharray', [1, 0]); break;
      case 'states': show = lv.states.show; setP(map, l.id, 'line-color', lv.states.color); setP(map, l.id, 'line-width', lv.states.width); break;
      case 'roads-major': show = lv.roads.show; setP(map, l.id, 'line-color', lv.roads.color); setP(map, l.id, 'line-width', lv.roads.width); break;
      case 'roads-minor': show = lv.roads.show && lv.roads.density === 'all'; setP(map, l.id, 'line-color', lv.roads.color); setP(map, l.id, 'line-width', lv.roads.width * 0.6); break;
      case 'ferries': show = lv.ferries.show; setP(map, l.id, 'line-color', lv.ferries.color); setP(map, l.id, 'line-width', lv.ferries.width); break;
      case 'road-labels': show = spec.labels.show && spec.labels.density === 'all' && lv.roads.show; break;
      case 'poi-labels': show = spec.labels.show && spec.labels.density === 'all'; break;
      default:
        if (c.startsWith('labels-')) {
          const allowed = LABEL_LEVEL[spec.labels.density];
          show = spec.labels.show && (!allowed || allowed.includes(c));
          setP(map, l.id, 'text-color', spec.labels.color);
          setP(map, l.id, 'text-halo-color', spec.labels.halo);
          setP(map, l.id, 'text-halo-width', 1.2);
        }
    }
    setL(map, l.id, 'visibility', vis(show));
    if (l.type === 'line') {
      setL(map, l.id, 'line-join', spec.smooth ? 'round' : 'miter');
      setL(map, l.id, 'line-cap', spec.smooth ? 'round' : 'butt');
    }
  }
}

// ── Our sources and layers ───────────────────────────────────────────────
function routeFeatures(routes, spec) {
  const feats = [];
  for (const r of routes) {
    const ts = spec.routes[r.type] || spec.routes.other || { color: '#666', width: 2, show: true };
    if (ts.show === false) continue;
    feats.push({
      type: 'Feature', id: r.id,
      properties: { id: r.id, name: r.name, date: r.date || '', color: r.color || ts.color, width: r.width || ts.width, dash: r.type === 'flight' || !!typeById(r.type).dash },
      geometry: { type: 'LineString', coordinates: r.coords },
    });
  }
  return { type: 'FeatureCollection', features: feats };
}

function placeFeatures(places, spec) {
  const kinds = spec.places.kinds;
  return {
    type: 'FeatureCollection',
    features: (spec.places.show ? places : []).filter((p) => !p.hidden && (kinds[p.kind] || kinds.other).show !== false).map((p) => {
      const k = kinds[p.kind] || kinds.other || PLACE_KINDS[PLACE_KINDS.length - 1];
      return { type: 'Feature', id: p.id, properties: { id: p.id, name: p.name || '', color: k.color, size: k.size }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } };
    }),
  };
}

const SEL = ['boolean', ['feature-state', 'sel'], false];
const HOV = ['boolean', ['feature-state', 'hover'], false];
const DIM = ['boolean', ['feature-state', 'dim'], false];

function addOurLayers(map, spec) {
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol');
  const before = firstLabel ? firstLabel.id : undefined;
  if (!map.getSource('ta-routes')) map.addSource('ta-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id', tolerance: 0.2 });
  if (!map.getSource('ta-places')) map.addSource('ta-places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
  const cs = spec.routeCasing;
  const solid = ['!', ['get', 'dash']];
  map.addLayer({
    id: 'ta-casing', type: 'line', source: 'ta-routes', filter: solid,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: vis(cs.show) },
    paint: { 'line-color': cs.color, 'line-width': ['+', ['get', 'width'], cs.width * 2], 'line-opacity': ['case', DIM, 0.15, spec.routeOpacity] },
  }, before);
  map.addLayer({
    id: 'ta-line', type: 'line', source: 'ta-routes', filter: solid,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['case', SEL, '#0f3a58', ['get', 'color']],
      'line-width': ['case', SEL, ['+', ['get', 'width'], 2.5], HOV, ['+', ['get', 'width'], 1.5], ['get', 'width']],
      'line-opacity': ['case', DIM, 0.18, spec.routeOpacity],
    },
  }, before);
  map.addLayer({
    id: 'ta-dash', type: 'line', source: 'ta-routes', filter: ['get', 'dash'],
    layout: { 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': ['case', SEL, '#0f3a58', ['get', 'color']],
      'line-width': ['case', SEL, ['+', ['get', 'width'], 2], ['get', 'width']],
      'line-dasharray': [3, 2], 'line-opacity': ['case', DIM, 0.18, spec.routeOpacity],
    },
  }, before);
  map.addLayer({
    id: 'ta-places', type: 'circle', source: 'ta-places',
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'size'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: 'ta-place-labels', type: 'symbol', source: 'ta-places',
    layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true, visibility: vis(spec.places.labels) },
    paint: { 'text-color': spec.labels.color, 'text-halo-color': spec.labels.halo, 'text-halo-width': 1.2 },
  });
}

function updateOurPaint(map, spec) {
  const cs = spec.routeCasing;
  setL(map, 'ta-casing', 'visibility', vis(cs.show));
  setP(map, 'ta-casing', 'line-color', cs.color);
  setP(map, 'ta-casing', 'line-width', ['+', ['get', 'width'], cs.width * 2]);
  for (const id of ['ta-casing', 'ta-line', 'ta-dash']) setP(map, id, 'line-opacity', ['case', DIM, id === 'ta-casing' ? 0.15 : 0.18, spec.routeOpacity]);
  setL(map, 'ta-place-labels', 'visibility', vis(spec.places.labels));
  setP(map, 'ta-place-labels', 'text-color', spec.labels.color);
}

// ── Public API ───────────────────────────────────────────────────────────
export async function createAtlas(container, { spec, interactive = true, pixelRatio, preserveDrawingBuffer = false, bounds, padding = 40, attribution = true } = {}) {
  let current = spec;
  let routes = [], places = [];
  const selected = new Set(), dimmed = new Set();
  let hovered = null;
  const handlers = { select: [], hover: [] };

  const map = new maplibregl.Map({
    container,
    style: await fetchBasemap(spec.basemap),
    interactive,
    attributionControl: attribution ? { compact: true } : false,
    preserveDrawingBuffer,
    pixelRatio: pixelRatio || window.devicePixelRatio || 1,
    maxCanvasSize: [16384, 16384],
    fadeDuration: interactive ? 300 : 0,
    bounds: bounds || [-130, -55, 40, 72],
    fitBoundsOptions: { padding },
    renderWorldCopies: false,
  });
  if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  const ready = () => new Promise((res) => (map.isStyleLoaded() ? res() : map.once('style.load', res)));
  await ready();

  function paintAll() {
    applyBase(map, current);
    if (!map.getLayer('ta-line')) addOurLayers(map, current); else updateOurPaint(map, current);
    map.getSource('ta-routes').setData(routeFeatures(routes, current));
    map.getSource('ta-places').setData(placeFeatures(places, current));
    restoreStates();
  }
  function restoreStates() {
    for (const id of selected) map.setFeatureState({ source: 'ta-routes', id }, { sel: true });
    for (const id of dimmed) map.setFeatureState({ source: 'ta-routes', id }, { dim: true });
  }
  paintAll();

  if (interactive) {
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    const layers = ['ta-line', 'ta-dash', 'ta-casing'];
    map.on('mousemove', (e) => {
      const f = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: layers.filter((l) => map.getLayer(l)) })[0];
      const id = f ? f.properties.id : null;
      if (id === hovered) { if (f) popup.setLngLat(e.lngLat); return; }
      if (hovered != null) map.setFeatureState({ source: 'ta-routes', id: hovered }, { hover: false });
      hovered = id;
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      if (id != null) {
        map.setFeatureState({ source: 'ta-routes', id }, { hover: true });
        const p = f.properties;
        popup.setLngLat(e.lngLat).setHTML(`<strong>${escapeHtml(p.name)}</strong>${p.date ? `<br><span style="color:#677384">${p.date}</span>` : ''}`).addTo(map);
      } else popup.remove();
      handlers.hover.forEach((h) => h(id));
    });
    map.on('mouseout', () => { popup.remove(); });
    map.on('click', (e) => {
      const f = map.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: layers.filter((l) => map.getLayer(l)) })[0];
      handlers.select.forEach((h) => h(f ? f.properties.id : null, e.originalEvent));
    });
  }

  return {
    map,
    on(ev, fn) { handlers[ev].push(fn); },
    async setSpec(next) {
      const basemapChanged = next.basemap !== current.basemap;
      current = next;
      if (basemapChanged) {
        map.setStyle(await fetchBasemap(next.basemap));
        await new Promise((res) => map.once('style.load', res));
      }
      paintAll();
    },
    setRoutes(list) { routes = list; map.getSource('ta-routes').setData(routeFeatures(routes, current)); restoreStates(); },
    setPlaces(list) { places = list; map.getSource('ta-places').setData(placeFeatures(places, current)); },
    setSelection(ids) {
      for (const id of selected) map.setFeatureState({ source: 'ta-routes', id }, { sel: false });
      selected.clear();
      for (const id of ids) { selected.add(id); map.setFeatureState({ source: 'ta-routes', id }, { sel: true }); }
    },
    setDimmed(ids) {
      for (const id of dimmed) map.setFeatureState({ source: 'ta-routes', id }, { dim: false });
      dimmed.clear();
      for (const id of ids) { dimmed.add(id); map.setFeatureState({ source: 'ta-routes', id }, { dim: true }); }
    },
    fit(bbox, opts = {}) {
      if (!bbox) return;
      const [w, s, e, n] = bbox;
      const pad = (e - w) < 0.01 && (n - s) < 0.01 ? 0.01 : 0;
      map.fitBounds([[w - pad, s - pad], [e + pad, n + pad]], { padding, maxZoom: 14, duration: interactive ? 600 : 0, ...opts });
    },
    idle() { return new Promise((res) => { if (map.loaded() && map.areTilesLoaded()) map.once('idle', res), map.triggerRepaint(); else map.once('idle', res); }); },
    destroy() { map.remove(); },
  };
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { classify };
