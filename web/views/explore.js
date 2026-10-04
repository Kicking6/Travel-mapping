// #/map — the whole trip: filterable route list, the map, an edit drawer.
import { store, api, loadRoutes, applyFilter, legFor, needsReview, esc, $, fmtDate, fmtKm, debounce, toast } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { resolveStyle, PLACE_KINDS } from '../lib/style.js';
import { styleControls } from './style-controls.js';
import { TYPES, typeById } from '../lib/types.js';
import { unionBbox } from '../lib/geo.js';
import { routeEditor } from './route-editor.js';

const PREF = 'ta-explore';
function loadPrefs() {
  try { return { q: '', types: [], leg: '', from: '', to: '', showHidden: false, styleId: null, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch (_) { return { q: '', types: [], leg: '', from: '', to: '', showHidden: false }; }
}
function savePrefs(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (_) { /* private mode */ } }

export async function render(el) {
  const prefs = loadPrefs();
  const selected = new Set();
  let lastClicked = null;
  let sort = { key: 'date', dir: 1 };

  el.innerHTML = `
  <div class="ws">
    <aside class="ws-panel">
      <div class="ws-panel-head">
        <div class="filter-row">
          <input class="input sm" id="q" type="search" placeholder="Search names, notes, places…" value="${esc(prefs.q)}">
        </div>
        <div class="chip-row" id="typeChips"></div>
        <div class="filter-row">
          <select class="select sm" id="leg"><option value="">All legs</option></select>
          <input class="input sm" id="from" type="date" title="From" value="${esc(prefs.from)}">
          <input class="input sm" id="to" type="date" title="To" value="${esc(prefs.to)}">
        </div>
        <label class="switch" style="font-size:var(--fs-sm)"><input type="checkbox" id="showHidden" ${prefs.showHidden ? 'checked' : ''}><span class="track"></span>Show hidden routes</label>
      </div>
      <div class="ws-panel-body"><table class="rt" id="table"></table></div>
      <div class="ws-panel-foot"><span id="count"></span><span style="margin-left:auto"></span><button class="btn sm ghost" id="selAll">Select all</button></div>
    </aside>
    <section class="ws-map"><div class="map" id="map"></div>
      <div class="map-float tl" style="padding:6px 8px;display:flex;gap:6px;align-items:center">
        <select class="select sm" id="styleSel" title="Map style" style="width:auto"></select>
        <button class="btn sm" id="fitAll" title="Zoom to the filtered routes">Fit</button>
        <a class="btn sm" href="#/draw" title="Add a route by clicking on the map">＋ Draw a route</a>
        <label class="switch" style="font-size:var(--fs-sm);margin-left:4px" title="Accommodation and campsites"><input type="checkbox" id="showStays"><span class="track"></span>Stays</label>
        <label class="switch" style="font-size:var(--fs-sm);margin-left:4px" title="Photo pins"><input type="checkbox" id="showPhotos"><span class="track"></span>Photos</label>
        <button class="btn sm" id="pinsBtn" title="Pin size, colour, shape and symbol — saved to this map style" aria-expanded="false">Pins…</button>
      </div>
      <div class="map-float pins-pop" id="pinsPop" hidden>
        <div class="row-between pins-pop-head"><strong>Pins</strong><span class="help" id="pinsSaved"></span><button class="btn sm ghost" id="pinsClose" aria-label="Close">×</button></div>
        <p class="help" style="margin:0 0 6px">Changes save to the “<span id="pinsStyleName"></span>” style, so album pages and exports using it match.</p>
        <div id="pinsControls"></div>
      </div>
      <div class="map-float bl map-legend-float" id="legend"></div>
    </section>
    <aside class="ws-drawer" id="drawer" hidden></aside>
  </div>`;

  // Controls
  const chips = $('#typeChips', el);
  chips.innerHTML = TYPES.map((t) => `<button class="chip filter-chip ${prefs.types.includes(t.id) ? 'on' : ''}" data-type="${t.id}" title="${esc(t.label)}"><span class="type-dot" style="background:${t.color}"></span>${esc(t.label.split(' /')[0])}</button>`).join('');
  const legSel = $('#leg', el);
  legSel.innerHTML += store.legs.map((l) => `<option value="${l.id}" ${String(prefs.leg) === String(l.id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const styleSel = $('#styleSel', el);
  styleSel.innerHTML = store.styles.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const styleRow = store.styles.find((s) => s.id === prefs.styleId) || store.styles[0];
  styleSel.value = styleRow.id;

  const atlas = await createAtlas($('#map', el), { spec: resolveStyle(styleRow.spec) });

  const filter = () => ({
    q: prefs.q.trim(), types: prefs.types, legs: prefs.leg ? [+prefs.leg] : [], from: prefs.from || null, to: prefs.to || null,
  });
  let visible = [];

  function computeVisible() {
    const base = prefs.showHidden ? store.routes.map((r) => ({ ...r, hidden: 0, _wasHidden: r.hidden })) : store.routes;
    visible = applyFilter(base, filter()).map((r) => store.route(r.id));
    const k = sort.key, d = sort.dir;
    visible.sort((a, b) => {
      const av = a[k] ?? '', bv = b[k] ?? '';
      if (k === 'date') return d * ((av || '9999') + (a.started_at || '')).localeCompare((bv || '9999') + (b.started_at || '')) || a.id - b.id;
      if (typeof av === 'number' || typeof bv === 'number') return d * ((av || 0) - (bv || 0));
      return d * String(av).localeCompare(String(bv));
    });
  }

  function renderLegend() {
    const types = [...new Set(visible.map((r) => r.type))];
    const spec = resolveStyle(store.style(+styleSel.value).spec);
    $('#legend', el).innerHTML = types.map((t) => `<span><span class="swatch-line" style="background:${spec.routes[t]?.color || typeById(t).color}"></span>${esc(typeById(t).label)}</span>`).join('') || '<span class="muted">No routes match</span>';
  }

  function renderTable() {
    const head = `<colgroup><col style="width:92px"><col><col style="width:62px"></colgroup>
      <thead><tr>${[['date', 'Date'], ['name', 'Route'], ['distance_km', 'km']].map(([k, l]) => `<th data-sort="${k}" ${sort.key === k ? `aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''} class="${k === 'distance_km' ? 'num' : ''}">${l}</th>`).join('')}</tr></thead>`;
    let body = '', lastMonth = null;
    for (const r of visible) {
      if (sort.key === 'date') {
        const month = r.date ? r.date.slice(0, 7) : 'none';
        if (month !== lastMonth) {
          if (lastMonth !== null) body += '</tbody>';
          const label = r.date ? new Date(r.date + 'T00:00:00Z').toLocaleDateString('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No date yet';
          body += `<tbody class="group"><tr><th colspan="3">${label}</th></tr>`;
          lastMonth = month;
        }
      }
      const t = typeById(r.type);
      const leg = legFor(r);
      const flag = needsReview(r) ? '<span class="flag" title="Needs a look — see Review">•</span>' : '';
      body += `<tr class="row ${selected.has(r.id) ? 'sel' : ''} ${r.hidden ? 'hidden-route' : ''}" data-id="${r.id}" data-route-id="${r.id}">
        <td title="${esc(r.date || '')}">${r.date ? esc(fmtDate(r.date).replace(/ \d{4}$/, '')) : '<span class="muted">—</span>'}</td>
        <td title="${esc(r.name)}${leg ? ' · ' + esc(leg.name) : ''}"><span class="type-dot" style="background:${r.color || t.color}"></span>${esc(r.name)}${flag}</td>
        <td class="num">${fmtKm(r.distance_km)}</td></tr>`;
    }
    $('#table', el).innerHTML = head + body + (lastMonth !== null ? '</tbody>' : '<tbody></tbody>');
    const km = visible.reduce((a, r) => a + (r.distance_km || 0), 0);
    $('#count', el).textContent = `${visible.length} route${visible.length === 1 ? '' : 's'} · ${fmtKm(km)} km`;
  }

  // Data goes to the map only when the routes themselves change; filtering
  // just swaps the visible-id filter (no re-tiling, so it's instant).
  let loadedVersion = null;
  function refresh({ fit = false } = {}) {
    const t0 = performance.now();
    computeVisible();
    renderTable();
    renderLegend();
    if (loadedVersion !== store.version) {
      atlas.setRoutes(store.routes);
      loadedVersion = store.version;
    }
    syncStays();
    atlas.setVisible(visible.map((r) => r.id));
    for (const id of [...selected]) if (!store.route(id)) selected.delete(id);
    atlas.setSelection([...selected]);
    if (fit) fitVisible();
    window.__taRefreshMs = performance.now() - t0; // read by the speed check in CLAUDE.md
  }
  function fitVisible(list = visible) { atlas.fit(unionBbox(list.map((r) => r.bbox))); }

  // Drawer
  const drawer = $('#drawer', el);
  function renderDrawer() {
    const ids = [...selected];
    if (!ids.length) { drawer.hidden = true; return; }
    drawer.hidden = false;
    routeEditor(drawer, ids.map((id) => store.route(id)), {
      onClose: () => { selected.clear(); atlas.setSelection([]); renderTable(); renderDrawer(); },
      onSaved: async () => { await loadRoutes(); },
      onDeleted: async () => { selected.clear(); await loadRoutes(); },
      // Colour/width saved from the drawer: repaint without rebuilding the drawer (keeps the picker open).
      onLineSaved: () => { atlas.setRoutes(store.routes); atlas.setVisible(visible.map((r) => r.id)); renderTable(); },
    });
    requestAnimationFrame(() => atlas.map.resize());
  }

  function select(id, ev, fromMap = false) {
    if (id == null) {
      if (!fromMap) return;
      selected.clear();
    } else if (ev && (ev.metaKey || ev.ctrlKey)) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
    } else if (ev && ev.shiftKey && lastClicked != null) {
      const ids = visible.map((r) => r.id);
      const [a, b] = [ids.indexOf(lastClicked), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) ids.slice(a, b + 1).forEach((x) => selected.add(x));
    } else {
      selected.clear(); selected.add(id);
    }
    if (id != null) lastClicked = id;
    atlas.setSelection([...selected]);
    renderTable();
    renderDrawer();
    // After the drawer has opened and the map has resized, or the fit is off-centre.
    if (!fromMap && selected.size) requestAnimationFrame(() => requestAnimationFrame(() => fitVisible([...selected].map((x) => store.route(x)))));
    if (fromMap && id != null) {
      const row = $(`tr[data-id="${id}"]`, el);
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  }

  // Events
  $('#table', el).addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; sort = { key: k, dir: sort.key === k ? -sort.dir : 1 }; computeVisible(); renderTable(); return; }
    const tr = e.target.closest('tr.row');
    if (tr) select(+tr.dataset.id, e);
  });
  atlas.on('select', (id, ev) => select(id, ev, true));
  const onFilter = (fit) => { savePrefs(prefs); refresh({ fit }); };
  $('#q', el).addEventListener('input', debounce((e) => { prefs.q = e.target.value; onFilter(false); }, 200));
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    const t = b.dataset.type;
    prefs.types = prefs.types.includes(t) ? prefs.types.filter((x) => x !== t) : [...prefs.types, t];
    b.classList.toggle('on');
    onFilter(false);
  });
  legSel.onchange = () => { prefs.leg = legSel.value; onFilter(true); };
  $('#from', el).onchange = (e) => { prefs.from = e.target.value; onFilter(true); };
  $('#to', el).onchange = (e) => { prefs.to = e.target.value; onFilter(true); };
  $('#showHidden', el).onchange = (e) => { prefs.showHidden = e.target.checked; onFilter(false); };
  $('#fitAll', el).onclick = () => fitVisible();
  $('#selAll', el).onclick = () => { visible.forEach((r) => selected.add(r.id)); atlas.setSelection([...selected]); renderTable(); renderDrawer(); };
  // Stays (accommodation pins): on/off, and only those in the date filter.
  const staysToggle = $('#showStays', el);
  staysToggle.checked = prefs.stays !== false;
  let lastStays = null;
  function syncStays() {
    const list = !staysToggle.checked ? [] : store.places.filter((p) => (!prefs.from || !p.date || p.date >= prefs.from) && (!prefs.to || !p.date || p.date <= prefs.to));
    const key = `${store.version}|${list.length}|${prefs.from}|${prefs.to}`;
    if (key !== lastStays) { atlas.setPlaces(list); lastStays = key; }
  }
  staysToggle.onchange = () => { prefs.stays = staysToggle.checked; savePrefs(prefs); syncStays(); };

  // Photo pins (clustered); click one for the lightbox.
  const photoToggle = $('#showPhotos', el);
  photoToggle.checked = /photos=1/.test(location.hash) || prefs.photos === true;
  async function syncPhotos() {
    prefs.photos = photoToggle.checked; savePrefs(prefs);
    if (!photoToggle.checked) { atlas.setPhotos([], false); return; }
    const { loadPhotos } = await import('./photos.js');
    atlas.setPhotos((await loadPhotos()).filter((p) => !p.hidden), true);
  }
  photoToggle.onchange = syncPhotos;
  atlas.on('photo', async (id) => { const { openPhoto } = await import('./photos.js'); openPhoto(id, syncPhotos); });
  syncPhotos();
  styleSel.onchange = async () => {
    prefs.styleId = +styleSel.value; savePrefs(prefs);
    await atlas.setSpec(resolveStyle(store.style(+styleSel.value).spec));
    renderLegend();
    if (!$('#pinsPop', el).hidden) openPins();
  };

  // Pins… — the style's place controls, right on the map. Edits save to the selected style.
  const pinsPop = $('#pinsPop', el), pinsBtn = $('#pinsBtn', el);
  function openPins() {
    const row = store.style(+styleSel.value);
    const spec = resolveStyle(row.spec);
    const kinds = [...new Set([...PLACE_KINDS.map((k) => k.id), ...Object.keys(spec.places.kinds), ...store.places.map((p) => p.kind)])];
    for (const k of kinds) if (!spec.places.kinds[k]) spec.places.kinds[k] = { color: '#677384', size: 5, show: true };
    // Only the kinds on this trip, so the list isn't a wall of unused ones.
    const used = kinds.filter((k) => store.places.some((p) => p.kind === k));
    $('#pinsStyleName', el).textContent = row.name;
    $('#pinsSaved', el).textContent = '';
    const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };
    const save = debounce(async () => {
      $('#pinsSaved', el).textContent = 'Saving…';
      try { await api('PUT', `/api/styles/${row.id}`, { name: row.name, spec }); row.spec = structuredClone(spec); $('#pinsSaved', el).textContent = 'Saved'; }
      catch (e) { $('#pinsSaved', el).textContent = ''; toast(e.message, 'err'); }
    }, 600);
    let pending = false;
    const repaint = () => { if (pending) return; pending = true; requestAnimationFrame(async () => { pending = false; await atlas.setSpec(structuredClone(spec)); }); };
    styleControls($('#pinsControls', el), spec, {
      placeKinds: used.length ? used : kinds, only: ['places', 'adv-pins'], openAdvanced: true,
      onChange: (path, v) => { set(spec, path, v); repaint(); save(); },
    });
    pinsPop.querySelectorAll('details.style-group').forEach((d) => { d.open = true; });
    if (!staysToggle.checked) { staysToggle.checked = true; staysToggle.onchange && staysToggle.onchange(); }
    pinsPop.hidden = false; pinsBtn.setAttribute('aria-expanded', 'true');
  }
  const closePins = () => { pinsPop.hidden = true; pinsBtn.setAttribute('aria-expanded', 'false'); };
  pinsBtn.onclick = () => (pinsPop.hidden ? openPins() : closePins());
  $('#pinsClose', el).onclick = closePins;
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape' && selected.size) { selected.clear(); atlas.setSelection([]); renderTable(); renderDrawer(); }
  };
  document.addEventListener('keydown', onKey);
  const off = store.on((what) => { if (what === 'routes') { refresh(); if (selected.size) renderDrawer(); } });

  refresh();
  if (!store.routes.length) {
    $('#table', el).innerHTML = `<tbody><tr><td><div class="empty"><h3>No routes yet</h3><p>Import your GPX files to get started.</p><a class="btn primary" href="#/import">Import routes</a></div></td></tr></tbody>`;
  } else fitVisible();

  return () => { off(); document.removeEventListener('keydown', onKey); atlas.destroy(); };
}
