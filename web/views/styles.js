// #/styles[/id] — map style editor with a live preview of the whole trip.
import { store, api, loadBootstrap, esc, $, toast, confirm, debounce } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { resolveStyle, BASEMAPS, PLACE_KINDS, defaultStyle } from '../lib/style.js';
import { TYPES } from '../lib/types.js';
import { unionBbox } from '../lib/geo.js';

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };

export async function render(el, params) {
  let id = +params[0] || store.styles[0].id;
  if (!store.styles.some((s) => s.id === id)) await loadBootstrap(); // made in another tab, or by the other person
  if (!store.styles.some((s) => s.id === id)) id = store.styles[0].id;
  const row = store.style(id);
  let spec = resolveStyle(row.spec);
  const placeKinds = [...new Set([...PLACE_KINDS.map((k) => k.id), ...Object.keys(spec.places.kinds), ...store.places.map((p) => p.kind)])];
  for (const k of placeKinds) if (!spec.places.kinds[k]) spec.places.kinds[k] = { color: '#677384', size: 5, show: true };

  const color = (path, label) => `<label class="style-line"><span>${label}</span><input type="color" data-path="${path}" value="${esc(get(spec, path))}"><span></span></label>`;
  const toggle = (path, label) => `<label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" data-path="${path}" ${get(spec, path) ? 'checked' : ''}><span class="track"></span>${label}</label>`;
  const num = (path, min, max, step) => `<input class="input sm" type="number" data-path="${path}" min="${min}" max="${max}" step="${step}" value="${get(spec, path)}">`;
  const layer = (key, label, extra = '') => `<div class="style-line"><span>${toggle(`layers.${key}.show`, label)}</span>${spec.layers[key].color !== undefined ? `<input type="color" data-path="layers.${key}.color" value="${esc(spec.layers[key].color)}">` : '<span></span>'}${spec.layers[key].width !== undefined ? num(`layers.${key}.width`, 0.1, 10, 0.1) : '<span></span>'}</div>${extra}`;

  el.innerHTML = `<div class="ws" style="grid-template-columns:var(--panel-w) minmax(0,1fr)">
    <aside class="ws-panel"><div class="ws-panel-body" style="padding:14px 16px;display:flex;flex-direction:column;gap:14px" id="panel">
      <div class="filter-row"><select class="select" id="pick">${store.styles.map((s) => `<option value="${s.id}" ${s.id === id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <button class="btn sm" id="dup" title="Copy this style">Copy</button></div>
      <div class="row-between"><input class="input" id="name" value="${esc(row.name)}" style="font-weight:700"><span class="help" id="saved" style="white-space:nowrap;margin-left:8px"></span></div>
      <div class="style-group stack"><div class="section-title">Base map</div>
        <select class="select" data-path="basemap">${BASEMAPS.map((b) => `<option value="${b.id}" ${spec.basemap === b.id ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select>
        ${color('land', 'Land')}${color('water', 'Water')}
        ${toggle('smooth', 'Smooth line corners')}
      </div>
      <div class="style-group stack"><div class="section-title">Labels</div>
        ${toggle('labels.show', 'Show place names')}
        <select class="select sm" data-path="labels.density"><option value="countries">Countries only</option><option value="cities">Countries, regions &amp; cities</option><option value="all">Everything</option></select>
        ${color('labels.color', 'Text')}${color('labels.halo', 'Halo')}
      </div>
      <div class="style-group stack"><div class="section-title">Lines on the base map <span class="muted" style="text-transform:none;letter-spacing:0">colour · width</span></div>
        ${layer('countries', 'Country borders')}${layer('states', 'State / province borders')}
        ${layer('roads', 'Roads', `<select class="select sm" data-path="layers.roads.density"><option value="major">Major roads only</option><option value="all">All roads</option></select>`)}
        ${layer('ferries', 'Ferry lines')}${layer('parks', 'Parks')}
      </div>
      <div class="style-group stack"><div class="section-title">Our routes <span class="muted" style="text-transform:none;letter-spacing:0">colour · width</span></div>
        ${TYPES.map((t) => `<div class="style-line"><span>${toggle(`routes.${t.id}.show`, esc(t.label))}</span><input type="color" data-path="routes.${t.id}.color" value="${esc(spec.routes[t.id].color)}">${num(`routes.${t.id}.width`, 0.25, 20, 0.25)}</div>`).join('')}
        <label class="style-line"><span>Opacity</span><span></span><input class="input sm" type="number" data-path="routeOpacity" min="0.1" max="1" step="0.05" value="${spec.routeOpacity}"></label>
        <div class="style-line"><span>${toggle('routeCasing.show', 'White edge on routes')}</span><input type="color" data-path="routeCasing.color" value="${esc(spec.routeCasing.color)}">${num('routeCasing.width', 0, 6, 0.25)}</div>
      </div>
      <div class="style-group stack"><div class="section-title">Places <span class="muted" style="text-transform:none;letter-spacing:0">colour · size</span></div>
        ${toggle('places.show', 'Show places')}${toggle('places.labels', 'Label places')}
        ${placeKinds.map((k) => `<div class="style-line"><span>${toggle(`places.kinds.${k}.show`, esc((PLACE_KINDS.find((x) => x.id === k) || { label: k }).label))}</span><input type="color" data-path="places.kinds.${k}.color" value="${esc(spec.places.kinds[k].color)}">${num(`places.kinds.${k}.size`, 1, 20, 0.5)}</div>`).join('')}
      </div>
      <div class="row-between"><button class="btn sm" id="reset">Reset to defaults</button><button class="btn danger sm" id="del">Delete style</button></div>
    </div></aside>
    <section class="ws-map"><div class="map" id="map"></div></section></div>`;

  const panel = $('#panel', el);
  for (const s of panel.querySelectorAll('select[data-path]')) s.value = get(spec, s.dataset.path);
  const atlas = await createAtlas($('#map', el), { spec });
  const visible = store.routes.filter((r) => !r.hidden);
  atlas.setRoutes(visible);
  atlas.setPlaces(store.places);
  atlas.fit(unionBbox(visible.map((r) => r.bbox)), { duration: 0 });

  const save = debounce(async () => {
    $('#saved', el).textContent = 'Saving…';
    try {
      await api('PUT', `/api/styles/${id}`, { name: $('#name', el).value.trim() || row.name, spec });
      row.spec = spec; row.name = $('#name', el).value.trim() || row.name;
      $('#saved', el).textContent = 'Saved';
    } catch (e) { $('#saved', el).textContent = ''; toast(e.message, 'err'); }
  }, 600);
  const repaint = debounce(() => atlas.setSpec(structuredClone(spec)), 60);

  panel.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'name') { save(); return; }
    const path = t.dataset.path;
    if (!path) return;
    const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? +t.value : t.value;
    set(spec, path, v);
    repaint();
    save();
  });
  $('#pick', el).onchange = (e) => { location.hash = `#/styles/${e.target.value}`; };
  $('#dup', el).onclick = async () => {
    const name = `${row.name} copy`;
    try {
      const { data } = await api('POST', '/api/styles', { name, spec });
      await loadBootstrap();
      location.hash = `#/styles/${data.id}`;
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#reset', el).onclick = async () => {
    if (!(await confirm('Reset style', 'Put every setting in this style back to the defaults?', 'Reset'))) return;
    spec = defaultStyle();
    await api('PUT', `/api/styles/${id}`, { name: row.name, spec });
    await loadBootstrap();
    render(el, [id]);
  };
  $('#del', el).onclick = async () => {
    if (store.styles.length === 1) { toast('Keep at least one style', 'err'); return; }
    if (!(await confirm('Delete style', `Delete “${row.name}”?`, 'Delete', true))) return;
    try { await api('DELETE', `/api/styles/${id}`); await loadBootstrap(); location.hash = '#/styles'; } catch (e) { toast(e.message, 'err'); }
  };
  return () => atlas.destroy();
}
