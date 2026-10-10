// Preset controls, declared once and rendered from data — the Presets page
// (#/map) and an album page's "Look" tab use the same component.
// The essentials come first and open; everything else sits under "More options".
import { esc } from '../app.js';
import { BASEMAPS, PLACE_KINDS, FONTS, TITLE_FONTS, DASHES, PRESETS, ROUTE_PALETTES, paletteColors, suggestPalette, logScale } from '../lib/style.js';
import { TYPES } from '../lib/types.js';
import { SHAPES, GLYPHS } from '../lib/pins.js';

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const POS = [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']];
const DASH_OPTS = Object.keys(DASHES).map((d) => [d, d === 'dashdot' ? 'dash-dot' : d]);
const DETAIL_OPTS = [['', 'Same as all routes'], ['0', 'Full detail'], ['10', '10 m'], ['25', '25 m'], ['50', '50 m'], ['100', '100 m'], ['250', '250 m'], ['500', '500 m'], ['1000', '1 km'], ['2000', '2 km'], ['5000', '5 km'], ['10000', '10 km']];

// Row helpers: c = colour, t = toggle, r = range, n = number, s = select, ca = colour or auto
const c = (path, label) => ({ k: 'color', path, label });
// `fallback(spec)`: the colour in use while it's on automatic, so the swatch shows it.
const ca = (path, label, auto = 'Automatic', fallback) => ({ k: 'colorAuto', path, label, auto, fallback });
const t = (path, label) => ({ k: 'toggle', path, label });
// `show` turns the value into a hint under the slider; `mul` is how the value is typed (0.05 → 5 with mul 100);
// `scale` bends the slider (fine steps at the low end) — the value is still typed exactly (TA-7, TA-8).
const r = (path, label, min, max, step, unit = '', show, mul = 1) => ({ k: 'range', path, label, min, max, step, unit, show, mul });
// What a base-map detail level means on the ground: features smaller than ~this are smoothed away.
const levelKm = (z) => (z ? `≈ ${(40075 / (512 * 2 ** z) * 4).toFixed(z > 6 ? 1 : 0)} km` : 'Automatic');
const curveLabel = (k) => (k ? `${2 ** k}× points` : 'Off');
const metres = (m) => (m ? (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${m} m`) : 'Off');
const n = (path, label, min, max, step) => ({ k: 'number', path, label, min, max, step });
const s = (path, label, options) => ({ k: 'select', path, label, options });
const line = (base, label, extra = []) => ({ k: 'line', base, label, extra });

export function sections(spec, placeKinds) {
  return [
    // ── The essentials, always open: what a preset is mostly about.
    { id: 'water', title: 'Land & water', rows: [
      c('land', 'Land'), c('water', 'Ocean & sea'), ca('lakes', 'Lakes', 'Same as the ocean', (sp) => sp.water),
      t('waterDetail.rivers.show', 'Rivers & streams'), ca('waterDetail.rivers.color', 'River colour', 'Same as lakes', (sp) => sp.lakes || sp.water),
      r('waterDetail.rivers.width', 'River width', 0.2, 4, 0.1, '×'),
    ] },
    { id: 'borders', title: 'Boundaries', rows: [
      { k: 'note', text: 'Switch · colour · width.' },
      line('layers.countries', 'Country borders'), line('layers.states', 'State / province borders'), { k: 'lineNoWidth', base: 'waterDetail.outline', label: 'Coastline outline' },
    ] },
    { id: 'routes', title: 'Routes', rows: [
      { k: 'note', text: 'Each kind of travel: switch · colour · width · line pattern.' },
      ...TYPES.map((ty) => ({ k: 'route', id: ty.id, label: ty.label })),
    ] },
    { id: 'places', title: 'Stays & points of interest', rows: [
      t('places.show', 'Show stays & points of interest'),
      r('places.scale', 'Size of all points', 0.5, 5, 0.05, '×'),
      t('places.labels', 'Label them'),
      { k: 'note', text: 'Set “All kinds” first, then ⋯ on a kind to change just that one: shape · symbol · symbol colour · outline.' },
      { k: 'kindsAll' },
      ...placeKinds.map((k) => ({ k: 'kind', id: k, label: (PLACE_KINDS.find((x) => x.id === k) || { label: k }).label })),
    ] },
    { id: 'labels', title: 'Place names', rows: [
      t('labels.show', 'Show place names'), s('labels.density', 'How many', [['countries', 'Countries only'], ['cities', 'Countries, regions & cities'], ['all', 'Everything']]),
      c('labels.color', 'Text'), c('labels.halo', 'Halo'),
    ] },
    { id: 'shape', title: 'Route line detail & curve', rows: [
      { ...r('detail.routeSimplify', 'Detail — simplify the lines', 0, 20000, 250, '', metres), scale: logScale(5, 20000) },
      r('detail.routeCurve', 'Curve — round the corners', 0, 5, 1, '', curveLabel),
      { k: 'note', text: 'Simplify drops points so long drives read as clean strokes (corners stay sharp); curve then rounds the corners into smooth bends. Flights are never changed.' },
    ] },

    // ── More options (collapsed).
    { id: 'presets', advanced: true, title: 'Apply a ready-made look', rows: [
      { k: 'note', text: 'Replaces this preset\'s colours with a starting look — then tune it above.' },
      { k: 'presets' },
    ] },
    { id: 'base', advanced: true, title: 'Base map', rows: [
      s('basemap', 'Map data style', BASEMAPS.map((b) => [b.id, b.label])), t('smooth', 'Smooth line corners'),
    ] },
    { id: 'detail', advanced: true, title: 'Map detail (coarseness)', rows: [
      s('detail.coastline', 'Coastline & lakes', [['osm', 'Finest — OpenStreetMap'], ['10m', 'Detailed — ≈ 1 km (Natural Earth 1:10m)'], ['50m', 'Smooth — ≈ 5 km (1:50m)'], ['110m', 'Very smooth — ≈ 30 km (1:110m)']]),
      r('detail.softness', 'Coast softness (with a smoothed coastline)', 0, 20, 0.5, 'px'),
      r('detail.baseLevel', 'Base-map detail', 0, 12, 1, '', levelKm),
      { k: 'note', text: 'Base-map detail caps how much the roads, borders and lakes are drawn — slide left for a cleaner, more generalised map at any zoom.' },
      { k: 'note', text: 'Route detail per type — walks can stay crisp while long drives are smoothed. “Same as all routes” follows the Detail slider above.' },
      ...TYPES.filter((ty) => ty.id !== 'flight').map((ty) => ({ k: 'select', path: `routes.${ty.id}.simplify`, num: true, label: ty.label, options: DETAIL_OPTS })),
    ] },
    { id: 'lines', advanced: true, title: 'Roads, ferries & parks', rows: [
      line('layers.roads', 'Roads', [s('layers.roads.density', 'Which roads', [['major', 'Major roads only'], ['all', 'All roads']])]),
      line('layers.ferries', 'Ferry lines'), { k: 'lineNoWidth', base: 'layers.parks', label: 'Parks' }, t('layers.buildings.show', 'Buildings (close zoom)'),
    ] },
    { id: 'routes-more', advanced: true, title: 'Route palettes & edges', rows: [
      { k: 'palette' },
      r('palette.hue', 'Shift hue', -180, 180, 5, '°'), r('palette.saturation', 'Saturation', -100, 100, 5, '%'), r('palette.lightness', 'Lighter / darker', -50, 50, 1, '%'),
      t('palette.fit', 'Keep lines readable on the land colour'), r('palette.contrast', 'Minimum contrast', 1.5, 7, 0.5, ':1'),
      { k: 'note', text: 'Picking or tuning a palette recolours every route type in Routes above; a colour set by hand stays until the next pick.' },
      r('routeOpacity', 'Opacity', 0.1, 1, 0.05), line('routeCasing', 'White edge'),
      t('routeFx.walkPoi.show', 'Show short walks as a dot when zoomed out'),
      r('routeFx.walkPoi.below', 'Turn into a dot below (% of map width)', 0.01, 0.2, 0.01, '%', undefined, 100),
      r('routeFx.walkPoi.size', 'Walk dot size', 2, 14, 0.5, 'px'),
      { k: 'note', text: 'Off by default — routes are plain lines with no dots at their ends.' },
    ] },
    { id: 'adv-pins', advanced: true, title: 'Pins & place labels', rows: [
      r('places.opacity', 'Pin opacity', 0.1, 1, 0.05), c('places.stroke', 'Default outline colour'), r('places.strokeWidth', 'Outline width', 0, 5, 0.25, 'px'), t('places.shadow', 'Soft shadow under pins'),
      s('places.label.field', 'Label text', [['name', 'Name'], ['name-nights', 'Name · nights'], ['name-date', 'Name · date'], ['date', 'Date'], ['nights', 'Nights'], ['number', 'Night number'], ['number-name', 'Number. Name']]),
      s('places.label.position', 'Label position', [['top', 'Above'], ['bottom', 'Below'], ['right', 'Right'], ['left', 'Left']]),
      s('places.label.font', 'Label font', FONTS.map((f) => [f, f.replace('Noto Sans ', '')])), r('places.label.size', 'Label size', 7, 24, 0.5, 'px'),
      ca('places.label.color', 'Label colour', 'Same as place names'), ca('places.label.halo', 'Label halo', 'Same as place names'), r('places.label.haloWidth', 'Halo width', 0, 4, 0.1, 'px'),
      t('places.label.uppercase', 'Uppercase labels'), r('places.label.minZoom', 'Labels from zoom', 0, 14, 0.5, ''),
      { k: 'note', text: 'Each pin kind can use this outline colour or its own, or none — set it under ⋯ on the Stays & points of interest kind.' },
      { k: 'note', text: 'Numbered stays: pick the “Night number” symbol for a kind, or the Night number label — stays are numbered in date order.' },
      t('places.connect.show', 'Join the stays in date order'), c('places.connect.color', 'Line colour'), r('places.connect.width', 'Line width', 0.25, 8, 0.25, 'px'),
      s('places.connect.dash', 'Line pattern', DASH_OPTS), r('places.connect.opacity', 'Line opacity', 0.1, 1, 0.05),
    ] },

    { id: 'adv-projection', advanced: true, title: 'Projection & globe', rows: [
      s('projection', 'Projection', [['mercator', 'Flat (Mercator)'], ['globe', 'Globe']]), t('globe.atmosphere', 'Atmosphere glow'), c('globe.space', 'Space around the globe'),
      { k: 'note', text: 'Tilt and rotate an album page with right-click-drag (or two fingers) — the export keeps the camera.' },
    ] },
    { id: 'adv-terrain', advanced: true, title: 'Terrain', rows: [
      t('relief.show', 'Hill shading'), r('relief.opacity', 'Strength', 0, 1, 0.05), r('relief.exaggeration', 'Exaggeration', 0, 1, 0.05),
      r('relief.direction', 'Light from', 0, 359, 1, '°'), c('relief.shadow', 'Shadow'), c('relief.highlight', 'Highlight'), c('relief.accent', 'Accent'),
      t('terrain3d.show', '3D terrain (with tilt)'), r('terrain3d.exaggeration', '3D height', 0.5, 3, 0.1, '×'),
    ] },
    { id: 'adv-landcover', advanced: true, title: 'Land cover', rows: [
      t('landcover.show', 'Show forests, grass, ice, sand…'), r('landcover.opacity', 'Strength', 0, 1, 0.05),
      c('landcover.wood', 'Forest'), c('landcover.grass', 'Grass & scrub'), c('landcover.farmland', 'Farmland'), c('landcover.ice', 'Ice & glacier'),
      c('landcover.sand', 'Sand & desert'), c('landcover.wetland', 'Wetland'), c('landcover.rock', 'Rock & scree'),
    ] },
    { id: 'adv-visited', advanced: true, title: 'Countries we visited', rows: [
      t('visited.show', 'Fill countries we visited'), c('visited.color', 'Fill'), r('visited.opacity', 'Fill strength', 0, 1, 0.05),
      line('visited.outline', 'Outline'), t('visited.fadeOthers.show', 'Fade everywhere else'), c('visited.fadeOthers.color', 'Fade colour'), r('visited.fadeOthers.opacity', 'Fade strength', 0, 1, 0.05),
    ] },
    { id: 'adv-type', advanced: true, title: 'Typography', rows: [
      s('type.font', 'Font', FONTS.map((f) => [f, f.replace('Noto Sans ', '')])), s('type.countryFont', 'Country font', FONTS.map((f) => [f, f.replace('Noto Sans ', '')])),
      r('type.scale', 'Size', 0.5, 2.5, 0.05, '×'), t('type.uppercase', 'Uppercase names'), t('type.countriesUppercase', 'Uppercase countries'),
      r('type.letterSpacing', 'Letter spacing', 0, 0.6, 0.01, 'em'), r('type.countryLetterSpacing', 'Country letter spacing', 0, 0.8, 0.01, 'em'),
      r('type.haloWidth', 'Halo width', 0, 4, 0.1, 'px'), t('waterDetail.labelsItalic', 'Italic sea & lake names'), ca('type.countryColor', 'Country names', 'Same as text'), ca('type.cityColor', 'City names', 'Same as text'), ca('type.waterColor', 'Water names', 'Same as text'),
    ] },
    { id: 'adv-routefx', advanced: true, title: 'Route effects', rows: [
      s('routeFx.gradient.mode', 'Colour', [['off', 'By transport type'], ['trip', 'Gradient through the trip (by date)'], ['route', 'Gradient along each route']]),
      c('routeFx.gradient.from', 'Gradient start'), c('routeFx.gradient.via', 'Gradient middle'), c('routeFx.gradient.to', 'Gradient end'),
      t('routeFx.glow.show', 'Glow'), ca('routeFx.glow.color', 'Glow colour', 'Route colour'), r('routeFx.glow.width', 'Glow size', 1, 30, 0.5, 'px'), r('routeFx.glow.blur', 'Glow softness', 0, 30, 0.5, 'px'), r('routeFx.glow.opacity', 'Glow strength', 0, 1, 0.05),
      t('routeFx.arrows.show', 'Direction arrows'), r('routeFx.arrows.spacing', 'Arrow spacing', 30, 400, 5, 'px'), r('routeFx.arrows.size', 'Arrow size', 0.3, 2, 0.05, '×'), ca('routeFx.arrows.color', 'Arrow colour', 'Route colour'),
      s('routeFx.cap', 'Line ends', [['round', 'Round'], ['butt', 'Flat'], ['square', 'Square']]),
    ] },
    { id: 'adv-finish', advanced: true, title: 'Print finishing', rows: [
      { k: 'note', text: 'Applied to exports and Preview, not the live map.' },
      r('finish.grain', 'Paper grain', 0, 1, 0.05), r('finish.vignette', 'Vignette', 0, 1, 0.05),
      t('finish.tint.show', 'Colour wash'), c('finish.tint.color', 'Wash colour'), r('finish.tint.opacity', 'Wash strength', 0, 1, 0.02),
      s('finish.tint.blend', 'Wash blend', [['multiply', 'Multiply'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['color', 'Colour'], ['screen', 'Screen']]),
      t('finish.border.show', 'Border'), r('finish.border.width', 'Border width', 0, 20, 0.25, 'mm'), r('finish.border.inset', 'Border inset', 0, 40, 0.5, 'mm'), c('finish.border.color', 'Border colour'),
    ] },
    { id: 'adv-decor', advanced: true, title: 'Title, legend & furniture', rows: [
      s('decor.titleFont', 'Title font', TITLE_FONTS.map((f) => [f.id, f.label])), r('decor.titleSize', 'Title size', 10, 90, 1, 'px'), ca('decor.titleColor', 'Title colour', 'Same as labels'),
      s('decor.titlePosition', 'Title position', POS), t('decor.titleUppercase', 'Uppercase title'), r('decor.titleSpacing', 'Title letter spacing', 0, 0.6, 0.01, 'em'),
      s('decor.subtitle', 'Subtitle', [['off', 'None'], ['dates', 'The dates on the page'], ['custom', 'Custom (set on the album page)']]),
      t('decor.legend.show', 'Legend'), s('decor.legend.position', 'Legend position', POS),
      t('decor.scaleBar.show', 'Scale bar'), s('decor.scaleBar.position', 'Scale bar position', POS),
      t('decor.northArrow.show', 'North arrow'), s('decor.northArrow.position', 'North arrow position', POS),
      t('decor.plate.show', 'Panel behind title & legend'), c('decor.plate.color', 'Panel colour'), r('decor.plate.opacity', 'Panel opacity', 0, 1, 0.05),
    ] },
    { id: 'adv-file', advanced: true, title: 'Preset file', rows: [{ k: 'file' }] },
  ];
}

function rowHtml(row, spec) {
  const v = row.path ? get(spec, row.path) : null;
  switch (row.k) {
    case 'color': return `<label class="style-line"><span>${esc(row.label)}</span><input type="color" data-path="${row.path}" value="${esc(v)}"><span></span></label>`;
    case 'colorAuto': return `<div class="style-line"><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-auto="${row.path}" ${v ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label><input type="color" data-path="${row.path}" value="${esc(v || (row.fallback && row.fallback(spec)) || '#16202b')}" ${v ? '' : 'disabled'} title="${v ? '' : esc(row.auto)}"><span class="help">${v ? '' : esc(row.auto)}</span></div>`;
    case 'toggle': return `<label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="${row.path}" ${v ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label>`;
    case 'range': {
      const sc = row.scale, mul = row.mul || 1;
      return `<label class="range-line has-num"><span>${esc(row.label)}</span><input type="range" data-path="${row.path}" min="${sc ? 0 : row.min}" max="${sc ? 100 : row.max}" step="${sc ? 1 : row.step}" value="${sc ? sc.pos(v) : v}"><input class="input sm" type="number" data-box="${row.path}" min="${+(row.min * mul).toFixed(4)}" max="${+(row.max * mul).toFixed(4)}" step="any" value="${shown(row, v)}" title="Type a value (${+(row.min * mul).toFixed(4)}–${+(row.max * mul).toFixed(4)})"><output${row.show ? ' class="long"' : ''}>${esc(row.show ? row.show(v) : row.unit)}</output></label>`;
    }
    case 'number': return `<label class="style-line"><span>${esc(row.label)}</span><span></span><input class="input sm" type="number" data-path="${row.path}" min="${row.min}" max="${row.max}" step="${row.step}" value="${v}"></label>`;
    case 'select': return `<label class="field"><span class="label">${esc(row.label)}</span><select class="select sm" data-path="${row.path}"${row.num ? ' data-num="1"' : ''}>${row.options.map(([id, l]) => `<option value="${esc(id)}" ${(v == null ? '' : String(v)) === String(id) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    case 'line': {
      const b = get(spec, row.base);
      return `<div class="style-line"><span><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="${row.base}.show" ${b.show ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label></span><input type="color" data-path="${row.base}.color" value="${esc(b.color)}"><input class="input sm" type="number" data-path="${row.base}.width" min="0" max="20" step="0.1" value="${b.width}"></div>${row.extra.map((x) => rowHtml(x, spec)).join('')}`;
    }
    case 'lineNoWidth': {
      const b = get(spec, row.base);
      return `<div class="style-line"><span><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="${row.base}.show" ${b.show ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label></span><input type="color" data-path="${row.base}.color" value="${esc(b.color)}"><span></span></div>`;
    }
    case 'route': {
      const rt = spec.routes[row.id], base = DASHES[rt.dash] || null;
      const dashBox = (key, ph, title) => `<input class="input sm" type="number" data-path="routes.${row.id}.${key}" data-num="1" min="0.05" max="40" step="0.05" value="${rt[key] == null ? '' : rt[key]}" placeholder="${ph}" title="${title}">`;
      return `<div class="route-block"><div class="route-line"><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="routes.${row.id}.show" ${rt.show !== false ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label>
        <input type="color" data-path="routes.${row.id}.color" value="${esc(rt.color)}"><input class="input sm" type="number" data-path="routes.${row.id}.width" min="0.25" max="20" step="0.25" value="${rt.width}" title="Width (px)">
        <select class="select sm" data-path="routes.${row.id}.dash" title="Line pattern">${DASH_OPTS.map(([id, l]) => `<option value="${id}" ${rt.dash === id ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="route-dash" data-dashrow="${row.id}" ${base ? '' : 'hidden'}><span>Dash length · gap <span class="help">× width</span></span>${dashBox('dashLen', base ? base[0] : '', 'Dash (or dot) length, in line widths')}${dashBox('dashGap', base ? base[1] : '', 'Gap between dashes, in line widths')}</div></div>`;
    }
    case 'kind': return kindBlock(spec, row);
    case 'kindsAll': return kindBlock(spec, { id: null, label: 'All kinds' });
    case 'palette': {
      const cur = (spec.palette && spec.palette.id) || 'classic';
      return `<div class="palette-grid">${ROUTE_PALETTES.map((p) => `<button type="button" class="palette-btn ${p.id === cur ? 'on' : ''}" data-palette="${p.id}" title="${esc(p.label)} — ${esc(p.for)}"><span class="pal-dots">${TYPES.map((ty) => `<i style="background:${p.colors[ty.id]}"></i>`).join('')}</span><span class="pal-name">${esc(p.label)}</span><span class="pal-for">${esc(p.for)}</span></button>`).join('')}</div>
        <button type="button" class="btn sm" data-palette-suggest title="Pick the palette that suits this preset's land colour">Suggest one for this background</button>`;
    }
    case 'presets': return `<div class="preset-grid">${PRESETS.map((p) => `<button type="button" class="preset" data-preset="${p.id}" title="${esc(p.label)}"><span class="preset-swatch" style="${swatch(p)}"></span>${esc(p.label)}</button>`).join('')}</div>`;
    case 'note': return `<p class="help">${esc(row.text)}</p>`;
    case 'file': return `<div class="toolbar"><button type="button" class="btn sm" data-file="copy">Copy preset as JSON</button><button type="button" class="btn sm" data-file="paste">Paste a preset…</button></div><p class="help">Share a look between presets, or keep a backup.</p>`;
    default: return '';
  }
}
// What a slider's number box shows: the value as typed (so 0.05 reads 5 on a percentage).
const shown = (row, v) => (typeof v === 'number' ? +(v * (row.mul || 1)).toFixed(4) : '');
// Kinds whose ⋯ detail line is open, so redrawing the panel keeps them open.
const openKinds = new Set(['*']);
// One pin kind: switch · colour · size on the first line, ⋯ opens shape · symbol · symbol colour · outline.
// With id null it is the "All kinds" row (data-all, not data-path): changing it sets that field on every kind (TA-6).
function kindBlock(spec, { id, label }) {
  const all = id == null, kinds = spec.places.kinds, ids = Object.keys(kinds);
  const k = all ? kinds[ids[0]] || {} : kinds[id];
  const at = (field) => (all ? `data-all="${field}"` : `data-path="places.kinds.${id}.${field}"`);
  const open = openKinds.has(all ? '*' : id);
  const placeholder = (what) => (all ? `<option value="" selected>${what}…</option>` : '');
  const sel = (field, map, cur, dflt) => `<select class="select sm" ${at(field)} title="${field === 'shape' ? 'Shape' : 'Symbol'}">${placeholder(field === 'shape' ? 'Shape' : 'Symbol')}${Object.entries(map).map(([key, x]) => `<option value="${key}" ${!all && (cur || dflt) === key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`;
  const outlineOn = all ? ids.every((i) => kinds[i].outline !== false) : k.outline !== false;
  const title = all ? '<strong>All kinds</strong>' : `<label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" ${at('show')} ${k.show !== false ? 'checked' : ''}><span class="track"></span>${esc(label)}</label>`;
  return `<div class="kind-block${all ? ' kind-all' : ''}" ${all ? '' : `data-kind="${id}"`}><div class="kind-head"><span>${title}</span><input type="color" ${at('color')} value="${esc(k.color || '#677384')}" title="${all ? 'Colour of every kind' : 'Colour'}"><input class="input sm" type="number" ${at('size')} min="1" max="20" step="0.5" value="${all ? '' : k.size}" ${all ? 'placeholder="size"' : ''} title="${all ? 'Size of every kind' : 'Size'}"><button type="button" class="btn sm ghost" data-more="${all ? '*' : id}" title="Shape, symbol and outline" aria-expanded="${open}">⋯</button></div>
    <div class="kind-more" ${open ? '' : 'hidden'}><div class="kind-line">${sel('shape', SHAPES, k.shape, 'circle')}${sel('glyph', GLYPHS, k.glyph, 'none')}<input type="color" ${at('glyphColor')} value="${esc(k.glyphColor || '#ffffff')}" title="Symbol colour"></div>
      <div class="kind-line kind-outline"><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" ${at('outline')} ${outlineOn ? 'checked' : ''}><span class="track"></span>Outline</label><span class="help">${all ? 'every kind' : 'colour →'}</span><input type="color" ${at('stroke')} value="${esc(k.stroke || spec.places.stroke || '#ffffff')}" title="Outline colour"></div></div></div>`;
}
function swatch(p) {
  const sp = p.spec, land = sp.land || '#f4f1ea', water = sp.water || '#a9cbe0';
  const rc = sp.routes ? Object.values(sp.routes)[0].color : '#c0392b';
  return `background:linear-gradient(135deg, ${water} 0 45%, ${land} 45% 100%);box-shadow:inset -10px -10px 0 -6px ${rc}`;
}

/**
 * Render controls into `host`. `onChange(path, value)` for single knobs;
 * `onReplace(spec)` for presets / pasted styles.
 */
export function styleControls(host, spec, { onChange, onReplace, placeKinds = [], openAdvanced = false, only } = {}) {
  const secs = sections(spec, placeKinds).filter((x) => !only || only.includes(x.id));
  const basic = secs.filter((x) => !x.advanced), adv = secs.filter((x) => x.advanced);
  const block = (x) => `<details class="style-group" ${x.advanced ? '' : 'open'}><summary class="section-title">${esc(x.title)}</summary><div class="stack">${x.rows.map((rw) => rowHtml(rw, spec)).join('')}</div></details>`;
  host.innerHTML = basic.map(block).join('') + (adv.length ? `<details class="advanced" ${openAdvanced ? 'open' : ''}><summary><span>More options</span><span class="help">ready-made looks · base map · coarseness · roads · palettes · pins · globe · terrain · typography · effects · print finishing · title & legend</span></summary>${adv.map(block).join('')}</details>` : '');

  const setLocal = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), spec)[last] = v; };
  const recolour = () => {
    const cols = paletteColors(spec);
    const routes = structuredClone(spec.routes);
    for (const [id, col] of Object.entries(cols)) { routes[id] = { ...(routes[id] || {}), color: col }; const inp = host.querySelector(`input[type=color][data-path="routes.${id}.color"]`); if (inp) inp.value = col; }
    spec.routes = routes;
    onChange('routes', structuredClone(routes));
  };
  const setPalette = (id) => {
    setLocal('palette.id', id); onChange('palette.id', id);
    host.querySelectorAll('[data-palette]').forEach((b) => b.classList.toggle('on', b.dataset.palette === id));
    recolour();
  };

  const rowFor = (path) => secs.flatMap((x) => x.rows).find((x) => x.path === path);
  // A slider's value changed (from the slider or its number box): keep both and the hint in step, then save.
  const setRange = (row, v) => {
    const sl = host.querySelector(`input[type=range][data-path="${row.path}"]`);
    if (sl) {
      sl.value = row.scale ? row.scale.pos(v) : v;
      const box = sl.parentElement.querySelector('[data-box]'), out = sl.parentElement.querySelector('output');
      if (box && document.activeElement !== box) box.value = shown(row, v);
      if (out) out.textContent = row.show ? row.show(v) : row.unit || '';
    }
    if (row.path.startsWith('palette.')) { setLocal(row.path, v); onChange(row.path, v); recolour(); } else onChange(row.path, v);
  };
  // A typed value, clamped to the slider's range and snapped to its step (a log slider takes any whole number).
  const snap = (row, v) => {
    const x = Math.min(row.max, Math.max(row.min, v));
    return row.scale ? Math.round(x) : +(Math.round((x - row.min) / row.step) * row.step + row.min).toFixed(6);
  };
  const boxValue = (el) => { const row = rowFor(el.dataset.box); const n = el.value === '' ? NaN : +el.value / (row.mul || 1); return { row, n }; };

  // "All kinds" (TA-6): write one field onto every pin kind once; each kind can then be changed on its own.
  const applyAll = (el) => {
    const field = el.dataset.all;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.value === '') return;
    else v = el.type === 'number' ? Math.min(20, Math.max(1, +el.value)) : el.value;
    const kinds = spec.places.kinds;
    for (const [id, kd] of Object.entries(kinds)) {
      kd[field] = v;
      const inp = host.querySelector(`[data-path="places.kinds.${id}.${field}"]`);
      if (inp) { if (inp.type === 'checkbox') inp.checked = v; else inp.value = v; }
    }
    onChange('places.kinds', structuredClone(kinds));
  };

  host.oninput = (e) => {
    const el = e.target, path = el.dataset.path;
    if (el.dataset.all) { applyAll(el); return; }
    if (el.dataset.box) { // typed into a slider's number box: apply once it is a number in range, snap on blur
      const { row, n } = boxValue(el);
      if (Number.isFinite(n) && n >= row.min && n <= row.max) setRange(row, snap(row, n));
      return;
    }
    if (el.type === 'range' && path) { const row = rowFor(path); if (row) { setRange(row, row.scale ? row.scale.val(+el.value) : +el.value); return; } }
    if (el.dataset.auto) {
      const col = host.querySelector(`input[type=color][data-path="${el.dataset.auto}"]`);
      col.disabled = !el.checked;
      onChange(el.dataset.auto, el.checked ? col.value : null);
      return;
    }
    if (!path) return;
    let v = el.type === 'checkbox' ? el.checked : el.dataset.num ? (el.value === '' ? null : +el.value) : el.type === 'number' || el.type === 'range' ? +el.value : el.value;
    if (el.dataset.num && el.type === 'number' && v != null) v = Math.min(+el.max, Math.max(+el.min, v)); // dash length / gap: keep within what saves
    onChange(path, v);
    const dm = path.match(/^routes\.(\w+)\.dash$/); // a new line pattern: show / hide its length + gap, and what "standard" is
    if (dm) {
      const dr = host.querySelector(`[data-dashrow="${dm[1]}"]`), base = DASHES[v];
      if (dr) { dr.hidden = !base; if (base) { const [a, g] = dr.querySelectorAll('input'); a.placeholder = base[0]; g.placeholder = base[1]; } }
    }
  };
  // Leaving a number box (or pressing Enter) puts the snapped value back in it.
  host.onchange = (e) => {
    const el = e.target;
    if (!el.dataset.box) return;
    const { row, n } = boxValue(el);
    const cur = Number.isFinite(n) ? snap(row, n) : null;
    if (cur == null) { el.value = shown(row, get(spec, row.path)); return; }
    el.value = shown(row, cur);
    setRange(row, cur);
  };
  host.onclick = async (e) => {
    const mb = e.target.closest('[data-more]');
    if (mb) {
      const id = mb.dataset.more, blk = mb.closest('.kind-block'), more = blk.querySelector('.kind-more');
      more.hidden = !more.hidden; mb.setAttribute('aria-expanded', String(!more.hidden));
      if (more.hidden) openKinds.delete(id); else openKinds.add(id);
      return;
    }
    const pb = e.target.closest('[data-palette]');
    if (pb) { setPalette(pb.dataset.palette); return; }
    if (e.target.closest('[data-palette-suggest]')) { setPalette(suggestPalette(spec)); return; }
    const pr = e.target.closest('[data-preset]');
    if (pr) { onReplace && onReplace({ preset: pr.dataset.preset }); return; }
    const f = e.target.closest('[data-file]');
    if (!f) return;
    if (f.dataset.file === 'copy') {
      try { await navigator.clipboard.writeText(JSON.stringify(spec, null, 2)); f.textContent = 'Copied'; setTimeout(() => { f.textContent = 'Copy preset as JSON'; }, 1500); } catch (_) { /* clipboard blocked */ }
    } else {
      const text = prompt('Paste a preset (JSON):');
      if (!text) return;
      try { onReplace && onReplace({ spec: JSON.parse(text) }); } catch (_) { alert('That isn\'t valid preset JSON.'); }
    }
  };
}
