import test from 'node:test';
import assert from 'node:assert/strict';
import { curve, walkPoiAmount } from '../web/lib/geo.js';
import { resolveStyle, validateStyle } from '../web/lib/style.js';

const zig = [[0, 0], [1, 0], [1, 1], [2, 1]];

test('curve: level 0 leaves the line alone', () => {
  assert.deepEqual(curve(zig, 0), zig);
});

test('curve: each level doubles the points per segment and keeps the ends', () => {
  const one = curve(zig, 1);
  assert.equal(one.length, 2 + 2 * (zig.length - 1));
  assert.deepEqual(one[0], zig[0]);
  assert.deepEqual(one[one.length - 1], zig[zig.length - 1]);
  assert.equal(curve(zig, 3).length, 2 + 2 * (curve(zig, 2).length - 1));
});

test('curve: corners are cut, so the line never passes through a sharp corner', () => {
  const pts = curve(zig, 2);
  assert.ok(!pts.some(([x, y]) => x === 1 && y === 0));
  assert.ok(pts.every(([x, y]) => x >= 0 && x <= 2 && y >= 0 && y <= 1));
});

test('curve: lines with fewer than 3 points are returned as they are', () => {
  assert.deepEqual(curve([[0, 0], [1, 1]], 3), [[0, 0], [1, 1]]);
});

test('curve: stops growing at 20k points', () => {
  const long = Array.from({ length: 12000 }, (_, i) => [i, i % 2]);
  assert.ok(curve(long, 5).length < 60000);
});

test('walkPoiAmount: a line above 5% of the view, a dot well below it, smooth in between', () => {
  assert.equal(walkPoiAmount(0.2, 0.05), 0);
  assert.equal(walkPoiAmount(0.05, 0.05), 0);
  assert.equal(walkPoiAmount(0.0, 0.05), 1);
  assert.equal(walkPoiAmount(0.035, 0.05), 1);
  const mid = walkPoiAmount(0.0425, 0.05);
  assert.ok(mid > 0 && mid < 1);
  let last = -1;
  for (let s = 0.06; s >= 0.03; s -= 0.001) { const t = walkPoiAmount(s, 0.05); assert.ok(t >= last); last = t; }
});

test('style: new defaults and validation for rounding and walk dots', () => {
  const s = resolveStyle({});
  assert.equal(s.detail.routeCurve, 0);
  assert.deepEqual(s.routeFx.walkPoi, { show: false, below: 0.05, size: 5 }); // off: routes are plain lines (2026-10-05)
  assert.equal(s.lakes, null); assert.equal(s.waterDetail.rivers.color, null); // null = follow the water colour
  assert.equal(validateStyle(s), null);
  assert.match(validateStyle({ ...s, detail: { ...s.detail, routeCurve: 9 } }), /routeCurve/);
  assert.match(validateStyle({ ...s, routeFx: { ...s.routeFx, walkPoi: { ...s.routeFx.walkPoi, below: 0.9 } } }), /walkPoi/);
  // an older saved style without the new fields picks the defaults up
  assert.equal(resolveStyle({ detail: { routeSimplify: 500 } }).routeFx.walkPoi.below, 0.05);
});
