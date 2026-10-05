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
    water: '#a9cbe0',          // oceans and seas
    lakes: null,               // null = same as water
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
    // simplify: metres of smoothing for this type; null = follow detail.routeSimplify. Walks keep full detail by default.
    routes: Object.fromEntries(TYPES.map((t) => [t.id, { color: t.color, width: t.width, show: true, dash: t.dash ? 'dashed' : 'solid', simplify: t.id === 'walk' ? 0 : null }])),
    // The palette the route colours came from, and how it was tuned to the background.
    // Picking or tuning it rewrites routes[type].color; a colour edited by hand stays until the next pick.
    palette: { id: 'classic', hue: 0, saturation: 0, lightness: 0, fit: false, contrast: 3 },
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
      routeCurve: 0,                       // 0 = straight segments; 1–5 rounds the corners (each step doubles the points)
    },
    smooth: true,

    // ── More options (Presets → More options). Everything off by default, so the
    // basic look is unchanged until someone reaches for it.
    projection: 'mercator',                // mercator | globe
    globe: { atmosphere: true, space: '#0b1020' },
    relief: { show: false, opacity: 0.5, exaggeration: 0.5, shadow: '#5a6472', highlight: '#ffffff', accent: '#8b95a3', direction: 315 },
    terrain3d: { show: false, exaggeration: 1.3 },
    landcover: { show: false, opacity: 0.6, wood: '#cfdcc0', grass: '#dfe7cc', farmland: '#ece6d3', ice: '#ffffff', sand: '#efe2c4', wetland: '#d3e1d9', rock: '#e1ddd6' },
    waterDetail: { outline: { show: false, color: '#7aa3bf', width: 0.6 }, rivers: { show: true, width: 1, color: null }, labelsItalic: true },
    visited: { show: false, color: '#f2d7a6', opacity: 0.55, outline: { show: false, color: '#c9a061', width: 0.8 }, fadeOthers: { show: false, color: '#e9e6df', opacity: 0.6 } },
    type: {                                // typography of map labels
      font: 'Noto Sans Regular', countryFont: 'Noto Sans Bold', scale: 1, uppercase: false, countriesUppercase: true,
      letterSpacing: 0, countryLetterSpacing: 0.12, haloWidth: 1.2, countryColor: null, cityColor: null, waterColor: null,
    },
    routeFx: {
      glow: { show: false, color: null, width: 6, blur: 6, opacity: 0.35 }, // color null = the route's own
      gradient: { mode: 'off', from: '#2a9d8f', via: '#e9c46a', to: '#e76f51' }, // off | trip (colour by date) | route (fade along each line)
      arrows: { show: false, spacing: 120, size: 0.7, color: null },
      cap: 'round',                        // round | butt | square
      // A walk whose extreme points are closer than `below` of the visible map width fades into a dot (TA-4).
      // Off by default: Rory and Eva read the dots as start/end markers (2026-10-05).
      walkPoi: { show: false, below: 0.05, size: 5 },
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
    routes: ramp(['#ffffff']), routeCasing: { show: false },
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
    land: '#f6f4ef', water: '#c9dbe6', routeFx: { gradient: { mode: 'trip' } },
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
    if (/palette\.hue$/.test(path) && typeof v === 'number' && !(v >= -180 && v <= 180)) errs.push(`${path} out of range`);
    if (/palette\.(saturation)$/.test(path) && typeof v === 'number' && !(v >= -100 && v <= 100)) errs.push(`${path} out of range`);
    if (/palette\.(lightness)$/.test(path) && typeof v === 'number' && !(v >= -50 && v <= 50)) errs.push(`${path} out of range`);
    if (/routes\.\w+\.simplify$/.test(path) && v !== null && !(typeof v === 'number' && v >= 0 && v <= 100000)) errs.push(`${path} out of range`);
    if (/routeCurve$/.test(path) && typeof v === 'number' && !(Number.isInteger(v) && v >= 0 && v <= 5)) errs.push(`${path} must be 0–5`);
    if (/walkPoi\.below$/.test(path) && typeof v === 'number' && !(v >= 0.005 && v <= 0.5)) errs.push(`${path} must be 0.5%–50%`);
    if (/routeSimplify$/.test(path) && typeof v === 'number' && !(v >= 0 && v <= 100000)) errs.push(`${path} out of range`);
    if (/(opacity|grain|vignette)$/i.test(path) && typeof v === 'number' && !(v >= 0 && v <= 1)) errs.push(`${path} must be 0–1`);
  })(spec, 'style');
  if (spec.basemap && !BASEMAPS.some((b) => b.id === spec.basemap)) errs.push('unknown basemap');
  if (spec.projection && !['mercator', 'globe'].includes(spec.projection)) errs.push('unknown projection');
  if (spec.detail && !['osm', '10m', '50m', '110m'].includes(spec.detail.coastline)) errs.push('unknown coastline detail');
  return errs.length ? errs.join('; ') : null;
}

