// File writers for exports — no DOM, so node --test covers them.
//   PNG pHYs (dpi), JPEG JFIF density (dpi), print PDF (raster + vector
//   routes, bleed, crop marks), SVG (editable in Illustrator), ZIP (layered
//   export), and route data as GPX / GeoJSON / KML.

const enc = new TextEncoder();

// ── CRC32 (PNG chunks, ZIP) ──
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── DPI stamps ──
export function pngWithDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set(enc.encode('pHYs'), 4);
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 8 + 25; // signature + IHDR chunk (4 len + 4 type + 13 data + 4 crc)
  const out = new Uint8Array(png.length + 21);
  out.set(png.subarray(0, at)); out.set(chunk, at); out.set(png.subarray(at), at + 21);
  return out;
}

export function jpegWithDpi(jpg, dpi) {
  const out = jpg.slice();
  // JFIF APP0: FFD8 FFE0 len(2) 'JFIF\0' ver(2) units(1) Xd(2) Yd(2)
  if (out[2] === 0xff && out[3] === 0xe0 && String.fromCharCode(...out.subarray(6, 10)) === 'JFIF') {
    out[13] = 1;
    out[14] = dpi >> 8; out[15] = dpi & 255; out[16] = dpi >> 8; out[17] = dpi & 255;
  }
  return out;
}

export function jpegSize(jpg) {
  for (let i = 2; i < jpg.length;) {
    if (jpg[i] !== 0xff) return null;
    const m = jpg[i + 1], len = (jpg[i + 2] << 8) | jpg[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (jpg[i + 5] << 8) | jpg[i + 6], w: (jpg[i + 7] << 8) | jpg[i + 8] };
    i += 2 + len;
  }
  return null;
}

// ── PDF ──
// One page. Units: mm in, points out. `image` is a JPEG (DCTDecode) or raw
// deflated RGB ({ flate, w, h }) covering the whole media box (trim + bleed).
// `paths`: [{ pts: [[xmm, ymm], …] (from the top-left of the media box), color '#rrggbb', width mm, dash [mm…]|null, opacity }]
// `marks`: crop marks at the trim corners when bleed > 0.
const mm = (v) => (v * 72) / 25.4;
const num = (v) => (Math.round(v * 1000) / 1000).toString();
const rgb = (h) => [1, 3, 5].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');

export function buildPdf({ trimW, trimH, bleed = 0, image, paths = [], marks = true, title = 'Trip Atlas map' }) {
  const W = trimW + bleed * 2, H = trimH + bleed * 2;
  const pw = mm(W), ph = mm(H);
  const parts = [];
  let size = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };

  // Content stream
  let c = `q ${num(pw)} 0 0 ${num(ph)} 0 0 cm /Im1 Do Q\n`;
  const alphas = new Map();
  for (const p of paths) {
    if (p.pts.length < 2) continue;
    let gs = '';
    if (p.opacity != null && p.opacity < 1) {
      const key = num(p.opacity);
      if (!alphas.has(key)) alphas.set(key, `GS${alphas.size + 1}`);
      gs = `/${alphas.get(key)} gs `;
    }
    c += `q ${gs}${rgb(p.color)} RG ${num(mm(p.width))} w 1 J 1 j ${p.dash ? `[${p.dash.map((d) => num(mm(d))).join(' ')}] 0 d` : '[] 0 d'}\n`;
    c += p.pts.map(([x, y], i) => `${num(mm(x))} ${num(ph - mm(y))} ${i ? 'l' : 'm'}`).join('\n') + '\nS Q\n';
  }
  if (marks && bleed > 0) {
    const L = mm(Math.min(bleed, 5)), b = mm(bleed);
    c += `q 0 0 0 RG 0.25 w\n`;
    for (const [x, y] of [[b, b], [pw - b, b], [b, ph - b], [pw - b, ph - b]]) {
      const sx = x < pw / 2 ? -1 : 1, sy = y < ph / 2 ? -1 : 1;
      c += `${num(x)} ${num(y + sy * 2)} m ${num(x)} ${num(y + sy * (2 + L))} l S\n${num(x + sx * 2)} ${num(y)} m ${num(x + sx * (2 + L))} ${num(y)} l S\n`;
    }
    c += 'Q\n';
  }
  const content = enc.encode(c);

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const ext = alphas.size ? ` /ExtGState << ${[...alphas].map(([a, n]) => `/${n} << /CA ${a} /ca ${a} >>`).join(' ')} >>` : '';
  const box = (x0, y0, x1, y1) => `[${num(x0)} ${num(y0)} ${num(x1)} ${num(y1)}]`;
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox ${box(0, 0, pw, ph)} /BleedBox ${box(0, 0, pw, ph)} /TrimBox ${box(mm(bleed), mm(bleed), pw - mm(bleed), ph - mm(bleed))} /Resources << /XObject << /Im1 5 0 R >>${ext} >> /Contents 4 0 R >>`);
  obj(4, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
  if (image.jpeg) {
    const s = jpegSize(image.jpeg);
    obj(5, [`<< /Type /XObject /Subtype /Image /Width ${s.w} /Height ${s.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`, image.jpeg, '\nendstream']);
  } else {
    obj(5, [`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.flate.length} >>\nstream\n`, image.flate, '\nendstream']);
  }
  obj(6, `<< /Title (${title.replace(/[()\\]/g, '')}) /Producer (Trip Atlas) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
  const xref = size;
  push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── SVG ──
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Same `paths` as buildPdf (mm). `image`: data URL of the base map (optional).
export function buildSvg({ w, h, image, paths = [], circles = [], texts = [], background }) {
  const d = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(w)}mm" height="${num(h)}mm" viewBox="0 0 ${num(w)} ${num(h)}">
