import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, GLYPHS, mapPath, pinParts, pathToPdf, glyphIn } from '../web/lib/pins.js';
import { buildPdf, buildSvg } from '../web/lib/outputs.js';
import { resolveStyle, validateStyle, PLACE_KINDS } from '../web/lib/style.js';

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 1, 1, 0x11, 0, 0xff, 0xd9]);

test('every shape and symbol is an absolute M/L/C/Z path', () => {
  for (const [id, s] of Object.entries(SHAPES)) assert.match(s.d, /^M[-\d. LCZ]+Z$/, id);
  for (const [id, g] of Object.entries(GLYPHS)) if (g.d) assert.match(g.d.replace(/\s/g, ' '), /^M[-\d. LCZM]+Z$/, id);
});

test('a teardrop pin puts its tip on the location; a circle centres on it', () => {
  const tip = pinParts({ shape: 'pin', glyph: 'bed' }, { x: 100, y: 200, px: 24 });
  assert.match(tip.shape, /^M100 200C/);             // the path starts at the tip, at the point
  assert.ok(tip.center[1] < 200);                     // symbol sits above the point
  assert.ok(tip.glyph.length > 10);
  const c = pinParts({ shape: 'circle', glyph: 'none' }, { x: 50, y: 50, px: 24 });
  assert.deepEqual(c.center, [50, 50]);
  assert.equal(c.glyph, '');
});

test('mapPath scales every coordinate pair; glyphs move into the shape centre', () => {
  assert.equal(mapPath('M1 2L3 4C5 6 7 8 9 10Z', ([x, y]) => [x * 2, y + 1]), 'M2 3L6 5C10 7 14 9 18 11Z');
  assert.ok(glyphIn('pin', 'tent').length > 0);
  assert.equal(glyphIn('circle', 'none'), '');
});

test('SVG path → PDF operators, with the y axis flipped', () => {
  assert.equal(pathToPdf('M0 0L10 0C10 5 5 10 0 10Z', (x) => x, (y) => 100 - y), '0 100 m\n10 100 l\n10 95 5 90 0 90 c\nh');
});

test('PDF and SVG carry pins as filled vector shapes', () => {
  const pin = pinParts({ shape: 'pin', glyph: 'tent' }, { x: 50, y: 50, px: 6 });
  const shapes = [{ d: pin.shape, fill: '#1c5d8c', stroke: '#ffffff', strokeWidth: 0.3, name: 'Hotel Churup' }, { d: pin.glyph, fill: '#ffffff', opacity: 0.9 }];
  const pdf = Buffer.from(buildPdf({ trimW: 100, trimH: 100, image: { jpeg: JPG }, shapes })).toString('latin1');
  assert.match(pdf, /0\.11 0\.365 0\.549 rg 1 1 1 RG/);
  assert.match(pdf, /\nB\* Q/);
  assert.match(pdf, /\nf\* Q/);
  const svg = buildSvg({ w: 100, h: 100, shapes });
  assert.match(svg, /<path d="M50 50C[^"]+" fill="#1c5d8c" stroke="#ffffff" stroke-width="0.3"/);
  assert.match(svg, /<title>Hotel Churup<\/title>/);
});

test('style: the trip’s accommodation kinds, pin options and map-detail settings validate', () => {
  const s = resolveStyle({ detail: { coastline: '50m', softness: 4, baseLevel: 6, routeSimplify: 2000 }, places: { kinds: { stay: { shape: 'star' } }, label: { field: 'name-nights' } } });
  assert.equal(validateStyle(s), null);
  assert.equal(s.places.kinds.stay.shape, 'star');
  assert.equal(s.places.kinds.stay.glyph, 'bed');
  for (const k of ['freedom', 'campground', 'tent', 'carpark', 'stay', 'friends', 'hut']) assert.ok(PLACE_KINDS.some((x) => x.id === k), k);
  assert.match(validateStyle(resolveStyle({ detail: { coastline: '5m' } })), /coastline/);
});
