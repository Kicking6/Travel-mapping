// Map style spec — shape, defaults, presets and merge. Shared by the style
// editor, the live map, the print/video renderers and the Worker (which
// validates on save). A saved style only stores what it has; resolveStyle()
// lays it over defaultStyle(), so adding a knob here never needs a migration.
import { TYPES } from './types.js';

export const BASEMAPS = [
  // OpenFreeMap: keyless vector tiles, so the renderers can request them at any pixel ratio.
  { id: 'positron', label: 'Light (Positron)', url: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'bright', label: 'Bright', url: 'https://tiles.openfreemap.org/styles/bright' },
  { id: 'liberty', label: 'Liberty', url: 'https://tiles.openfreemap.org/styles/liberty' },
];

// Glyph fonts the OpenFreeMap font server actually has.
export const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
// Fonts for the printed title/legend, drawn on the export canvas, so any web-safe stack works.
export const TITLE_FONTS = [
  { id: 'sans', label: 'Sans (system)', css: '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'serif', label: 'Serif (Georgia)', css: 'Georgia, "Times New Roman", serif' },
  { id: 'didone', label: 'Didone (Didot)', css: 'Didot, "Bodoni 72", "Bodoni MT", Georgia, serif' },
  { id: 'mono', label: 'Mono', css: 'ui-monospace, "SF Mono", Menlo, monospace' },
  { id: 'rounded', label: 'Rounded', css: '"SF Pro Rounded", "Arial Rounded MT Bold", "Helvetica Neue", sans-serif' },
  { id: 'condensed', label: 'Condensed', css: '"Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", sans-serif' },
];

// Kinds from the trip's accommodation sheet first, then general ones. `size`
// is the pin's radius-ish in px (the icon box is ~2.6× it).
export const PLACE_KINDS = [
  { id: 'freedom', label: 'Freedom camping', color: '#2e7d32', size: 6, shape: 'triangle', glyph: 'none' },
  { id: 'campground', label: 'Campground', color: '#558b2f', size: 6.5, shape: 'pin', glyph: 'tent' },
  { id: 'tent', label: 'Tent camping', color: '#33691e', size: 6.5, shape: 'circle', glyph: 'tent' },
  { id: 'carpark', label: 'Car park / roadside', color: '#6d4c41', size: 5.5, shape: 'rounded', glyph: 'car' },
  { id: 'stay', label: 'Accommodation', color: '#1c5d8c', size: 6.5, shape: 'pin', glyph: 'bed' },
  { id: 'friends', label: 'Friends / family', color: '#ef6c00', size: 6.5, shape: 'pin', glyph: 'heart' },
  { id: 'hut', label: 'Cabin / hut', color: '#795548', size: 6.5, shape: 'pin', glyph: 'cabin' },
  { id: 'hotel', label: 'Hotel', color: '#1c5d8c', size: 6, shape: 'circle', glyph: 'bed' },
  { id: 'hostel', label: 'Hostel', color: '#7b5ea7', size: 6, shape: 'circle', glyph: 'bed' },
  { id: 'airbnb', label: 'Airbnb / rental', color: '#c2185b', size: 6, shape: 'circle', glyph: 'house' },
  { id: 'sight', label: 'Sight', color: '#455a64', size: 5, shape: 'star', glyph: 'none' },
  { id: 'other', label: 'Other', color: '#677384', size: 5, shape: 'circle', glyph: 'none' },
];

export const DASHES = { solid: null, dashed: [3, 2], dotted: [0.1, 2], long: [6, 3], dashdot: [4, 2, 0.1, 2] };

export function defaultStyle() {
  return {
    basemap: 'positron',
    land: '#f4f1ea',
    water: '#a9cbe0',
    background: null,          // null = same as land
    labels: { show: true, color: '#3a4553', halo: '#ffffff', density: 'cities' }, // countries | cities | all
    layers: {
      countries: { show: true, color: '#8b95a3', width: 1 },
      states: { show: false, color: '#b4bcc6', width: 0.6 },
      roads: { show: false, color: '#d8d2c4', width: 0.6, density: 'major' }, // major | all
      ferries: { show: false, color: '#7aa6c2', width: 0.8 },
      parks: { show: false, color: '#d9e8cf' },
      buildings: { show: false },
    },
    routes: Object.fromEntries(TYPES.map((t) => [t.id, { color: t.color, width: t.width, show: true, dash: t.dash ? 'dashed' : 'solid' }])),
    routeOpacity: 0.95,
    routeCasing: { show: true, color: '#ffffff', width: 1.5 },
    places: {
      show: true, labels: false, stroke: '#ffffff', strokeWidth: 1.5, opacity: 1, shadow: true,
      scale: 1.6,                          // every pin at once, on top of each kind's own size
      kinds: Object.fromEntries(PLACE_KINDS.map((k) => [k.id, { color: k.color, size: k.size, show: true, shape: k.shape, glyph: k.glyph, glyphColor: '#ffffff' }])),
      label: { field: 'name', size: 11, color: null, halo: null, haloWidth: 1.4, font: 'Noto Sans Regular', position: 'top', uppercase: false, minZoom: 0 },
      numbering: false,                    // number stays in date order (shown by the "Night number" symbol and labels)
      connect: { show: false, color: '#677384', width: 1.2, dash: 'dotted', opacity: 0.85 }, // join the stays in date order
    },
    // How coarse the base map is — for a clean, generalised look at any scale.
    detail: {
      coastline: 'osm',                    // osm (finest) | 10m (~1 km) | 50m (~5 km) | 110m (~30 km) — Natural Earth land
      softness: 0,                         // px of blur along the coast
      baseLevel: 0,                        // 0 = automatic; 2–12 caps how detailed the base map's shapes get
      routeSimplify: 0,                    // metres — smooth our routes for the overview look
    },
    smooth: true,

    // ── Advanced (Map styles → Advanced). Everything off by default, so the
    // basic look is unchanged until someone reaches for it.
    projection: 'mercator',                // mercator | globe
    globe: { atmosphere: true, space: '#0b1020' },
    relief: { show: false, opacity: 0.5, exaggeration: 0.5, shadow: '#5a6472', highlight: '#ffffff', accent: '#8b95a3', direction: 315 },
    terrain3d: { show: false, exaggeration: 1.3 },
    landcover: { show: false, opacity: 0.6, wood: '#cfdcc0', grass: '#dfe7cc', farmland: '#ece6d3', ice: '#ffffff', sand: '#efe2c4', wetland: '#d3e1d9', rock: '#e1ddd6' },
    waterDetail: { outline: { show: false, color: '#7aa3bf', width: 0.6 }, rivers: { show: true, width: 1 }, labelsItalic: true },
    visited: { show: false, color: '#f2d7a6', opacity: 0.55, outline: { show: false, color: '#c9a061', width: 0.8 }, fadeOthers: { show: false, color: '#e9e6df', opacity: 0.6 } },
    type: {                                // typography of map labels
      font: 'Noto Sans Regular', countryFont: 'Noto Sans Bold', scale: 1, uppercase: false, countriesUppercase: true,
      letterSpacing: 0, countryLetterSpacing: 0.12, haloWidth: 1.2, countryColor: null, cityColor: null, waterColor: null,
    },
    routeFx: {
      glow: { show: false, color: null, width: 6, blur: 6, opacity: 0.35 }, // color null = the route's own
      gradient: { mode: 'off', from: '#2a9d8f', via: '#e9c46a', to: '#e76f51' }, // off | trip (colour by date) | route (fade along each line)
      arrows: { show: false, spacing: 120, size: 0.7, color: null },
      endpoints: { show: false, size: 3.5, color: '#ffffff', stroke: '#16202b' },
      cap: 'round',                        // round | butt | square
    },
    finish: {                              // applied on export (and the print preview)
      grain: 0, vignette: 0, tint: { show: false, color: '#f3e9d2', opacity: 0.12, blend: 'multiply' },
      border: { show: false, width: 0, color: '#16202b', inset: 0 }, // mm
    },
    decor: {                               // page furniture drawn on export
      titleFont: 'sans', titleSize: 26, titleColor: null, titlePosition: 'bottom-left', titleUppercase: false, titleSpacing: 0,
      subtitle: 'dates',                   // off | dates | custom
      legend: { show: false, position: 'bottom-right' },
      scaleBar: { show: false, position: 'bottom-left' },
      northArrow: { show: false, position: 'top-right' },
      plate: { show: false, color: '#ffffff', opacity: 0.85 }, // a panel behind title/legend
    },
  };
}

// Designer presets: partial specs laid over the defaults. They set a mood,
// not every knob — routes keep their per-type colours unless the preset says otherwise.
const ramp = (colors) => Object.fromEntries(TYPES.map((t, i) => [t.id, { color: colors[i % colors.length] }]));
export const PRESETS = [
  { id: 'album-light', label: 'Album light', spec: {} },
  { id: 'vintage', label: 'Vintage atlas', spec: {
    land: '#efe3c8', water: '#a9c4c0', labels: { color: '#5b4a33', halo: '#f5ecd8' },
    layers: { countries: { color: '#a4865a', width: 0.9 }, states: { show: true, color: '#c8b48e', width: 0.5 } },
    routes: ramp(['#8c2f1c', '#a0522d', '#6b4226', '#3d5a4c', '#2f4858', '#b5651d', '#7a3b2e', '#4a6670', '#5b4a33', '#7a6a55']),
    routeCasing: { color: '#f5ecd8' }, relief: { show: true, opacity: 0.35, shadow: '#8a7350', highlight: '#fff6e0' },
    type: { font: 'Noto Sans Italic', countryFont: 'Noto Sans Bold', countriesUppercase: true, countryLetterSpacing: 0.25 },
    finish: { grain: 0.25, vignette: 0.35, tint: { show: true, color: '#e8d5ac', opacity: 0.18 } },
    decor: { titleFont: 'didone', titleUppercase: true, titleSpacing: 0.2 },
  } },
  { id: 'midnight', label: 'Midnight', spec: {
    land: '#1d2533', water: '#0f1520', labels: { color: '#c9d3e0', halo: '#0f1520' },
    layers: { countries: { color: '#3c4a60', width: 0.8 } },
    routes: ramp(['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b', '#ff70a6', '#ffd166', '#9be564', '#e0e0e0', '#a0a0a0']),
    routeCasing: { show: false }, routeFx: { glow: { show: true, width: 8, blur: 8, opacity: 0.45 } },
    finish: { vignette: 0.4 }, decor: { titleColor: '#f1f4f8' }, globe: { space: '#05070d' },
  } },
  { id: 'blueprint', label: 'Blueprint', spec: {
    land: '#1f4e79', water: '#173d61', labels: { color: '#dbe8f5', halo: '#1f4e79' },
    layers: { countries: { color: '#9cc2e5', width: 0.7 }, states: { show: true, color: '#5f8fbf', width: 0.4 } },
    routes: ramp(['#ffffff']), routeCasing: { show: false }, routeFx: { endpoints: { show: true, color: '#1f4e79', stroke: '#ffffff' } },
    type: { font: 'Noto Sans Regular', uppercase: true, letterSpacing: 0.15, countryLetterSpacing: 0.3 },
    decor: { titleFont: 'mono', titleColor: '#ffffff', titleUppercase: true, titleSpacing: 0.15 },
  } },
  { id: 'ink', label: 'Ink & paper', spec: {
    land: '#ffffff', water: '#ffffff', labels: { color: '#222222', halo: '#ffffff' },
    layers: { countries: { color: '#222222', width: 0.6 } }, waterDetail: { outline: { show: true, color: '#222222', width: 0.6 } },
    routes: ramp(['#d62828']), routeCasing: { show: false },
    type: { countryFont: 'Noto Sans Regular', countryLetterSpacing: 0.35 },
    decor: { titleFont: 'serif' },
  } },
  { id: 'swiss', label: 'Swiss minimal', spec: {
    land: '#f2f2f0', water: '#d6dde3', labels: { show: true, density: 'countries', color: '#1a1a1a' },
    layers: { countries: { show: true, color: '#ffffff', width: 1.6 } },
    routes: ramp(['#e30613', '#1a1a1a', '#f39200', '#1a1a1a', '#0057a8', '#00843d', '#6a1b9a', '#0098d8', '#9a9a9a', '#9a9a9a']),
    routeCasing: { show: false }, routeFx: { cap: 'butt' },
    type: { countryFont: 'Noto Sans Bold', countriesUppercase: true, countryLetterSpacing: 0.05 },
    decor: { titleFont: 'sans', titleSize: 34, titlePosition: 'top-left', legend: { show: true } },
  } },
  { id: 'watercolour', label: 'Watercolour', spec: {
    land: '#f7f1e6', water: '#bcd9e6', labels: { color: '#4a5560', halo: '#f7f1e6' },
    landcover: { show: true, opacity: 0.5 }, relief: { show: true, opacity: 0.25 },
    routeFx: { glow: { show: true, width: 10, blur: 10, opacity: 0.3 } }, routeOpacity: 0.85,
    finish: { grain: 0.35, vignette: 0.15, tint: { show: true, color: '#f0e3cc', opacity: 0.1 } },
    decor: { titleFont: 'serif' },
  } },
  { id: 'terrain', label: 'Terrain', spec: {
    basemap: 'positron', land: '#eef0e6', water: '#a8c8dc', landcover: { show: true, opacity: 0.7 },
    relief: { show: true, opacity: 0.6, exaggeration: 0.7 }, layers: { countries: { color: '#7c8576' } },
  } },
  { id: 'journey', label: 'Journey gradient', spec: {
    land: '#f6f4ef', water: '#c9dbe6', routeFx: { gradient: { mode: 'trip' }, endpoints: { show: false } },
    visited: { show: true, color: '#efe2c6', opacity: 0.6 }, decor: { legend: { show: false } },
  } },
];

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
    out[k] = isObj(base[k]) && isObj(over[k]) ? mergeStyle(base[k], over[k], k) : (base[k] === null || typeof over[k] === typeof base[k] || over[k] === null ? over[k] : base[k]);
  }
  return out;
}

