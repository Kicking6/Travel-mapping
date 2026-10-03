import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, cameraFor, glide, sliceLine } from '../web/lib/film.js';
import { bbox } from '../web/lib/geo.js';

const mk = (id, date, coords, km) => ({ id, name: `R${id}`, date, type: 'drive', coords, bbox: bbox(coords), distance_km: km });
const routes = [
  mk(1, '2024-08-02', [[-93.2, 44.9], [-92.0, 44.5]], 100),
  mk(2, '2024-08-03', [[-92.0, 44.5], [-90.0, 44.0]], 170),
  mk(3, '2025-06-20', [[14.0, 68.2], [14.5, 68.3]], 30),   // Norway: a long jump
  mk(4, '2025-06-21', [[14.5, 68.3], [15.0, 68.4]], 25),
  { ...mk(5, null, [[0, 1], [1, 1]], 5) },                  // undated: left out
];

test('timeline fits the requested length and draws every dated route once, in order', () => {
  const tl = buildTimeline(routes, [], { W: 1920, H: 1080, seconds: 60, group: 'day' });
  assert.ok(Math.abs(tl.duration - 60) < 6, `duration ${tl.duration}`);
  const order = tl.events.filter((e) => e.kind === 'draw').map((e) => e.route.id);
  assert.deepEqual(order, [1, 2, 3, 4]);
  let lastDone = 0;
  for (let t = 0; t < tl.duration; t += 0.5) {
    const f = tl.frame(t);
    assert.ok(f.done.size >= lastDone, 'routes never un-draw');
    lastDone = f.done.size;
    assert.ok(Number.isFinite(f.camera.zoom) && f.camera.center.every(Number.isFinite));
  }
  assert.equal(tl.frame(tl.duration).done.size, 4);
});

test('grouping by week merges the two US days into one camera beat', () => {
  const tl = buildTimeline(routes, [], { seconds: 40, group: 'week' });
  assert.equal(tl.groups.length, 2);
});

test('the cumulative km counter reaches the trip total', () => {
  const tl = buildTimeline(routes, [], { seconds: 30, group: 'day' });
  const end = tl.frame(tl.duration - 0.01);
  assert.ok(Math.abs(end.km - 325) < 1, `km ${end.km}`);
});

test('photos get a hold after their route', () => {
  const tl = buildTimeline(routes, [{ id: 99, route_id: 3, lat: 68.25, lon: 14.2, date: '2025-06-20', caption: 'Reinebringen' }], { seconds: 30, group: 'day', photoSeconds: 2 });
  const ev = tl.events.find((e) => e.kind === 'photo');
  assert.ok(ev && ev.t1 - ev.t0 === 2);
  const f = tl.frame((ev.t0 + ev.t1) / 2);
  assert.equal(f.photo.id, 99);
  assert.equal(f.caption.name, 'Reinebringen');
});

test('camera: a small area zooms in further than a big one; a long glide pulls back mid-way', () => {
  const near = cameraFor([14, 68, 14.5, 68.3], 1920, 1080), far = cameraFor([-130, -55, 40, 72], 1920, 1080);
  assert.ok(near.zoom > far.zoom + 4);
  const usa = cameraFor([-93, 44, -90, 45], 1920, 1080), nor = cameraFor([14, 68, 15, 68.5], 1920, 1080);
  const mid = glide(usa, nor, 0.5, 1920);
  assert.ok(mid.zoom < Math.min(usa.zoom, nor.zoom) - 2, `mid zoom ${mid.zoom}`);
});

test('sliceLine cuts by distance and ends exactly at the end', () => {
  const c = [[0, 0], [1, 0], [2, 0]], cum = new Float64Array([0, 111.2, 222.4]);
  assert.deepEqual(sliceLine(c, cum, 0.25).at(-1).map((x) => +x.toFixed(2)), [0.5, 0]);
  assert.deepEqual(sliceLine(c, cum, 1), c);
});

test('empty trip → zero-length film, no crash', () => {
  assert.equal(buildTimeline([], []).duration, 0);
});
