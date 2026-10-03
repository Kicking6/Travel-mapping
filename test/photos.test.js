import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { env as makeEnv, signedIn } from './_d1.js';
import { placePhoto, pointAlong, exifTime } from '../web/lib/photos.js';

const hike = { id: 7, date: '2025-05-18', started_at: '2025-05-18T08:00:00Z', ended_at: '2025-05-18T12:00:00Z', distance_km: 9, coords: [[6.80, 46.35], [6.90, 46.35]] };
const drive = { id: 8, date: '2025-05-18', distance_km: 120, coords: [[6.0, 46.0], [7.0, 46.5]] };

test('photo with GPS keeps it and links the route that passes within 3 km', () => {
  const r = placePhoto({ lat: 46.351, lon: 6.85, date: '2025-05-18' }, [hike, drive]);
  assert.deepEqual([r.place_source, r.route_id, r.lat], ['gps', 7, 46.351]);
});

test('photo without GPS but with a time is interpolated along the recorded hike', () => {
  const r = placePhoto({ taken_at: '2025-05-18T10:00:00Z', date: '2025-05-18' }, [hike, drive]);
  assert.equal(r.place_source, 'route-time');
  assert.ok(Math.abs(r.lon - 6.85) < 0.002);
});

test('photo with only a date sits mid-way along the day’s longest route', () => {
  const r = placePhoto({ date: '2025-05-18' }, [hike, drive]);
  assert.deepEqual([r.place_source, r.route_id], ['route-date', 8]);
});

test('photo with nothing stays unplaced', () => {
  assert.equal(placePhoto({}, [hike]).place_source, null);
});

test('pointAlong walks by distance', () => {
  assert.deepEqual(pointAlong([[0, 0], [2, 0]], 0.25).map((x) => +x.toFixed(6)), [0.5, 0]);
});

test('EXIF time: local wall clock, offset when present', () => {
  assert.deepEqual(exifTime('2025:05:18 14:03:22'), { taken_at: '2025-05-18T14:03:22', date: '2025-05-18' });
  assert.equal(exifTime('2025:05:18 14:03:22', '+02:00').taken_at, '2025-05-18T12:03:22.000Z');
  assert.equal(exifTime('2025:05:18 00:30:00', '+02:00').date, '2025-05-18'); // the local day, not UTC's
});

test('photos API: insert once per sha, edit, store files, delete removes files', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const sha = 'a'.repeat(64);
  const p = { sha, file_name: 'IMG_1.jpg', taken_at: '2025-05-18T10:00:00', date: '2025-05-18', lat: 46.3, lon: 6.8, place_source: 'gps', width: 2048, height: 1536 };
  assert.equal((await api('POST', '/api/photos', { photos: [p, p] })).body.inserted, 1);
  assert.equal((await api('POST', '/api/photos', { photos: [{ ...p, lat: 200 }] })).status, 400);
  assert.equal((await api('PUT', `/api/photo-file/${sha}/thumb`, 'jpegbytes', { 'Content-Type': 'image/jpeg' })).status, 200);
  assert.equal((await api('PUT', `/api/photo-file/${sha}/full`, 'x', { 'Content-Type': 'text/plain' })).status, 415);
  const got = await api('GET', `/api/photo-file/${sha}/thumb`);
  assert.match(got.headers.get('Cache-Control'), /immutable/);
  const list = (await api('GET', '/api/photos')).body.photos;
  assert.equal(list.length, 1);
  await api('PATCH', '/api/photos', { ids: [list[0].id], fields: { caption: 'Summit!', in_film: false } });
  const after = (await api('GET', '/api/photos')).body.photos[0];
  assert.deepEqual([after.caption, after.in_film], ['Summit!', 0]);
  await api('DELETE', '/api/photos', { ids: [after.id] });
  assert.equal(e.ORIGINALS.objects.size, 0);
});

test('a camera time with no zone is read as local to the route, not the browser', () => {
  // 10:30 local in the Alps (lon 6.8 → UTC+0 by solar offset rounding? 6.8/15 ≈ 0.45 → 0 h)
  const alps = { ...hike, coords: [[6.80, 46.35], [6.90, 46.35]] };
  assert.equal(placePhoto({ taken_at: '2025-05-18T10:30:00', date: '2025-05-18' }, [alps]).place_source, 'route-time');
  // Peru (lon −77.5 → UTC−5): 08:00 local is 13:00 UTC
  const peru = { id: 9, date: '2024-11-22', started_at: '2024-11-22T12:00:00Z', ended_at: '2024-11-22T16:00:00Z', distance_km: 10, coords: [[-77.5, -9.0], [-77.4, -9.0]] };
  assert.equal(placePhoto({ taken_at: '2024-11-22T08:00:00', date: '2024-11-22' }, [peru]).place_source, 'route-time');
  assert.equal(placePhoto({ taken_at: '2024-11-22T05:00:00', date: '2024-11-22' }, [peru]).place_source, 'route-date'); // before the hike started
});