// Colour for a moment in the trip (gradient mode 'trip'): from → via → to.
// ── Route palettes ──────────────────────────────────────────────────────
// One colour per transport type, in TYPES order: drive, taxi, bus, train,
// boat, walk, bike, ski, flight, other. `for` says which backgrounds suit it.
const pal = (id, label, forBg, colors) => ({ id, label, for: forBg, colors: Object.fromEntries(TYPES.map((t, i) => [t.id, colors[i]])) });
export const ROUTE_PALETTES = [
  pal('classic', 'Classic', 'Light maps', TYPES.map((t) => t.color)),
  pal('vivid', 'Vivid', 'Light & white maps', ['#1f6feb', '#4c8dff', '#f28c00', '#8e44ad', '#00a6a6', '#e53935', '#ff6d00', '#00a0e9', '#5f6b7a', '#78909c']),
  pal('pastel', 'Soft pastel', 'White, minimal albums', ['#6f9bd1', '#9dbbe3', '#efa968', '#b294d1', '#6fbcab', '#e07a7a', '#f19a6b', '#7fc3ea', '#a4abb3', '#b8bec5']),
  pal('earth', 'Earth', 'Cream, vintage, terrain', ['#2f4858', '#55707f', '#b5651d', '#6b4226', '#3d7a74', '#8c2f1c', '#a0522d', '#4a6670', '#7a6a55', '#8b8172']),
  pal('sunset', 'Sunset', 'Light & warm maps', ['#d1495b', '#e07a5f', '#edae49', '#7b2cbf', '#00798c', '#3d348b', '#f3722c', '#4ea8de', '#8d99ae', '#adb5bd']),
  pal('neon', 'Neon', 'Dark & night maps', ['#4cc9f0', '#7ad3ff', '#ffb703', '#c77dff', '#2ec4b6', '#ff4d6d', '#fb8500', '#90e0ef', '#e0e0e0', '#adb5bd']),
  pal('satellite', 'High-vis', 'Satellite & photo backgrounds', ['#ffeb3b', '#fff59d', '#ff9800', '#e040fb', '#00e5ff', '#ff1744', '#ff6e40', '#80d8ff', '#ffffff', '#eeeeee']),
  pal('okabe', 'Colour-blind safe', 'Any map (Okabe–Ito)', ['#0072b2', '#56b4e9', '#e69f00', '#cc79a7', '#009e73', '#d55e00', '#1a1a1a', '#88ccee', '#999999', '#777777']),
  pal('ink', 'Ink + accent', 'Print, monochrome', ['#1a1a1a', '#4d4d4d', '#333333', '#555555', '#2b4c6f', '#c62828', '#3a3a3a', '#6b6b6b', '#8a8a8a', '#9e9e9e']),
];

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgbHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
function rgbHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const luminance = (hex) => { const [r, g, b] = hexRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrastRatio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Shift hue (°), saturation and lightness (±%) — the "tune to the background" knobs.
export function tuneColor(hex, { hue = 0, saturation = 0, lightness = 0 } = {}) {
  const [h, s, l] = rgbHsl(hexRgb(hex));
  return rgbHex(hslRgb([(h + hue + 360) % 360, Math.max(0, Math.min(1, s * (1 + saturation / 100))), Math.max(0, Math.min(1, l + lightness / 100))]));
}
// Darken or lighten (away from the background) until the line stands out by `min`:1.
export function ensureContrast(hex, bg, min = 3) {
  if (contrastRatio(hex, bg) >= min) return hex;
  const [h, s, l0] = rgbHsl(hexRgb(hex));
  const darker = luminance(bg) > 0.35;
  for (let i = 1; i <= 50; i++) {
    const l = Math.max(0, Math.min(1, l0 + (darker ? -i : i) / 50));
    const c = rgbHex(hslRgb([h, s, l]));
    if (contrastRatio(c, bg) >= min || l === 0 || l === 1) return c;
  }
  return hex;
}
// The colour each transport type gets from the spec's palette settings.
export function paletteColors(spec, p = spec.palette) {
  const base = ROUTE_PALETTES.find((x) => x.id === (p && p.id)) || ROUTE_PALETTES[0];
  const bg = spec.background || spec.land;
  const out = {};
  for (const [id, hex] of Object.entries(base.colors)) {
    let c = tuneColor(hex, p || {});
    if (p && p.fit) c = ensureContrast(c, bg, p.contrast || 3);
    out[id] = c;
  }
  return out;
}
// A copy of the spec with the palette applied to every route type (widths, dashes kept).
export function applyPalette(spec, p) {
  const s = structuredClone(spec);
  s.palette = { ...defaultStyle().palette, ...(s.palette || {}), ...(p || {}) };
  for (const [id, color] of Object.entries(paletteColors(s))) s.routes[id] = { ...(s.routes[id] || {}), color };
  return s;
}
// The palette that suits a background: night maps want bright lines, cream wants earthy ones.
export function suggestPalette(spec) {
  const bg = spec.background || spec.land, L = luminance(bg), [, sat] = rgbHsl(hexRgb(bg));
  if (L < 0.18) return 'neon';
  if (L < 0.4) return 'satellite';
  if (sat > 0.25 && L < 0.85) return 'earth';
  if (L > 0.9) return 'vivid';
  return 'classic';
}

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
