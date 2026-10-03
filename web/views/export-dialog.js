// The Export… dialog for an album page, and route-data downloads.
import { esc, modal, toast } from '../app.js';
import { exportPage, download, FORMATS, printPixels, maxRenderSize } from '../map/render.js';
import { toGpx, toGeoJson, toKml } from '../lib/outputs.js';

const DEFAULTS = { format: 'png', quality: 0.92, dpi: null, bleed: null, cropMarks: true, vector: true, lossless: false, transparent: false, svgBase: true };
const safe = (s) => String(s || 'album-map').replace(/[^\w\- ]+/g, '').trim() || 'album-map';

export async function exportDialog({ name, paper, last, opts, statusEl }) {
  const o = { ...DEFAULTS, ...(last || {}) };
  const body = document.createElement('form');
  body.className = 'stack';
  body.innerHTML = `
    <div class="stack" style="gap:6px">${FORMATS.map((f) => `<label class="option-card"><input type="radio" name="format" value="${f.id}" ${o.format === f.id ? 'checked' : ''}><span><strong>${esc(f.label.split(' — ')[0])}</strong><br><span class="help">${esc(f.label.split(' — ')[1] || '')}</span></span></label>`).join('')}</div>
    <div class="field-row">
      <div class="field"><label>Resolution</label><select class="select" name="dpi">${[72, 150, 200, 240, 300, 400, 600].map((d) => `<option value="${d}" ${(o.dpi || paper.dpi) === d ? 'selected' : ''}>${d} dpi</option>`).join('')}</select></div>
      <div class="field" data-for="jpeg webp pdf"><label>Quality <span class="muted" id="qv"></span></label><input type="range" name="quality" min="0.6" max="1" step="0.01" value="${o.quality}"></div>
    </div>
    <div class="stack" data-for="pdf">
      <div class="field-row"><div class="field"><label>Bleed (mm)</label><input class="input" type="number" name="bleed" min="0" max="20" step="0.5" value="${o.bleed ?? paper.bleed ?? 3}"></div><div></div></div>
      <label class="switch"><input type="checkbox" name="cropMarks" ${o.cropMarks ? 'checked' : ''}><span class="track"></span>Crop marks</label>
      <label class="switch"><input type="checkbox" name="vector" ${o.vector ? 'checked' : ''}><span class="track"></span>Routes as vector paths (razor sharp at any zoom; off when glow/gradient is on)</label>
      <label class="switch"><input type="checkbox" name="lossless" ${o.lossless ? 'checked' : ''}><span class="track"></span>Lossless base map (much bigger file)</label>
    </div>
    <label class="switch" data-for="png webp"><input type="checkbox" name="transparent" ${o.transparent ? 'checked' : ''}><span class="track"></span>Transparent background — routes, places and title only</label>
    <label class="switch" data-for="svg"><input type="checkbox" name="svgBase" ${o.svgBase ? 'checked' : ''}><span class="track"></span>Include the base map as an embedded image</label>
    <div class="notice info" id="sizeNote"></div>
    <p class="help">Colour: files are sRGB. Most photo-book printers (Blurb, Milk, Momento, Snapfish) want sRGB JPEG or PDF at 300 dpi; for offset print ask the printer to convert to CMYK.</p>`;

  const sync = () => {
    const f = body.elements, fmt = f.format.value, dpi = +f.dpi.value, bleed = fmt === 'pdf' ? +f.bleed.value || 0 : 0;
    body.querySelectorAll('[data-for]').forEach((x) => { x.hidden = !x.dataset.for.split(' ').includes(fmt); });
    body.querySelector('#qv').textContent = Math.round(+f.quality.value * 100) + '%';
    const [w, h] = printPixels({ ...paper, dpi }, bleed), max = maxRenderSize();
    body.querySelector('#sizeNote').innerHTML = `${(paper.w / 10).toFixed(1)} × ${(paper.h / 10).toFixed(1)} cm${bleed ? ` + ${bleed} mm bleed` : ''} at ${dpi} dpi → <strong>${w.toLocaleString()} × ${h.toLocaleString()} px</strong>${Math.max(w, h) > max ? `<br><span class="status-err">Over this computer's ${max.toLocaleString()} px limit — lower the dpi.</span>` : ''}`;
  };
  body.addEventListener('input', sync);
  sync();

  const go = await modal({ title: `Export “${name}”`, body, actions: [{ label: 'Cancel', value: false }, { label: 'Export', value: true, primary: true }] });
  if (!go) return null;
  const f = body.elements;
  const options = {
    format: f.format.value, quality: +f.quality.value, dpi: +f.dpi.value, bleed: +f.bleed.value || 0, cropMarks: f.cropMarks.checked,
    vector: f.vector.checked, lossless: f.lossless.checked, transparent: f.transparent.checked, svgBase: f.svgBase.checked,
  };
  const status = (s) => { if (statusEl) statusEl.textContent = s; };
  try {
    const t0 = performance.now();
    const base = opts();
    const res = await exportPage({
      ...base, paper: { ...base.paper, dpi: options.dpi }, format: options.format, quality: options.quality,
      bleed: options.format === 'pdf' ? options.bleed : 0, cropMarks: options.cropMarks, vector: options.vector, lossless: options.lossless,
      transparent: options.transparent && ['png', 'webp'].includes(options.format), svgBase: options.svgBase, onStage: status,
    });
    const cm = `${+(paper.w / 10).toFixed(1)}x${+(paper.h / 10).toFixed(1)}cm`;
    download(res.blob, `${safe(name)} — ${cm} ${options.dpi}dpi.${res.ext}`);
    status(`Exported ${options.format.toUpperCase()} · ${res.px[0].toLocaleString()} × ${res.px[1].toLocaleString()} px · ${(res.blob.size / 1e6).toFixed(1)} MB · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    return { options, px: res.px };
  } catch (e) {
    status('');
    toast(e.message, 'err');
    return null;
  }
}

export function downloadRouteData(routes, kind, name, spec) {
  if (!routes.length) { toast('No routes on this page', 'err'); return; }
  const colorFor = (r) => r.color || (spec.routes[r.type] || spec.routes.other).color;
  const [text, ext, mime] = kind === 'gpx' ? [toGpx(routes), 'gpx', 'application/gpx+xml']
    : kind === 'kml' ? [toKml(routes, colorFor), 'kml', 'application/vnd.google-earth.kml+xml']
      : [toGeoJson(routes), 'geojson', 'application/geo+json'];
  download(new Blob([text], { type: mime }), `${safe(name)} — ${routes.length} routes.${ext}`);
}
