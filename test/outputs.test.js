import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32, pngWithDpi, jpegWithDpi, jpegSize, buildPdf, buildSvg, buildZip, toGpx, toGeoJson, toKml } from '../web/lib/outputs.js';
import { routesFromGpx } from '../web/lib/gpx.js';
import { scaleSize } from '../web/map/scale-size.js';

// A real 1×1 PNG and a minimal JFIF JPEG header with an SOF0 marker.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 1, 1, 0x11, 0, 0xff, 0xd9]);

test('crc32 matches zlib', () => {
  const b = Buffer.from('Trip Atlas');
  assert.equal(crc32(b), zlib.crc32(b));
});

test('PNG gets a valid pHYs chunk right after IHDR', () => {
  const out = pngWithDpi(new Uint8Array(PNG), 300);
  assert.equal(Buffer.from(out.subarray(37, 41)).toString(), 'pHYs');
  const dv = new DataView(out.buffer);
  assert.equal(Math.round(dv.getUint32(41) * 0.0254), 300);
  assert.equal(dv.getUint32(50), zlib.crc32(Buffer.from(out.subarray(37, 50))));
  assert.equal(out.length, PNG.length + 21);
});

test('JPEG density set to dpi; size read from SOF', () => {
  const out = jpegWithDpi(JPG, 300);
  assert.equal(out[13], 1);
  assert.equal((out[14] << 8) | out[15], 300);
  assert.deepEqual(jpegSize(out), { w: 30, h: 20 });
});

test('PDF: page boxes in points, xref offsets point at each object', () => {
  const pdf = buildPdf({ trimW: 300, trimH: 300, bleed: 3, image: { jpeg: JPG }, paths: [{ pts: [[10, 10], [100, 50]], color: '#c0392b', width: 0.5, dash: [1, 0.5], opacity: 0.9 }] });
  const s = Buffer.from(pdf).toString('latin1');
  assert.match(s, /^%PDF-1\.4/);
  assert.match(s, /\/MediaBox \[0 0 867\.402 867\.402\]/);           // (300 + 2·3) mm
  assert.match(s, /\/TrimBox \[8\.504 8\.504 858\.898 858\.898\]/);
  assert.match(s, /\/Filter \/DCTDecode/);
  assert.match(s, /\/GS1 << \/CA 0\.9/);
  const xref = +s.match(/startxref\n(\d+)/)[1];
  assert.ok(s.slice(xref).startsWith('xref'));
  const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n/gm)].map((m) => +m[1]);
  offs.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.match(s, /0 0 0 RG 0\.25 w/); // crop marks with bleed
});

test('SVG: real-size mm canvas, routes as paths with titles', () => {
  const svg = buildSvg({ w: 300, h: 200, paths: [{ id: 'route-1', name: 'Le Grammont & co', pts: [[1, 2], [3, 4]], color: '#c0392b', width: 0.6 }], circles: [{ x: 5, y: 5, r: 1, color: '#2e7d32', name: 'Camp' }] });
  assert.match(svg, /width="300mm" height="200mm" viewBox="0 0 300 200"/);
  assert.match(svg, /<path id="route-1" d="M1 2L3 4" stroke="#c0392b" stroke-width="0.6"><title>Le Grammont &amp; co<\/title>/);
  assert.match(svg, /<circle cx="5"/);
});

test('ZIP: readable by unzip-style parsing (local headers, central directory, CRCs)', () => {
  const files = [{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'b/c.png', data: new Uint8Array(PNG) }];
  const zip = buildZip(files);
  const dv = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  let p = dv.getUint32(end + 16, true);
  for (const f of files) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const local = dv.getUint32(p + 42, true), nameLen = dv.getUint16(p + 28, true);
    assert.equal(Buffer.from(zip.subarray(p + 46, p + 46 + nameLen)).toString(), f.name);
    assert.equal(dv.getUint32(p + 16, true), zlib.crc32(Buffer.from(f.data)));
    const dataAt = local + 30 + dv.getUint16(local + 26, true);
    assert.deepEqual(zip.subarray(dataAt, dataAt + f.data.length), f.data);
    p += 46 + nameLen;
  }
});

test('route data round-trips: GPX export re-imports to the same line', () => {
  const r = { id: 1, name: 'Le Grammont & friends', date: '2025-05-18', type: 'walk', coords: [[6.85, 46.35], [6.86, 46.36], [6.9, 46.4]] };
  const back = routesFromGpx(toGpx([r]), { fileName: 'export.gpx' });
  assert.equal(back.routes.length, 1);
  assert.equal(back.routes[0].point_count, 3);
  assert.equal(JSON.parse(toGeoJson([r])).features[0].properties.name, 'Le Grammont & friends');
  assert.match(toKml([r], () => '#c0392b'), /<color>ff2b39c0<\/color>/);
});

test('label size scaling keeps zoom curves top-level', () => {
  assert.equal(scaleSize(12, 1.5), 18);
  assert.deepEqual(scaleSize(['interpolate', ['linear'], ['zoom'], 3, 10, 8, 16], 2), ['interpolate', ['linear'], ['zoom'], 3, 20, 8, 32]);
  assert.deepEqual(scaleSize(['step', ['zoom'], 10, 5, 14], 0.5), ['step', ['zoom'], 5, 5, 7]);
  assert.deepEqual(scaleSize({ stops: [[3, 10], [8, 16]] }, 2), { stops: [[3, 20], [8, 32]] });
});
