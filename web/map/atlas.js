// The map. One instance drives the Map page, the album editor, the style
// editor, the trip film and (offscreen, at print resolution) the exporters —
// so what you see is what prints.
//
// Speed rules:
//  - every route is ONE feature in ONE GeoJSON source (the legacy app made a
//    source + layer per route, which is why it froze);
//  - filtering is a layer filter on ids, never a setData — re-tiling 100k
//    points on each keystroke is what makes maps feel sticky;
//  - selection / hover / dim are feature-state.
import { BASEMAPS, PLACE_KINDS, DASHES, rampColor, pinPx } from '../lib/style.js';
import { loadCountries } from '../lib/countries.js';
import { SHAPES, pinParts } from '../lib/pins.js';
import { simplify } from '../lib/geo.js';
import { scaleSize } from './scale-size.js';

const maplibregl = window.maplibregl;
const styleCache = new Map();
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'; // keyless, global, incl. bathymetry

const tileJsonCache = new Map();
// baseLevel > 0 caps the zoom the base map's tiles are taken from, so its
// shapes stay as generalised as that zoom draws them (a coarser, cleaner map).
// The TileJSON is inlined because a `url` source's own maxzoom would win.
// Coastline detail = which zoom the water is taken from. OpenMapTiles water
// is Natural Earth 1:110m at z0–1, 1:50m at z2–4, 1:10m at z5–7 and
// OpenStreetMap from z8, so capping the water's tiles at those zooms gives
// the same coast drawn at ~30 km, ~5 km or ~1 km — through the normal tile
// pipeline (wide margins when overzoomed, so no seams).
export const COAST_LEVEL = { osm: 0, '10m': 8, '50m': 6, '110m': 4 }; // measured on OpenFreeMap tiles, 2026-10-04
async function fetchBasemap(id, baseLevel = 0, coastline = 'osm') {
  const bm = BASEMAPS.find((b) => b.id === id) || BASEMAPS[0];
  if (!styleCache.has(bm.id)) styleCache.set(bm.id, fetch(bm.url).then((r) => { if (!r.ok) throw new Error('Basemap failed to load'); return r.json(); }));
  const style = structuredClone(await styleCache.get(bm.id));
  const coastLevel = COAST_LEVEL[coastline] || 0;
  for (const [name, src] of Object.entries({ ...style.sources })) {
    if (src.type !== 'vector' || !src.url || (!baseLevel && !coastLevel)) continue;
    if (!tileJsonCache.has(src.url)) tileJsonCache.set(src.url, fetch(src.url).then((r) => r.json()));
    const tj = await tileJsonCache.get(src.url);
    const inline = (max) => ({ type: 'vector', tiles: tj.tiles, minzoom: tj.minzoom || 0, maxzoom: Math.min(max, tj.maxzoom || 14), attribution: tj.attribution });
    if (baseLevel > 0) style.sources[name] = inline(baseLevel);
    if (coastLevel > 0) {
      style.sources['ta-coastsrc'] = inline(baseLevel > 0 ? Math.min(coastLevel, baseLevel) : coastLevel);
      for (const l of style.layers) if (l.source === name && l['source-layer'] === 'water') l.source = 'ta-coastsrc';
    }
  }
  return style;
}
export function preloadBasemap(id) { fetchBasemap(id).catch(() => {}); }
const baseKey = (spec) => `${spec.basemap}|${(spec.detail && spec.detail.baseLevel) || 0}|${(spec.detail && spec.detail.coastline) || 'osm'}`;

// Lowest admin_level a boundary layer draws (walks its filter). Positron's
// "boundary_3" is states (3–6), "boundary_2" countries.
function boundaryLevel(l) {
  let min = Infinity;
  (function walk(x) {
    if (!Array.isArray(x)) return;
    const i = x.findIndex((v) => v === 'admin_level' || (Array.isArray(v) && v[0] === 'get' && v[1] === 'admin_level'));
    if (i >= 0) {
      const nums = x.slice(i + 1).flat().filter((n) => typeof n === 'number');
      if (x[0] === '<=' || x[0] === '<') min = Math.min(min, 0);
      else if (nums.length) min = Math.min(min, ...nums);
    }
    x.forEach(walk);
  })(l.filter);
  if (min === Infinity) return /disputed|country|_2\b/.test(l.id) ? 2 : 4;
  if (min === 0) return /state|province|_3|_4/.test(l.id) ? 4 : 2;
  return min;
}

const LANDCOVER = [['wood', /wood|forest/], ['grass', /grass|meadow|scrub|park/], ['farmland', /farm|crop|orchard|vineyard/],
  ['ice', /ice|glacier/], ['sand', /sand|beach|desert/], ['wetland', /wetland|marsh|swamp|bog/], ['rock', /rock|bare|scree/]];

