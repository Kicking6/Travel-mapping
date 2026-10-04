// Style controls, declared once and rendered from data — the Map styles page
// and an album page's "Customise this page" panel use the same component.
// Basic sections first; the designer controls live under "Advanced".
import { esc } from '../app.js';
import { BASEMAPS, PLACE_KINDS, FONTS, TITLE_FONTS, DASHES, PRESETS, ROUTE_PALETTES, paletteColors, suggestPalette } from '../lib/style.js';
import { TYPES } from '../lib/types.js';
import { SHAPES, GLYPHS } from '../lib/pins.js';

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const POS = [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']];
const DASH_OPTS = Object.keys(DASHES).map((d) => [d, d === 'dashdot' ? 'dash-dot' : d]);
const DETAIL_OPTS = [['', 'Same as all routes'], ['0', 'Full detail'], ['10', '10 m'], ['25', '25 m'], ['50', '50 m'], ['100', '100 m'], ['250', '250 m'], ['500', '500 m'], ['1000', '1 km'], ['2000', '2 km'], ['5000', '5 km'], ['10000', '10 km']];

// Row helpers: c = colour, t = toggle, r = range, n = number, s = select, ca = colour or auto
const c = (path, label) => ({ k: 'color', path, label });
const ca = (path, label, auto = 'Automatic') => ({ k: 'colorAuto', path, label, auto });
const t = (path, label) => ({ k: 'toggle', path, label });
const r = (path, label, min, max, step, unit = '', show) => ({ k: 'range', path, label, min, max, step, unit, show });
// What a base-map detail level means on the ground: features smaller than ~this are smoothed away.
const levelKm = (z) => (z ? `≈ ${(40075 / (512 * 2 ** z) * 4).toFixed(z > 6 ? 1 : 0)} km` : 'Automatic');
const curveLabel = (k) => (k ? `${2 ** k}× points` : 'Off');
const pct = (v) => `${Math.round(v * 100)}%`;
const metres = (m) => (m ? (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${m} m`) : 'Off');
const n = (path, label, min, max, step) => ({ k: 'number', path, label, min, max, step });
const s = (path, label, options) => ({ k: 'select', path, label, options });
const line = (base, label, extra = []) => ({ k: 'line', base, label, extra });

export function sections(spec, placeKinds) {
  return [
    { id: 'presets', title: 'Start from a look', rows: [{ k: 'presets' }] },
    { id: 'base', title: 'Base map', rows: [
      s('basemap', 'Map data style', BASEMAPS.map((b) => [b.id, b.label])), c('land', 'Land'), c('water', 'Water'), t('smooth', 'Smooth line corners'),
    ] },
    { id: 'detail', title: 'Map detail (coarseness)', rows: [
      s('detail.coastline', 'Coastline & lakes', [['osm', 'Finest — OpenStreetMap'], ['10m', 'Detailed — ≈ 1 km (Natural Earth 1:10m)'], ['50m', 'Smooth — ≈ 5 km (1:50m)'], ['110m', 'Very smooth — ≈ 30 km (1:110m)']]),
      r('detail.softness', 'Coast softness (with a smoothed coastline)', 0, 20, 0.5, 'px'),
      r('detail.baseLevel', 'Base-map detail', 0, 12, 1, '', levelKm),
      { k: 'note', text: 'Base-map detail caps how much the roads, borders and lakes are drawn — slide left for a cleaner, more generalised map at any zoom.' },
      r('detail.routeSimplify', 'Simplify our routes (all types)', 0, 20000, 250, '', metres),
      r('detail.routeCurve', 'Round the corners into curves', 0, 5, 1, '', curveLabel),
      { k: 'note', text: 'Simplify drops points (corners stay sharp); rounding then turns the corners into smooth curves — more points make a smoother curve. Both apply to every route type except flights.' },
      { k: 'note', text: 'Line detail per type — walks can stay crisp while long drives are smoothed. “Same as all” follows the slider above.' },
      ...TYPES.filter((ty) => ty.id !== 'flight').map((ty) => ({ k: 'select', path: `routes.${ty.id}.simplify`, num: true, label: ty.label, options: DETAIL_OPTS })),
    ] },
    { id: 'labels', title: 'Place names', rows: [
      t('labels.show', 'Show place names'), s('labels.density', 'How many', [['countries', 'Countries only'], ['cities', 'Countries, regions & cities'], ['all', 'Everything']]),
      c('labels.color', 'Text'), c('labels.halo', 'Halo'),
    ] },
    { id: 'lines', title: 'Lines on the base map', rows: [
      line('layers.countries', 'Country borders'), line('layers.states', 'State / province borders'),
      line('layers.roads', 'Roads', [s('layers.roads.density', 'Which roads', [['major', 'Major roads only'], ['all', 'All roads']])]),
      line('layers.ferries', 'Ferry lines'), { k: 'lineNoWidth', base: 'layers.parks', label: 'Parks' }, t('layers.buildings.show', 'Buildings (close zoom)'),
    ] },
    { id: 'routes', title: 'Our routes', rows: [
      { k: 'palette' },
      r('palette.hue', 'Shift hue', -180, 180, 5, '°'), r('palette.saturation', 'Saturation', -100, 100, 5, '%'), r('palette.lightness', 'Lighter / darker', -50, 50, 1, '%'),
      t('palette.fit', 'Keep lines readable on the land colour'), r('palette.contrast', 'Minimum contrast', 1.5, 7, 0.5, ':1'),
      { k: 'note', text: 'Each type below can still be fine-tuned by hand — picking or tuning a palette recolours them all again.' },
      ...TYPES.map((ty) => ({ k: 'route', id: ty.id, label: ty.label })),
      r('routeOpacity', 'Opacity', 0.1, 1, 0.05), line('routeCasing', 'White edge'),
      t('routeFx.walkPoi.show', 'Short walks become dots when zoomed out'),
      r('routeFx.walkPoi.below', 'Turn into a dot below', 0.01, 0.2, 0.01, '', pct),
      r('routeFx.walkPoi.size', 'Walk dot size', 2, 14, 0.5, 'px'),
      { k: 'note', text: 'A walk shorter than this share of the map view fades smoothly into a dot at its middle, so it never disappears.' },
    ] },
    { id: 'places', title: 'Places (accommodation)', rows: [
      t('places.show', 'Show places'), t('places.labels', 'Label places'),
      r('places.scale', 'Pin size (all pins)', 0.5, 5, 0.05, '×'),
      { k: 'note', text: 'Per kind: show · colour · size · shape · symbol · symbol colour.' },
      ...placeKinds.map((k) => ({ k: 'kind', id: k, label: (PLACE_KINDS.find((x) => x.id === k) || { label: k }).label })),
    ] },
    { id: 'adv-pins', advanced: true, title: 'Pins & place labels', rows: [
      r('places.opacity', 'Pin opacity', 0.1, 1, 0.05), c('places.stroke', 'Pin outline'), r('places.strokeWidth', 'Outline width', 0, 5, 0.25, 'px'), t('places.shadow', 'Soft shadow under pins'),
      s('places.label.field', 'Label text', [['name', 'Name'], ['name-nights', 'Name · nights'], ['name-date', 'Name · date'], ['date', 'Date'], ['nights', 'Nights'], ['number', 'Night number'], ['number-name', 'Number. Name']]),
      s('places.label.position', 'Label position', [['top', 'Above'], ['bottom', 'Below'], ['right', 'Right'], ['left', 'Left']]),
      s('places.label.font', 'Label font', FONTS.map((f) => [f, f.replace('Noto Sans ', '')])), r('places.label.size', 'Label size', 7, 24, 0.5, 'px'),
      ca('places.label.color', 'Label colour', 'Same as place names'), ca('places.label.halo', 'Label halo', 'Same as place names'), r('places.label.haloWidth', 'Halo width', 0, 4, 0.1, 'px'),
      t('places.label.uppercase', 'Uppercase labels'), r('places.label.minZoom', 'Labels from zoom', 0, 14, 0.5, ''),
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
    { id: 'adv-water', advanced: true, title: 'Water', rows: [
      line('waterDetail.outline', 'Coastline outline'), t('waterDetail.rivers.show', 'Rivers'), r('waterDetail.rivers.width', 'River width', 0.2, 4, 0.1, '×'),
      t('waterDetail.labelsItalic', 'Italic sea & lake names'),
    ] },
    { id: 'adv-visited', advanced: true, title: 'Countries we visited', rows: [
      t('visited.show', 'Fill countries we visited'), c('visited.color', 'Fill'), r('visited.opacity', 'Fill strength', 0, 1, 0.05),
      line('visited.outline', 'Outline'), t('visited.fadeOthers.show', 'Fade everywhere else'), c('visited.fadeOthers.color', 'Fade colour'), r('visited.fadeOthers.opacity', 'Fade strength', 0, 1, 0.05),
    ] },
    { id: 'adv-type', advanced: true, title: 'Typography', rows: [
      s('type.font', 'Font', FONTS.map((f) => [f, f.replace('Noto Sans ', '')])), s('type.countryFont', 'Country font', FONTS.map((f) => [f, f.replace('Noto Sans ', '')])),
      r('type.scale', 'Size', 0.5, 2.5, 0.05, '×'), t('type.uppercase', 'Uppercase names'), t('type.countriesUppercase', 'Uppercase countries'),
      r('type.letterSpacing', 'Letter spacing', 0, 0.6, 0.01, 'em'), r('type.countryLetterSpacing', 'Country letter spacing', 0, 0.8, 0.01, 'em'),
      r('type.haloWidth', 'Halo width', 0, 4, 0.1, 'px'), ca('type.countryColor', 'Country names', 'Same as text'), ca('type.cityColor', 'City names', 'Same as text'), ca('type.waterColor', 'Water names', 'Same as text'),
    ] },
    { id: 'adv-routefx', advanced: true, title: 'Route effects', rows: [
      s('routeFx.gradient.mode', 'Colour', [['off', 'By transport type'], ['trip', 'Gradient through the trip (by date)'], ['route', 'Gradient along each route']]),
      c('routeFx.gradient.from', 'Gradient start'), c('routeFx.gradient.via', 'Gradient middle'), c('routeFx.gradient.to', 'Gradient end'),
      t('routeFx.glow.show', 'Glow'), ca('routeFx.glow.color', 'Glow colour', 'Route colour'), r('routeFx.glow.width', 'Glow size', 1, 30, 0.5, 'px'), r('routeFx.glow.blur', 'Glow softness', 0, 30, 0.5, 'px'), r('routeFx.glow.opacity', 'Glow strength', 0, 1, 0.05),
      t('routeFx.arrows.show', 'Direction arrows'), r('routeFx.arrows.spacing', 'Arrow spacing', 30, 400, 5, 'px'), r('routeFx.arrows.size', 'Arrow size', 0.3, 2, 0.05, '×'), ca('routeFx.arrows.color', 'Arrow colour', 'Route colour'),
      t('routeFx.endpoints.show', 'Start & end dots'), r('routeFx.endpoints.size', 'Dot size', 1, 12, 0.5, 'px'), c('routeFx.endpoints.color', 'Dot fill'), c('routeFx.endpoints.stroke', 'Dot outline'),
      s('routeFx.cap', 'Line ends', [['round', 'Round'], ['butt', 'Flat'], ['square', 'Square']]),
    ] },
    { id: 'adv-places', advanced: true, title: 'Place markers', rows: [c('places.stroke', 'Outline'), r('places.strokeWidth', 'Outline width', 0, 5, 0.25, 'px')] },
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
    { id: 'adv-file', advanced: true, title: 'Style file', rows: [{ k: 'file' }] },
  ];
}

function rowHtml(row, spec) {
  const v = row.path ? get(spec, row.path) : null;
  switch (row.k) {
    case 'color': return `<label class="style-line"><span>${esc(row.label)}</span><input type="color" data-path="${row.path}" value="${esc(v)}"><span></span></label>`;
    case 'colorAuto': return `<div class="style-line"><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-auto="${row.path}" ${v ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label><input type="color" data-path="${row.path}" value="${esc(v || '#16202b')}" ${v ? '' : 'disabled'} title="${v ? '' : esc(row.auto)}"><span class="help">${v ? '' : esc(row.auto)}</span></div>`;
    case 'toggle': return `<label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="${row.path}" ${v ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label>`;
    case 'range': return `<label class="range-line"><span>${esc(row.label)}</span><input type="range" data-path="${row.path}" min="${row.min}" max="${row.max}" step="${row.step}" value="${v}"><output>${row.show ? row.show(v) : fmt(v) + row.unit}</output></label>`;
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
      const rt = spec.routes[row.id];
      return `<div class="route-line"><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="routes.${row.id}.show" ${rt.show !== false ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label>
        <input type="color" data-path="routes.${row.id}.color" value="${esc(rt.color)}"><input class="input sm" type="number" data-path="routes.${row.id}.width" min="0.25" max="20" step="0.25" value="${rt.width}" title="Width (px)">
        <select class="select sm" data-path="routes.${row.id}.dash" title="Line pattern">${DASH_OPTS.map(([id, l]) => `<option value="${id}" ${rt.dash === id ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    }
    case 'kind': {
      const k = spec.places.kinds[row.id], b = `places.kinds.${row.id}`;
      return `<div class="kind-block"><div class="style-line"><span><label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="${b}.show" ${k.show !== false ? 'checked' : ''}><span class="track"></span>${esc(row.label)}</label></span><input type="color" data-path="${b}.color" value="${esc(k.color)}"><input class="input sm" type="number" data-path="${b}.size" min="1" max="20" step="0.5" value="${k.size}" title="Size"></div>
        <div class="kind-line"><select class="select sm" data-path="${b}.shape" title="Shape">${Object.entries(SHAPES).map(([id, x]) => `<option value="${id}" ${(k.shape || 'circle') === id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        <select class="select sm" data-path="${b}.glyph" title="Symbol">${Object.entries(GLYPHS).map(([id, x]) => `<option value="${id}" ${(k.glyph || 'none') === id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        <input type="color" data-path="${b}.glyphColor" value="${esc(k.glyphColor || '#ffffff')}" title="Symbol colour"></div></div>`;
    }
    case 'palette': {
      const cur = (spec.palette && spec.palette.id) || 'classic';
      return `<div class="palette-grid">${ROUTE_PALETTES.map((p) => `<button type="button" class="palette-btn ${p.id === cur ? 'on' : ''}" data-palette="${p.id}" title="${esc(p.label)} — ${esc(p.for)}"><span class="pal-dots">${TYPES.map((ty) => `<i style="background:${p.colors[ty.id]}"></i>`).join('')}</span><span class="pal-name">${esc(p.label)}</span><span class="pal-for">${esc(p.for)}</span></button>`).join('')}</div>
        <button type="button" class="btn sm" data-palette-suggest title="Pick the palette that suits this style's land colour">Suggest one for this background</button>`;
    }
    case 'presets': return `<div class="preset-grid">${PRESETS.map((p) => `<button type="button" class="preset" data-preset="${p.id}" title="${esc(p.label)}"><span class="preset-swatch" style="${swatch(p)}"></span>${esc(p.label)}</button>`).join('')}</div>`;
    case 'note': return `<p class="help">${esc(row.text)}</p>`;
    case 'file': return `<div class="toolbar"><button type="button" class="btn sm" data-file="copy">Copy style as JSON</button><button type="button" class="btn sm" data-file="paste">Paste a style…</button></div><p class="help">Share a look between styles, or keep a backup.</p>`;
    default: return '';
  }
}
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 10 ? Math.round(v) : +v.toFixed(2)) : v);
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
  const block = (x) => `<details class="style-group" ${['presets', 'base', 'routes', 'detail'].includes(x.id) ? 'open' : ''}><summary class="section-title">${esc(x.title)}</summary><div class="stack">${x.rows.map((rw) => rowHtml(rw, spec)).join('')}</div></details>`;
  host.innerHTML = basic.map(block).join('') + (adv.length ? `<details class="advanced" ${openAdvanced ? 'open' : ''}><summary><span>Advanced</span><span class="help">projection · terrain · land cover · visited countries · typography · route effects · finishing · title & legend</span></summary>${adv.map(block).join('')}</details>` : '');

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

  host.oninput = (e) => {
    const el = e.target, path = el.dataset.path;
    if (path && path.startsWith('palette.')) {
      const v = el.type === 'checkbox' ? el.checked : +el.value;
      if (el.type === 'range') { const out = el.parentElement.querySelector('output'); const row = secs.flatMap((x) => x.rows).find((x) => x.path === path); if (out) out.textContent = fmt(v) + ((row && row.unit) || ''); }
      setLocal(path, v); onChange(path, v); recolour();
      return;
    }
    if (el.dataset.auto) {
      const col = host.querySelector(`input[type=color][data-path="${el.dataset.auto}"]`);
      col.disabled = !el.checked;
      onChange(el.dataset.auto, el.checked ? col.value : null);
      return;
    }
    if (!path) return;
    const v = el.type === 'checkbox' ? el.checked : el.dataset.num ? (el.value === '' ? null : +el.value) : el.type === 'number' || el.type === 'range' ? +el.value : el.value;
    if (el.type === 'range') { const out = el.parentElement.querySelector('output'); const row = secs.flatMap((x) => x.rows).find((x) => x.path === path); if (out) out.textContent = row && row.show ? row.show(v) : fmt(v) + ((row && row.unit) || ''); }
    onChange(path, v);
  };
  host.onclick = async (e) => {
    const pb = e.target.closest('[data-palette]');
    if (pb) { setPalette(pb.dataset.palette); return; }
    if (e.target.closest('[data-palette-suggest]')) { setPalette(suggestPalette(spec)); return; }
    const pr = e.target.closest('[data-preset]');
    if (pr) { onReplace && onReplace({ preset: pr.dataset.preset }); return; }
    const f = e.target.closest('[data-file]');
    if (!f) return;
    if (f.dataset.file === 'copy') {
      try { await navigator.clipboard.writeText(JSON.stringify(spec, null, 2)); f.textContent = 'Copied'; setTimeout(() => { f.textContent = 'Copy style as JSON'; }, 1500); } catch (_) { /* clipboard blocked */ }
    } else {
      const text = prompt('Paste a style (JSON):');
      if (!text) return;
      try { onReplace && onReplace({ spec: JSON.parse(text) }); } catch (_) { alert('That isn\'t valid style JSON.'); }
    }
  };
}
