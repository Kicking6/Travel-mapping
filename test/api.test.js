import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { env as makeEnv, signedIn } from './_d1.js';
import { routesFromGpx } from '../web/lib/gpx.js';

const gpx = (pts) => `<gpx version="1.1"><trk><trkseg>${pts.map(([x, y]) => `<trkpt lat="${y}" lon="${x}"/>`).join('')}</trkseg></trk></gpx>`;
const route = (name, pts, extra = {}) => ({ ...routesFromGpx(gpx(pts), { fileName: name, tripStart: '2024-07-21' }).routes[0], ...extra });
const A = [[10, 60], [10.1, 60.1], [10.2, 60.1]];
const B = [[-72.5, -13.5], [-72.6, -13.6]];

test('signed out: API is 401, pages show sign-in, assets are not served', async () => {
  const e = makeEnv();
  const api = await worker.fetch(new Request('https://atlas.test/api/routes'), e);
  assert.equal(api.status, 401);
  const home = await (await worker.fetch(new Request('https://atlas.test/'), e)).text();
  assert.match(home, /Email me a code/);
  const asset = await worker.fetch(new Request('https://atlas.test/app.js'), e);
  assert.equal(asset.status, 303);
});

test('sign-in: unknown email is refused; wrong code is refused and counted', async () => {
  const e = makeEnv();
  const post = (p, b) => worker.fetch(new Request('https://atlas.test' + p, { method: 'POST', body: new URLSearchParams(b) }), e);
  assert.equal((await post('/auth/code', { email: 'stranger@x.nz' })).status, 403);
  await post('/auth/code', { email: 'rory@x.nz' });
  const bad = await (await post('/auth/verify', { email: 'rory@x.nz', code: '000000' })).text();
  assert.match(bad, /wrong or has expired/);
  const row = e.DB.raw.prepare('SELECT attempts FROM login_codes ORDER BY id DESC').get();
  assert.ok(row.attempts === 1 || row.attempts === 0); // 0 only if the random code happened to be 000000
});

test('bootstrap seeds a default style and returns the trip', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const b = await api('GET', '/api/bootstrap');
  assert.equal(b.status, 200);
  assert.equal(b.body.me.isAdmin, true);
  assert.equal(b.body.trip.trip_start, '2024-07-21');
  assert.equal(b.body.styles[0].name, 'Album light');
});

test('import: stores routes, skips exact repeats, flags lookalikes for review', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const first = await api('POST', '/api/routes/import', { routes: [route('Le_Grammont - 18:05:2025.gpx', A, { source_hash: 'a'.repeat(64) }), route('day 137 busing.gpx', B)] });
  assert.equal(first.status, 200);
  assert.equal(first.body.inserted.length, 2);

  const again = await api('POST', '/api/routes/import', { routes: [route('Le_Grammont - 18:05:2025.gpx', A, { source_hash: 'a'.repeat(64) })] });
  assert.equal(again.body.inserted.length, 0);
  assert.match(again.body.skipped[0].reason, /already imported/);

  // Same road, different file (the "May 9 / May 10 driving" case): kept, flagged.
  const twin = route('May 10 2025 driving.gpx', [A[0], [10.05, 60.08], A[2]], { source_hash: 'b'.repeat(64), date: '2025-05-10' });
  const flagged = await api('POST', '/api/routes/import', { routes: [twin] });
  assert.equal(flagged.body.inserted.length, 1);
  assert.equal(flagged.body.flagged.length, 1);

  const list = await api('GET', '/api/routes');
  assert.equal(list.body.routes.length, 3);
  const bus = list.body.routes.find((r) => r.trip_day === 137);
  assert.equal(bus.type, 'bus');
  assert.equal(bus.date, '2024-12-04');
  assert.ok(list.body.routes.find((r) => r.review && r.review.possibleDuplicateName));
});

test('routes list is ETag-cached on the data version', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  await api('POST', '/api/routes/import', { routes: [route('a.gpx', A)] });
  const one = await api('GET', '/api/routes');
  const etag = one.headers.get('ETag');
  const same = await api('GET', '/api/routes', undefined, { 'If-None-Match': etag });
  assert.equal(same.status, 304);
  await api('PATCH', '/api/routes', { ids: [one.body.routes[0].id], fields: { name: 'Renamed' } });
  const changed = await api('GET', '/api/routes', undefined, { 'If-None-Match': etag });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.routes[0].name, 'Renamed');
  assert.equal(changed.body.routes[0].updated_by, 'rory@x.nz');
});

test('bulk edit validates fields; a manual date records its source', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const ins = await api('POST', '/api/routes/import', { routes: [route('Cathedral_Rock_Trail.gpx', A), route('x.gpx', B)] });
  const ids = ins.body.inserted;
  assert.equal((await api('PATCH', '/api/routes', { ids, fields: { colour: '#fff' } })).status, 400);
  assert.equal((await api('PATCH', '/api/routes', { ids, fields: { color: 'red' } })).status, 400);
  assert.equal((await api('PATCH', '/api/routes', { ids, fields: { date: '2024-09-20', country: 'US', color: '#AA0000' } })).status, 200);
  const r = (await api('GET', '/api/routes')).body.routes;
  assert.ok(r.every((x) => x.date === '2024-09-20' && x.date_source === 'manual' && x.color === '#aa0000'));
});

