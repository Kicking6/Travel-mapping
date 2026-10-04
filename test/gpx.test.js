import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGpx, routesFromGpx, routesFromWktCsv, placesFromCsv, localDate, flightRoute } from '../web/lib/gpx.js';
import { simplify, encodePolyline, decodePolyline, lengthKm, greatCircle, fingerprint, sameRoute, pointInPolygon } from '../web/lib/geo.js';
import { resolveStyle, validateStyle, styleFromLegacy } from '../web/lib/style.js';

const gpx = (pts, { times = false, ns = '', meta = '' } = {}) => `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${meta}
<${ns}trk><${ns}name>Track</${ns}name><${ns}trkseg>
${pts.map(([lon, lat], i) => `<${ns}trkpt lat="${lat}" lon="${lon}">${times ? `<${ns}time>2025-05-18T0${i}:00:00Z</${ns}time>` : ''}</${ns}trkpt>`).join('\n')}
</${ns}trkseg></${ns}trk></gpx>`;

const LINE = [[6.85, 46.35], [6.86, 46.36], [6.87, 46.37], [6.88, 46.36]];

test('parses track points as [lon, lat]', () => {
  const g = parseGpx(gpx(LINE));
  assert.equal(g.tracks.length, 1);
  assert.deepEqual(g.tracks[0].coords[0], [6.85, 46.35]);
});

test('namespace-prefixed GPX', () => {
  const t = gpx(LINE).replace(/<(\/?)(trk|trkseg|trkpt|name)\b/g, '<$1gpx:$2');
  assert.equal(parseGpx(t).tracks[0].coords.length, 4);
});

test('recorded timestamps beat the file name; one timestamp alone is ignored', () => {
  const rec = routesFromGpx(gpx(LINE, { times: true }), { fileName: 'Walk - 01:01:2025.gpx' }).routes[0];
  assert.equal(rec.date, '2025-05-18');
  assert.equal(rec.date_source, 'gps-time');
  // mapstogpx writes a single <time> in metadata — that's the export date.
  const one = routesFromGpx(gpx(LINE, { meta: '<metadata><time>2026-06-14T00:00:00Z</time></metadata>' }), { fileName: 'August 02 2025 driving.gpx' }).routes[0];
  assert.equal(one.date, '2025-08-02');
  assert.equal(one.date_source, 'filename');
});

test('UTC time → local calendar date by longitude', () => {
  // 03:00 UTC in Peru (−77°) is still the previous evening there.
  assert.equal(localDate('2024-11-23T03:00:00Z', -77.5), '2024-11-22');
  assert.equal(localDate('2024-11-23T03:00:00Z', 10), '2024-11-23');
});

test('null-island and out-of-range points are dropped with a warning', () => {
  const g = parseGpx(gpx([[0, 0], ...LINE, [200, 10]]));
  assert.equal(g.tracks[0].coords.length, 4);
  assert.match(g.warnings[0], /2 invalid/);
});

test('not a GPX file', () => {
  assert.match(parseGpx('<html></html>').warnings[0], /Not a GPX/);
});

test('route record carries simplified geometry, fingerprint, folder-derived type', () => {
  const r = routesFromGpx(gpx(LINE), { fileName: 'Cathedral_Rock_Trail.gpx', folderPath: 'Walking/Cathedral_Rock_Trail.gpx' }).routes[0];
  assert.equal(r.type, 'walk');
  assert.ok(r.distance_km > 3 && r.distance_km < 5);
  assert.equal(decodePolyline(r.geom).length, 3); // the collinear second point goes
  assert.ok(r.fingerprint.startsWith('46.350,6.850>'));
});

test('WKT CSV (Google My Maps export) imports as routes', () => {
  const csv = '﻿WKT,name,description\n"LINESTRING (9.1 39.2, 9.2 39.3, 9.3 39.4)",BOAT - September 13 Car Ferry Sardinia to Sicily,\n"LINESTRING (1 1)",Broken,\n';
  const r = routesFromWktCsv(csv, { tripStart: '2024-07-21' });
  assert.equal(r.routes.length, 1);
  assert.equal(r.routes[0].type, 'boat');
  assert.equal(r.routes[0].date_source, 'suggested'); // no year in the name: Sept is in 2024 and 2025
  assert.match(r.warnings[0], /Broken/);
});

