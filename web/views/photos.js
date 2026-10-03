// #/photos — drop photos; they're placed on the trip by GPS, or by time along
// the route you were on, or by date. Shown on the map and in the trip film.
//
// Everything heavy is in the browser: EXIF (exifr), orientation, resizing to
// a 2048 px JPEG + 480 px thumbnail. Originals never leave the computer.
import { store, api, esc, $, toast, modal, confirm, fmtDate } from '../app.js';
import { placePhoto, exifTime } from '../lib/photos.js';

const EXIFR = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs';
let photos = [];
export const photoUrl = (p, size = 'thumb') => `/api/photo-file/${p.sha}/${size}`;

export async function loadPhotos() {
  photos = (await api('GET', '/api/photos')).data.photos;
  store.photos = photos;
  return photos;
}

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function shrink(bitmap, max, quality) {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(bitmap, 0, 0, w, h);
  return { blob: await c.convertToBlob({ type: 'image/jpeg', quality }), w, h };
}

// One file → { record, full, thumb } or throws a readable error.
async function prepare(file, exifr) {
  const buf = await file.arrayBuffer();
  const sha = await sha256(buf);
  let meta = {};
  // No `pick` list: exifr needs GPSLatitudeRef/GPSLongitudeRef to sign the
  // coordinates — without them every photo in the Americas lands in Asia.
  try { meta = (await exifr.parse(buf, { gps: true, exif: true, tiff: true, ifd1: false, iptc: false, xmp: false, icc: false, jfif: false })) || {}; } catch (_) { /* no EXIF */ }
  let bitmap;
  try { bitmap = await createImageBitmap(new Blob([buf], { type: file.type || 'image/jpeg' }), { imageOrientation: 'from-image' }); } catch (_) {
    throw new Error(/heic|heif/i.test(file.name) ? 'HEIC can\'t be read by this browser — export as JPEG (Photos → File → Export), or use Safari' : 'not an image this browser can read');
  }
  const full = await shrink(bitmap, 2048, 0.86), thumb = await shrink(bitmap, 480, 0.8);
  bitmap.close();
  const t = exifTime(meta.DateTimeOriginal || meta.CreateDate, meta.OffsetTimeOriginal);
  const lat = Number.isFinite(meta.latitude) ? meta.latitude : null, lon = Number.isFinite(meta.longitude) ? meta.longitude : null;
  const place = placePhoto({ lat, lon, taken_at: t.taken_at, date: t.date }, store.routes);
  return { record: { sha, file_name: file.name, taken_at: t.taken_at, date: t.date, ...place, width: full.w, height: full.h }, full: full.blob, thumb: thumb.blob };
}