<title>Trip Atlas map</title>
${background ? `<rect id="background" width="100%" height="100%" fill="${background}"/>` : ''}
${image ? `<image id="basemap" x="0" y="0" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" xlink:href="${image}"/>` : ''}
<g id="routes" fill="none" stroke-linecap="round" stroke-linejoin="round">
${paths.filter((p) => p.pts.length > 1).map((p) => `<path${p.id ? ` id="${esc(p.id)}"` : ''} d="${d(p.pts)}" stroke="${p.color}" stroke-width="${num(p.width)}"${p.dash ? ` stroke-dasharray="${p.dash.map(num).join(' ')}"` : ''}${p.opacity != null && p.opacity < 1 ? ` stroke-opacity="${num(p.opacity)}"` : ''}>${p.name ? `<title>${esc(p.name)}</title>` : ''}</path>`).join('\n')}
</g>
<g id="places">
${circles.map((c) => `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(c.r)}" fill="${c.color}" stroke="${c.stroke || 'none'}" stroke-width="${num(c.strokeWidth || 0)}">${c.name ? `<title>${esc(c.name)}</title>` : ''}</circle>`).join('\n')}
</g>
<g id="text">
${texts.map((t) => `<text x="${num(t.x)}" y="${num(t.y)}" font-family="${esc(t.font)}" font-size="${num(t.size)}" font-weight="${t.weight || 400}" fill="${t.color}"${t.spacing ? ` letter-spacing="${num(t.spacing)}"` : ''}${t.anchor ? ` text-anchor="${t.anchor}"` : ''}>${esc(t.text)}</text>`).join('\n')}
</g>
</svg>`;
}

// ── ZIP (stored, no compression — PNGs are already compressed) ──
export function buildZip(files) {
  const chunks = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true); dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); ch.set(name, 46);
    chunks.push(lh, data); central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of all) { out.set(c, o); o += c.length; }
  return out;
}

// ── Route data ──
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function toGpx(routes) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trip Atlas" xmlns="http://www.topografix.com/GPX/1/1">
${routes.map((r) => `<trk><name>${xml(r.name)}</name>${r.date ? `<desc>${xml(r.date)}</desc>` : ''}<type>${xml(r.type)}</type><trkseg>
${r.coords.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}
</trkseg></trk>`).join('\n')}
</gpx>
`;
}
export function toGeoJson(routes) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: routes.map((r) => ({ type: 'Feature', properties: { id: r.id, name: r.name, date: r.date, type: r.type, country: r.country, distance_km: r.distance_km, notes: r.notes || undefined }, geometry: { type: 'LineString', coordinates: r.coords } })),
  });
}
export function toKml(routes, colorFor = () => '#c0392b') {
  const abgr = (h) => 'ff' + h.slice(5, 7) + h.slice(3, 5) + h.slice(1, 3);
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Trip Atlas</name>
${routes.map((r) => `<Placemark><name>${xml(r.name)}</name>${r.date ? `<TimeStamp><when>${r.date}</when></TimeStamp>` : ''}<Style><LineStyle><color>${abgr(colorFor(r))}</color><width>3</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${r.coords.map(([x, y]) => `${x},${y}`).join(' ')}</coordinates></LineString></Placemark>`).join('\n')}
</Document></kml>
`;
}
