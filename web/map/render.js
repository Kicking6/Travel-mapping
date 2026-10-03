// Print & image export. The legacy app grabbed the on-screen view (~2–3k px)
// and stretched it to 10,000 px. Here the map is re-rendered offscreen at the
// real print size: vector tiles and routes are drawn at
// `pixelRatio = outputPx / compositionPx`, so every line and label is sharp.
//
// "Composition" fixes the page layout independent of the browser window:
// zoom, line widths and label sizes are worked out for a page `composition`
// CSS px wide, then drawn at output resolution. The same function renders
// the preview, so preview = print.
//
// Pipeline: renderMap (one of 'all' | 'base' | 'overlay') → finish (tint,
// grain, vignette, border) → decor (title, subtitle, legend, scale bar,
// north arrow) → encode (PNG/JPEG/WebP/PDF/SVG/ZIP of layers).
import { createAtlas } from './atlas.js';
import { TITLE_FONTS, DASHES, PLACE_KINDS } from '../lib/style.js';
import { typeById } from '../lib/types.js';
import { pngWithDpi, jpegWithDpi, buildPdf, buildSvg, buildZip } from '../lib/outputs.js';

export const PAPER_PRESETS = [
  { id: 'sq30', label: '30 × 30 cm square', w: 300, h: 300 },
  { id: 'sq20', label: '20 × 20 cm square', w: 200, h: 200 },
  { id: 'sq12in', label: '12 × 12 in square', w: 304.8, h: 304.8 },
  { id: 'a4p', label: 'A4 portrait', w: 210, h: 297 },
  { id: 'a4l', label: 'A4 landscape', w: 297, h: 210 },
  { id: 'a3l', label: 'A3 landscape', w: 420, h: 297 },
  { id: 'a3p', label: 'A3 portrait', w: 297, h: 420 },
  { id: 'a2p', label: 'A2 poster', w: 420, h: 594 },
  { id: 'l12x8', label: '12 × 8 in landscape', w: 304.8, h: 203.2 },
  { id: 'p8x12', label: '8 × 12 in portrait', w: 203.2, h: 304.8 },
  { id: 'spread', label: '60 × 30 cm double page', w: 600, h: 300 },
  { id: 'insta', label: 'Instagram post (4:5)', w: 216, h: 270 },
  { id: 'phone', label: 'Phone wallpaper (9:19.5)', w: 90, h: 195 },
];

export const FORMATS = [
  { id: 'png', label: 'PNG — lossless', ext: 'png', mime: 'image/png' },
  { id: 'jpeg', label: 'JPEG — smaller, for photo books', ext: 'jpg', mime: 'image/jpeg', quality: true },
  { id: 'webp', label: 'WebP — smallest, for screens', ext: 'webp', mime: 'image/webp', quality: true },
  { id: 'pdf', label: 'PDF — print-ready, exact size, bleed & crop marks', ext: 'pdf', mime: 'application/pdf' },
  { id: 'svg', label: 'SVG — vector routes, edit in Illustrator', ext: 'svg', mime: 'image/svg+xml' },
  { id: 'layers', label: 'Layers (ZIP) — base map, routes, decoration as separate transparent PNGs', ext: 'zip', mime: 'application/zip' },
];

export const printPixels = (paper, bleed = 0) => [Math.round(((paper.w + 2 * bleed) / 25.4) * paper.dpi), Math.round(((paper.h + 2 * bleed) / 25.4) * paper.dpi)];

