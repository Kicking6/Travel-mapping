// Geometry helpers shared by the browser, the Worker and the tests.
// Coordinates are always [lon, lat] (GeoJSON order) — the legacy app mixed
// [lat, lon] and [lon, lat] across the Python/JS bridge; this file is the only
// place that order is decided.

const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversineKm(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function lengthKm(coords) {
  let t = 0;
  for (let i = 1; i < coords.length; i++) t += haversineKm(coords[i - 1], coords[i]);
  return Math.round(t * 1000) / 1000;
}

export function bbox(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return coords.length ? [w, s, e, n] : null;
}

export function unionBbox(boxes) {
  const b = boxes.filter(Boolean);
  if (!b.length) return null;
  return [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1])),
    Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))];
}

export function bboxIntersects(a, b) {
  return !!a && !!b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

// Chaikin corner cutting (TA-2): each pass swaps every corner for two points a
// quarter and three quarters along its edges, so a jagged polyline becomes a
// smooth curve. Every pass doubles the points per segment (level 3 = 8x). The
// first and last points stay put; a runaway line stops growing at 20k points.
export function curve(coords, level) {
  let pts = coords;
  for (let i = 0; i < level && pts.length >= 3 && pts.length < 20000; i++) {
    const out = [pts[0]];
    for (let j = 0; j < pts.length - 1; j++) {
      const [ax, ay] = pts[j], [bx, by] = pts[j + 1];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// How far a short walk has turned into a dot (TA-4): 0 = still a line, 1 = a
// dot. `share` is the walk's size as a fraction of the map view; it starts to
// fade below `below` and is a dot by 70% of that — eased, so it never pops.
export function walkPoiAmount(share, below) {
  const t = Math.max(0, Math.min(1, (below - share) / (below * 0.3)));
  return t * t * (3 - 2 * t);
}

// Douglas–Peucker on a local equirectangular projection, tolerance in metres.
// Iterative (an explicit stack) so a 60k-point hike can't blow the call stack.
export function simplify(coords, toleranceM) {
  if (coords.length < 3 || !(toleranceM > 0)) return coords.slice();
  const lat0 = rad(coords[0][1]);
  const kx = 111320 * Math.cos(lat0), ky = 110574;
  const p = coords.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = p[a], [bx, by] = p[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = p[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return coords.filter((_, i) => keep[i]);
}

// Google encoded polyline, precision 5 (~1.1 m). Stores [lon, lat] pairs in
// the standard lat-first encoding so the strings are portable.
export function encodePolyline(coords, precision = 5) {
  const f = 10 ** precision;
  let out = '', pLat = 0, pLon = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * f), lo = Math.round(lon * f);
    out += enc(la - pLat) + enc(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}

export function decodePolyline(str, precision = 5) {
  const f = 10 ** precision, out = [];
  let i = 0, lat = 0, lon = 0;
  const dec = () => {
    let r = 0, s = 0, b;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < str.length) {
    lat += dec(); lon += dec();
    out.push([lon / f, lat / f]);
  }
  return out;
}

// A route's identity for duplicate detection: where it starts and ends, to
// ~100 m, plus its length to the nearest km. The same route exported at a
// different thinning resolution (the old 10 m / 100 m CSVs) keeps its
// fingerprint; a genuinely different trip between the same two towns almost
// never has the same length too.
export function fingerprint(coords) {
  if (!coords.length) return null;
  const a = coords[0], b = coords[coords.length - 1];
  const r = (v) => v.toFixed(3);
  return `${r(a[1])},${r(a[0])}>${r(b[1])},${r(b[0])}~${Math.round(lengthKm(coords))}`;
}

// Same start/end, length within 5% — used when fingerprints differ only by
// rounding on a boundary.
export function sameRoute(a, b) {
  if (!a || !b) return false;
  const [sa, la] = a.split('~'), [sb, lb] = b.split('~');
  if (sa !== sb) return false;
  const x = +la, y = +lb;
  return Math.abs(x - y) <= Math.max(1, 0.05 * Math.max(x, y));
}

// Great-circle arc between two [lon, lat] points, split at the antimeridian
// so MapLibre doesn't draw a line the long way round the world.
export function greatCircle(a, b, n = 128) {
  const [l1, p1] = [rad(a[0]), rad(a[1])], [l2, p2] = [rad(b[0]), rad(b[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [a.slice(), b.slice()];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    pts.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  // Unwrap longitudes so consecutive points never jump by more than 180°.
  for (let i = 1; i < pts.length; i++) {
    while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360;
    while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360;
  }
  return pts;
}

export function validCoord(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90
    && !(lon === 0 && lat === 0); // "null island" — the legacy flight file started a route there
}

// Point-in-polygon for country detection. `poly` is GeoJSON Polygon or
// MultiPolygon coordinates.
export function pointInPolygon(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const rings of polys) {
    if (inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h))) return true;
  }
  return false;
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Representative point: the vertex nearest the middle of the route by
// distance — for a loop hike the bbox centre can sit outside the country.
export function midpoint(coords) {
  if (coords.length <= 2) return coords[0];
  const half = lengthKm(coords) / 2;
  let t = 0;
  for (let i = 1; i < coords.length; i++) {
    t += haversineKm(coords[i - 1], coords[i]);
    if (t >= half) return coords[i];
  }
  return coords[coords.length - 1];
}
