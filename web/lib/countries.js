// Which country a route is in, worked out in the browser from Natural Earth
// 1:50m boundaries (world-atlas, ~750 KB, fetched once on demand). The legacy
// database had a country on 1 route of 208.
import { pointInPolygon, midpoint, bbox as bboxOf } from './geo.js';

const URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
let loading = null;

// Minimal TopoJSON → GeoJSON for Polygon/MultiPolygon (quantized, delta-encoded arcs).
function decodeTopo(topo, objName) {
  const { scale, translate } = topo.transform || { scale: [1, 1], translate: [0, 0] };
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
  });
  const ring = (ids) => {
    const out = [];
    for (const i of ids) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  return topo.objects[objName].geometries.map((g) => {
    const geom = g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.arcs.map(ring) }
      : g.type === 'MultiPolygon' ? { type: 'MultiPolygon', coordinates: g.arcs.map((p) => p.map(ring)) } : null;
    if (!geom) return null;
    const flat = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates.flatMap((p) => p[0]);
    return { name: (g.properties && g.properties.name) || g.id, geom, bbox: bboxOf(flat) };
  }).filter(Boolean);
}

// One feature per polygon, wound the GeoJSON way (outer anticlockwise, holes
// clockwise). world-atlas winds the other way round; drawn as-is, tiles that
// sit wholly inside a continent came out as sea.
const signedArea = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return a / 2; };
const wind = (ring, ccw) => ((signedArea(ring) > 0) === ccw ? ring : ring.slice().reverse());
export function splitAndRewind(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map((rings) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings.map((r, i) => wind(r, i === 0)) } }));
}

// Natural Earth land at 1:10m / 1:50m / 1:110m — the "coastline detail" knob.
// The same coast drawn at roughly 1 km, 5 km or 30 km resolution.
const landLoads = new Map();
export function loadLand(scale) {
  if (!['10m', '50m', '110m'].includes(scale)) return Promise.reject(new Error('Unknown land scale'));
  if (!landLoads.has(scale)) {
    landLoads.set(scale, fetch(`https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-${scale}.json`)
      .then((r) => { if (!r.ok) throw new Error('Could not load coastlines'); return r.json(); })
      .then((t) => ({ type: 'FeatureCollection', features: decodeTopo(t, 'land').flatMap((x) => splitAndRewind(x.geom)) })));
  }
  return landLoads.get(scale);
}

export function loadCountries() {
  if (!loading) loading = fetch(URL).then((r) => { if (!r.ok) throw new Error('Could not load country boundaries'); return r.json(); }).then((t) => decodeTopo(t, 'countries'));
  return loading;
}

export function countryAt(countries, pt) {
  for (const c of countries) {
    const b = c.bbox;
    if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
    if (pointInPolygon(pt, c.geom)) return c.name;
  }
  return null;
}

// Start, middle and end of the route; a ferry or border-crossing drive gets
// every country it touches, in travel order ("Sardinia → Sicily" is one
// country; "Austria, Italy" is two). Points at sea are skipped.
export function countriesFor(countries, coords) {
  if (!coords || !coords.length) return null;
  const probes = [coords[0], midpoint(coords), coords[coords.length - 1]];
  const names = [];
  for (const p of probes) { const n = countryAt(countries, p); if (n && !names.includes(n)) names.push(n); }
  return names.length ? names.join(', ') : null;
}
