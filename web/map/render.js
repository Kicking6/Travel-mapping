// Print export. The legacy app grabbed the on-screen view (~2–3k px) and
// stretched it to the requested 10,000 px — soft, upscaled prints. Here the
// map is re-rendered offscreen at the real print size: vector tiles and
// routes are drawn at `pixelRatio = printPx / compositionPx`, so every line
// and label is sharp at 300 dpi.
//
// "Composition width" fixes how the page is laid out independent of the
// browser window: lines, labels and zoom are worked out for a page that is
// `composition` CSS px wide, then drawn at print resolution. Larger
// composition = more map detail, thinner lines and smaller text relative to
// the page. The same function renders the low-res preview, so preview = print.
import { createAtlas } from './atlas.js';

export const PAPER_PRESETS = [
  { id: 'sq30', label: '30 × 30 cm square', w: 300, h: 300 },
  { id: 'sq20', label: '20 × 20 cm square', w: 200, h: 200 },
  { id: 'a4p', label: 'A4 portrait', w: 210, h: 297 },
  { id: 'a4l', label: 'A4 landscape', w: 297, h: 210 },
  { id: 'a3l', label: 'A3 landscape', w: 420, h: 297 },
  { id: 'a3p', label: 'A3 portrait', w: 297, h: 420 },
  { id: 'l12x8', label: '12 × 8 in landscape', w: 304.8, h: 203.2 },
  { id: 'p8x12', label: '8 × 12 in portrait', w: 203.2, h: 304.8 },
  { id: 'spread', label: '60 × 30 cm double page', w: 600, h: 300 },
];

export const printPixels = (paper) => [Math.round((paper.w / 25.4) * paper.dpi), Math.round((paper.h / 25.4) * paper.dpi)];

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
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long — check your connection and try again`)), ms))]);
}

/**
 * Render a map to a PNG Blob.
 * @param {object} o
 * @param {Array} o.routes      already filtered, with .coords
 * @param {Array} o.places
 * @param {object} o.spec       resolved style spec
 * @param {number[]} o.bounds   [w,s,e,n] — the page's extent
 * @param {object} o.paper      {w,h,dpi} mm
 * @param {number} o.composition CSS px width the page is laid out at (default 900)
 * @param {number} [o.outWidth] override pixel width (preview); default = print size
 * @param {string} [o.title]
 * @param {boolean} [o.attribution=true]
 * @param {function} [o.onStage]
 */
export async function renderPng(o) {
  const composition = o.composition || 900;
  const [printW, printH] = printPixels(o.paper);
  const outW = o.outWidth || printW;
  const outH = Math.round(outW * (printH / printW));
  const max = maxRenderSize();
  if (outW > max || outH > max) {
    throw new Error(`This computer's graphics card can draw at most ${max.toLocaleString()} px a side; this page needs ${Math.max(outW, outH).toLocaleString()} px. Lower the dpi or the paper size.`);
  }
  const cssW = composition, cssH = Math.round(composition * (outH / outW));
  const ratio = outW / cssW;

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${cssW + 200}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none;`;
  document.body.append(host);
  let atlas;
  try {
    o.onStage && o.onStage('Preparing the map…');
    atlas = await withTimeout(createAtlas(host, {
      spec: o.spec, interactive: false, pixelRatio: ratio, preserveDrawingBuffer: true,
      bounds: o.bounds, padding: 0, attribution: false,
    }), 30000, 'Loading the base map');
    atlas.setRoutes(o.routes);
    atlas.setPlaces(o.places || []);
    atlas.map.fitBounds([[o.bounds[0], o.bounds[1]], [o.bounds[2], o.bounds[3]]], { padding: 0, duration: 0 });
    o.onStage && o.onStage('Drawing tiles at print resolution…');
    await withTimeout(new Promise((res) => atlas.map.once('idle', res)), 120000, 'Drawing the map');

    const src = atlas.map.getCanvas();
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0, outW, outH);
    const px = (n) => Math.round(n * ratio); // composition px → output px

    if (o.title) {
      ctx.font = `700 ${px(26)}px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillStyle = o.spec.labels.color;
      ctx.strokeStyle = o.spec.labels.halo;
      ctx.lineWidth = px(5);
      ctx.lineJoin = 'round';
      ctx.strokeText(o.title, px(28), outH - px(30));
      ctx.fillText(o.title, px(28), outH - px(30));
    }
    if (o.attribution !== false) {
      const text = '© OpenMapTiles © OpenStreetMap contributors';
      ctx.font = `${px(8)}px -apple-system, Helvetica, Arial, sans-serif`;
      ctx.fillStyle = 'rgba(40,48,58,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(text, outW - px(8), outH - px(7));
    }
    o.onStage && o.onStage('Saving PNG…');
    const blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('The browser could not encode the image (out of memory?)'))), 'image/png'));
    return o.outWidth ? blob : withDpi(blob, o.paper.dpi);
  } finally {
    if (atlas) atlas.destroy();
    host.remove();
  }
}

// ── PNG pHYs chunk: tells print software the dpi, so a 3543 px image opens
// as 30 cm at 300 dpi instead of 125 cm at 72.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function phys(dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, ppm); dv.setUint32(4, ppm); data[8] = 1; // unit: metre
  const type = new TextEncoder().encode('pHYs');
  const chunk = new Uint8Array(12 + 9);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set(type, 4); chunk.set(data, 8);
  cv.setUint32(17, crc32(new Uint8Array([...type, ...data])));
  return chunk;
}
async function withDpi(blob, dpi) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ihdrEnd = 8 + 8 + 13 + 4; // signature + IHDR(len,type) + data + crc
  return new Blob([buf.slice(0, ihdrEnd), phys(dpi), buf.slice(ihdrEnd)], { type: 'image/png' });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
