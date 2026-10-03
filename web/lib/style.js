// Map style spec — shape, defaults and merge. Shared by the style editor, the
// live map, the print renderer and the Worker (which validates on save).
import { TYPES } from './types.js';

export const BASEMAPS = [
  // OpenFreeMap: keyless vector tiles, so the print renderer can request them at any pixel ratio.
  { id: 'positron', label: 'Light (Positron)', url: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'bright', label: 'Bright', url: 'https://tiles.openfreemap.org/styles/bright' },
  { id: 'liberty', label: 'Liberty', url: 'https://tiles.openfreemap.org/styles/liberty' },
];

export const PLACE_KINDS = [
  { id: 'tent', label: 'Tent / campsite', color: '#2e7d32', size: 6 },
  { id: 'hut', label: 'Hut / cabin', color: '#6d4c41', size: 6 },
  { id: 'hotel', label: 'Hotel', color: '#1c5d8c', size: 6 },
  { id: 'hostel', label: 'Hostel', color: '#7b5ea7', size: 6 },
  { id: 'airbnb', label: 'Airbnb / rental', color: '#c2185b', size: 6 },
  { id: 'friends', label: 'Friends / family', color: '#ef6c00', size: 6 },
  { id: 'sight', label: 'Sight', color: '#455a64', size: 5 },
  { id: 'other', label: 'Other', color: '#677384', size: 5 },
];

export function defaultStyle() {
  return {
    basemap: 'positron',
    land: '#f4f1ea',
    water: '#a9cbe0',
    background: null,          // null = basemap's own
    labels: { show: true, color: '#3a4553', halo: '#ffffff', density: 'cities' }, // countries | cities | all
    layers: {
      countries: { show: true, color: '#8b95a3', width: 1 },
      states: { show: false, color: '#b4bcc6', width: 0.6 },
      roads: { show: false, color: '#d8d2c4', width: 0.6, density: 'major' }, // major | all
      ferries: { show: false, color: '#7aa6c2', width: 0.8 },
      parks: { show: false, color: '#d9e8cf' },
      buildings: { show: false },
    },
    routes: Object.fromEntries(TYPES.map((t) => [t.id, { color: t.color, width: t.width, show: true }])),
    routeOpacity: 0.95,
    routeCasing: { show: true, color: '#ffffff', width: 1.5 }, // a thin halo keeps lines legible over busy tiles
    places: { show: true, kinds: Object.fromEntries(PLACE_KINDS.map((k) => [k.id, { color: k.color, size: k.size, show: true }])), labels: false },
    smooth: true,              // round caps/joins on every line layer
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Deep-merge `over` onto `base`, keeping only keys `base` knows about — a
// saved style from an older version gains new defaults, and junk is dropped.
// `routes` and `places.kinds` are open sets (a new place kind arrives with a CSV).
const OPEN = new Set(['routes', 'kinds']);
export function mergeStyle(base, over, key = '') {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (!(k in base)) {
      if (OPEN.has(key) && isObj(over[k])) out[k] = { ...over[k] };
      continue;
    }
    out[k] = isObj(base[k]) && isObj(over[k]) ? mergeStyle(base[k], over[k], k) : over[k];
  }
  return out;
}

export function resolveStyle(saved, overrides) {
  return mergeStyle(mergeStyle(defaultStyle(), saved || {}), overrides || {});
}

const HEX = /^#[0-9a-f]{6}$/i;
// Server-side check: colours are hex, numbers are sane. Returns an error string or null.
export function validateStyle(spec) {
  const errs = [];
  (function walk(v, path) {
    if (isObj(v)) { for (const k of Object.keys(v)) walk(v[k], path + '.' + k); return; }
    if (/color|land|water|halo|background$/i.test(path) && v !== null && typeof v === 'string' && !HEX.test(v)) errs.push(`${path} is not a #rrggbb colour`);
    if (/width|size/i.test(path) && typeof v === 'number' && !(v >= 0 && v <= 40)) errs.push(`${path} out of range`);
  })(spec, 'style');
  if (spec.basemap && !BASEMAPS.some((b) => b.id === spec.basemap)) errs.push('unknown basemap');
  return errs.length ? errs.join('; ') : null;
}

// The legacy desktop app's tuned settings (app_config 'mapstyle.*'), so Rory's
// last look carries over as a named style.
export function styleFromLegacy(cfg) {
  const s = defaultStyle();
  const g = (k) => cfg['mapstyle.' + k];
  if (g('land_color')) s.land = g('land_color');
  if (g('sea_color')) s.water = g('sea_color');
  if (g('labels_color')) s.labels.color = g('labels_color');
  if (g('labels_visible') !== undefined) s.labels.show = g('labels_visible') === '1';
  if (g('labels_density')) s.labels.density = { countries: 'countries', cities: 'cities', all: 'all' }[g('labels_density')] || 'cities';
  if (g('show_boundaries') !== undefined) s.layers.countries.show = g('show_boundaries') === '1';
  if (g('boundary_color')) s.layers.countries.color = g('boundary_color');
  if (g('boundary_width')) s.layers.countries.width = +g('boundary_width');
  if (g('show_roads') !== undefined) s.layers.roads.show = g('show_roads') === '1';
  if (g('show_ferry') !== undefined) s.layers.ferries.show = g('show_ferry') === '1';
  if (g('show_parks') !== undefined) s.layers.parks.show = g('show_parks') === '1';
  if (g('route_weight')) for (const t of Object.values(s.routes)) t.width = +g('route_weight');
  if (g('route_opacity')) s.routeOpacity = Math.min(1, +g('route_opacity') / 100);
  return s;
}