let glMax = null;
export function maxRenderSize() {
  if (glMax) return glMax;
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    glMax = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
  } catch (_) { glMax = 4096; }
  return glMax;
}

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long — keep this tab in front and check your connection`)), ms))]);
}

const font = (id) => (TITLE_FONTS.find((f) => f.id === id) || TITLE_FONTS[0]).css;

/**
 * Render the map alone. Returns { canvas, project(lngLat) → [x, y] output px,
 * ratio, metersPerPx (output px, at centre), bearing }.
 */
export async function renderMap(o) {
  const composition = o.composition || 900;
  const bleed = o.bleed || 0;
  const [W, H] = o.outWidth
    ? [o.outWidth, Math.round(o.outWidth * ((o.paper.h + 2 * bleed) / (o.paper.w + 2 * bleed)))]
    : printPixels(o.paper, bleed);
  const max = maxRenderSize();
  if (W > max || H > max) throw new Error(`This computer's graphics card can draw at most ${max.toLocaleString()} px a side; this needs ${Math.max(W, H).toLocaleString()} px. Lower the dpi or the paper size.`);
  const cssW = composition, cssH = Math.round(composition * (H / W));
  const ratio = W / cssW;
  const bleedCss = (bleed / (o.paper.w + 2 * bleed)) * cssW;

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${cssW + 400}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none;`;
  document.body.append(host);
  let atlas;
  try {
    o.onStage && o.onStage('Preparing the map…');
    atlas = await withTimeout(createAtlas(host, {
      spec: o.spec, interactive: false, pixelRatio: ratio, preserveDrawingBuffer: true, bounds: o.bounds, padding: 0, attribution: false, mode: o.mode || 'all',
    }), 45000, 'Loading the base map');
    atlas.setRoutes(o.routes);
    atlas.setPlaces(o.places || []);
    if (o.camera && o.camera.center) {
      // The camera was composed in a frame `frameW` CSS px wide; this layout is
      // (cssW − bleed) wide, so zoom shifts by the log₂ of the ratio.
      const trimCss = cssW - 2 * bleedCss;
      atlas.map.jumpTo({ center: o.camera.center, zoom: o.camera.zoom + Math.log2(trimCss / (o.camera.frameW || trimCss)), bearing: o.camera.bearing || 0, pitch: o.camera.pitch || 0 });
    } else {
      atlas.map.fitBounds([[o.bounds[0], o.bounds[1]], [o.bounds[2], o.bounds[3]]], { padding: bleedCss, duration: 0, bearing: (o.camera && o.camera.bearing) || 0 });
    }
    await atlas.countriesReady();
    o.onStage && o.onStage('Drawing tiles at full resolution…');
    await withTimeout(atlas.idle(), 180000, 'Drawing the map');

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (o.spec.projection === 'globe' && o.mode !== 'overlay') { ctx.fillStyle = o.spec.globe.space; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(atlas.map.getCanvas(), 0, 0, W, H);
    const m = atlas.map, c = m.getCenter();
    const metersPerCss = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** m.getZoom());
    const project = (ll) => { const p = m.project(ll); return [p.x * ratio, p.y * ratio]; };
    // Snapshot projected geometry before the map goes away (vector outputs).
    const vector = o.wantVector ? projectVector(o, project, ratio) : null;
    return { canvas, W, H, ratio, metersPerPx: metersPerCss / ratio, bearing: m.getBearing(), vector };
  } finally {
    if (atlas) atlas.destroy();
    host.remove();
  }
}

function projectVector(o, project, ratio) {
  const s = o.spec, paths = [], circles = [];
  const thin = (pts) => { const out = []; let last = null; for (const p of pts) { if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > 0.6) { out.push(p); last = p; } } return out; };
  for (const r of o.routes) {
    const ts = s.routes[r.type] || s.routes.other;
    if (!ts || ts.show === false) continue;
    const pts = thin(r.coords.map(project));
    const width = (r.width || ts.width) * ratio, dash = DASHES[ts.dash] ? DASHES[ts.dash].map((d) => Math.max(d, 0.1) * width) : null;
    if (s.routeCasing.show && !dash) paths.push({ id: `casing-${r.id}`, pts, color: s.routeCasing.color, width: width + s.routeCasing.width * 2 * ratio, opacity: s.routeOpacity });
    paths.push({ id: `route-${r.id}`, name: `${r.name}${r.date ? ' · ' + r.date : ''}`, pts, color: r.color || ts.color, width, dash, opacity: s.routeOpacity });
  }
  if (s.places.show) for (const p of o.places || []) {
    const k = s.places.kinds[p.kind] || s.places.kinds.other;
    if (!k || k.show === false || p.hidden) continue;
    const [x, y] = project([p.lon, p.lat]);
    circles.push({ x, y, r: k.size * ratio, color: k.color, stroke: s.places.stroke, strokeWidth: s.places.strokeWidth * ratio, name: p.name });
  }
  return { paths, circles };
}

// ── Finishing ─────────────────────────────────────────────────────────────
function applyFinish(ctx, W, H, spec, ratio, bleedPx) { // eslint-disable-line no-unused-vars
  const f = spec.finish;
  if (f.tint.show) {
    ctx.save(); ctx.globalCompositeOperation = f.tint.blend || 'multiply'; ctx.globalAlpha = f.tint.opacity;
    ctx.fillStyle = f.tint.color; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  if (f.grain > 0) {
    const n = document.createElement('canvas'); n.width = n.height = 256;
    const nx = n.getContext('2d'), img = nx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    nx.putImageData(img, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = f.grain * 0.35;
    const pat = ctx.createPattern(n, 'repeat');
    // Grain scales with the page, so it looks the same in preview and print.
    const k = Math.max(1, ratio / 2);
    ctx.scale(k, k); ctx.fillStyle = pat; ctx.fillRect(0, 0, W / k, H / k); ctx.restore();
  }
  if (f.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(20,16,10,${f.vignette * 0.6})`);
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  void bleedPx;
}

