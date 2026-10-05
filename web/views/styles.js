// #/map[/id] — the Presets page, the app's home: pick a preset (a saved map
// style), change how the map looks, then "Update preset" to keep it or
// "Save as new preset…" to keep a copy. The whole trip is drawn underneath.
// Album pages pick a preset and export it.
import { store, api, loadBootstrap, esc, $, toast, confirm, modal, legFor } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { renderPage } from '../map/render.js';
import { resolveStyle, applyPreset, PLACE_KINDS, PRESETS } from '../lib/style.js';
import { unionBbox } from '../lib/geo.js';
import { styleControls } from './style-controls.js';

const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };

// Unsaved edits per preset id ({ spec, name }), kept while the app is open so
// leaving the page or switching presets never throws work away.
const drafts = new Map();
window.addEventListener('beforeunload', (e) => { if (drafts.size) { e.preventDefault(); e.returnValue = ''; } });

export async function render(el, params) {
  let last = 0;
  try { last = +localStorage.getItem('ta-preset'); } catch (_) { /* private mode */ }
  let id = +params[0] || last || store.styles[0].id;
  if (!store.styles.some((s) => s.id === id)) await loadBootstrap(); // made in another tab, or by the other person
  if (!store.styles.some((s) => s.id === id)) id = store.styles[0].id;
  try { localStorage.setItem('ta-preset', String(id)); } catch (_) { /* private mode */ }
  const row = store.style(id);
  const draft = drafts.get(id);
  let spec = resolveStyle(draft ? draft.spec : row.spec);
  const placeKinds = [...new Set([...PLACE_KINDS.map((k) => k.id), ...Object.keys(spec.places.kinds), ...store.places.map((p) => p.kind)])];
  const fillKinds = () => { for (const k of placeKinds) if (!spec.places.kinds[k]) spec.places.kinds[k] = { color: '#677384', size: 5, show: true }; };
  fillKinds();
  let moreOpen = false;
  try { moreOpen = localStorage.getItem('ta-adv') === '1'; } catch (_) { /* private mode */ }

  const optionLabel = (s) => `${drafts.has(s.id) ? '• ' : ''}${s.name}`;
  el.innerHTML = `<div class="ws ws-2">
    <aside class="ws-panel">
      <div class="ws-panel-head preset-head">
        <div class="field"><label for="pick">Preset</label>
          <select class="select" id="pick">${store.styles.map((s) => `<option value="${s.id}" ${s.id === id ? 'selected' : ''}>${esc(optionLabel(s))}</option>`).join('')}</select></div>
        <div class="field"><label for="name">Name</label><input class="input" id="name" value="${esc(draft ? draft.name : row.name)}"></div>
        <div class="toolbar">
          <button class="btn primary" id="update" disabled>Update preset</button>
          <button class="btn" id="dup" title="Keep how the map looks now as a new preset; this one stays as it was">Save as new preset…</button>
          <button class="btn ghost" id="discard" hidden>Discard changes</button>
        </div>
        <p class="help" id="status" style="margin:0"></p>
      </div>
      <div class="ws-panel-body" style="padding:6px 16px 16px" id="controls"></div>
      <div class="ws-panel-foot"><button class="btn sm" id="preview">Print preview</button><a class="btn sm ghost" href="#/album" title="To export, open an album page (a region or a few weeks of the trip) and pick this preset">Export →</a><span style="margin-left:auto"></span><button class="btn danger sm ghost" id="del">Delete</button></div>
    </aside>
    <section class="ws-map"><div class="map" id="map"></div>
      <div class="map-float tl" style="padding:6px 8px;display:flex;gap:6px;align-items:center">
        <select class="select sm" id="zoomTo" title="Zoom the preview to part of the trip" style="width:auto"><option value="">Whole trip</option>${store.legs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
      </div>
    </section></div>`;

  const atlas = await createAtlas($('#map', el), { spec });
  const visible = store.routes.filter((r) => !r.hidden);
  atlas.setRoutes(visible);
  atlas.setPlaces(store.places.filter((p) => !p.hidden));
  atlas.fit(unionBbox(visible.map((r) => r.bbox)), { duration: 0 });

  // Dirty state: the panel says plainly whether there is anything to keep.
  const nameNow = () => $('#name', el).value.trim() || row.name;
  function paintState() {
    const dirty = drafts.has(id);
    $('#update', el).disabled = !dirty;
    $('#discard', el).hidden = !dirty;
    $('#status', el).innerHTML = dirty
      ? `<strong>Unsaved changes.</strong> Press <strong>Update preset</strong> to save them to “${esc(row.name)}”, or save them as a new preset.`
      : `Saved. Album pages using “${esc(row.name)}” look like this.`;
    const opt = $(`#pick option[value="${id}"]`, el);
    if (opt) opt.textContent = optionLabel(row);
  }
  const markDirty = () => { drafts.set(id, { spec: structuredClone(spec), name: nameNow() }); paintState(); };
  paintState();

  // Repaints coalesce to one per frame, so dragging a slider stays smooth.
  let pending = false;
  const repaint = () => { if (pending) return; pending = true; requestAnimationFrame(async () => { pending = false; await atlas.setSpec(structuredClone(spec)); }); };

  function drawControls() {
    styleControls($('#controls', el), spec, {
      placeKinds, openAdvanced: moreOpen,
      onChange: (path, v) => { set(spec, path, v); repaint(); markDirty(); },
      onReplace: ({ preset, spec: pasted }) => {
        spec = preset ? applyPreset(spec, preset) : resolveStyle(pasted);
        fillKinds();
        if (preset) toast(`Applied “${(PRESETS.find((p) => p.id === preset) || {}).label}” — Update preset to keep it`);
        drawControls(); repaint(); markDirty();
      },
    });
    const adv = $('#controls details.advanced', el);
    if (adv) adv.ontoggle = () => { moreOpen = adv.open; try { localStorage.setItem('ta-adv', adv.open ? '1' : '0'); } catch (_) { /* private mode */ } };
  }
  drawControls();

  $('#name', el).oninput = markDirty;
  $('#pick', el).onchange = (e) => { location.hash = `#/map/${e.target.value}`; };
  $('#zoomTo', el).onchange = (e) => {
    const leg = +e.target.value;
    const list = leg ? visible.filter((r) => { const l = legFor(r); return l && l.id === leg; }) : visible;
    atlas.fit(unionBbox(list.map((r) => r.bbox)));
  };

  $('#update', el).onclick = async () => {
    const btn = $('#update', el); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const name = nameNow();
      await api('PUT', `/api/styles/${id}`, { name, spec });
      row.spec = structuredClone(spec); row.name = name;
      drafts.delete(id);
      toast(`Updated “${name}”`);
    } catch (e) { toast(e.message, 'err'); } finally { btn.textContent = 'Update preset'; paintState(); }
  };
  $('#discard', el).onclick = async () => {
    if (!(await confirm('Discard changes', `Go back to the saved “${row.name}”?`, 'Discard changes', true))) return;
    drafts.delete(id);
    spec = resolveStyle(row.spec); fillKinds();
    $('#name', el).value = row.name;
    drawControls(); repaint(); paintState();
  };
  // "Save as new preset…" asks for a name first (TA-1).
  $('#dup', el).onclick = async () => {
    const body = document.createElement('div');
    body.innerHTML = `<div class="field"><label>Name for the new preset</label><input class="input" name="newname" placeholder="e.g. Norway — fjord blues"></div>
      <p class="help">The new preset starts as the map looks right now, and opens so you can keep going. “${esc(row.name)}” stays as it was last saved.</p>`;
    const input = $('input', body);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.ds-modal-foot .btn.primary')?.click(); });
    if (!(await modal({ title: 'Save as new preset', body, actions: [{ label: 'Cancel', value: false }, { label: 'Save as new preset', value: true, primary: true }] }))) return;
    const name = input.value.trim();
    if (!name) { toast('Give the new preset a name', 'err'); return; }
    try {
      const { data } = await api('POST', '/api/styles', { name, spec });
      drafts.delete(id); // the edits live on in the new preset; this one goes back to its saved look
      await loadBootstrap();
      toast(`Saved “${name}” as a new preset`);
      location.hash = `#/map/${data.id}`;
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
      await modal({ title: `Print preview — ${nameNow()}`, body: canvas, wide: true });
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; btn.textContent = 'Print preview'; }
  };
  $('#del', el).onclick = async () => {
    if (store.styles.length === 1) { toast('Keep at least one preset', 'err'); return; }
    const used = store.maps.filter((m) => m.style_id === id).length;
    if (used) { toast(`${used} album page${used === 1 ? ' uses' : 's use'} “${row.name}” — pick another preset on ${used === 1 ? 'it' : 'them'} first`, 'err'); return; }
    if (!(await confirm('Delete preset', `Delete “${row.name}”?`, 'Delete', true))) return;
    try {
      await api('DELETE', `/api/styles/${id}`);
      drafts.delete(id);
      try { localStorage.removeItem('ta-preset'); } catch (_) { /* private mode */ }
      await loadBootstrap(); location.hash = '#/map';
    } catch (e) { toast(e.message, 'err'); }
  };
  return () => atlas.destroy();
}