test('places CSV', () => {
  const r = placesFromCsv('name,lat,lon,type,notes\n"Base Camp",-13.4,-72.5,Tent,views\nBad,999,1,hotel,\n');
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].kind, 'tent');
  assert.match(r.warnings[0], /Row 3/);
});

test('simplify keeps ends and drops collinear points', () => {
  const line = Array.from({ length: 101 }, (_, i) => [174 + i * 0.001, -36]);
  const s = simplify(line, 5);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], line[0]);
  assert.deepEqual(s[1], line[100]);
});

test('simplify handles a 60k-point line without recursion', () => {
  const line = Array.from({ length: 60000 }, (_, i) => [10 + i * 1e-5, 60 + Math.sin(i / 50) * 1e-3]);
  const s = simplify(line, 4);
  assert.ok(s.length > 10 && s.length < 60000);
});

test('polyline round-trips to ~1 m', () => {
  const line = [[-72.545123, -13.163456], [-72.546, -13.164], [179.9, -16.5]];
  const back = decodePolyline(encodePolyline(line));
  back.forEach((p, i) => { assert.ok(Math.abs(p[0] - line[i][0]) < 1e-5); assert.ok(Math.abs(p[1] - line[i][1]) < 1e-5); });
});

test('great circle crosses the antimeridian without wrapping the world', () => {
  const arc = greatCircle([174.78, -36.85], [-118.4, 33.94]); // AKL → LAX
  for (let i = 1; i < arc.length; i++) assert.ok(Math.abs(arc[i][0] - arc[i - 1][0]) < 10);
  assert.ok(lengthKm(arc) > 10000 && lengthKm(arc) < 11000);
});

test('flight route is typed and dated manually', () => {
  const r = flightRoute({ code: 'AKL', coord: [174.78, -36.85] }, { code: 'LAX', coord: [-118.4, 33.94] }, { date: '2024-07-20' });
  assert.equal(r.type, 'flight');
  assert.equal(r.date, '2024-07-20');
  assert.equal(r.name, 'AKL To LAX');
});

test('sameRoute tolerates small length differences only', () => {
  const a = fingerprint([[1, 1], [1.1, 1.1]]);
  assert.ok(sameRoute(a, a));
  assert.ok(!sameRoute(a, fingerprint([[1, 1], [1.05, 1.3], [1.1, 1.1]])));
});

test('point in polygon with a hole', () => {
  const sq = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.ok(pointInPolygon([2, 2], sq));
  assert.ok(!pointInPolygon([5, 5], sq));
  assert.ok(!pointInPolygon([12, 5], sq));
});

test('style: saved spec merges onto defaults; junk is dropped; open sets keep new kinds', () => {
  const s = resolveStyle({ land: '#ffffff', bogus: 1, places: { kinds: { glamping: { color: '#123456', size: 7, show: true } } } });
  assert.equal(s.land, '#ffffff');
  assert.equal(s.bogus, undefined);
  assert.equal(s.places.kinds.glamping.color, '#123456');
  assert.ok(s.places.kinds.tent);
  assert.equal(validateStyle(s), null);
  assert.match(validateStyle(resolveStyle({ water: 'blue' })), /water/);
});

test('style: legacy desktop settings carry over', () => {
  const s = styleFromLegacy({ 'mapstyle.land_color': '#6da7c6', 'mapstyle.show_boundaries': '1', 'mapstyle.route_weight': '3', 'mapstyle.route_opacity': '76' });
  assert.equal(s.land, '#6da7c6');
  assert.equal(s.routes.walk.width, 3);
  assert.equal(s.routeOpacity, 0.76);
});

test('land polygons are split and rewound: outer ring anticlockwise, holes clockwise', async () => {
  const { splitAndRewind } = await import('../web/lib/countries.js');
  const cw = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];        // clockwise outer (world-atlas style)
  const ccwHole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];       // anticlockwise hole
  const [f] = splitAndRewind({ type: 'MultiPolygon', coordinates: [[cw, ccwHole]] });
  const area = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
  assert.ok(area(f.geometry.coordinates[0]) > 0);
  assert.ok(area(f.geometry.coordinates[1]) < 0);
});
