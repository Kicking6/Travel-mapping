// #/album — the album's maps (one printed page each) and the page editor.
import { store, api, loadBootstrap, applyFilter, esc, $, toast, modal, confirm, fmtDate, debounce } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { renderPng, download, PAPER_PRESETS, printPixels, maxRenderSize } from '../map/render.js';
import { resolveStyle } from '../lib/style.js';
import { TYPES } from '../lib/types.js';
import { unionBbox } from '../lib/geo.js';

const DEFAULT_COMPOSITION = 900;

export async function render(el, params) {
  if (params[0]) return editor(el, +params[0]);
  return list(el);
}

const mapRoutes = (m) => applyFilter(store.routes, m.filter || {});
const mapPlaces = (m) => {
  if (m.filter && m.filter.places === false) return [];
  const f = m.filter || {};
  return store.places.filter((p) => !p.hidden && (!p.date || ((!f.from || p.date >= f.from) && (!f.to || p.date <= f.to))));
};
const specFor = (m) => resolveStyle(store.style(m.style_id).spec, (m.overrides && m.overrides.style) || {});
const boundsFor = (m) => (m.view && m.view.bounds) || unionBbox(mapRoutes(m).map((r) => r.bbox)) || [-130, -55, 40, 72];
const sizeLabel = (p) => `${+(p.w / 10).toFixed(1)} × ${+(p.h / 10).toFixed(1)} cm`;

function describe(m) {
  const f = m.filter || {};
  const parts = [];
  if (f.from || f.to) parts.push(`${f.from ? fmtDate(f.from) : 'start'} – ${f.to ? fmtDate(f.to) : 'end'}`);
  if (f.legs && f.legs.length) parts.push(f.legs.map((id) => (store.legs.find((l) => l.id === id) || {}).name).filter(Boolean).join(', '));
  if (f.countries && f.countries.length) parts.push(f.countries.join(', '));
  return parts.join(' · ') || 'Whole trip';
}