function drawBorder(ctx, W, H, spec, pxPerMm, bleedPx) {
  const b = spec.finish.border;
  if (!b.show || !(b.width > 0)) return;
  const w = b.width * pxPerMm, inset = b.inset * pxPerMm + bleedPx;
  ctx.save(); ctx.strokeStyle = b.color; ctx.lineWidth = w;
  ctx.strokeRect(inset + w / 2, inset + w / 2, W - 2 * inset - w, H - 2 * inset - w);
  ctx.restore();
}

// ── Decoration ────────────────────────────────────────────────────────────
function niceScale(maxMeters) {
  const pow = 10 ** Math.floor(Math.log10(maxMeters));
  for (const m of [5, 2, 1]) if (m * pow <= maxMeters) return m * pow;
  return pow;
}
function dateRange(routes) {
  const d = routes.map((r) => r.date).filter(Boolean).sort();
  if (!d.length) return '';
  const f = (x, y) => new Date(x + 'T00:00:00Z').toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', ...(y ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const a = d[0], b = d[d.length - 1];
  if (a === b) return f(a, true);
  return `${f(a, a.slice(0, 4) !== b.slice(0, 4))} – ${f(b, true)}`;
}

function drawDecor(ctx, W, H, o, info, unit, bleedPx) {
  const s = o.spec, dc = s.decor, ink = dc.titleColor || s.labels.color, halo = s.labels.halo;
  const pad = 26 * unit + bleedPx;
  const corner = (pos, w, h) => {
    const [v, hz] = pos.split('-');
    return [hz === 'left' ? pad : W - pad - w, v === 'top' ? pad : H - pad - h];
  };
  const plate = (x, y, w, h) => {
    if (!dc.plate.show) return;
    ctx.save(); ctx.globalAlpha = dc.plate.opacity; ctx.fillStyle = dc.plate.color;
    const r = 6 * unit; ctx.beginPath(); ctx.roundRect(x - 12 * unit, y - 10 * unit, w + 24 * unit, h + 20 * unit, r); ctx.fill(); ctx.restore();
  };
  const text = (str, x, y, size, weight, spacing = 0, color = ink) => {
    ctx.font = `${weight} ${size}px ${font(dc.titleFont)}`;
    ctx.letterSpacing = `${spacing * size}px`;
    ctx.textBaseline = 'alphabetic';
    if (!dc.plate.show) { ctx.strokeStyle = halo; ctx.lineWidth = size * 0.18; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    ctx.letterSpacing = '0px';
  };

  // Title block
  const title = o.title ? (dc.titleUppercase ? o.title.toUpperCase() : o.title) : '';
  const sub = dc.subtitle === 'dates' ? dateRange(o.routes) : dc.subtitle === 'custom' ? o.subtitle || '' : '';
  if (title || sub) {
    const ts = dc.titleSize * unit, ss = ts * 0.5;
    ctx.font = `700 ${ts}px ${font(dc.titleFont)}`; ctx.letterSpacing = `${dc.titleSpacing * ts}px`;
    const tw = title ? ctx.measureText(title).width : 0;
    ctx.font = `400 ${ss}px ${font(dc.titleFont)}`; ctx.letterSpacing = '0px';
    const sw = sub ? ctx.measureText(sub).width : 0;
    const bw = Math.max(tw, sw), bh = (title ? ts : 0) + (sub ? ss * 1.5 : 0);
    const [x, y] = corner(dc.titlePosition, bw, bh);
    plate(x, y, bw, bh);
    if (title) text(title, x, y + ts * 0.85, ts, 700, dc.titleSpacing);
    if (sub) text(sub, x, y + (title ? ts : 0) + ss * 1.2, ss, 400, 0.02);
  }

  // Legend: the transport types (and place kinds) actually on this page.
  if (dc.legend.show) {
    const types = [...new Set(o.routes.map((r) => r.type))].filter((t) => s.routes[t] && s.routes[t].show !== false);
    const kinds = s.places.show ? [...new Set((o.places || []).map((p) => p.kind))].filter((k) => s.places.kinds[k] && s.places.kinds[k].show !== false) : [];
    const fs = 11 * unit, row = fs * 1.7, sw = 22 * unit;
    ctx.font = `400 ${fs}px ${font(dc.titleFont)}`;
    const items = [...types.map((t) => ({ kind: 'line', label: typeById(t).label, color: s.routes[t].color, dash: s.routes[t].dash })), ...kinds.map((k) => ({ kind: 'dot', label: (PLACE_KINDS.find((x) => x.id === k) || { label: k }).label, color: s.places.kinds[k].color }))];
    const w = sw + 8 * unit + Math.max(0, ...items.map((i) => ctx.measureText(i.label).width)), h = items.length * row;
    const [x, y] = corner(dc.legend.position, w, h);
    plate(x, y, w, h);
    items.forEach((it, i) => {
      const cy = y + i * row + row / 2;
      ctx.save();
      if (it.kind === 'line') {
        ctx.strokeStyle = it.color; ctx.lineWidth = 3 * unit; ctx.lineCap = 'round';
        if (DASHES[it.dash]) ctx.setLineDash(DASHES[it.dash].map((d) => Math.max(d, 0.4) * 3 * unit));
        ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + sw, cy); ctx.stroke();
      } else { ctx.fillStyle = it.color; ctx.beginPath(); ctx.arc(x + sw / 2, cy, 4 * unit, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      text(it.label, x + sw + 8 * unit, cy + fs * 0.35, fs, 400);
    });
  }

  // Scale bar (not meaningful on a tilted or globe view far out — skipped there).
  if (dc.scaleBar.show && info.metersPerPx && !(o.camera && o.camera.pitch) && !(s.projection === 'globe' && info.metersPerPx * W > 4e6)) {
    const maxPx = 140 * unit, meters = niceScale(info.metersPerPx * maxPx), px = meters / info.metersPerPx;
    const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
    const fs = 10 * unit, h = 6 * unit + fs * 1.6;
    const [x, y] = corner(dc.scaleBar.position, px, h);
    plate(x, y, px, h);
    ctx.save(); ctx.fillStyle = ink; ctx.strokeStyle = halo; ctx.lineWidth = 2 * unit;
    ctx.strokeRect(x, y + fs * 1.6, px, 4 * unit); ctx.fillRect(x, y + fs * 1.6, px / 2, 4 * unit);
    ctx.lineWidth = 1 * unit; ctx.strokeStyle = ink; ctx.strokeRect(x, y + fs * 1.6, px, 4 * unit);
    ctx.restore();
    text('0', x, y + fs, fs, 400); ctx.textAlign = 'right'; text(label, x + px, y + fs, fs, 400); ctx.textAlign = 'left';
  }

  // North arrow
  if (dc.northArrow.show) {
    const sz = 28 * unit;
    const [x, y] = corner(dc.northArrow.position, sz, sz * 1.3);
    plate(x, y, sz, sz * 1.3);
    ctx.save(); ctx.translate(x + sz / 2, y + sz * 0.75); ctx.rotate((-info.bearing * Math.PI) / 180);
    ctx.fillStyle = ink; ctx.strokeStyle = halo; ctx.lineWidth = 1.5 * unit;
    ctx.beginPath(); ctx.moveTo(0, -sz * 0.55); ctx.lineTo(sz * 0.22, sz * 0.25); ctx.lineTo(0, sz * 0.1); ctx.lineTo(-sz * 0.22, sz * 0.25); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center'; text('N', x + sz / 2, y + sz * 0.22, 10 * unit, 700); ctx.textAlign = 'left';
  }

  // Data credit — small, required by the OpenStreetMap/OpenMapTiles licence.
  if (o.attribution !== false) {
    ctx.font = `${8 * unit}px -apple-system, Helvetica, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(40,48,58,0.55)'; ctx.textAlign = 'right';
    ctx.fillText('© OpenMapTiles © OpenStreetMap contributors', W - 8 * unit - bleedPx, H - 7 * unit - bleedPx);
    ctx.textAlign = 'left';
  }
}

/**
 * Map + finish + decor → canvas.
 * `mode`: 'all' | 'base' | 'overlay' (transparent routes/places) | 'decor'
 * (title/legend alone, transparent) | 'base-decor' | 'overlay-decor'.
 */
export async function renderPage(o) {
  const bleed = o.bleed || 0;
  const mode = o.mode || 'all';
  const mapMode = mode === 'decor' ? null : mode.startsWith('base') ? 'base' : mode.startsWith('overlay') ? 'overlay' : 'all';
  const withDecor = mode === 'all' || mode.endsWith('decor');
  const info = mapMode ? await renderMap({ ...o, bleed, mode: mapMode }) : null;
  const [W, H] = info ? [info.W, info.H] : (o.outWidth ? [o.outWidth, Math.round(o.outWidth * ((o.paper.h + 2 * bleed) / (o.paper.w + 2 * bleed)))] : printPixels(o.paper, bleed));
  const unit = W / (o.composition || 900);       // decor is designed in composition px
  const pxPerMm = W / (o.paper.w + 2 * bleed);
  const bleedPx = bleed * pxPerMm;
  const canvas = info ? info.canvas : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  if (mapMode === 'all' || mapMode === 'base') applyFinish(ctx, W, H, o.spec, info.ratio, bleedPx);
  if (withDecor) {
    drawDecor(ctx, W, H, o, info || { metersPerPx: o.metersPerPx, bearing: 0 }, unit, bleedPx);
    drawBorder(ctx, W, H, o.spec, pxPerMm, bleedPx);
  }
  return { canvas, info, W, H, pxPerMm };
}

const toBlob = (canvas, mime, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The browser could not encode the image (out of memory?)'))), mime, q));
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

async function deflate(u8) {
  const cs = new CompressionStream('deflate');
  const out = new Response(new Blob([u8]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * Export a page. o: the renderPage options + { format, quality (0–1), bleed (mm),
 * vector (bool: PDF/SVG routes as vector), lossless (PDF) }.
 * Returns { blob, ext, px: [w, h] }.
 */
export async function exportPage(o) {
  const fmt = FORMATS.find((f) => f.id === o.format) || FORMATS[0];
  const dpi = o.paper.dpi;
  const stage = o.onStage || (() => {});

  if (fmt.id === 'png' || fmt.id === 'jpeg' || fmt.id === 'webp') {
    const { canvas, W, H } = await renderPage({ ...o, bleed: 0, mode: o.transparent ? 'overlay-decor' : 'all' });
    stage(`Encoding ${fmt.id.toUpperCase()}…`);
    if (fmt.id === 'jpeg') { // JPEG has no alpha: flatten onto white
      const flat = document.createElement('canvas'); flat.width = W; flat.height = H;
      const fx = flat.getContext('2d'); fx.fillStyle = '#ffffff'; fx.fillRect(0, 0, W, H); fx.drawImage(canvas, 0, 0);
      return { blob: new Blob([jpegWithDpi(await bytes(await toBlob(flat, fmt.mime, o.quality ?? 0.92)), dpi)], { type: fmt.mime }), ext: fmt.ext, px: [W, H] };
    }
    const blob = await toBlob(canvas, fmt.mime, o.quality ?? 0.92);
    return { blob: fmt.id === 'png' ? new Blob([pngWithDpi(await bytes(blob), dpi)], { type: fmt.mime }) : blob, ext: fmt.ext, px: [W, H] };
  }

  if (fmt.id === 'pdf') {
    const bleed = o.bleed || 0;
    // Vector routes: raster carries the base map + decor; routes become PDF paths.
    const vector = o.vector && o.spec.routeFx.gradient.mode === 'off' && !o.spec.routeFx.glow.show;
    const { canvas, info, W, H, pxPerMm } = await renderPage({ ...o, bleed, mode: vector ? 'base-decor' : 'all', wantVector: vector });
    stage('Writing PDF…');
    let image;
    if (o.lossless) {
      const id = canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const rgb = new Uint8Array(W * H * 3);
      for (let i = 0, j = 0; i < id.length; i += 4, j += 3) { rgb[j] = id[i]; rgb[j + 1] = id[i + 1]; rgb[j + 2] = id[i + 2]; }
      image = { flate: await deflate(rgb), w: W, h: H };
    } else image = { jpeg: await bytes(await toBlob(canvas, 'image/jpeg', o.quality ?? 0.95)) };
    const toMm = (pts) => pts.map(([x, y]) => [x / pxPerMm, y / pxPerMm]);
    const paths = vector && info.vector ? info.vector.paths.map((p) => ({ ...p, pts: toMm(p.pts), width: p.width / pxPerMm, dash: p.dash && p.dash.map((d) => d / pxPerMm) })) : [];
    const pdf = buildPdf({ trimW: o.paper.w, trimH: o.paper.h, bleed, image, paths, marks: o.cropMarks !== false, title: o.title || 'Trip Atlas map' });
    return { blob: new Blob([pdf], { type: fmt.mime }), ext: fmt.ext, px: [W, H] };
  }

  if (fmt.id === 'svg') {
    const { canvas, info, W, H, pxPerMm } = await renderPage({ ...o, bleed: 0, mode: 'base-decor', wantVector: true });
    stage('Writing SVG…');
    const toMm = (pts) => pts.map(([x, y]) => [x / pxPerMm, y / pxPerMm]);
    let dataUrl = null;
    if (o.svgBase !== false) {
      const b = await toBlob(canvas, 'image/jpeg', 0.92);
      dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    }
    const svg = buildSvg({
      w: o.paper.w, h: o.paper.h, image: dataUrl,
      paths: info.vector.paths.map((p) => ({ ...p, pts: toMm(p.pts), width: p.width / pxPerMm, dash: p.dash && p.dash.map((d) => d / pxPerMm) })),
      circles: info.vector.circles.map((c) => ({ ...c, x: c.x / pxPerMm, y: c.y / pxPerMm, r: c.r / pxPerMm, strokeWidth: c.strokeWidth / pxPerMm })),
    });
    return { blob: new Blob([svg], { type: fmt.mime }), ext: fmt.ext, px: [W, H] };
  }

  if (fmt.id === 'layers') {
    const files = [];
    for (const [name, mode] of [['1-base-map.png', 'base'], ['2-routes-and-places.png', 'overlay'], ['3-title-legend.png', 'decor'], ['0-composite.png', 'all']]) {
      stage(`Rendering ${name}…`);
      const base = mode === 'decor' ? await renderMap({ ...o, bleed: 0, mode: 'overlay' }) : null; // for the scale bar's metres/px
      const { canvas } = await renderPage({ ...o, bleed: 0, mode, metersPerPx: base && base.metersPerPx });
      files.push({ name, data: pngWithDpi(await bytes(await toBlob(canvas, 'image/png')), dpi) });
    }
    const [W, H] = printPixels(o.paper);
    files.push({ name: 'README.txt', data: new TextEncoder().encode(`Trip Atlas layered export — ${o.title || ''}\n${o.paper.w} × ${o.paper.h} mm at ${dpi} dpi (${W} × ${H} px).\nStack 1 → 3 in Photoshop/InDesign/Affinity; 0-composite is all of them flattened.\n`) });
    return { blob: new Blob([buildZip(files)], { type: fmt.mime }), ext: fmt.ext, px: [W, H] };
  }
  throw new Error('Unknown format');
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// Back-compat for the album list thumbnails.
export async function renderPng(o) {
  const { canvas } = await renderPage({ ...o, mode: 'all' });
  return toBlob(canvas, 'image/png');
}