test('moving the trip start re-dates only "day N" routes', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  await api('POST', '/api/routes/import', { routes: [route('day 10 driving.gpx', A), route('Churup 23-11-2024.gpx', B)] });
  const res = await api('PATCH', '/api/trip', { trip_start: '2024-07-25' });
  assert.equal(res.body.redated, 1);
  const r = (await api('GET', '/api/routes')).body.routes;
  assert.equal(r.find((x) => x.trip_day === 10).date, '2024-08-03');
  assert.equal(r.find((x) => x.name === 'Churup').date, '2024-11-23');
});

test('import rejects junk geometry and oversized batches', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  assert.equal((await api('POST', '/api/routes/import', { routes: [{ name: 'x', geom: '' }] })).status, 400);
  assert.equal((await api('POST', '/api/routes/import', { routes: Array(61).fill(route('a.gpx', A)) })).status, 400);
});

test('originals: stored once by hash, downloadable', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const h = 'c'.repeat(64);
  assert.equal((await api('PUT', `/api/raw/${h}`, gpx(A), { 'X-File-Name': 'Le Grammont.gpx' })).status, 200);
  assert.equal((await api('PUT', `/api/raw/${h}`, gpx(A))).body.existed, true);
  const back = await api('GET', `/api/raw/${h}`);
  assert.match(back.body, /<gpx/);
  assert.match(back.headers.get('Content-Disposition'), /Le Grammont\.gpx/);
});

test('album maps and styles: create, validate, protect a style in use', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const style = await api('POST', '/api/styles', { name: 'Norway', spec: { land: '#eeeeee' } });
  assert.equal(style.status, 200);
  assert.equal((await api('POST', '/api/styles', { name: 'Bad', spec: { water: 'blue' } })).status, 400);
  const map = await api('POST', '/api/maps', {
    name: 'Norway', style_id: style.body.id, filter: { from: '2025-06-15', to: '2025-07-25', types: ['walk', 'drive', 'nope'] },
    paper: { w: 300, h: 300, dpi: 300 }, view: { bounds: [4, 57.9, 31.3, 71.2] },
  });
  assert.equal(map.status, 200);
  const b = await api('GET', '/api/bootstrap');
  const m = b.body.maps[0];
  assert.deepEqual(m.filter.types, ['walk', 'drive']);
  assert.equal(m.paper.dpi, 300);
  assert.equal((await api('DELETE', `/api/styles/${style.body.id}`)).status, 409);
  assert.equal((await api('POST', '/api/maps', { name: 'x', view: { bounds: [0, 10, 1, 5] } })).status, 400);
});

test('people: admin adds and removes; removed person loses their session', async () => {
  const e = makeEnv();
  const rory = await signedIn(worker, e);
  assert.equal((await rory('POST', '/api/people', { email: 'eva@x.nz', name: 'Eva' })).status, 200);
  const eva = await signedIn(worker, e, 'eva@x.nz');
  assert.equal((await eva('GET', '/api/bootstrap')).body.me.isAdmin, false);
  assert.equal((await eva('GET', '/api/people')).status, 403);
  await rory('DELETE', '/api/people', { email: 'eva@x.nz' });
  // The isolate cache is cleared on change, so the removal is immediate here.
  assert.equal((await eva('GET', '/api/bootstrap')).status, 401);
});

test('writes from another origin are refused', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const r = await api('PATCH', '/api/trip', { trip_name: 'x' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('import: thinned copies (My Maps CSV, 10 m / 100 m resolution GPX) are skipped, not flagged', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  const dense = Array.from({ length: 50 }, (_, i) => [10 + i * 0.004, 60 + Math.sin(i / 3) * 0.002]);
  await api('POST', '/api/routes/import', { routes: [route('Le_Grammont - 18:05:2025.gpx', dense, { source_hash: 'd'.repeat(64) })] });
  const thin = dense.filter((_, i) => i % 5 === 0 || i === 49); // real thinned files keep ≤20% of points
  const fromGpx = await api('POST', '/api/routes/import', { routes: [route('Le_Grammont.gpx', thin, { source_hash: 'e'.repeat(64) })] });
  assert.equal(fromGpx.body.inserted.length, 0);
  assert.match(fromGpx.body.skipped[0].reason, /simplified copy/);
  const fromCsv = await api('POST', '/api/routes/import', { routes: [route('Le_Grammont', dense.filter((_, i) => i % 2 === 0 || i === 49), { source_kind: 'csv' })] });
  assert.equal(fromCsv.body.inserted.length, 0);
});

test('duplicate verdicts on real ratios', async () => {
  const { duplicateVerdict } = await import('../worker/api/routes.js');
  const t = { fingerprint: 'a>b~20', point_count: 20000, geom: 'x' };
  assert.equal(duplicateVerdict({ fingerprint: 'a>b~11', point_count: 246, geom: 'y' }, t), 'simplified');   // Machu Picchu CSV: 0.54 length, 2% points
  assert.equal(duplicateVerdict({ fingerprint: 'a>b~20', point_count: 19000, geom: 'y' }, t), 'same');        // same route exported twice
  assert.equal(duplicateVerdict({ fingerprint: 'a>b~20', point_count: 9000, geom: 'y', source_kind: 'gpx' }, { ...t, point_count: 9500 }), 'same');
  assert.equal(duplicateVerdict({ fingerprint: 'a>b~20', point_count: 19500, geom: 'y', date: '2025-05-10' }, { ...t, date: '2025-05-09' }), 'lookalike'); // May 9 / May 10
  assert.equal(duplicateVerdict({ fingerprint: 'a>b~21', point_count: 12000, geom: 'y' }, t), 'lookalike');
  assert.equal(duplicateVerdict({ fingerprint: 'a>b~6', point_count: 9000, geom: 'y' }, t), null);            // another walk from the same house
});