export async function render(el) {
  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Photos</h1><p>Drop photos and they're placed on the trip — by GPS if the photo has it, otherwise along the route you were on at that time, otherwise on that day. They show on the map and pop up in the trip film.</p></div>
      <div class="toolbar"><a class="btn" href="#/map?photos=1">See them on the map</a></div></div>
    <div class="drop" id="drop"><h3>Drop photos here (JPEG, PNG; HEIC in Safari)</h3>
      <p class="muted">They're resized on this computer to 2048 px before uploading — originals stay with you.</p>
      <div class="toolbar"><label class="btn primary">Choose photos<input type="file" id="pick" multiple accept="image/*,.heic,.heif" hidden></label><label class="btn">Choose a folder<input type="file" id="pickDir" webkitdirectory multiple hidden></label></div></div>
    <div id="work" style="margin-top:16px"></div>
    <div class="row-between" style="margin:18px 0 10px"><div class="chip-row" id="filters"></div><span class="help" id="count"></span></div>
    <div id="grid"></div></div>`;
  let filter = 'all';
  await loadPhotos();

  function draw() {
    const groups = { all: photos, unplaced: photos.filter((p) => p.lat == null), film: photos.filter((p) => p.in_film && !p.hidden), approx: photos.filter((p) => p.place_source === 'route-date') };
    $('#filters', el).innerHTML = [['all', 'All'], ['unplaced', 'Not on the map'], ['approx', 'Placed by date only'], ['film', 'In the film']]
      .map(([id, l]) => `<button class="chip filter-chip ${filter === id ? 'on' : ''}" data-f="${id}">${l} ${groups[id].length}</button>`).join('');
    const list = groups[filter];
    $('#count', el).textContent = `${list.length} photo${list.length === 1 ? '' : 's'}`;
    const byDay = new Map();
    for (const p of list) { const k = p.date || 'No date'; (byDay.get(k) || byDay.set(k, []).get(k)).push(p); }
    $('#grid', el).innerHTML = list.length ? [...byDay].map(([d, ps]) => `<div class="section-title" style="margin-top:14px">${d === 'No date' ? d : esc(fmtDate(d))} <span class="muted" style="text-transform:none;letter-spacing:0">· ${ps.length}</span></div>
      <div class="photo-grid">${ps.map((p) => `<button class="photo-tile ${p.lat == null ? 'unplaced' : ''}" data-id="${p.id}" style="background-image:url(${photoUrl(p)})" title="${esc(p.caption || p.file_name || '')}">${p.caption ? `<span class="badge">${esc(p.caption.slice(0, 28))}</span>` : ''}</button>`).join('')}</div>`).join('')
      : '<div class="empty"><h3>No photos here yet</h3></div>';
  }
  draw();

  $('#filters', el).onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } };
  $('#grid', el).onclick = (e) => { const t = e.target.closest('[data-id]'); if (t) openPhoto(+t.dataset.id, async () => { await loadPhotos(); draw(); }); };

  const drop = $('#drop', el);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); });
  $('#pick', el).onchange = (e) => upload([...e.target.files]);
  $('#pickDir', el).onchange = (e) => upload([...e.target.files]);

  async function upload(files) {
    files = files.filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png)$/i.test(f.name));
    if (!files.length) { toast('No photos there', 'err'); return; }
    const known = new Set(photos.map((p) => p.sha));
    const work = $('#work', el);
    work.innerHTML = `<div class="card card-pad stack"><div class="row-between"><strong id="stage">Reading ${files.length} photos…</strong><span class="muted" id="pct"></span></div><div class="progress"><i id="bar"></i></div></div>`;
    const exifr = (await import(EXIFR)).default;
    const queue = files.slice(), problems = [], ready = [];
    let done = 0, placed = 0, uploaded = 0;
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          const p = await prepare(f, exifr);
          if (known.has(p.record.sha)) { done++; continue; }
          known.add(p.record.sha);
          await api('PUT', `/api/photo-file/${p.record.sha}/thumb`, p.thumb, { headers: { 'Content-Type': 'image/jpeg' } });
          await api('PUT', `/api/photo-file/${p.record.sha}/full`, p.full, { headers: { 'Content-Type': 'image/jpeg' } });
          ready.push(p.record); uploaded++;
          if (p.record.lat != null) placed++;
          if (ready.length >= 25) await api('POST', '/api/photos', { photos: ready.splice(0) });
        } catch (e) { problems.push(`${f.name}: ${e.message}`); }
        done++;
        $('#bar', work).style.width = `${Math.round((done / files.length) * 100)}%`;
        $('#pct', work).textContent = `${done} / ${files.length}`;
        $('#stage', work).textContent = `Placing and uploading… ${f.name}`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (ready.length) await api('POST', '/api/photos', { photos: ready });
    await loadPhotos();
    work.innerHTML = `<div class="card card-pad stack"><div class="notice ok"><strong>${uploaded} photo${uploaded === 1 ? '' : 's'} added</strong> — ${placed} placed on the map${uploaded - placed ? `, ${uploaded - placed} still need a place (see “Not on the map”)` : ''}.${files.length - uploaded - problems.length ? ` ${files.length - uploaded - problems.length} were already here.` : ''}</div>
      ${problems.length ? `<details class="notice warn"><summary>${problems.length} couldn't be read</summary>${problems.slice(0, 40).map((p) => `<div>${esc(p)}</div>`).join('')}</details>` : ''}</div>`;
    draw();
  }
}

// Lightbox + edit. Used here and from the map.
export async function openPhoto(id, onChange) {
  if (!photos.length) await loadPhotos();
  const p = photos.find((x) => x.id === id);
  if (!p) return;
  const routesThatDay = store.routes.filter((r) => r.date && r.date === p.date);
  const body = document.createElement('form');
  body.className = 'stack';
  body.innerHTML = `<img class="lightbox" src="${photoUrl(p, 'full')}" alt="${esc(p.caption || p.file_name || 'Photo')}">
    <div class="field"><label>Caption</label><input class="input" name="caption" value="${esc(p.caption || '')}" placeholder="Shown in the film"></div>
    <div class="field-row"><div class="field"><label>Date</label><input class="input" type="date" name="date" value="${esc(p.date || '')}"></div>
      <div class="field"><label>Taken on</label><select class="select" name="route"><option value="">—</option>${routesThatDay.map((r) => `<option value="${r.id}" ${r.id === p.route_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div></div>
    <label class="switch"><input type="checkbox" name="in_film" ${p.in_film ? 'checked' : ''}><span class="track"></span>Show in the trip film</label>
    <p class="help">${p.place_source === 'gps' ? 'Placed by the photo’s GPS.' : p.place_source === 'route-time' ? 'Placed along the route by the time it was taken.' : p.place_source === 'route-date' ? 'Placed roughly — by date only. Pick the route it was taken on to move it.' : 'Not on the map yet — set a date and pick a route.'}${p.file_name ? ` · ${esc(p.file_name)}` : ''}</p>`;
  const act = await modal({ title: p.date ? fmtDate(p.date) : 'Photo', body, wide: true, actions: [{ label: 'Delete', value: 'delete', danger: true }, { label: 'Close', value: null }, { label: 'Save', value: 'save', primary: true }] });
  if (act === 'delete') {
    if (!(await confirm('Delete photo', 'Remove this photo from the trip for both of you?', 'Delete', true))) return;
    await api('DELETE', '/api/photos', { ids: [p.id] });
    toast('Deleted'); onChange && onChange();
  } else if (act === 'save') {
    const f = body.elements, fields = { caption: f.caption.value, date: f.date.value || null, in_film: f.in_film.checked };
    const rid = f.route.value ? +f.route.value : null;
    if (rid && rid !== p.route_id) {
      const { pointAlong } = await import('../lib/photos.js');
      const r = store.route(rid);
      const [lon, lat] = pointAlong(r.coords, 0.5);
      Object.assign(fields, { route_id: rid, lat, lon, place_source: 'manual' });
    }
    try { await api('PATCH', '/api/photos', { ids: [p.id], fields }); toast('Saved'); onChange && onChange(); } catch (e) { toast(e.message, 'err'); }
  }
}
