import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../worker/index.js';
import { env as makeEnv, signedIn } from './_d1.js';

const AIRPORTS = fs.readFileSync(new URL('../web/data/airports.json', import.meta.url), 'utf8');
const gpx = (pts, name = 'Track') => `<gpx version="1.1"><trk><name>${name}</name><trkseg>${pts.map(([x, y], i) => `<trkpt lat="${y}" lon="${x}"><time>2025-05-18T0${i}:00:00Z</time></trkpt>`).join('')}</trkseg></trk></gpx>`;

async function setup() {
  const e = makeEnv({ ASSETS: { fetch: async (req) => (new URL(req.url).pathname === '/data/airports.json' ? new Response(AIRPORTS) : new Response('<!doctype html>')) } });
  const app = await signedIn(worker, e);
  const { body } = await app('POST', '/api/tokens', { name: 'Claude' });
  let n = 0;
  const mcp = async (method, params, { token = body.token, viaPath = false } = {}) => {
    const r = await worker.fetch(new Request(`https://atlas.test/mcp${viaPath ? '/' + token : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(viaPath ? {} : { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }),
    }), e);
    return { status: r.status, body: r.status === 202 ? null : await r.json() };
  };
  const call = async (name, args) => {
    const r = await mcp('tools/call', { name, arguments: args });
    const res = r.body.result;
    return { isError: !!res.isError, data: res.structuredContent, text: res.content[0].text };
  };
  return { e, app, token: body.token, mcpUrl: body.mcpUrl, mcp, call };
}

test('handshake, tool list, notifications, and both ways to pass the token', async () => {
  const { mcp, token, mcpUrl } = await setup();
  assert.match(mcpUrl, /\/mcp\/ta_/);
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'trip-atlas');
  const list = await mcp('tools/list', {});
  const names = list.body.result.tools.map((t) => t.name);
  for (const n of ['trip_summary', 'list_routes', 'update_routes', 'import_gpx', 'add_route', 'add_flights', 'find_missing_travel', 'save_places', 'update_style']) assert.ok(names.includes(n), n);
  assert.ok(list.body.result.tools.every((t) => t.inputSchema.type === 'object'));
  const viaPath = await mcp('ping', {}, { viaPath: true });
  assert.deepEqual(viaPath.body.result, {});
  const r = await worker.fetch(new Request('https://atlas.test/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), (await setup()).e);
  assert.ok([202, 401].includes(r.status));
});

test('no token or a revoked token → 401', async () => {
  const { mcp, app, e } = await setup();
  assert.equal((await mcp('ping', {}, { token: 'ta_' + 'x'.repeat(32) })).status, 401);
  const { body } = await app('GET', '/api/tokens');
  await app('DELETE', `/api/tokens/${body.tokens[0].id}`);
  const { forgetAll } = await import('../worker/auth.js');
  forgetAll();
  assert.equal((await mcp('ping', {})).status, 401);
  void e;
});

test('import a GPX, find it, rename it, hide it, delete it', async () => {
  const { call } = await setup();
  const imp = await call('import_gpx', { gpx: gpx([[6.85, 46.35], [6.87, 46.37], [6.9, 46.4]], 'Le Grammont'), file_name: 'Le_Grammont - 18:05:2025.gpx' });
  assert.equal(imp.isError, false, imp.text);
  assert.equal(imp.data.inserted.length, 1);
  const again = await call('import_gpx', { gpx: gpx([[6.85, 46.35], [6.87, 46.37], [6.9, 46.4]], 'Le Grammont'), file_name: 'Le_Grammont - 18:05:2025.gpx' });
  assert.equal(again.data.inserted.length, 0);
  const found = await call('list_routes', { search: 'Grammont' });
  assert.equal(found.data.total, 1);
  const id = found.data.routes[0].id;
  assert.equal(found.data.routes[0].date, '2025-05-18');
  await call('update_routes', { ids: [id], fields: { name: 'Le Grammont summit', hidden: true, color: '#aa0000' } });
  const one = await call('get_route', { id, geometry: 'detail' });
  assert.deepEqual([one.data.name, one.data.hidden, one.data.color], ['Le Grammont summit', 1, '#aa0000']);
  assert.ok(one.data.coordinates.length >= 2);
  assert.equal((await call('list_routes', { search: 'Grammont' })).data.total, 0);       // hidden
  assert.equal((await call('delete_routes', { ids: [id], confirm: false })).isError, true);
  assert.equal((await call('delete_routes', { ids: [id], confirm: true })).isError, false);
});

test('add a layover flight and a hand-drawn boat route; bad input is an error, not a crash', async () => {
  const { call } = await setup();
  const f = await call('add_flights', { itineraries: [{ route: 'LIM SCL PUQ', date: '2024-12-18', notes: 'NYBZTX' }], text: '2025-02-26 ZRH GOT\nnonsense' });
  assert.equal(f.isError, false, f.text);
  assert.equal(f.data.inserted.length, 3);
  assert.equal(f.data.errors.length, 1);
  const legs = await call('list_routes', { type: 'flight' });
  assert.match(legs.data.routes.find((r) => r.source_name === 'SCL-PUQ').notes, /Itinerary LIM → SCL → PUQ \(leg 2 of 2\) · NYBZTX/);
  const boat = await call('add_route', { name: 'Kayak to Stigen', type: 'boat', date: '2025-07-01', coordinates: [[13.0, 67.9], [13.05, 67.92], [13.1, 67.93]], notes: 'paddled' });
  assert.equal(boat.data.inserted.length, 1);
  assert.equal((await call('add_flights', { text: 'XXX YYY' })).isError, true);
  assert.equal((await call('add_route', { name: 'x', type: 'walk' })).isError, true);
  assert.equal((await call('update_routes', { ids: [1], fields: { color: 'red' } })).isError, true);
});

test('missing travel, summary, style change and places through MCP', async () => {
  const { call } = await setup();
  const noTimes = '<gpx version="1.1"><trk><trkseg><trkpt lat="19.43" lon="-99.13"/><trkpt lat="19.44" lon="-99.12"/></trkseg></trk></gpx>';
  await call('import_gpx', { gpx: noTimes, file_name: 'Walk - 16:11:2024.gpx' });
  await call('save_places', { places: [{ name: 'Hotel Churup', lat: -9.53, lon: -77.53, kind: 'stay', date: '2024-11-20' }] });
  const gaps = await call('find_missing_travel', { min_km: 400 });
  assert.equal(gaps.data.gaps.length, 1);
  // Hub to hub: Mexico City to a large Peruvian airport (Lima or Trujillo — both are 'large'; the user edits before adding).
  assert.match(gaps.data.gaps[0].suggest, /^MEX (LIM|TRU)$/);
  const s = await call('trip_summary', {});
  assert.equal(s.data.trip.trip_start, '2024-07-21');
  await call('get_style', {});
  const st = await call('update_style', { id: 1, changes: { land: '#efe3c8', routes: { walk: { width: 4 } } } });
  assert.equal(st.isError, false, 'update_style: ' + st.text);
  const back = await call('get_style', { id: 1 });
  assert.deepEqual([back.data.spec.land, back.data.spec.routes.walk.width], ['#efe3c8', 4]);
  const airports = await call('search_airports', { query: 'punta arenas' });
  assert.equal(airports.data.airports[0].code, 'PUQ');
});