export function resolveStyle(saved, overrides) {
  return mergeStyle(mergeStyle(defaultStyle(), saved || {}), overrides || {});
}

export function applyPreset(spec, presetId) {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) return spec;
  // Presets start from the defaults, so switching presets doesn't accumulate leftovers.
  return mergeStyle(defaultStyle(), structuredClone(p.spec));
}

const HEX = /^#[0-9a-f]{6}$/i;
// Server-side check: colours are hex, numbers are sane. Returns an error string or null.
export function validateStyle(spec) {
  const errs = [];
  (function walk(v, path) {
    if (isObj(v)) { for (const k of Object.keys(v)) walk(v[k], path + '.' + k); return; }
    if (typeof v === 'string' && (v.startsWith('#') || /(color|land|water|halo|background|shadow|highlight|accent|space|from|via|to|stroke|wood|grass|farmland|ice|sand|wetland|rock)$/i.test(path)) && !HEX.test(v)
      && !/(blend|mode|font|position|subtitle|density|cap|dash|basemap|projection|titleFont|titleColor|shape|glyph|field|coastline)$/i.test(path)) errs.push(`${path} is not a #rrggbb colour`);
    if (/(width|size|spacing)$/i.test(path) && typeof v === 'number' && !(v >= 0 && v <= 400)) errs.push(`${path} out of range`);
    if (/places\.scale$/.test(path) && typeof v === 'number' && !(v >= 0.2 && v <= 6)) errs.push(`${path} must be 0.2–6`);
    if (/routeSimplify$/.test(path) && typeof v === 'number' && !(v >= 0 && v <= 100000)) errs.push(`${path} out of range`);
    if (/(opacity|grain|vignette)$/i.test(path) && typeof v === 'number' && !(v >= 0 && v <= 1)) errs.push(`${path} must be 0–1`);
  })(spec, 'style');
  if (spec.basemap && !BASEMAPS.some((b) => b.id === spec.basemap)) errs.push('unknown basemap');
  if (spec.projection && !['mercator', 'globe'].includes(spec.projection)) errs.push('unknown projection');
  if (spec.detail && !['osm', '10m', '50m', '110m'].includes(spec.detail.coastline)) errs.push('unknown coastline detail');
  return errs.length ? errs.join('; ') : null;
}

// Colour for a moment in the trip (gradient mode 'trip'): from → via → to.
// A pin's drawn height in px (before the map's pixel ratio): its kind's size × the all-pins scale.
export const pinPx = (kind, places) => kind.size * 2.6 * ((places && places.scale) || 1);

export function rampColor(g, t) {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, f) => '#' + a.map((x, i) => Math.round(x + (b[i] - x) * f).toString(16).padStart(2, '0')).join('');
  const f = Math.max(0, Math.min(1, t));
  return f < 0.5 ? mix(hex(g.from), hex(g.via), f * 2) : mix(hex(g.via), hex(g.to), (f - 0.5) * 2);
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
