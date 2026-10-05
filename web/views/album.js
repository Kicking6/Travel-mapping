// #/album — the album's maps (one printed page each) and the page editor.
import { store, api, loadBootstrap, applyFilter, esc, $, toast, modal, confirm, fmtDate, debounce } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { renderPng, download, PAPER_PRESETS, printPixels, maxRenderSize } from '../map/render.js';
import { resolveStyle, PLACE_KINDS } from '../lib/style.js';
import { styleControls } from './style-controls.js';
import { exportDialog, downloadRouteData } from './export-dialog.js';
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
const cameraFor = (m) => (m.view && m.view.camera) || null;
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
          const blob = await renderPng({ routes: mapRoutes(m), places: mapPlaces(m), spec: specFor(m), bounds: boundsFor(m), camera: cameraFor(m), paper: m.paper,
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
const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };

async function editor(el, id) {
  const m = structuredClone(store.maps.find((x) => x.id === id));
  if (!m) { el.innerHTML = '<div class="page"><div class="empty"><h3>Album map not found</h3><a href="#/album">Back to the album</a></div></div>'; return; }
  m.filter = { types: [], legs: [], countries: [], include: [], exclude: [], places: true, ...(m.filter || {}) };
  m.overrides = m.overrides || {};
  m.paper.bleed = m.paper.bleed || 0;
  const countries = [...new Set(store.routes.flatMap((r) => (r.country || '').split(',').map((c) => c.trim())).filter(Boolean))].sort();
  let tab = 'page';

  el.innerHTML = `<div class="ws ws-2">
    <aside class="ws-panel">
      <div class="ws-panel-head"><div class="row-between"><a href="#/album" class="btn ghost sm">← Album</a><span class="help" id="saved"></span></div>
        <div class="seg" role="tablist"><button type="button" data-tab="page" aria-pressed="true">Page</button><button type="button" data-tab="look" aria-pressed="false">Look for this page</button></div></div>
      <form class="ws-panel-body" id="form" autocomplete="off" style="padding:14px 16px;display:flex;flex-direction:column;gap:14px">
        <div class="field"><label>Name</label><input class="input" name="name" value="${esc(m.name)}"></div>
        <div class="field"><label>Title printed on the map <span class="muted">(optional)</span></label><input class="input" name="title" value="${esc(m.title || '')}"></div>
        <div class="field"><label>Custom subtitle <span class="muted">(shown when the preset's subtitle is “Custom”)</span></label><input class="input" name="subtitle" value="${esc(m.overrides.subtitle || '')}"></div>
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
          <div class="field-row"><div class="field"><label>Resolution</label><select class="select" name="dpi">${[150, 200, 240, 300, 400, 600].map((d) => `<option value="${d}" ${m.paper.dpi === d ? 'selected' : ''}>${d} dpi${d === 300 ? ' (books)' : ''}</option>`).join('')}</select></div>
          <div class="field"><label>Bleed (mm)</label><input class="input" type="number" name="bleed" min="0" max="20" step="0.5" value="${m.paper.bleed}"></div></div>
          <div class="help" id="px"></div>
          <label class="range-line"><span>Map detail</span><input type="range" name="composition" min="400" max="2400" step="50" value="${m.overrides.composition || DEFAULT_COMPOSITION}"><output id="compLbl"></output></label>
          <span class="help">Right = more roads and names, finer lines and smaller text on the page. Preview shows exactly what prints.</span>
        </div>
        <div class="style-group stack"><div class="section-title">Camera</div>
          <p class="help">Drag to move, scroll to zoom. Right-click-drag (or ctrl-drag) to tilt and rotate — 3D terrain and globe pages keep the exact view.</p>
          <div class="toolbar"><button type="button" class="btn sm" id="fit">Fit to routes</button><button type="button" class="btn sm" id="flat">Reset tilt & north up</button></div>
          <div class="help" id="camInfo"></div>
        </div>
        <div class="style-group stack"><div class="section-title">Preset</div>
          <div class="filter-row"><select class="select" name="style_id">${store.styles.map((s) => `<option value="${s.id}" ${s.id === (m.style_id || store.styles[0].id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><a class="btn sm" id="editStyle">Edit preset</a></div>
          <p class="help" id="tweaks"></p>
        </div>
        <div class="stack">
          <div class="toolbar"><button type="button" class="btn" id="preview">Preview</button><button type="button" class="btn primary" id="export">Export…</button></div>
          <div class="toolbar"><span class="help">Routes on this page:</span><button type="button" class="btn ghost sm" data-data="gpx">GPX</button><button type="button" class="btn ghost sm" data-data="geojson">GeoJSON</button><button type="button" class="btn ghost sm" data-data="kml">KML</button></div>
          <div class="help" id="exportStatus">${m.last_export ? `Last exported ${esc(new Date(m.last_export.at).toLocaleString('en-NZ'))} by ${esc((m.last_export.by || '').split('@')[0])}` : ''}</div>
          <button type="button" class="btn danger sm" id="delete" style="align-self:flex-start">Delete this album map</button>
        </div>
      </form>
      <div class="ws-panel-body" id="look" hidden style="padding:6px 16px 16px"></div>
    </aside>
    <section class="ws-map"><div class="map" id="map"></div><div class="frame-layer"><div class="frame-box" id="frame"><span class="frame-label" id="frameLbl"></span></div></div></section>
  </div>`;

  const form = $('#form', el);
  const cam = cameraFor(m);
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
    const corners = [[frameRect.x, frameRect.y], [frameRect.x + frameRect.w, frameRect.y], [frameRect.x, frameRect.y + frameRect.h], [frameRect.x + frameRect.w, frameRect.y + frameRect.h]].map((p) => atlas.map.unproject(p));
    const lons = corners.map((c) => c.lng), lats = corners.map((c) => c.lat);
    return [Math.min(...lons), Math.max(-85, Math.min(...lats)), Math.max(...lons), Math.min(85, Math.max(...lats))];
  }
  // The camera as composed in the frame; `frameW` lets the exporter rescale zoom to its own layout width.
  function frameCamera() {
    const c = atlas.map.getCenter();
    return { center: [c.lng, c.lat], zoom: atlas.map.getZoom(), bearing: atlas.map.getBearing(), pitch: atlas.map.getPitch(), frameW: frameRect.w };
  }
  function fitFrame(bounds, animate = false) {
    atlas.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: framePadding(), duration: animate ? 500 : 0, bearing: 0, pitch: 0 });
  }
  function restoreCamera(c) {
    // Saved zoom was for a frame c.frameW wide; this screen's frame may differ.
    atlas.map.jumpTo({ center: c.center, zoom: c.zoom + Math.log2(frameRect.w / (c.frameW || frameRect.w)), bearing: c.bearing || 0, pitch: c.pitch || 0 });
  }
  const spec = () => specFor(m);
  const tilted = () => { const c = frameCamera(); return Math.abs(c.bearing) > 0.5 || c.pitch > 0.5 || spec().projection === 'globe'; };

  function refreshData() {
    const routes = mapRoutes(m);
    atlas.setRoutes(routes);
    atlas.setPlaces(mapPlaces(m));
    const km = routes.reduce((a, r) => a + (r.distance_km || 0), 0);
    $('#count', el).textContent = `${routes.length} routes · ${Math.round(km).toLocaleString()} km`;
  }
  function refreshPaperInfo() {
    const [px, py] = printPixels(m.paper, m.paper.bleed);
    const max = maxRenderSize();
    $('#px', el).innerHTML = `Renders at <strong>${px.toLocaleString()} × ${py.toLocaleString()} px</strong>${m.paper.bleed ? ' incl. bleed' : ''}${Math.max(px, py) > max ? ` — <span class="status-err">over this computer's ${max.toLocaleString()} px limit; lower the dpi</span>` : ''}`;
    $('#compLbl', el).textContent = m.overrides.composition || DEFAULT_COMPOSITION;
    const n = m.overrides.style ? JSON.stringify(m.overrides.style).match(/":/g)?.length || 0 : 0;
    $('#tweaks', el).textContent = n ? `${n} setting${n === 1 ? '' : 's'} changed for this page only (Look tab).` : 'Tweak this page alone in the “Look for this page” tab.';
  }
  function refreshCamInfo() {
    const c = frameCamera();
    $('#camInfo', el).textContent = tilted() ? `Tilt ${Math.round(c.pitch)}° · rotated ${Math.round(c.bearing)}°${spec().projection === 'globe' ? ' · globe' : ''}` : 'Flat, north up';
  }

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
  if (cam) restoreCamera(cam); else fitFrame(boundsFor(m));
  refreshCamInfo();
  let settling = true;
  setTimeout(() => { settling = false; }, 500);
  atlas.map.on('moveend', () => {
    refreshCamInfo();
    if (settling) return;
    m.view = { bounds: frameBounds(), bearing: atlas.map.getBearing(), ...(tilted() ? { camera: frameCamera() } : {}) };
    save();
  });
  const ro = new ResizeObserver(() => { const c = frameCamera(); atlas.map.resize(); layoutFrame(); restoreCamera(c); });
  ro.observe(mapEl);

  // Tabs
  el.querySelector('[role=tablist]').onclick = (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    tab = b.dataset.tab;
    el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.tab === tab));
    form.hidden = tab !== 'page'; $('#look', el).hidden = tab !== 'look';
    if (tab === 'look') drawLook();
  };
  function drawLook() {
    const base = resolveStyle(store.style(m.style_id).spec);
    const kinds = [...new Set([...PLACE_KINDS.map((k) => k.id), ...store.places.map((p) => p.kind)])];
    const host = $('#look', el);
    styleControls(host, spec(), {
      placeKinds: kinds, openAdvanced: true,
      onChange: (path, v) => {
        m.overrides.style = m.overrides.style || {};
        // Store only what differs from the page's base style.
        if (JSON.stringify(path.split('.').reduce((a, k) => (a == null ? a : a[k]), base)) === JSON.stringify(v)) {
          const ks = path.split('.'); const last = ks.pop(); const parent = ks.reduce((a, k) => (a && a[k]), m.overrides.style);
          if (parent) delete parent[last];
        } else set(m.overrides.style, path, v);
        atlas.setSpec(spec()); refreshPaperInfo(); save();
      },
      onReplace: () => toast('Ready-made looks apply to a whole preset — use Presets → Save as new preset, then pick it here', 'err'),
    });
    host.insertAdjacentHTML('afterbegin', `<div class="notice info" style="margin:10px 0">Changes here apply to <strong>this page only</strong>, on top of “${esc(store.style(m.style_id).name)}”. <button type="button" class="btn sm" id="resetLook">Reset this page's look</button></div>`);
    $('#resetLook', el).onclick = () => { m.overrides.style = {}; atlas.setSpec(spec()); drawLook(); refreshPaperInfo(); save(); };
  }

  // Form wiring
  form.addEventListener('input', (e) => {
    const t = e.target, f = form.elements;
    if (t.name === 'name') m.name = t.value;
    else if (t.name === 'title') m.title = t.value;
    else if (t.name === 'subtitle') m.overrides.subtitle = t.value;
    else if (t.name === 'from' || t.name === 'to') { m.filter[t.name] = t.value || null; refreshData(); }
    else if (t.name === 'places') { m.filter.places = t.checked; refreshData(); }
    else if (['pw', 'ph', 'dpi', 'preset', 'bleed'].includes(t.name)) {
      if (t.name === 'preset' && t.value) { const p = PAPER_PRESETS.find((x) => x.id === t.value); f.pw.value = p.w; f.ph.value = p.h; }
      if (t.name !== 'preset') f.preset.value = (PAPER_PRESETS.find((p) => p.w === +f.pw.value && p.h === +f.ph.value) || { id: '' }).id;
      const b = frameBounds();
      m.paper = { w: +f.pw.value || 300, h: +f.ph.value || 300, dpi: +f.dpi.value, bleed: Math.max(0, +f.bleed.value || 0) };
      layoutFrame(); if (!tilted()) fitFrame(b); refreshPaperInfo();
    } else if (t.name === 'composition') { m.overrides.composition = +t.value; refreshPaperInfo(); }
    else if (t.name === 'style_id') { m.style_id = +t.value; atlas.setSpec(spec()); }
    else return;
    save();
  });
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-leg],[data-type],[data-country]');
    if (chip) {
      const [key, val] = chip.dataset.leg ? ['legs', +chip.dataset.leg] : chip.dataset.type ? ['types', chip.dataset.type] : ['countries', chip.dataset.country];
      m.filter[key] = m.filter[key].includes(val) ? m.filter[key].filter((x) => x !== val) : [...m.filter[key], val];
      chip.classList.toggle('on'); refreshData(); save();
      return;
    }
    const dd = e.target.closest('[data-data]');
    if (dd) downloadRouteData(mapRoutes(m), dd.dataset.data, m.name, spec());
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#editStyle', el).onclick = () => { location.hash = `#/map/${m.style_id || store.styles[0].id}`; };
  $('#fit', el).onclick = () => { const b = unionBbox(mapRoutes(m).map((r) => r.bbox)); if (b) fitFrame(b, true); };
  $('#flat', el).onclick = () => { atlas.map.easeTo({ pitch: 0, bearing: 0, duration: 500 }); };

  const renderOpts = () => ({
    routes: mapRoutes(m), places: mapPlaces(m), spec: spec(), bounds: frameBounds(), camera: tilted() ? frameCamera() : null, paper: m.paper,
    composition: m.overrides.composition || DEFAULT_COMPOSITION, title: m.title || null, subtitle: m.overrides.subtitle || '',
  });
  $('#preview', el).onclick = async () => {
    const btn = $('#preview', el); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Rendering';
    try {
      const { renderPage } = await import('../map/render.js');
      const { canvas } = await renderPage({ ...renderOpts(), outWidth: Math.min(1400, Math.round(window.innerWidth * 0.8)) });
      canvas.className = 'preview-img';
      await modal({ title: `Preview — ${m.name}`, body: canvas, wide: true });
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; btn.textContent = 'Preview'; }
  };
  $('#export', el).onclick = async () => {
    const res = await exportDialog({ name: m.name, paper: m.paper, last: m.overrides.export, opts: renderOpts, statusEl: $('#exportStatus', el) });
    if (!res) return;
    m.overrides.export = res.options;
    save();
    await api('POST', `/api/maps/${id}/exported`, { px: res.px });
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
