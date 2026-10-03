// #/import — GPX/CSV files or whole folders → preview → import. Also flights and places.
//
// Everything heavy runs here in the browser: parsing (web/lib/gpx.js),
// simplification, hashing, country lookup. The Worker receives small,
// already-simplified records in batches, de-duplicates and stores them, and
// (optionally) keeps each original file in R2 so nothing is ever lost.
import { store, api, loadRoutes, esc, $, toast, fmtKm, modal } from '../app.js';
import { routesFromGpx, routesFromWktCsv, placesFromCsv, flightRoute } from '../lib/gpx.js';
import { sameRoute, decodePolyline } from '../lib/geo.js';
import { loadCountries, countriesFor } from '../lib/countries.js';
import { typeById, TYPES } from '../lib/types.js';

const BATCH = 40;

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// Folder drops: walk directory entries recursively.
async function filesFromDrop(dt) {
  const items = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files].map((f) => ({ file: f, path: f.name }));
  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, prefix + entry.name + '/');
      } while (batch.length);
    }
  }
  for (const e of items) await walk(e, '');
  return out;
}

export async function render(el) {
  el.innerHTML = `<div class="page page-narrow">
    <div class="page-head"><div><h1>Import</h1><p>GPX files from mapstogpx or Strava, Google My Maps CSV exports, or whole folders. Files are read on this computer; only the simplified lines are uploaded.</p></div></div>
    <div class="drop" id="drop">
      <h3>Drop GPX or CSV files, or a whole folder</h3>
      <p class="muted">Dates come from the GPS recording, then the file name (“18:05:2025”, “August 02 2025”, “day 103 busing”). Duplicates are caught automatically.</p>
      <div class="toolbar">
        <label class="btn primary">Choose files<input type="file" id="pickFiles" multiple accept=".gpx,.csv" hidden></label>
        <label class="btn">Choose a folder<input type="file" id="pickDir" webkitdirectory multiple hidden></label>
      </div>
      <label class="switch" style="margin-top:14px;font-size:var(--fs-sm)"><input type="checkbox" id="keepOriginals" checked><span class="track"></span>Keep a copy of each original file (recommended)</label>
    </div>
    <div id="work" style="margin-top:18px"></div>
    <div class="form-grid" style="margin-top:22px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      <div class="card"><div class="card-head"><h3>Add a flight</h3></div><form class="card-body stack" id="flightForm" autocomplete="off">
        <div class="field-row"><div class="field"><label>From (airport code)</label><input class="input" name="from" placeholder="AKL" maxlength="3" required style="text-transform:uppercase"></div>
        <div class="field"><label>To</label><input class="input" name="to" placeholder="LAX" maxlength="3" required style="text-transform:uppercase"></div></div>
        <div class="field"><label>Date</label><input class="input" type="date" name="date"></div>
        <div class="help" id="flightHelp">Drawn as a great-circle arc, dashed on the map.</div>
        <button class="btn primary" type="submit">Add flight</button></form></div>
      <div class="card"><div class="card-head"><h3>Places (accommodation, campsites)</h3></div><div class="card-body stack">
        <p class="help">A CSV with columns <span class="mono">name, lat, lon, kind, date, notes</span>. Kind is tent, hut, hotel, hostel, airbnb, friends, sight — or anything else, which gets its own colour in Map styles.</p>
        <label class="btn">Choose places CSV<input type="file" id="pickPlaces" accept=".csv" hidden></label>
        <p class="help">${store.places.length} place${store.places.length === 1 ? '' : 's'} on the map now.</p>
      </div></div>
    </div>
  </div>`;

  const work = $('#work', el);
  const drop = $('#drop', el);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); prepare(await filesFromDrop(e.dataTransfer)); });
  $('#pickFiles', el).onchange = (e) => prepare([...e.target.files].map((f) => ({ file: f, path: f.name })));
  $('#pickDir', el).onchange = (e) => prepare([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));

  let candidates = [];

  async function prepare(entries) {
    const files = entries.filter(({ path }) => /\.(gpx|csv)$/i.test(path) && !path.split('/').some((p) => p.startsWith('.')));
    if (!files.length) { toast('No .gpx or .csv files there', 'err'); return; }
    work.innerHTML = `<div class="card card-pad stack"><div class="row-between"><strong id="stage">Reading ${files.length} files…</strong><span class="muted" id="pct"></span></div><div class="progress"><i id="bar"></i></div></div>`;
    const bar = $('#bar', work), stage = $('#stage', work), pct = $('#pct', work);
    const tripStart = store.trip.trip_start;
    candidates = [];
    const problems = [];
    for (let i = 0; i < files.length; i++) {
      const { file, path } = files[i];
      stage.textContent = `Reading ${file.name}`;
      try {
        const text = await file.text();
        const hash = await sha256(text);
        const ctx = { fileName: file.name, folderPath: path, tripStart };
        const res = /\.csv$/i.test(file.name) ? routesFromWktCsv(text, ctx) : routesFromGpx(text, ctx);
        if (!res.routes.length) problems.push({ path, msg: res.warnings.join('; ') || 'no lines' });
        for (const r of res.routes) candidates.push({ ...r, source_hash: res.routes.length === 1 ? hash : null, _text: res.routes.length === 1 && /\.gpx$/i.test(file.name) ? text : null, _path: path });
      } catch (e) {
        problems.push({ path, msg: e.message });
      }
      bar.style.width = `${Math.round(((i + 1) / files.length) * 70)}%`;
      pct.textContent = `${i + 1} / ${files.length}`;
      if (i % 5 === 0) await tick();
    }

    stage.textContent = 'Working out countries…';
    try {
      const countries = await loadCountries();
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        c.country = countriesFor(countries, decodePolyline(c.geom_lo || c.geom));
        if (i % 20 === 0) { bar.style.width = `${70 + Math.round((i / candidates.length) * 30)}%`; await tick(); }
      }
    } catch (e) { problems.push({ path: 'Country lookup', msg: e.message + ' — you can add countries later' }); }

    // Status against what's already in the trip (the server re-checks).
    const seen = [];
    for (const c of candidates) {
      const here = store.routes.find((r) => (c.source_hash && r.source_hash === c.source_hash) || (sameRoute(r.fingerprint, c.fingerprint) && r.geom === c.geom));
      const twin = here || seen.find((s) => s.fingerprint === c.fingerprint && s.geom === c.geom);
      const look = !twin && (store.routes.find((r) => sameRoute(r.fingerprint, c.fingerprint)) || seen.find((s) => sameRoute(s.fingerprint, c.fingerprint)));
      c._status = twin ? 'skip' : look ? 'flag' : 'new';
      c._note = twin ? `already here as “${twin.name}”` : look ? `same start/end as “${look.name}”` : '';
      c._include = c._status !== 'skip';
      seen.push(c);
    }
    showPreview(problems);
  }

  function showPreview(problems) {
    const n = (s) => candidates.filter((c) => c._status === s).length;
    const undated = candidates.filter((c) => !c.date).length;
    const kinds = TYPES.map((t) => [t, candidates.filter((c) => c.type === t.id && c._include).length]).filter(([, k]) => k);
    work.innerHTML = `<div class="card">
      <div class="card-head"><h3>${candidates.length} routes found</h3><div class="toolbar"><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="go">Import ${candidates.filter((c) => c._include).length}</button></div></div>
      <div class="card-body stack">
        <div class="kpi"><div><b>${n('new')}</b><span>new</span></div><div><b>${n('flag')}</b><span>possible duplicates — imported, flagged for Review</span></div><div><b>${n('skip')}</b><span>already here — skipped</span></div><div><b>${undated}</b><span>no date yet</span></div></div>
        <div class="chip-row">${kinds.map(([t, k]) => `<span class="chip"><span class="type-dot" style="background:${t.color}"></span>${esc(t.label)} ${k}</span>`).join('')}</div>
        ${problems.length ? `<details class="notice warn"><summary>${problems.length} file${problems.length === 1 ? '' : 's'} couldn't be read</summary>${problems.slice(0, 50).map((p) => `<div><span class="mono">${esc(p.path)}</span> — ${esc(p.msg)}</div>`).join('')}</details>` : ''}
        <div class="preview-wrap"><table class="rt"><colgroup><col style="width:34px"><col><col style="width:150px"><col style="width:100px"><col style="width:70px"><col style="width:120px"><col style="width:170px"></colgroup>
          <thead><tr><th></th><th>Route</th><th>Date</th><th>Type</th><th class="num">km</th><th>Country</th><th>Status</th></tr></thead><tbody>
          ${candidates.map((c, i) => `<tr><td><input type="checkbox" data-i="${i}" ${c._include ? 'checked' : ''}></td>
            <td title="${esc(c._path)}">${esc(c.name)}<div class="help mono" style="overflow:hidden;text-overflow:ellipsis">${esc(c._path)}</div></td>
            <td title="${esc(c.date_source || '')}">${c.date ? esc(c.date) + (c.date_source === 'suggested' ? ' <span class="flag" title="Year guessed">?</span>' : '') : '<span class="muted">—</span>'}</td>
            <td><span class="type-dot" style="background:${typeById(c.type).color}"></span>${esc(typeById(c.type).label.split(' /')[0])}</td>
            <td class="num">${fmtKm(c.distance_km)}</td><td title="${esc(c.country || '')}">${esc(c.country || '')}</td>
            <td class="status-${c._status}" title="${esc(c._note)}">${c._status === 'new' ? 'New' : c._status === 'flag' ? 'Possible duplicate' : 'Already here'}</td></tr>`).join('')}
        </tbody></table></div>
      </div></div>`;
    $('#cancel', work).onclick = () => { work.innerHTML = ''; candidates = []; };
    work.querySelector('tbody').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-i]'); if (!cb) return;
      candidates[+cb.dataset.i]._include = cb.checked;
      $('#go', work).textContent = `Import ${candidates.filter((c) => c._include).length}`;
    });
    $('#go', work).onclick = () => runImport();
  }

  async function runImport() {
    const list = candidates.filter((c) => c._include);
    if (!list.length) return;
    const keep = $('#keepOriginals', el).checked;
    work.innerHTML = `<div class="card card-pad stack"><div class="row-between"><strong id="stage">Importing…</strong><span class="muted" id="pct"></span></div><div class="progress"><i id="bar"></i></div></div>`;
    const bar = $('#bar', work), stage = $('#stage', work), pct = $('#pct', work);
    let inserted = 0, skipped = [], flagged = [], failed = [];
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const payload = chunk.map(({ _text, _path, _status, _note, _include, ...r }) => r);
      try {
        const { data } = await api('POST', '/api/routes/import', { routes: payload });
        inserted += data.inserted.length; skipped.push(...data.skipped); flagged.push(...data.flagged);
      } catch (e) { failed.push(`${chunk[0].name}…: ${e.message}`); }
      bar.style.width = `${Math.round(((i + chunk.length) / list.length) * (keep ? 60 : 100))}%`;
      pct.textContent = `${Math.min(i + BATCH, list.length)} / ${list.length}`;
    }
    if (keep) {
      const originals = list.filter((c) => c._text && c.source_hash);
      let done = 0;
      const queue = originals.slice();
      const worker = async () => {
        while (queue.length) {
          const c = queue.shift();
          stage.textContent = `Keeping originals… ${c.source_name}`;
          try { await api('PUT', `/api/raw/${c.source_hash}`, new Blob([c._text], { type: 'application/gpx+xml' }), { headers: { 'X-File-Name': encodeURIComponent(c.source_name || 'route.gpx') } }); } catch (_) { /* optional — the route itself is stored */ }
          done++;
          bar.style.width = `${60 + Math.round((done / originals.length) * 40)}%`;
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    }
    await loadRoutes(true);
    candidates = [];
    work.innerHTML = `<div class="card card-pad stack">
      <div class="notice ok"><strong>${inserted} route${inserted === 1 ? '' : 's'} imported.</strong> ${skipped.length ? `${skipped.length} were already here.` : ''}</div>
      ${flagged.length ? `<div class="notice warn">${flagged.length} look like duplicates of routes already in the trip — they're in <a href="#/review">Review</a> to decide.</div>` : ''}
      ${failed.length ? `<div class="notice warn">${failed.map(esc).join('<br>')}</div>` : ''}
      <div class="toolbar"><a class="btn primary" href="#/map">See them on the map</a><a class="btn" href="#/review">Review what needs a look</a></div></div>`;
  }

  // Flights
  let airports = null;
  const ff = $('#flightForm', el);
  ff.onsubmit = async (e) => {
    e.preventDefault();
    airports = airports || await fetch('/data/airports.json').then((r) => r.json());
    const code = (s) => s.trim().toUpperCase();
    const a = airports[code(ff.from.value)], b = airports[code(ff.to.value)];
    if (!a || !b) { $('#flightHelp', el).innerHTML = `<span class="status-err">Unknown airport code: ${esc(!a ? code(ff.from.value) : code(ff.to.value))}</span>`; return; }
    const r = flightRoute({ code: code(ff.from.value), coord: [a[0], a[1]] }, { code: code(ff.to.value), coord: [b[0], b[1]] }, { date: ff.date.value || null, name: `${a[3] || code(ff.from.value)} to ${b[3] || code(ff.to.value)}` });
    // Same country names as every other route (Natural Earth), not the airport list's ("Usa").
    try {
      const countries = await loadCountries();
      r.country = countriesFor(countries, [[a[0], a[1]], [b[0], b[1]]]);
    } catch (_) { r.country = null; }
    try {
      await api('POST', '/api/routes/import', { routes: [r] });
      await loadRoutes(true);
      toast(`Added ${r.name}`);
      ff.reset();
      $('#flightHelp', el).textContent = 'Drawn as a great-circle arc, dashed on the map.';
    } catch (err) { toast(err.message, 'err'); }
  };

  // Places
  $('#pickPlaces', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const { places, warnings } = placesFromCsv(await f.text());
    if (!places.length) { toast(warnings[0] || 'No places found', 'err'); return; }
    let replace = false;
    if (store.places.length) {
      const choice = await modal({ title: 'Import places', body: `<p>Add ${places.length} places to the ${store.places.length} already on the map, or replace them?</p>`, actions: [{ label: 'Cancel', value: null }, { label: 'Replace all', value: 'replace' }, { label: 'Add', value: 'add', primary: true }] });
      if (!choice) return;
      replace = choice === 'replace';
    }
    try {
      await api('POST', '/api/places/import', { places, replace });
      await loadRoutes(true);
      toast(`Imported ${places.length} places${warnings.length ? ` (${warnings.length} rows skipped)` : ''}`);
      render(el);
    } catch (err) { toast(err.message, 'err'); }
  };
}
