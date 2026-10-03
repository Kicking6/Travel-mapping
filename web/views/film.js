// #/film — the trip as a film: the pen draws each journey in date order, the
// camera glides between places, photos pop up where they were taken, and a
// ticker counts the days and kilometres. Preview live; render a real MP4
// (H.264 via WebCodecs, muxed with mp4-muxer) frame by frame, so every frame
// waits for its map tiles — no dropped frames, no blank tiles, up to 4K/60.
import { store, legFor, esc, $, toast, fmtDate, applyFilter } from '../app.js';
import { createAtlas } from '../map/atlas.js';
import { resolveStyle, TITLE_FONTS } from '../lib/style.js';
import { TYPES } from '../lib/types.js';
import { buildTimeline, FILM_SIZES } from '../lib/film.js';
import { download } from '../map/render.js';

const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';
const PREF = 'ta-film';
const DEFAULTS = { size: '1080p', fps: 30, seconds: 120, group: 'week', styleId: null, photos: true, photoSeconds: 2.4, pitch: 0, drift: false, from: '', to: '', types: [], title: '', quality: 'high', ticker: true, font: 'sans' };
const loadPrefs = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch (_) { return { ...DEFAULTS }; } };
const savePrefs = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (_) { /* private mode */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Overlay: title card, captions, km ticker, photo card ─────────────────
export function drawOverlay(ctx, W, H, fr, o, images) {
  ctx.clearRect(0, 0, W, H);
  if (!fr) return;
  const u = Math.min(W, H) / 1080, font = (TITLE_FONTS.find((f) => f.id === o.font) || TITLE_FONTS[0]).css;
  const fade = (f, a = 0.15) => Math.min(1, f / a, (1 - f) / a);

  if (fr.card) {
    const a = fr.card.kind === 'title' ? Math.min(1, (1 - fr.card.f) / 0.25) : Math.min(1, fr.card.f / 0.3);
    ctx.save(); ctx.globalAlpha = Math.max(0, a) * 0.55;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(8,12,20,0.2)'); g.addColorStop(1, 'rgba(8,12,20,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = `700 ${78 * u}px ${font}`;
    ctx.fillText(o.title || 'Our OE', W / 2, H / 2);
    ctx.font = `400 ${30 * u}px ${font}`;
    ctx.fillText(fr.card.kind === 'title' ? o.subtitle : `${Math.round(fr.km).toLocaleString('en-NZ')} km · ${o.countries} countries · ${o.days} days`, W / 2, H / 2 + 56 * u);
    ctx.restore();
  }
  if (fr.caption && o.ticker) {
    const a = fade(fr.caption.f, 0.2);
    ctx.save(); ctx.globalAlpha = a;
    const x = 48 * u, y = H - 64 * u;
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 12 * u;
    ctx.fillStyle = '#fff'; ctx.font = `600 ${22 * u}px ${font}`;
    const d = fr.caption.date ? new Date(fr.caption.date + 'T00:00:00Z').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
    const day = fr.caption.date && o.tripStart ? Math.round((Date.parse(fr.caption.date) - Date.parse(o.tripStart)) / 86400000) + 1 : null;
    ctx.fillText(`${d}${day > 0 ? `  ·  Day ${day}` : ''}`, x, y - 36 * u);
    ctx.font = `700 ${34 * u}px ${font}`;
    ctx.fillText(fr.caption.name || '', x, y);
    ctx.restore();
  }
  if (o.ticker && !fr.card) {
    ctx.save(); ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 12 * u;
    ctx.font = `700 ${34 * u}px ${font}`; ctx.fillText(`${Math.round(fr.km).toLocaleString('en-NZ')} km`, W - 48 * u, H - 64 * u);
    ctx.restore();
  }
  if (fr.photo && images.get(fr.photo.id)) {
    const img = images.get(fr.photo.id), f = fr.photo.f;
    const s = Math.min(1, f / 0.18, (1 - f) / 0.18), e = 1 - (1 - Math.max(0, s)) ** 3;
    const maxW = W * 0.42, maxH = H * 0.62, k = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * k, h = img.height * k, border = 14 * u, cap = fr.photo.caption ? 46 * u : border;
    ctx.save();
    ctx.translate(W * 0.68, H * 0.46); ctx.rotate((((fr.photo.id % 7) - 3) * Math.PI) / 360); ctx.scale(0.85 + 0.15 * e, 0.85 + 0.15 * e); ctx.globalAlpha = e;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30 * u; ctx.shadowOffsetY = 10 * u;
    ctx.fillStyle = '#fff'; ctx.fillRect(-w / 2 - border, -h / 2 - border, w + border * 2, h + border + cap);
    ctx.shadowColor = 'transparent';
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    if (fr.photo.caption) { ctx.fillStyle = '#222'; ctx.font = `500 ${22 * u}px ${font}`; ctx.textAlign = 'center'; ctx.fillText(fr.photo.caption, 0, h / 2 + 32 * u, w); }
    ctx.restore();
  }
}

// Apply a frame to a live atlas. `last` caches what's already set.
function applyFrame(atlas, fr, spec, last) {
  if (!fr) return;
  atlas.map.jumpTo(fr.camera);
  const key = fr.done.size;
  if (last.done !== key) { atlas.setVisible([...fr.done]); last.done = key; }
  if (fr.active) {
    const ts = spec.routes[fr.active.type] || spec.routes.other;
    atlas.setActive(fr.active.coords, { color: ts.color, width: ts.width * 1.5 + 0.5, head: ts.width * 1.5 + 3 });
    last.active = true;
  } else if (last.active) { atlas.setActive(null); last.active = false; }
}

export async function render(el) {
  const prefs = loadPrefs();
  prefs.styleId = store.styles.some((s) => s.id === prefs.styleId) ? prefs.styleId : store.styles[0].id;
  let photos = [];
  try { photos = (await import('./photos.js').then((m) => m.loadPhotos())).filter((p) => p.in_film && !p.hidden); } catch (_) { /* no photos yet */ }

  el.innerHTML = `<div class="ws ws-2"><aside class="ws-panel"><div class="ws-panel-body" style="padding:14px 16px;display:flex;flex-direction:column;gap:12px" id="panel">
      <div><h3 style="font-size:var(--fs-lg)">Trip film</h3><p class="help">The pen draws each journey in date order; photos pop up where they were taken.</p></div>
      <div class="field"><label>Title</label><input class="input" name="title" value="${esc(prefs.title || store.trip.trip_name || 'Our OE')}"></div>
      <div class="field-row"><div class="field"><label>From</label><input class="input" type="date" name="from" value="${esc(prefs.from)}"></div><div class="field"><label>To</label><input class="input" type="date" name="to" value="${esc(prefs.to)}"></div></div>
      <div class="field"><label>Transport <span class="muted">(none = all)</span></label><div class="chip-row" id="types">${TYPES.map((t) => `<button type="button" class="chip filter-chip ${prefs.types.includes(t.id) ? 'on' : ''}" data-type="${t.id}"><span class="type-dot" style="background:${t.color}"></span>${esc(t.label.split(' /')[0])}</button>`).join('')}</div></div>
      <label class="range-line"><span>Length</span><input type="range" name="seconds" min="20" max="600" step="10" value="${prefs.seconds}"><output id="secOut"></output></label>
      <div class="field"><label>Pace</label><select class="select" name="group"><option value="day" ${prefs.group === 'day' ? 'selected' : ''}>A beat per day</option><option value="week" ${prefs.group === 'week' ? 'selected' : ''}>A beat per week</option><option value="leg" ${prefs.group === 'leg' ? 'selected' : ''}>A beat per leg</option></select></div>
      <div class="field"><label>Map style</label><select class="select" name="styleId">${store.styles.map((s) => `<option value="${s.id}" ${s.id === prefs.styleId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <label class="range-line"><span>Camera tilt</span><input type="range" name="pitch" min="0" max="60" step="5" value="${prefs.pitch}"><output id="pitchOut"></output></label>
      <label class="switch"><input type="checkbox" name="drift" ${prefs.drift ? 'checked' : ''}><span class="track"></span>Slow camera drift</label>
      <label class="switch"><input type="checkbox" name="ticker" ${prefs.ticker ? 'checked' : ''}><span class="track"></span>Dates, names & km counter</label>
      <label class="switch"><input type="checkbox" name="photos" ${prefs.photos ? 'checked' : ''}><span class="track"></span>Photos (${photos.length} marked for the film)</label>
      <label class="range-line"><span>Each photo</span><input type="range" name="photoSeconds" min="1" max="6" step="0.2" value="${prefs.photoSeconds}"><output id="phOut"></output></label>
      <div class="field"><label>Lettering</label><select class="select" name="font">${TITLE_FONTS.map((f) => `<option value="${f.id}" ${prefs.font === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></div>
      <div class="style-group stack"><div class="section-title">Video file</div>
        <div class="field"><label>Size</label><select class="select" name="size">${FILM_SIZES.map((s) => `<option value="${s.id}" ${prefs.size === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>
        <div class="field-row"><div class="field"><label>Frame rate</label><select class="select" name="fps"><option value="24" ${prefs.fps == 24 ? 'selected' : ''}>24 fps (cinematic)</option><option value="30" ${prefs.fps == 30 ? 'selected' : ''}>30 fps</option><option value="60" ${prefs.fps == 60 ? 'selected' : ''}>60 fps (smoothest)</option></select></div>
        <div class="field"><label>Quality</label><select class="select" name="quality"><option value="standard" ${prefs.quality === 'standard' ? 'selected' : ''}>Standard</option><option value="high" ${prefs.quality === 'high' ? 'selected' : ''}>High</option><option value="max" ${prefs.quality === 'max' ? 'selected' : ''}>Maximum</option></select></div></div>
        <button class="btn primary" id="renderBtn">Render MP4</button>
        <div class="help" id="renderInfo"></div>
        <div class="progress" id="renderBar" hidden><i></i></div>
        <p class="help">Rendering draws every frame at full quality, so it takes longer than the film — keep this tab in front. Add music afterwards in iMovie, CapCut or Premiere.</p>
      </div>
    </div></aside>
    <section class="ws-map"><div class="film-stage" id="stage"><div class="film-frame" id="frame"><div class="map" id="map"></div><canvas class="film-overlay" id="overlay"></canvas></div></div>
      <div class="map-float film-bar"><button class="btn sm primary" id="play">Play</button><input type="range" id="scrub" min="0" max="1000" value="0"><span class="mono help" id="clock">0:00</span></div></section></div>`;

  const panel = $('#panel', el);
  const size = () => FILM_SIZES.find((s) => s.id === prefs.size) || FILM_SIZES[0];
  const spec = () => resolveStyle(store.style(prefs.styleId).spec);
  const routes = () => applyFilter(store.routes, { from: prefs.from || null, to: prefs.to || null, types: prefs.types }).filter((r) => r.date);
  const countries = (rs) => new Set(rs.flatMap((r) => (r.country || '').split(',').map((c) => c.trim())).filter(Boolean)).size;
  const days = (rs) => new Set(rs.map((r) => r.date)).size;

  // Preview frame: the video's aspect, fitted to the stage.
  const stage = $('#stage', el), frameEl = $('#frame', el), overlay = $('#overlay', el);
  let pw = 0, ph = 0;
  function layout() {
    const s = size(), sw = stage.clientWidth - 40, sh = stage.clientHeight - 90;
    const k = Math.min(sw / s.w, sh / s.h);
    pw = Math.round(s.w * k); ph = Math.round(s.h * k);
    Object.assign(frameEl.style, { width: `${pw}px`, height: `${ph}px` });
    overlay.width = pw * devicePixelRatio; overlay.height = ph * devicePixelRatio;
    overlay.style.width = `${pw}px`; overlay.style.height = `${ph}px`;
  }
  layout();
  const atlas = await createAtlas($('#map', el), { spec: spec(), interactive: false, attribution: false });
  let tl = null, t = 0, playing = false, raf = 0;
  const last = {}, images = new Map();

  const overlayOpts = (rs) => ({ title: prefs.title || store.trip.trip_name || 'Our OE', subtitle: subtitleFor(rs), countries: countries(rs), days: days(rs), tripStart: store.trip.trip_start, ticker: prefs.ticker, font: prefs.font });
  function subtitleFor(rs) {
    const d = rs.map((r) => r.date).sort();
    return d.length ? `${fmtDate(d[0])} – ${fmtDate(d[d.length - 1])}` : '';
  }
  // The timeline is laid out for the preview frame's size so the camera
  // framing matches; the renderer rebuilds it at the video's CSS size.
  function rebuild() {
    const rs = routes();
    tl = buildTimeline(rs, prefs.photos ? photos : [], { W: pw, H: ph, seconds: prefs.seconds, group: prefs.group, legFor, photoSeconds: prefs.photoSeconds, pitch: prefs.pitch, drift: prefs.drift });
    atlas.setRoutes(rs);
    last.done = -1;
    $('#secOut', el).textContent = `${Math.floor(prefs.seconds / 60)}:${String(prefs.seconds % 60).padStart(2, '0')}`;
    $('#pitchOut', el).textContent = `${prefs.pitch}°`;
    $('#phOut', el).textContent = `${(+prefs.photoSeconds).toFixed(1)} s`;
    const frames = Math.round(tl.duration * prefs.fps);
    $('#renderInfo', el).textContent = tl.duration ? `${rs.length} routes in ${tl.groups.length} beats · ${Math.round(tl.duration)} s · ${size().w}×${size().h} · ${frames.toLocaleString()} frames` : 'No dated routes match.';
    t = Math.min(t, tl.duration);
    draw();
  }
  function draw() {
    if (!tl || !tl.duration) return;
    const fr = tl.frame(t);
    applyFrame(atlas, fr, spec(), last);
    const ctx = overlay.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    drawOverlay(ctx, pw, ph, fr, overlayOpts(routes()), images);
    $('#scrub', el).value = Math.round((t / tl.duration) * 1000);
    $('#clock', el).textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} / ${Math.floor(tl.duration / 60)}:${String(Math.round(tl.duration % 60)).padStart(2, '0')}`;
  }
  async function loadImages() {
    for (const p of photos) {
      if (images.has(p.id)) continue;
      try { images.set(p.id, await createImageBitmap(await (await fetch(`/api/photo-file/${p.sha}/full`)).blob())); } catch (_) { /* skip */ }
    }
  }
  loadImages();

  let lastTs = 0;
  function loop(ts) {
    if (!playing) return;
    t += Math.min(0.1, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;
    if (t >= tl.duration) { t = tl.duration; playing = false; $('#play', el).textContent = 'Play'; }
    draw();
    raf = requestAnimationFrame(loop);
  }
  $('#play', el).onclick = () => {
    playing = !playing; $('#play', el).textContent = playing ? 'Pause' : 'Play';
    if (playing) { if (t >= tl.duration - 0.05) t = 0; lastTs = 0; raf = requestAnimationFrame(loop); }
  };
  $('#scrub', el).oninput = (e) => { t = (e.target.value / 1000) * tl.duration; draw(); };

  panel.addEventListener('input', async (e) => {
    const n = e.target.name; if (!n) return;
    prefs[n] = e.target.type === 'checkbox' ? e.target.checked : ['seconds', 'pitch', 'photoSeconds', 'fps', 'styleId'].includes(n) ? +e.target.value : e.target.value;
    savePrefs(prefs);
    if (n === 'styleId') await atlas.setSpec(spec());
    if (n === 'size') { layout(); atlas.map.resize(); }
    rebuild();
  });
  $('#types', el).onclick = (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    const ty = b.dataset.type;
    prefs.types = prefs.types.includes(ty) ? prefs.types.filter((x) => x !== ty) : [...prefs.types, ty];
    b.classList.toggle('on'); savePrefs(prefs); rebuild();
  };
  const ro = new ResizeObserver(() => { layout(); atlas.map.resize(); rebuild(); });
  ro.observe(stage);

  let cancel = null;
  $('#renderBtn', el).onclick = async () => {
    if (cancel) { cancel(); return; }
    playing = false;
    const btn = $('#renderBtn', el), bar = $('#renderBar', el), info = $('#renderInfo', el);
    let stop = false;
    cancel = () => { stop = true; };
    btn.textContent = 'Cancel render'; bar.hidden = false;
    const onHide = () => { if (document.hidden) toast('Rendering pauses while this tab is in the background — bring it back to finish', 'err'); };
    document.addEventListener('visibilitychange', onHide);
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch (_) { /* optional */ }
    try {
      await loadImages();
      const res = await renderFilm({
        size: size(), fps: prefs.fps, quality: prefs.quality, spec: spec(), routes: routes(), photos: prefs.photos ? photos : [], prefs, images,
        overlay: overlayOpts(routes()), shouldStop: () => stop,
        onProgress: (i, n, eta) => { bar.firstElementChild.style.width = `${(i / n) * 100}%`; info.textContent = `Frame ${i.toLocaleString()} of ${n.toLocaleString()} · about ${eta} left`; },
      });
      if (res) {
        if (res.blob) download(res.blob, `${(prefs.title || 'Trip film').replace(/[^\w\- ]+/g, '')} — ${size().w}x${size().h} ${prefs.fps}fps.mp4`);
        info.textContent = `Done — ${res.frames.toLocaleString()} frames${res.blob ? `, ${(res.blob.size / 1e6).toFixed(0)} MB` : ' saved to your file'} in ${Math.round(res.seconds)} s.`;
      } else info.textContent = 'Render cancelled.';
    } catch (e) { toast(e.message, 'err'); info.textContent = ''; }
    finally {
      document.removeEventListener('visibilitychange', onHide);
      try { await wake?.release(); } catch (_) { /* already released */ }
      cancel = null; btn.textContent = 'Render MP4'; bar.hidden = true;
    }
  };

  rebuild();
  return () => { playing = false; cancelAnimationFrame(raf); ro.disconnect(); atlas.destroy(); if (cancel) cancel(); };
}

// ── Offline render ───────────────────────────────────────────────────────
async function pickCodec(w, h, fps, bitrate) {
  for (const codec of ['avc1.640034', 'avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.42003e']) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (_) { /* try next */ }
  }
  return null;
}

// Wait until every tile in view is drawn. Uses map.redraw() (synchronous)
// in a short poll rather than the render loop, so it keeps working even if
// the browser throttles animation frames.
async function settle(map) {
  for (let k = 0; k < 400; k++) {
    map.redraw();
    if (map.areTilesLoaded() && map.isStyleLoaded()) { map.redraw(); return; }
    await sleep(k < 20 ? 10 : 40);
  }
  map.redraw();
}

export async function renderFilm({ size, fps, quality, spec, routes, photos, prefs, images, overlay, shouldStop, onProgress }) {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser can\'t encode video — use Chrome, Edge or Safari 17+.');
  const { w: W, h: H } = size;
  const ratio = W >= 2500 || H >= 2500 ? 2 : 1;           // 4K is 1080p's layout drawn twice as sharp
  const cssW = W / ratio, cssH = H / ratio;
  const bitrate = Math.round(W * H * fps * { standard: 0.08, high: 0.14, max: 0.22 }[quality || 'high']);
  const cfg = await pickCodec(W, H, fps, bitrate);
  if (!cfg) throw new Error(`This computer can't encode H.264 at ${W}×${H} — try 1080p.`);
  const { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } = await import(MUXER);

  // Big files stream straight to disk where the browser allows it.
  let fileStream = null;
  const tl = buildTimeline(routes, photos, { W: cssW, H: cssH, seconds: prefs.seconds, group: prefs.group, legFor, photoSeconds: prefs.photoSeconds, pitch: prefs.pitch, drift: prefs.drift });
  const n = Math.round(tl.duration * fps);
  if (window.showSaveFilePicker && (W * H * n > 1920 * 1080 * 30 * 120)) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: `${(prefs.title || 'Trip film').replace(/[^\w\- ]+/g, '')}.mp4`, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      fileStream = await h.createWritable();
    } catch (_) { /* fall back to memory */ }
  }
  const target = fileStream ? new FileSystemWritableFileStreamTarget(fileStream) : new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: fileStream ? false : 'in-memory' });
  let encErr = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  encoder.configure(cfg);

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${cssW + 400}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none;`;
  document.body.append(host);
  const atlas = await createAtlas(host, { spec, interactive: false, pixelRatio: ratio, preserveDrawingBuffer: true, attribution: false, camera: tl.frame(0).camera });
  atlas.setRoutes(routes);
  const out = new OffscreenCanvas(W, H), ctx = out.getContext('2d');
  const ov = new OffscreenCanvas(W, H), octx = ov.getContext('2d');
  const last = {};
  const t0 = performance.now();
  try {
    for (let i = 0; i < n; i++) {
      if (shouldStop()) { encoder.close(); if (fileStream) await fileStream.abort?.(); return null; }
      if (encErr) throw encErr;
      const fr = tl.frame(i / fps);
      applyFrame(atlas, fr, spec, last);
      await settle(atlas.map);
      ctx.drawImage(atlas.map.getCanvas(), 0, 0, W, H);
      octx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawOverlay(octx, cssW, cssH, fr, overlay, images);
      ctx.drawImage(ov, 0, 0);
      const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 6) await sleep(2);
      if (i % 10 === 0) {
        const per = (performance.now() - t0) / (i + 1), left = ((n - i) * per) / 1000;
        onProgress(i, n, left > 90 ? `${Math.round(left / 60)} min` : `${Math.round(left)} s`);
      }
    }
    await encoder.flush();
    muxer.finalize();
    const seconds = (performance.now() - t0) / 1000;
    if (fileStream) { await fileStream.close(); return { frames: n, seconds }; }
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), frames: n, seconds };
  } finally {
    try { if (encoder.state !== 'closed') encoder.close(); } catch (_) { /* closed */ }
    atlas.destroy(); host.remove();
  }
}
