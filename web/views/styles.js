// #/styles[/id] — map style editor with a live preview of the whole trip.
import { store, api, loadBootstrap, esc, $, toast, confirm, debounce, modal } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { renderPage } from '../map/render.js';
import { resolveStyle, applyPreset, PLACE_KINDS, PRESETS } from '../lib/style.js';
import { unionBbox } from '../lib/geo.js';
import { styleControls } from './style-controls.js';

const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };

export async function render(el, params) {
  let id = +params[0] || store.styles[0].id;
  if (!store.styles.some((s) => s.id === id)) await loadBootstrap(); // made in another tab, or by the other person
  if (!store.styles.some((s) => s.id === id)) id = store.styles[0].id;
  const row = store.style(id);
  let spec = resolveStyle(row.spec);
  const placeKinds = [...new Set([...PLACE_KINDS.map((k) => k.id), ...Object.keys(spec.places.kinds), ...store.places.map((p) => p.kind)])];
  const fillKinds = () => { for (const k of placeKinds) if (!spec.places.kinds[k]) spec.places.kinds[k] = { color: '#677384', size: 5, show: true }; };
  fillKinds();
  let advancedOpen = false;
  try { advancedOpen = localStorage.getItem('ta-adv') === '1'; } catch (_) { /* private mode */ }

  el.innerHTML = `<div class="ws ws-2">
    <aside class="ws-panel">
      <div class="ws-panel-head">
        <div class="filter-row"><select class="select" id="pick">${store.styles.map((s) => `<option value="${s.id}" ${s.id === id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          <button class="btn sm" id="dup" title="Keep this look as its own style, so you can carry on changing it here">Save as new…</button></div>
        <div class="row-between"><input class="input" id="name" value="${esc(row.name)}" style="font-weight:700" aria-label="Style name"><span class="help" id="saved" style="white-space:nowrap;margin-left:8px">✓ Saved</span></div>
        <p class="help" style="margin:6px 0 0">Changes to this style save automatically. To keep a different version, use <strong>Save as new…</strong> — it leaves this one as it is.</p>
      </div>
      <div class="ws-panel-body" style="padding:6px 16px 16px" id="controls"></div>
      <div class="ws-panel-foot"><button class="btn sm" id="preview">Print preview</button><span style="margin-left:auto"></span><button class="btn danger sm ghost" id="del">Delete</button></div>
    </aside>
    <section class="ws-map"><div class="map" id="map"></div></section></div>`;

  const atlas = await createAtlas($('#map', el), { spec });
  const visible = store.routes.filter((r) => !r.hidden);
  atlas.setRoutes(visible);
  atlas.setPlaces(store.places);
  atlas.fit(unionBbox(visible.map((r) => r.bbox)), { duration: 0 });

  const save = debounce(async () => {
    $('#saved', el).textContent = 'Saving…';
    try {
      const name = $('#name', el).value.trim() || row.name;
      await api('PUT', `/api/styles/${id}`, { name, spec });
      row.spec = structuredClone(spec); row.name = name;
      $('#saved', el).textContent = '✓ Saved';
    } catch (e) { $('#saved', el).textContent = ''; toast(e.message, 'err'); }
  }, 600);
  // Repaints coalesce to one per frame, so dragging a slider stays smooth.
  let pending = false;
  const repaint = () => { if (pending) return; pending = true; requestAnimationFrame(async () => { pending = false; await atlas.setSpec(structuredClone(spec)); }); };

  function drawControls() {
    styleControls($('#controls', el), spec, {
      placeKinds, openAdvanced: advancedOpen,
      onChange: (path, v) => { set(spec, path, v); repaint(); save(); },
      onReplace: ({ preset, spec: pasted }) => {
        spec = preset ? applyPreset(spec, preset) : resolveStyle(pasted);
        fillKinds();
        if (preset) toast(`Applied “${(PRESETS.find((p) => p.id === preset) || {}).label}”`);
        drawControls(); repaint(); save();
      },
    });
    const adv = $('#controls details.advanced', el);
    if (adv) adv.ontoggle = () => { advancedOpen = adv.open; try { localStorage.setItem('ta-adv', adv.open ? '1' : '0'); } catch (_) { /* private mode */ } };
  }
  drawControls();

  $('#name', el).oninput = save;
  $('#pick', el).onchange = (e) => { location.hash = `#/styles/${e.target.value}`; };
  // TA-1: "Save as new…" asks for a name first, instead of silently making "… copy 123".
  $('#dup', el).onclick = async () => {
    const body = document.createElement('div');
    body.innerHTML = `<div class="field"><label>Name for the new style</label><input class="input" name="newname" value="${esc(`${$('#name', el).value.trim() || row.name} 2`)}"></div>
      <p class="help">The new style starts as a copy of how this one looks right now, and opens so you can keep going. “${esc(row.name)}” stays as it is.</p>`;
    const input = $('input', body);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.ds-modal-foot .btn.primary')?.click(); });
    if (!(await modal({ title: 'Save as new style', body, actions: [{ label: 'Cancel', value: false }, { label: 'Save as new style', value: true, primary: true }] }))) return;
    const name = input.value.trim();
    if (!name) { toast('Give the new style a name', 'err'); return; }
    try {
      const { data } = await api('POST', '/api/styles', { name, spec });
      await loadBootstrap();
      toast(`Saved “${name}” as a new style`);
      location.hash = `#/styles/${data.id}`;
    } catch (e) { toast(e.message, 'err'); }
  };
  // Print preview of the current view, with finishing and decoration.
  $('#preview', el).onclick = async () => {
    const b = atlas.map.getBounds(), box = atlas.map.getContainer();
    const btn = $('#preview', el); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Rendering';
    try {
      const { canvas } = await renderPage({
        routes: visible, places: store.places, spec, bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        paper: { w: 300, h: 300 * (box.clientHeight / box.clientWidth), dpi: 300 }, composition: 900, outWidth: 1200, title: store.trip.trip_name || 'Our OE',
      });
      canvas.className = 'preview-img';
      await modal({ title: `Print preview — ${row.name}`, body: canvas, wide: true });
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; btn.textContent = 'Print preview'; }
  };
  $('#del', el).onclick = async () => {
    if (store.styles.length === 1) { toast('Keep at least one style', 'err'); return; }
    if (!(await confirm('Delete style', `Delete “${row.name}”?`, 'Delete', true))) return;
    try { await api('DELETE', `/api/styles/${id}`); await loadBootstrap(); location.hash = '#/styles'; } catch (e) { toast(e.message, 'err'); }
  };
  return () => atlas.destroy();
}