// Classify basemap layers by source-layer + filter, not id, so all three
// OpenFreeMap styles work with every knob.
export function classify(l) {
  const sl = l['source-layer'] || '';
  const f = JSON.stringify(l.filter || '') + ' ' + l.id;
  if (l.type === 'background') return 'background';
  if (sl === 'water' && l.type === 'fill') return 'water';
  if (sl === 'waterway' && l.type === 'line') return 'waterway';
  if (sl === 'boundary') return boundaryLevel(l) <= 2 ? 'countries' : 'states';
  if (sl === 'transportation') return /ferry/.test(f) ? 'ferries' : /motorway|trunk|primary/.test(f) && !/minor|service|track|path|street|tertiary|secondary/.test(l.id) ? 'roads-major' : 'roads-minor';
  if (sl === 'transportation_name') return 'road-labels';
  if (l.type === 'symbol' && (sl === 'park' || sl === 'poi' || sl === 'aerodrome_label' || sl === 'mountain_peak' || sl === 'housenumber' || sl === 'waterway')) return 'poi-labels';
  if (sl === 'park') return 'parks';
  if (sl === 'landcover' || sl === 'landuse') {
    for (const [k, re] of LANDCOVER) if (re.test(f)) return 'landcover-' + k;
    return 'landuse';
  }
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
const ROUTE_LAYERS = ['ta-glow', 'ta-casing', ...Object.keys(DASHES).map((d) => 'ta-line-' + d), 'ta-line-grad', 'ta-arrows'];

// `mode`: 'all' | 'base' (no routes/places) | 'overlay' (routes/places only, transparent) — layered export.
function applyBase(map, spec, orig, mode) {
  const lv = spec.layers, ty = spec.type, base = mode !== 'overlay';
  for (const l of map.getStyle().layers) {
    if (l.id.startsWith('ta-')) continue;
    const c = classify(l);
    let show = true;
    switch (c) {
      case 'background': setP(map, l.id, 'background-color', spec.background || spec.land); break;
      case 'water': setP(map, l.id, 'fill-color', spec.water); setP(map, l.id, 'fill-outline-color', spec.water); break;
      case 'waterway': show = spec.waterDetail.rivers.show; setP(map, l.id, 'line-color', spec.water); setP(map, l.id, 'line-width', ['interpolate', ['linear'], ['zoom'], 6, 0.4 * spec.waterDetail.rivers.width, 14, 2.5 * spec.waterDetail.rivers.width]); break;
      case 'landuse': case 'aeroway': show = false; break;
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
        if (c.startsWith('landcover-')) {
          show = spec.landcover.show;
          if (l.type === 'fill') { setP(map, l.id, 'fill-color', spec.landcover[c.slice(10)]); setP(map, l.id, 'fill-opacity', spec.landcover.opacity); setP(map, l.id, 'fill-outline-color', 'rgba(0,0,0,0)'); }
        } else if (c.startsWith('labels-')) {
          const allowed = LABEL_LEVEL[spec.labels.density];
          show = spec.labels.show && (!allowed || allowed.includes(c));
          const country = c === 'labels-country', water = c === 'labels-water';
          const color = (country && ty.countryColor) || (c === 'labels-city' && ty.cityColor) || (water && ty.waterColor) || spec.labels.color;
          setP(map, l.id, 'text-color', color);
          setP(map, l.id, 'text-halo-color', spec.labels.halo);
          setP(map, l.id, 'text-halo-width', ty.haloWidth);
          const o = orig.get(l.id) || {};
          setL(map, l.id, 'text-font', [country ? ty.countryFont : water && spec.waterDetail.labelsItalic ? 'Noto Sans Italic' : ty.font]);
          if (o.size !== undefined) setL(map, l.id, 'text-size', scaleSize(o.size, ty.scale));
          setL(map, l.id, 'text-transform', (country ? ty.countriesUppercase : ty.uppercase) ? 'uppercase' : 'none');
          setL(map, l.id, 'text-letter-spacing', country ? ty.countryLetterSpacing : ty.letterSpacing);
        }
    }
    if (c === 'water' && spec.waterDetail.outline.show) { setP(map, l.id, 'fill-outline-color', spec.waterDetail.outline.color); }
    if (!base && c !== 'background') show = false;
    if (!base && c === 'background') show = false;
    setL(map, l.id, 'visibility', vis(show));
    if (l.type === 'line') {
      setL(map, l.id, 'line-join', spec.smooth ? 'round' : 'miter');
      setL(map, l.id, 'line-cap', spec.smooth ? 'round' : 'butt');
    }
  }
}

// Size expressions as authored, captured once per style load so the
// typography scale multiplies the original, never its own last result.
function snapshotLabels(map) {
  const out = new Map();
  for (const l of map.getStyle().layers) {
    if (l.type === 'symbol' && l.layout && l.layout['text-size'] !== undefined) out.set(l.id, { size: l.layout['text-size'] });
    if (l['source-layer'] === 'water' && l.type === 'fill') out.set(l.id, { filter: l.filter === undefined ? null : l.filter });
  }
  return out;
}

// ── Features ─────────────────────────────────────────────────────────────
function tripSpan(routes) {
  let a = null, b = null;
  for (const r of routes) if (r.date) { if (!a || r.date < a) a = r.date; if (!b || r.date > b) b = r.date; }
  return a ? [Date.parse(a), Math.max(Date.parse(b), Date.parse(a) + 1)] : null;
}

const simplified = new Map(); // `${id}:${tol}` → coords
function routeFeatures(routes, spec) {
  const g = spec.routeFx.gradient, span = g.mode === 'trip' ? tripSpan(routes) : null;
  const tol = (spec.detail && spec.detail.routeSimplify) || 0;
  const line = (r) => {
    if (!tol || r.coords.length < 3) return r.coords;
    const k = `${r.id}:${tol}:${r.coords.length}`;
    if (!simplified.has(k)) { if (simplified.size > 5000) simplified.clear(); simplified.set(k, simplify(r.coords, tol)); }
    return simplified.get(k);
  };
  const feats = [];
  for (const r of routes) {
    const ts = spec.routes[r.type] || spec.routes.other || { color: '#666', width: 2, show: true };
    if (ts.show === false) continue;
    let color = r.color || ts.color;
    if (span && r.date) color = rampColor(g, (Date.parse(r.date) - span[0]) / (span[1] - span[0]));
    feats.push({
      type: 'Feature', id: r.id,
      properties: { id: r.id, name: r.name, date: r.date || '', color, width: r.width || ts.width, dash: DASHES[ts.dash] !== undefined ? ts.dash : 'solid' },
      geometry: { type: 'LineString', coordinates: line(r) },
    });
  }
  return { type: 'FeatureCollection', features: feats };
}

function endpointFeatures(routes, spec) {
  if (!spec.routeFx.endpoints.show) return { type: 'FeatureCollection', features: [] };
  const feats = [];
  for (const r of routes) {
    if (r.type === 'flight' || !r.coords.length || (spec.routes[r.type] && spec.routes[r.type].show === false)) continue;
    feats.push({ type: 'Feature', properties: { id: r.id }, geometry: { type: 'Point', coordinates: r.coords[0] } });
    feats.push({ type: 'Feature', properties: { id: r.id }, geometry: { type: 'Point', coordinates: r.coords[r.coords.length - 1] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

export const kindOf = (spec, kind) => spec.places.kinds[kind] || spec.places.kinds.other || PLACE_KINDS[PLACE_KINDS.length - 1];
export function visiblePlaces(places, spec) {
  if (!spec.places.show) return [];
  return places.filter((p) => !p.hidden && kindOf(spec, p.kind).show !== false)
    .slice().sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || a.id - b.id);
}
function labelText(p, n, field) {
  const nights = p.nights > 1 ? `${p.nights} nights` : p.nights === 1 ? '1 night' : '';
  const day = p.date ? new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
  switch (field) {
    case 'name-nights': return [p.name, nights].filter(Boolean).join(' · ');
    case 'name-date': return [p.name, day].filter(Boolean).join(' · ');
    case 'date': return day;
    case 'nights': return nights;
    case 'number': return String(n);
    case 'number-name': return `${n}. ${p.name || ''}`;
    default: return p.name || '';
  }
}
function placeFeatures(places, spec) {
  const list = visiblePlaces(places, spec);
  return {
    type: 'FeatureCollection',
    features: list.map((p, i) => ({ type: 'Feature', id: p.id, properties: {
      id: p.id, kind: spec.places.kinds[p.kind] ? p.kind : 'other', name: p.name || '', num: i + 1, label: labelText(p, i + 1, spec.places.label.field),
      date: p.date || '', nights: p.nights || 0, notes: p.notes || '', glyphNumber: kindOf(spec, p.kind).glyph === 'number',
      numOffset: numOffset(kindOf(spec, p.kind)),
    }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
  };
}
// Where the night number sits, in ems of its 9 px text: the shape's centre
// relative to the location point (above it, for a teardrop pin).
function numOffset(kind) {
  const sh = SHAPES[kind.shape] || SHAPES.circle, px = kind.size * 2.6;
  return [0, ((sh.center[1] - (sh.anchor === 'bottom' ? 23 : 12)) * px) / 24 / 9];
}
function staysLine(places, spec) {
  if (!spec.places.connect.show) return EMPTY;
  const pts = visiblePlaces(places, spec).filter((p) => p.date).map((p) => [p.lon, p.lat]);
  return pts.length > 1 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] } : EMPTY;
}

// One bitmap per kind, drawn at the map's pixel ratio so pins are crisp on
// screen and at print resolution. The anchor point sits at the image centre.
function pinImage(kind, places, pr) {
  const px = pinPx(kind, places);
  const sh = SHAPES[kind.shape] || SHAPES.circle;
  const sw = places.strokeWidth, pad = sw + (places.shadow ? 3 : 1);
  const w = Math.ceil((px + pad * 2) * pr);
  const h = Math.ceil((sh.anchor === 'bottom' ? (px + pad) * 2 : px + pad * 2) * pr);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.scale(pr, pr);
  const parts = pinParts(kind, { x: w / pr / 2, y: h / pr / 2, px });
  const shape = new Path2D(parts.shape);
  x.globalAlpha = places.opacity;
  if (places.shadow) { x.save(); x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 3; x.shadowOffsetY = 1; x.fillStyle = kind.color; x.fill(shape); x.restore(); }
  x.fillStyle = kind.color; x.fill(shape);
  if (sw > 0) { x.lineWidth = sw; x.lineJoin = 'round'; x.strokeStyle = places.stroke; x.stroke(shape); }
  if (parts.glyph) { x.fillStyle = kind.glyphColor || '#ffffff'; x.fill(new Path2D(parts.glyph), 'evenodd'); }
  return { image: x.getImageData(0, 0, w, h), pixelRatio: pr, glyphDy: (parts.center[1] - h / pr / 2) };
}
function syncPins(map, spec, pr) {
  const out = {};
  for (const [id, kind] of Object.entries(spec.places.kinds)) {
    const name = `ta-pin-${id}`;
    const { image, pixelRatio, glyphDy } = pinImage(kind, spec.places, pr);
    if (map.hasImage(name)) map.removeImage(name);
    map.addImage(name, image, { pixelRatio });
    out[id] = glyphDy;
  }
  return out;
}

const EMPTY = { type: 'FeatureCollection', features: [] };
const SEL = ['boolean', ['feature-state', 'sel'], false];
const HOV = ['boolean', ['feature-state', 'hover'], false];
const DIM = ['boolean', ['feature-state', 'dim'], false];

// SDF chevron for direction arrows, drawn once.
function arrowImage() {
  const s = 32, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.beginPath(); x.moveTo(8, 6); x.lineTo(24, 16); x.lineTo(8, 26); x.lineTo(12, 16); x.closePath(); x.fill();
  return x.getImageData(0, 0, s, s);
}

function firstOf(map, pred) {
  const l = map.getStyle().layers.find(pred);
  return l ? l.id : undefined;
}

function addOurLayers(map, spec) {
  const layers = map.getStyle().layers;
  const firstLabel = firstOf(map, (l) => l.type === 'symbol');
  const waterId = firstOf(map, (l) => l['source-layer'] === 'water' && l.type === 'fill');
  const add = (src, def) => { if (!map.getSource(src)) map.addSource(src, def); };
  add('ta-routes', { type: 'geojson', data: EMPTY, promoteId: 'id', tolerance: 0.2, lineMetrics: true });
  add('ta-ends', { type: 'geojson', data: EMPTY });
  add('ta-places', { type: 'geojson', data: EMPTY, promoteId: 'id' });
  add('ta-active', { type: 'geojson', data: EMPTY, lineMetrics: true });
  add('ta-photos', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 36, clusterMaxZoom: 13 });
  add('ta-dem', { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen/AWS' });
  add('ta-countries', { type: 'geojson', data: EMPTY });

  add('ta-stays-line', { type: 'geojson', data: EMPTY });
  if (!map.hasImage('ta-arrow')) map.addImage('ta-arrow', arrowImage(), { sdf: true });

  // Under the water so coasts stay crisp: visited fills, then relief.
  map.addLayer({ id: 'ta-unvisited', type: 'fill', source: 'ta-countries', filter: ['!', ['get', 'visited']], paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, waterId);
  map.addLayer({ id: 'ta-visited', type: 'fill', source: 'ta-countries', filter: ['get', 'visited'], paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, waterId);
  map.addLayer({ id: 'ta-visited-line', type: 'line', source: 'ta-countries', filter: ['get', 'visited'], layout: { visibility: 'none' }, paint: {} }, firstLabel);
  map.addLayer({ id: 'ta-relief', type: 'hillshade', source: 'ta-dem', layout: { visibility: 'none' }, paint: {} }, waterId);
  // Soft coast: a blurred line in the land colour along the (coarse) shoreline.
  const afterWater = layers[layers.findIndex((l) => l.id === waterId) + 1];
  if (map.getSource('ta-coastsrc')) map.addLayer({ id: 'ta-coast-soft', type: 'line', source: 'ta-coastsrc', 'source-layer': 'water', filter: ['==', ['get', 'class'], 'ocean'], layout: { visibility: 'none', 'line-join': 'round' }, paint: {} }, afterWater && afterWater.id);

  const solid = (d) => ['==', ['get', 'dash'], d];
  map.addLayer({ id: 'ta-glow', type: 'line', source: 'ta-routes', layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' }, paint: {} }, firstLabel);
  map.addLayer({ id: 'ta-casing', type: 'line', source: 'ta-routes', filter: solid('solid'), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {} }, firstLabel);
  for (const d of Object.keys(DASHES)) {
    map.addLayer({ id: 'ta-line-' + d, type: 'line', source: 'ta-routes', filter: solid(d), layout: { 'line-join': 'round', 'line-cap': d === 'solid' ? 'round' : 'butt' }, paint: DASHES[d] ? { 'line-dasharray': DASHES[d] } : {} }, firstLabel);
  }
  map.addLayer({ id: 'ta-line-grad', type: 'line', source: 'ta-routes', layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' }, paint: {} }, firstLabel);
  map.addLayer({ id: 'ta-arrows', type: 'symbol', source: 'ta-routes', layout: { 'symbol-placement': 'line', 'icon-image': 'ta-arrow', 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map', visibility: 'none' }, paint: {} });
  map.addLayer({ id: 'ta-ends', type: 'circle', source: 'ta-ends', paint: {} });
  map.addLayer({ id: 'ta-active-casing', type: 'line', source: 'ta-active', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['+', ['get', 'width'], 3] } });
  map.addLayer({ id: 'ta-active', type: 'line', source: 'ta-active', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] } });
  map.addLayer({ id: 'ta-active-head', type: 'circle', source: 'ta-active', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'ta-stays-line', type: 'line', source: 'ta-stays-line', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {} });
  map.addLayer({ id: 'ta-places', type: 'symbol', source: 'ta-places', layout: { 'icon-image': ['concat', 'ta-pin-', ['get', 'kind']], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'num'] }, paint: {} });
  map.addLayer({ id: 'ta-place-num', type: 'symbol', source: 'ta-places', filter: ['get', 'glyphNumber'], layout: { 'text-field': ['to-string', ['get', 'num']], 'text-font': ['Noto Sans Bold'], 'text-size': 9, 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-offset': ['get', 'numOffset'] }, paint: {} });
  map.addLayer({ id: 'ta-place-labels', type: 'symbol', source: 'ta-places', layout: { 'text-field': ['get', 'label'], 'text-optional': true, 'text-font': ['Noto Sans Regular'] }, paint: {} });
  map.addLayer({ id: 'ta-photos', type: 'circle', source: 'ta-photos', layout: { visibility: 'none' }, paint: { 'circle-color': '#ffffff', 'circle-radius': ['case', ['has', 'point_count'], ['interpolate', ['linear'], ['get', 'point_count'], 2, 11, 50, 18], 7], 'circle-stroke-color': '#16202b', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'ta-photo-count', type: 'symbol', source: 'ta-photos', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-font': ['Noto Sans Bold'], visibility: 'none' }, paint: { 'text-color': '#16202b' } });
  void layers;
}

function paintOurs(map, spec, visibleFilter, mode) {
  const fx = spec.routeFx, cs = spec.routeCasing, overlay = mode !== 'base', base = mode !== 'overlay';
  const withVis = (f) => (visibleFilter ? (f ? ['all', f, visibleFilter] : visibleFilter) : f || null);
  const op = (a) => ['case', DIM, 0.15, a];
  const width = ['case', SEL, ['+', ['get', 'width'], 2.5], HOV, ['+', ['get', 'width'], 1.5], ['get', 'width']];
  const gradRoute = fx.gradient.mode === 'route';

  setL(map, 'ta-glow', 'visibility', vis(overlay && fx.glow.show));
  setP(map, 'ta-glow', 'line-color', fx.glow.color || ['get', 'color']);
  setP(map, 'ta-glow', 'line-width', ['+', ['get', 'width'], fx.glow.width * 2]);
  setP(map, 'ta-glow', 'line-blur', fx.glow.blur);
  setP(map, 'ta-glow', 'line-opacity', op(fx.glow.opacity));
  map.setFilter('ta-glow', withVis(null));

  setL(map, 'ta-casing', 'visibility', vis(overlay && cs.show));
  setP(map, 'ta-casing', 'line-color', cs.color);
  setP(map, 'ta-casing', 'line-width', ['+', ['get', 'width'], cs.width * 2]);
  setP(map, 'ta-casing', 'line-opacity', op(spec.routeOpacity));
  setL(map, 'ta-casing', 'line-cap', fx.cap);
  map.setFilter('ta-casing', withVis(null));

  for (const d of Object.keys(DASHES)) {
    const id = 'ta-line-' + d;
    setL(map, id, 'visibility', vis(overlay && !(gradRoute && d === 'solid')));
    setP(map, id, 'line-color', ['case', SEL, '#0f3a58', ['get', 'color']]);
    setP(map, id, 'line-width', width);
    setP(map, id, 'line-opacity', op(spec.routeOpacity));
    if (d === 'solid') setL(map, id, 'line-cap', fx.cap);
    map.setFilter(id, withVis(['==', ['get', 'dash'], d]));
  }
  setL(map, 'ta-line-grad', 'visibility', vis(overlay && gradRoute));
  setP(map, 'ta-line-grad', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, fx.gradient.from, 0.5, fx.gradient.via, 1, fx.gradient.to]);
  setP(map, 'ta-line-grad', 'line-width', width);
  setP(map, 'ta-line-grad', 'line-opacity', spec.routeOpacity);
  map.setFilter('ta-line-grad', withVis(['==', ['get', 'dash'], 'solid']));

  setL(map, 'ta-arrows', 'visibility', vis(overlay && fx.arrows.show));
  setL(map, 'ta-arrows', 'symbol-spacing', fx.arrows.spacing);
  setL(map, 'ta-arrows', 'icon-size', fx.arrows.size);
  setP(map, 'ta-arrows', 'icon-color', fx.arrows.color || ['get', 'color']);
  setP(map, 'ta-arrows', 'icon-halo-color', cs.color);
  setP(map, 'ta-arrows', 'icon-halo-width', 1);
  map.setFilter('ta-arrows', withVis(null));

  setL(map, 'ta-ends', 'visibility', vis(overlay && fx.endpoints.show));
  setP(map, 'ta-ends', 'circle-radius', fx.endpoints.size);
  setP(map, 'ta-ends', 'circle-color', fx.endpoints.color);
  setP(map, 'ta-ends', 'circle-stroke-color', fx.endpoints.stroke);
  setP(map, 'ta-ends', 'circle-stroke-width', 1.5);
  map.setFilter('ta-ends', withVis(null));

  const pl = spec.places, lb = pl.label;
  setL(map, 'ta-places', 'visibility', vis(overlay && pl.show));
  setL(map, 'ta-place-num', 'visibility', vis(overlay && pl.show));
  setP(map, 'ta-place-num', 'text-color', '#ffffff');
  const pos = { top: ['bottom', [0, -1]], bottom: ['top', [0, 1]], left: ['right', [-1, 0]], right: ['left', [1, 0]] }[lb.position] || ['bottom', [0, -1]];
  const r = Math.max(...Object.values(pl.kinds).map((k) => k.size)) * 1.3 * (pl.scale || 1) / lb.size;
  // The number scales with its pin; numOffset is in ems, so it follows along.
  setL(map, 'ta-place-num', 'text-size', 9 * (pl.scale || 1));
  setL(map, 'ta-place-labels', 'visibility', vis(overlay && pl.show && pl.labels));
  setL(map, 'ta-place-labels', 'text-anchor', pos[0]);
  setL(map, 'ta-place-labels', 'text-offset', [pos[1][0] * (r + 0.4), pos[1][1] * (r + 0.4)]);
  setL(map, 'ta-place-labels', 'text-size', lb.size);
  setL(map, 'ta-place-labels', 'text-font', [lb.font]);
  setL(map, 'ta-place-labels', 'text-transform', lb.uppercase ? 'uppercase' : 'none');
  setP(map, 'ta-place-labels', 'text-color', lb.color || spec.labels.color);
  setP(map, 'ta-place-labels', 'text-halo-color', lb.halo || spec.labels.halo);
  setP(map, 'ta-place-labels', 'text-halo-width', lb.haloWidth);
  map.setLayerZoomRange('ta-place-labels', lb.minZoom || 0, 24);
  const cn = pl.connect;
  setL(map, 'ta-stays-line', 'visibility', vis(overlay && pl.show && cn.show));
  setP(map, 'ta-stays-line', 'line-color', cn.color);
  setP(map, 'ta-stays-line', 'line-width', cn.width);
  setP(map, 'ta-stays-line', 'line-opacity', cn.opacity);
  setP(map, 'ta-stays-line', 'line-dasharray', DASHES[cn.dash] || [1, 0]);

  const dt = spec.detail;
  if (map.getLayer('ta-coast-soft')) {
    setL(map, 'ta-coast-soft', 'visibility', vis(base && dt.softness > 0));
    setP(map, 'ta-coast-soft', 'line-color', spec.land);
    setP(map, 'ta-coast-soft', 'line-width', dt.softness * 1.2);
    setP(map, 'ta-coast-soft', 'line-blur', dt.softness);
    setP(map, 'ta-coast-soft', 'line-opacity', 0.75);
  }

  const v = spec.visited;
  setP(map, 'ta-visited', 'fill-color', v.color);
  setP(map, 'ta-visited', 'fill-opacity', base && v.show ? v.opacity : 0);
  setP(map, 'ta-unvisited', 'fill-color', v.fadeOthers.color);
  setP(map, 'ta-unvisited', 'fill-opacity', base && v.show && v.fadeOthers.show ? v.fadeOthers.opacity : 0);
  setL(map, 'ta-visited-line', 'visibility', vis(base && v.show && v.outline.show));
  setP(map, 'ta-visited-line', 'line-color', v.outline.color);
  setP(map, 'ta-visited-line', 'line-width', v.outline.width);

  const rl = spec.relief;
  setL(map, 'ta-relief', 'visibility', vis(base && rl.show));
  setP(map, 'ta-relief', 'hillshade-exaggeration', rl.exaggeration);
  setP(map, 'ta-relief', 'hillshade-shadow-color', hexA(rl.shadow, rl.opacity));
  setP(map, 'ta-relief', 'hillshade-highlight-color', hexA(rl.highlight, rl.opacity * 0.8));
  setP(map, 'ta-relief', 'hillshade-accent-color', hexA(rl.accent, rl.opacity * 0.6));
  setP(map, 'ta-relief', 'hillshade-illumination-direction', rl.direction);
}

const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${Math.max(0, Math.min(1, a))})`;

function applyProjection(map, spec, container) {
  try { map.setProjection({ type: spec.projection === 'globe' ? 'globe' : 'mercator' }); } catch (_) { /* older engine */ }
  if (spec.projection === 'globe') {
    container.style.background = spec.globe.space;
    try { map.setSky(spec.globe.atmosphere ? { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] } : { 'atmosphere-blend': 0 }); } catch (_) { /* no sky support */ }
  } else container.style.background = '';
  try { map.setTerrain(spec.terrain3d.show ? { source: 'ta-dem', exaggeration: spec.terrain3d.exaggeration } : null); } catch (_) { /* terrain unsupported */ }
}

// ── Public API ───────────────────────────────────────────────────────────
export async function createAtlas(container, {
  spec, interactive = true, pixelRatio, preserveDrawingBuffer = false, bounds, padding = 40, attribution = true, mode = 'all', camera,
} = {}) {
  let current = spec;
  let routes = [], places = [], photos = [], visibleIds = null;
  const selected = new Set(), dimmed = new Set();
  let hovered = null, orig = new Map(), countriesLoaded = false;
  const handlers = { select: [], hover: [], photo: [] };

  const map = new maplibregl.Map({
    container,
    style: await fetchBasemap(spec.basemap, spec.detail && spec.detail.baseLevel, spec.detail && spec.detail.coastline),
    interactive,
    attributionControl: attribution ? { compact: true } : false,
    canvasContextAttributes: { preserveDrawingBuffer, antialias: true },
    pixelRatio: pixelRatio || window.devicePixelRatio || 1,
    maxCanvasSize: [16384, 16384],
    fadeDuration: interactive ? 300 : 0,
    bounds: camera ? undefined : bounds || [-130, -55, 40, 72],
    center: camera ? camera.center : undefined, zoom: camera ? camera.zoom : undefined,
    bearing: camera ? camera.bearing || 0 : 0, pitch: camera ? camera.pitch || 0 : 0,
    fitBoundsOptions: { padding },
    renderWorldCopies: false,
    maxPitch: 75,
  });
  if (interactive) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  if (interactive) window.__taMap = map; // handy in the console: the live map

  await new Promise((res) => (map.isStyleLoaded() ? res() : map.once('style.load', res)));

  const visibleFilter = () => (visibleIds ? ['in', ['get', 'id'], ['literal', visibleIds]] : null);

  async function ensureCountries() {
    if (!current.visited.show || countriesLoaded) return;
    countriesLoaded = true;
    try {
      const cs = await loadCountries();
      const visited = new Set(routes.flatMap((r) => (r.country || '').split(',').map((c) => c.trim())).filter(Boolean));
      map.getSource('ta-countries')?.setData({ type: 'FeatureCollection', features: cs.map((c) => ({ type: 'Feature', properties: { name: c.name, visited: visited.has(c.name) }, geometry: c.geom })) });
    } catch (_) { countriesLoaded = false; }
  }

  function setRouteData() {
    map.getSource('ta-routes').setData(routeFeatures(routes, current));
    map.getSource('ta-ends').setData(endpointFeatures(routes, current));
    restoreStates();
  }
  const pr = pixelRatio || window.devicePixelRatio || 1;
  function setPlaceData() {
    map.getSource('ta-places').setData(placeFeatures(places, current));
    map.getSource('ta-stays-line').setData(staysLine(places, current));
  }
  function paintAll() {
    applyBase(map, current, orig, mode);
    if (!map.getLayer('ta-casing')) addOurLayers(map, current);
    paintOurs(map, current, visibleFilter(), mode);
    applyProjection(map, current, container);
    syncPins(map, current, pr);
    setRouteData();
    setPlaceData();
    countriesLoaded = false;
    ensureCountries();
  }
  function restoreStates() {
    for (const id of selected) map.setFeatureState({ source: 'ta-routes', id }, { sel: true });
    for (const id of dimmed) map.setFeatureState({ source: 'ta-routes', id }, { dim: true });
  }
  orig = snapshotLabels(map);
  paintAll();

  if (interactive) {
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    const hit = (pt, pad) => map.queryRenderedFeatures([[pt.x - pad, pt.y - pad], [pt.x + pad, pt.y + pad]], { layers: ROUTE_LAYERS.filter((l) => map.getLayer(l) && l !== 'ta-arrows') })[0];
    map.on('mousemove', (e) => {
      const f = hit(e.point, 4);
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
    map.on('mouseout', () => popup.remove());
    map.on('click', (e) => {
      const ph = map.getLayoutProperty('ta-photos', 'visibility') === 'visible' && map.queryRenderedFeatures(e.point, { layers: ['ta-photos'] })[0];
      if (ph) {
        if (ph.properties.cluster) {
          map.getSource('ta-photos').getClusterExpansionZoom(ph.properties.cluster_id).then((z) => map.easeTo({ center: ph.geometry.coordinates, zoom: z }));
        } else handlers.photo.forEach((h) => h(ph.properties.id));
        return;
      }
      const pin = map.getLayer('ta-places') && map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['ta-places'] })[0];
      if (pin) {
        const q = pin.properties;
        new maplibregl.Popup({ offset: 12, maxWidth: '280px' }).setLngLat(pin.geometry.coordinates)
          .setHTML(`<strong>${escapeHtml(q.name)}</strong><br><span style="color:#677384">${escapeHtml(q.date)}${q.nights ? ` · ${q.nights} night${q.nights > 1 ? 's' : ''}` : ''}</span>${q.notes ? `<div style="margin-top:4px;font-size:12px">${escapeHtml(String(q.notes).slice(0, 220))}</div>` : ''}`).addTo(map);
        return;
      }
      const f = hit(e.point, 5);
      handlers.select.forEach((h) => h(f ? f.properties.id : null, e.originalEvent));
    });
  }

  return {
    map,
    on(ev, fn) { handlers[ev].push(fn); },
    get spec() { return current; },
    async setSpec(next) {
      const basemapChanged = baseKey(next) !== baseKey(current);
      current = next;
      if (basemapChanged) {
        map.setStyle(await fetchBasemap(next.basemap, next.detail && next.detail.baseLevel, next.detail && next.detail.coastline));
        await new Promise((res) => map.once('style.load', res));
        orig = snapshotLabels(map);
      }
      paintAll();
    },
    landReady: () => Promise.resolve(),
    setRoutes(list) { routes = list; setRouteData(); countriesLoaded = false; ensureCountries(); },
    // Show only these ids (null = all) without touching the data — instant.
    setVisible(ids) { visibleIds = ids ? [...ids] : null; paintOurs(map, current, visibleFilter(), mode); },
    setPlaces(list) { places = list; setPlaceData(); },
    setPhotos(list, show = true) {
      photos = list;
      map.getSource('ta-photos').setData({ type: 'FeatureCollection', features: photos.filter((p) => p.lat != null).map((p) => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
      setL(map, 'ta-photos', 'visibility', vis(show));
      setL(map, 'ta-photo-count', 'visibility', vis(show));
    },
    // The film's moving pen: a partial line plus a head dot.
    setActive(coords, { color = '#c0392b', width = 3, head = 6 } = {}) {
      const src = map.getSource('ta-active');
      if (!coords || coords.length < 1) { src.setData(EMPTY); return; }
      const feats = [{ type: 'Feature', properties: { color, r: head }, geometry: { type: 'Point', coordinates: coords[coords.length - 1] } }];
      if (coords.length > 1) feats.unshift({ type: 'Feature', properties: { color, width }, geometry: { type: 'LineString', coordinates: coords } });
      src.setData({ type: 'FeatureCollection', features: feats });
    },
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
    // Resolves once every tile in view is drawn (exports, film frames).
    idle() {
      return new Promise((res) => {
        if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) { map.once('render', () => (map.loaded() ? res() : map.once('idle', res))); map.triggerRepaint(); } else map.once('idle', res);
      });
    },
    countriesReady: () => (current.visited.show ? loadCountries().then(() => new Promise((r) => setTimeout(r, 30))) : Promise.resolve()),
    destroy() { map.remove(); },
  };
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
