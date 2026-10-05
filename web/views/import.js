// #/import — GPX/CSV files or whole folders → preview → import. Also flights and places.
//
// Everything heavy runs here in the browser: parsing (web/lib/gpx.js),
// simplification, hashing, country lookup. The Worker receives small,
// already-simplified records in batches, de-duplicates and stores them, and
// (optionally) keeps each original file in R2 so nothing is ever lost.
import { store, api, loadRoutes, esc, $, toast, fmtKm, modal, debounce, fmtDate } from '../app.js';
import { routesFromGpx, routesFromWktCsv, placesFromCsv } from '../lib/gpx.js';
import { parseFlightLines, flightLegs } from '../lib/travel.js';
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
      <div class="card"><div class="card-head"><h3>Flights (with layovers)</h3></div><form class="card-body stack" id="flightForm" autocomplete="off">
        <p class="help">One flight per line — date (optional), then the airports in order. Layovers become one dashed leg each.</p>
        <textarea class="input mono" name="lines" rows="5" placeholder="2024-07-23 AKL LAX JFK  Air NZ&#10;2024-12-18 LIM SCL PUQ  NYBZTX&#10;26/02/2025 ZRH GOT"></textarea>
        <div class="filter-row"><input class="input sm" id="apSearch" placeholder="Find a code — city or airport"><span class="help" id="apHits"></span></div>
        <div class="help" id="flightHelp"></div>
        <div class="toolbar"><button class="btn primary" type="submit">Add flights</button><a class="btn ghost sm" href="#/review/travel">Find missing flights</a></div></form></div>
      <div class="card"><div class="card-head"><h3>Strava</h3><span class="help" id="stravaState"></span></div><div class="card-body stack" id="strava"><span class="spinner"></span></div></div>
      <div class="card"><div class="card-head"><h3>AllTrails, Garmin, Komoot…</h3></div><div class="card-body stack">
        <p class="help">These don't offer an open API for personal apps (AllTrails has none; Garmin and Komoot require a business partnership), so there's no “connect” button. Each one exports GPX: AllTrails → a recording → ⋯ → Download route / Export GPX; Garmin Connect → activity → ⚙ → Export to GPX; Komoot → tour → ⋯ → Download GPX. Drop the files above — dates, duplicates and countries are handled the same way.</p>
        <a class="btn" href="#/draw">Or draw a route by hand</a>
      </div></div>
      <div class="card"><div class="card-head"><h3>Places (accommodation, campsites)</h3></div><div class="card-body stack">
        <p class="help">A CSV with columns <span class="mono">name, lat, lon, kind, date, notes</span>. Kind is tent, hut, hotel, hostel, airbnb, friends, sight — or anything else, which gets its own colour in each preset.</p>
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
      <div class="toolbar"><a class="btn primary" href="#/routes">See them in Edit routes</a><a class="btn" href="#/review">Review what needs a look</a></div></div>`;
  }

  // Flights — itineraries with layovers, one per line.
  const ff = $('#flightForm', el);
  const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('flight');
  if (pre) { ff.lines.value = pre; ff.lines.focus(); }
  $('#apSearch', el).addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 3) { $('#apHits', el).textContent = ''; return; }
    const ap = await airportList();
    const hits = Object.entries(ap).filter(([k, v]) => k.toLowerCase() === q || `${v[2]} ${v[3]}`.toLowerCase().includes(q)).sort((a, b) => (b[1][5] || 1) - (a[1][5] || 1)).slice(0, 5);
    $('#apHits', el).innerHTML = hits.map(([k, v]) => `<strong>${k}</strong> ${esc(v[3] || v[2])}`).join(' · ') || 'No match';
  }, 200));
  ff.onsubmit = async (e) => {
    e.preventDefault();
    const help = $('#flightHelp', el);
    const { flights, errors } = parseFlightLines(ff.lines.value);
    const ap = await airportList();
    const routes = [];
    for (const f of flights) { try { routes.push(...flightLegs(f.codes, ap, f)); } catch (err) { errors.push(`${f.line}: ${err.message}`); } }
    if (!routes.length) { help.innerHTML = `<span class="status-err">${esc(errors.join(' · ') || 'Nothing to add')}</span>`; return; }
    try {
      const countries = await loadCountries();
      for (const r of routes) { const c = decodePolyline(r.geom_lo || r.geom); r.country = countriesFor(countries, [c[0], c[c.length - 1]]); }
    } catch (_) { /* countries are optional */ }
    try {
      const { data } = await api('POST', '/api/routes/import', { routes });
      await loadRoutes(true);
      help.innerHTML = `<span class="status-new">Added ${data.inserted.length} leg${data.inserted.length === 1 ? '' : 's'} from ${flights.length} flight${flights.length === 1 ? '' : 's'}.</span>${data.skipped.length ? ` ${data.skipped.length} already there.` : ''}${errors.length ? `<br><span class="status-err">${esc(errors.join(' · '))}</span>` : ''}`;
      ff.lines.value = errors.length ? ff.lines.value : '';
    } catch (err) { toast(err.message, 'err'); }
  };

  // Strava
  stravaCard($('#strava', el), $('#stravaState', el));

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

let airportsP = null;
const airportList = () => (airportsP = airportsP || fetch('/data/airports.json').then((r) => r.json()));

async function stravaCard(host, stateEl) {
  let st;
  try { st = (await api('GET', '/api/strava')).data; } catch (e) { host.innerHTML = `<p class="help">${esc(e.message)}</p>`; return; }
  if (!st.configured) {
    host.innerHTML = `<p class="help">Import walks, hikes, rides and ski days straight from Strava at full GPS detail. One-time setup (Rory, 3 minutes):</p>
      <ol class="help" style="margin:0;padding-left:18px"><li>At <span class="mono">strava.com/settings/api</span> create an application; set <em>Authorization Callback Domain</em> to <span class="mono">${esc(st.callbackDomain)}</span>.</li>
      <li>In Terminal, in the Travel-mapping folder: <span class="mono">npx wrangler secret put STRAVA_CLIENT_ID</span>, then <span class="mono">STRAVA_CLIENT_SECRET</span>.</li></ol>
      <p class="help">Then each of you clicks “Connect Strava” here.</p>`;
    return;
  }
  if (!st.connected) {
    if (/strava=denied/.test(location.hash)) host.insertAdjacentHTML('beforeend', '<div class="notice warn">Strava wasn\'t connected.</div>');
    host.innerHTML += `<p class="help">Connect your Strava account to pick activities to import. Read-only — Trip Atlas never changes anything on Strava.</p><a class="btn primary" href="/strava/connect">Connect Strava</a>`;
    return;
  }
  stateEl.textContent = `Connected as ${st.athlete || 'you'}`;
  host.innerHTML = `<div class="field-row"><div class="field"><label>From</label><input class="input sm" type="date" id="sFrom" value="${esc(store.trip.trip_start || '')}"></div><div class="field"><label>To</label><input class="input sm" type="date" id="sTo"></div></div>
    <div class="toolbar"><button class="btn sm" id="sLoad">Show activities</button><button class="btn ghost sm" id="sOff">Disconnect</button></div><div id="sList"></div>`;
  let page = 1, acts = [];
  const load = async (more) => {
    page = more ? page + 1 : 1;
    const q = new URLSearchParams({ page, per_page: 60 });
    if ($('#sFrom', host).value) q.set('after', $('#sFrom', host).value);
    if ($('#sTo', host).value) q.set('before', $('#sTo', host).value);
    $('#sList', host).innerHTML = '<span class="spinner"></span>';
    try {
      const { data } = await api('GET', `/api/strava/activities?${q}`);
      acts = more ? acts.concat(data.activities) : data.activities;
      $('#sList', host).innerHTML = acts.length ? `<div class="preview-wrap" style="max-height:320px"><table class="rt"><colgroup><col style="width:28px"><col><col style="width:84px"><col style="width:56px"></colgroup><tbody>
        ${acts.map((a, i) => `<tr><td><input type="checkbox" data-i="${i}" ${a.imported || !a.hasMap ? 'disabled' : ''} ${!a.imported && a.hasMap ? 'checked' : ''}></td><td title="${esc(a.sport)}">${esc(a.name)}<div class="help">${esc(a.sport)}${a.imported ? ' · already here' : !a.hasMap ? ' · no GPS' : ''}</div></td><td>${esc(fmtDate(a.date))}</td><td class="num">${a.km}</td></tr>`).join('')}
        </tbody></table></div><div class="toolbar" style="margin-top:8px">${data.activities.length === 60 ? '<button class="btn ghost sm" id="sMore">Load more</button>' : ''}<button class="btn primary sm" id="sImport">Import selected</button></div>` : '<p class="help">No activities in those dates.</p>';
      const moreBtn = $('#sMore', host); if (moreBtn) moreBtn.onclick = () => load(true);
      $('#sImport', host) && ($('#sImport', host).onclick = importSel);
    } catch (e) { $('#sList', host).innerHTML = `<p class="status-err">${esc(e.message)}</p>`; }
  };
  const importSel = async () => {
    const ids = [...host.querySelectorAll('[data-i]:checked')].map((c) => acts[+c.dataset.i].id);
    if (!ids.length) return;
    const btn = $('#sImport', host); btn.disabled = true;
    let added = 0, skipped = 0, failed = 0;
    let countries = null; try { countries = await loadCountries(); } catch (_) { /* optional */ }
    for (let i = 0; i < ids.length; i += 15) {
      btn.textContent = `Importing ${Math.min(i + 15, ids.length)} of ${ids.length}…`;
      try {
        const { data } = await api('POST', '/api/strava/import', { ids: ids.slice(i, i + 15) });
        failed += data.failed.length;
        if (countries) for (const r of data.routes) r.country = countriesFor(countries, decodePolyline(r.geom_lo || r.geom));
        if (data.routes.length) { const res = (await api('POST', '/api/routes/import', { routes: data.routes })).data; added += res.inserted.length; skipped += res.skipped.length; }
      } catch (e) { toast(e.message, 'err'); break; }
    }
    await loadRoutes(true);
    toast(`Imported ${added} from Strava${skipped ? `, ${skipped} already here` : ''}${failed ? `, ${failed} without GPS` : ''}`);
    load();
  };
  $('#sLoad', host).onclick = () => load();
  $('#sOff', host).onclick = async () => { await api('DELETE', '/api/strava'); stravaCard(host, stateEl); stateEl.textContent = ''; };
}