// ── List ─────────────────────────────────────────────────────────────────
async function list(el) {
  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Album maps</h1><p>One map per album page — a few weeks of travel, a region, an island. Each prints at full resolution.</p></div>
      <div class="toolbar">${store.legs.length ? '<button class="btn" id="perLeg">One map per leg</button>' : ''}<button class="btn primary" id="new">New album map</button></div></div>
    <div class="album-grid" id="grid"></div></div>`;
  const grid = $('#grid', el);
  grid.innerHTML = store.maps.map((m) => `<a class="card album-card" href="#/album/${m.id}">
      <div class="album-thumb" data-thumb="${m.id}" style="aspect-ratio:${m.paper.w}/${m.paper.h}"><span class="spinner"></span></div>
      <div class="meta"><strong>${esc(m.name)}</strong><span>${esc(describe(m))}</span><br><span>${esc(sizeLabel(m.paper))} · ${mapRoutes(m).length} routes${m.last_export ? ' · exported' : ''}</span></div></a>`).join('')
    + `<button class="card album-card new" id="new2">＋ New album map</button>`;
  $('#new', el).onclick = $('#new2', el).onclick = () => createMap();
  const per = $('#perLeg', el);
  if (per) per.onclick = async () => {
    const missing = store.legs.filter((l) => !store.maps.some((m) => (m.filter.legs || []).length === 1 && m.filter.legs[0] === l.id));
    if (!missing.length) { toast('Every leg already has a map'); return; }
    if (!(await confirm('One map per leg', `Create ${missing.length} album map${missing.length === 1 ? '' : 's'}: ${missing.map((l) => l.name).join(', ')}?`, 'Create'))) return;
    for (const l of missing) await api('POST', '/api/maps', { name: l.name, filter: { legs: [l.id] }, style_id: store.styles[0].id, paper: { w: 300, h: 300, dpi: 300 } });
    await loadBootstrap();
    list(el);
  };

  // Thumbnails, one at a time (each is a WebGL context), cached per session.
  let cancelled = false;
  (async () => {
    for (const m of store.maps) {
      if (cancelled) return;
      const slot = $(`[data-thumb="${m.id}"]`, el);
      if (!slot) continue;
      const key = `ta-thumb-${m.id}-${m.updated_at}-${store.version}`;
      let url = null;
      try { url = sessionStorage.getItem(key); } catch (_) { /* private mode */ }
      if (!url) {
        try {
          const blob = await renderPng({ routes: mapRoutes(m), places: mapPlaces(m), spec: specFor(m), bounds: boundsFor(m), paper: m.paper,
            composition: (m.overrides && m.overrides.composition) || DEFAULT_COMPOSITION, outWidth: 480, title: m.title, attribution: false });
          url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
          try { sessionStorage.setItem(key, url); } catch (_) { /* full */ }
        } catch (e) { slot.textContent = 'No preview'; continue; }
      }
      slot.innerHTML = '';
      slot.style.backgroundImage = `url(${url})`;
    }
  })();
  return () => { cancelled = true; };
}

async function createMap(preset = {}) {
  const legs = store.legs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  const body = document.createElement('form');
  body.className = 'stack';
  body.innerHTML = `<div class="field"><label>Name</label><input class="input" name="name" required placeholder="e.g. Norway, Sardinia, USA — the south" value="${esc(preset.name || '')}"></div>
    ${legs ? `<div class="field"><label>Start from a leg</label><select class="select" name="leg"><option value="">— no, choose dates —</option>${legs}</select></div>` : ''}
    <div class="field-row"><div class="field"><label>From</label><input class="input" type="date" name="from"></div><div class="field"><label>To</label><input class="input" type="date" name="to"></div></div>
    <div class="field"><label>Paper</label><select class="select" name="paper">${PAPER_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></div>
    <p class="help">You can change all of this, and frame the map exactly, on the next screen.</p>`;
  const ok = await modal({ title: 'New album map', body, actions: [{ label: 'Cancel', value: false }, { label: 'Create', value: true, primary: true }] });
  if (!ok) return;
  const f = body.elements;
  if (!f.name.value.trim()) { toast('Give it a name', 'err'); return; }
  const p = PAPER_PRESETS.find((x) => x.id === f.paper.value) || PAPER_PRESETS[0];
  const filter = { from: f.from.value || null, to: f.to.value || null, legs: f.leg && f.leg.value ? [+f.leg.value] : [] };
  const { data } = await api('POST', '/api/maps', { name: f.name.value.trim(), filter, style_id: store.styles[0].id, paper: { w: p.w, h: p.h, dpi: 300 } });
  await loadBootstrap();
  location.hash = `#/album/${data.id}`;
}

// ── Editor ───────────────────────────────────────────────────────────────
async function editor(el, id) {
  const m = structuredClone(store.maps.find((x) => x.id === id));
  if (!m) { el.innerHTML = '<div class="page"><div class="empty"><h3>Album map not found</h3><a href="#/album">Back to the album</a></div></div>'; return; }
  m.filter = { types: [], legs: [], countries: [], include: [], exclude: [], places: true, ...(m.filter || {}) };
  m.overrides = m.overrides || {};
  const countries = [...new Set(store.routes.flatMap((r) => (r.country || '').split(',').map((c) => c.trim())).filter(Boolean))].sort();

  el.innerHTML = `<div class="ws" style="grid-template-columns:var(--panel-w) minmax(0,1fr)">
    <aside class="ws-panel"><form class="ws-panel-body" id="form" autocomplete="off" style="padding:14px 16px;display:flex;flex-direction:column;gap:14px">
      <div class="row-between"><a href="#/album" class="btn ghost sm">← Album</a><span class="help" id="saved"></span></div>
      <div class="field"><label>Name</label><input class="input" name="name" value="${esc(m.name)}"></div>
      <div class="field"><label>Title printed on the map <span class="muted">(optional)</span></label><input class="input" name="title" value="${esc(m.title || '')}"></div>
      <div class="style-group stack"><div class="section-title">What's on it</div>
        <div class="field-row"><div class="field"><label>From</label><input class="input" type="date" name="from" value="${esc(m.filter.from || '')}"></div><div class="field"><label>To</label><input class="input" type="date" name="to" value="${esc(m.filter.to || '')}"></div></div>
        ${store.legs.length ? `<div class="field"><label>Legs</label><div class="chip-row">${store.legs.map((l) => `<button type="button" class="chip filter-chip ${m.filter.legs.includes(l.id) ? 'on' : ''}" data-leg="${l.id}">${esc(l.name)}</button>`).join('')}</div></div>` : ''}
        <div class="field"><label>Transport <span class="muted">(none selected = all)</span></label><div class="chip-row">${TYPES.map((t) => `<button type="button" class="chip filter-chip ${m.filter.types.includes(t.id) ? 'on' : ''}" data-type="${t.id}"><span class="type-dot" style="background:${t.color}"></span>${esc(t.label.split(' /')[0])}</button>`).join('')}</div></div>
        ${countries.length ? `<div class="field"><label>Countries</label><div class="chip-row">${countries.map((c) => `<button type="button" class="chip filter-chip ${m.filter.countries.includes(c) ? 'on' : ''}" data-country="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}
        <label class="switch"><input type="checkbox" name="places" ${m.filter.places !== false ? 'checked' : ''}><span class="track"></span>Show places (accommodation)</label>
        <div class="help" id="count"></div>
      </div>
      <div class="style-group stack"><div class="section-title">Paper</div>
        <select class="select" name="preset"><option value="">Custom size</option>${PAPER_PRESETS.map((p) => `<option value="${p.id}" ${p.w === m.paper.w && p.h === m.paper.h ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
        <div class="field-row"><div class="field"><label>Width (mm)</label><input class="input" type="number" name="pw" min="20" max="1200" step="0.1" value="${m.paper.w}"></div><div class="field"><label>Height (mm)</label><input class="input" type="number" name="ph" min="20" max="1200" step="0.1" value="${m.paper.h}"></div></div>
        <div class="field"><label>Resolution</label><select class="select" name="dpi">${[150, 200, 240, 300, 400].map((d) => `<option value="${d}" ${m.paper.dpi === d ? 'selected' : ''}>${d} dpi${d === 300 ? ' — photo books' : ''}</option>`).join('')}</select></div>
        <div class="help" id="px"></div>
        <div class="field"><label>Map detail <span class="muted" id="compLbl"></span></label><input type="range" name="composition" min="500" max="2400" step="50" value="${m.overrides.composition || DEFAULT_COMPOSITION}">
          <span class="hint">Right = more roads and place names, finer lines and smaller text on the page. Use Preview to check.</span></div>
      </div>
      <div class="style-group stack"><div class="section-title">Look</div>
        <div class="filter-row"><select class="select" name="style_id">${store.styles.map((s) => `<option value="${s.id}" ${s.id === (m.style_id || store.styles[0].id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><a class="btn sm" id="editStyle">Edit</a></div>
      </div>
      <div class="stack">
        <div class="toolbar"><button type="button" class="btn" id="fit">Fit to routes</button><button type="button" class="btn" id="preview">Preview</button><button type="button" class="btn primary" id="export">Export PNG</button></div>
        <div class="help" id="exportStatus">${m.last_export ? `Last exported ${esc(new Date(m.last_export.at).toLocaleString('en-NZ'))} by ${esc((m.last_export.by || '').split('@')[0])}` : ''}</div>
        <button type="button" class="btn danger sm" id="delete" style="align-self:flex-start">Delete this album map</button>
      </div>
    </form></aside>
    <section class="ws-map"><div class="map" id="map"></div><div class="frame-layer"><div class="frame-box" id="frame"><span class="frame-label" id="frameLbl"></span></div></div></section>
  </div>`;

  const form = $('#form', el);
  const atlas = await createAtlas($('#map', el), { spec: specFor(m), bounds: boundsFor(m) });
  const mapEl = $('#map', el), frame = $('#frame', el);
  let frameRect = null;

  function layoutFrame() {
    const W = mapEl.clientWidth, H = mapEl.clientHeight, margin = 48;
    const aspect = m.paper.w / m.paper.h;
    let fw = W - margin * 2, fh = fw / aspect;
    if (fh > H - margin * 2) { fh = H - margin * 2; fw = fh * aspect; }
    frameRect = { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh, W, H };
    Object.assign(frame.style, { left: `${frameRect.x}px`, top: `${frameRect.y}px`, width: `${fw}px`, height: `${fh}px` });
    const [px, py] = printPixels(m.paper);
    $('#frameLbl', el).textContent = `${sizeLabel(m.paper)} · ${px.toLocaleString()} × ${py.toLocaleString()} px`;
  }
  const framePadding = () => ({ left: frameRect.x, top: frameRect.y, right: frameRect.W - frameRect.x - frameRect.w, bottom: frameRect.H - frameRect.y - frameRect.h });
  function frameBounds() {
    const a = atlas.map.unproject([frameRect.x, frameRect.y + frameRect.h]);
    const b = atlas.map.unproject([frameRect.x + frameRect.w, frameRect.y]);
    return [a.lng, a.lat, b.lng, b.lat];
  }
  function fitFrame(bounds, animate = false) {
    atlas.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: framePadding(), duration: animate ? 500 : 0 });
  }

  function refreshData() {
    const routes = mapRoutes(m);
    atlas.setRoutes(routes);
    atlas.setPlaces(mapPlaces(m));
    const km = routes.reduce((a, r) => a + (r.distance_km || 0), 0);
    $('#count', el).textContent = `${routes.length} routes · ${Math.round(km).toLocaleString()} km`;
  }
  function refreshPaperInfo() {
    const [px, py] = printPixels(m.paper);
    const max = maxRenderSize();
    $('#px', el).innerHTML = `Prints at <strong>${px.toLocaleString()} × ${py.toLocaleString()} px</strong>${Math.max(px, py) > max ? ` — <span class="status-err">over this computer's ${max.toLocaleString()} px limit; lower the dpi</span>` : ''}`;
    $('#compLbl', el).textContent = `(${m.overrides.composition || DEFAULT_COMPOSITION})`;
  }

  // Save: debounced PUT of the whole page definition.
  const save = debounce(async () => {
    $('#saved', el).textContent = 'Saving…';
    try {
      await api('PUT', `/api/maps/${id}`, { name: m.name || 'Untitled', title: m.title || null, filter: m.filter, view: m.view, paper: m.paper, style_id: m.style_id || store.styles[0].id, overrides: m.overrides });
      const i = store.maps.findIndex((x) => x.id === id);
      store.maps[i] = { ...structuredClone(m), updated_at: new Date().toISOString() };
      $('#saved', el).textContent = 'Saved';
    } catch (e) { $('#saved', el).textContent = ''; toast(e.message, 'err'); }
  }, 700);

  layoutFrame();
  refreshData();
  refreshPaperInfo();
  fitFrame(boundsFor(m));
  let settling = true;
  setTimeout(() => { settling = false; }, 400);
  atlas.map.on('moveend', () => { if (settling) return; m.view = { bounds: frameBounds(), bearing: 0 }; save(); });
  const ro = new ResizeObserver(() => { const b = frameBounds(); atlas.map.resize(); layoutFrame(); fitFrame(b); });
  ro.observe(mapEl);

  // Form wiring
  form.addEventListener('input', (e) => {
    const t = e.target, f = form.elements;
    if (t.name === 'name') m.name = t.value;
    else if (t.name === 'title') m.title = t.value;
    else if (t.name === 'from' || t.name === 'to') { m.filter[t.name] = t.value || null; refreshData(); }
    else if (t.name === 'places') { m.filter.places = t.checked; refreshData(); }
    else if (t.name === 'pw' || t.name === 'ph' || t.name === 'dpi' || t.name === 'preset') {
      if (t.name === 'preset' && t.value) { const p = PAPER_PRESETS.find((x) => x.id === t.value); f.pw.value = p.w; f.ph.value = p.h; }
      if (t.name !== 'preset') f.preset.value = (PAPER_PRESETS.find((p) => p.w === +f.pw.value && p.h === +f.ph.value) || { id: '' }).id;
      const b = frameBounds();
      m.paper = { w: +f.pw.value || 300, h: +f.ph.value || 300, dpi: +f.dpi.value };
      layoutFrame(); fitFrame(b); refreshPaperInfo();
    } else if (t.name === 'composition') { m.overrides.composition = +t.value; refreshPaperInfo(); }
    else if (t.name === 'style_id') { m.style_id = +t.value; atlas.setSpec(specFor(m)); }
    else return;
    save();
  });
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-leg],[data-type],[data-country]');
    if (!chip) return;
    const [key, val] = chip.dataset.leg ? ['legs', +chip.dataset.leg] : chip.dataset.type ? ['types', chip.dataset.type] : ['countries', chip.dataset.country];
    const arr = m.filter[key];
    m.filter[key] = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
    chip.classList.toggle('on');
    refreshData();
    save();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#editStyle', el).onclick = () => { location.hash = `#/styles/${m.style_id || store.styles[0].id}`; };
  $('#fit', el).onclick = () => { const b = unionBbox(mapRoutes(m).map((r) => r.bbox)); if (b) fitFrame(b, true); };

  const renderOpts = (outWidth) => ({
    routes: mapRoutes(m), places: mapPlaces(m), spec: specFor(m), bounds: frameBounds(), paper: m.paper,
    composition: m.overrides.composition || DEFAULT_COMPOSITION, outWidth, title: m.title || null,
  });
  $('#preview', el).onclick = async () => {
    const btn = $('#preview', el); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Rendering';
    try {
      const blob = await renderPng(renderOpts(Math.min(1400, Math.round(window.innerWidth * 0.8))));
      const img = document.createElement('img');
      img.className = 'preview-img'; img.src = URL.createObjectURL(blob);
      img.alt = `Preview of ${m.name}`;
      await modal({ title: `Preview — ${m.name}`, body: img, wide: true, actions: [{ label: 'Close' }] });
      URL.revokeObjectURL(img.src);
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; btn.textContent = 'Preview'; }
  };
  $('#export', el).onclick = async () => {
    const btn = $('#export', el), status = $('#exportStatus', el);
    btn.disabled = true;
    try {
      const t0 = performance.now();
      const blob = await renderPng({ ...renderOpts(), onStage: (s) => { status.textContent = s; } });
      const [px, py] = printPixels(m.paper);
      const safe = m.name.replace(/[^\w\- ]+/g, '').trim() || 'album-map';
      download(blob, `${safe} — ${sizeLabel(m.paper).replace(/ /g, '')} ${m.paper.dpi}dpi.png`);
      await api('POST', `/api/maps/${id}/exported`, { px: [px, py] });
      status.textContent = `Exported ${px.toLocaleString()} × ${py.toLocaleString()} px (${(blob.size / 1e6).toFixed(1)} MB) in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) { status.textContent = ''; toast(e.message, 'err'); } finally { btn.disabled = false; }
  };
  $('#delete', el).onclick = async () => {
    if (!(await confirm('Delete album map', `Delete “${m.name}”? Routes aren't affected.`, 'Delete', true))) return;
    await api('DELETE', `/api/maps/${id}`);
    await loadBootstrap();
    location.hash = '#/album';
  };

  const off = store.on((w) => { if (w === 'routes') refreshData(); });
  return () => { off(); ro.disconnect(); atlas.destroy(); };
}
