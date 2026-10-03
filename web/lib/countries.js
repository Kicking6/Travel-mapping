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
