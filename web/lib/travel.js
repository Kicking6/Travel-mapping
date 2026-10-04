// Flights with layovers, and finding travel the trip is missing — pure, shared
// by the Import page, the Review queue, the MCP connector and the tests.
import { haversineKm, flightRoute } from './geo-flight.js';

// "AKL LAX JFK", "AKL-LAX-JFK", "AKL > LAX > JFK", "akl→lax→jfk" → ['AKL','LAX','JFK']
export function parseItinerary(s) {
  const codes = String(s || '').toUpperCase().split(/[^A-Z]+/).filter((c) => /^[A-Z]{3}$/.test(c));
  return codes.length >= 2 ? codes : null;
}

// One flight (with any layovers) per line:
//   2024-07-23 AKL LAX JFK  Air NZ via LAX
//   23/07/2024 AKL-LAX-JFK          (day first)
//   AKL LAX                          (no date)
// Returns [{ date, codes, notes, line }] and errors per bad line.
export function parseFlightLines(text) {
  const out = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let date = null, rest = line, m;
    if ((m = rest.match(/^(\d{4})-(\d{2})-(\d{2})\b\s*/))) { date = `${m[1]}-${m[2]}-${m[3]}`; rest = rest.slice(m[0].length); }
    else if ((m = rest.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b\s*/))) { date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; rest = rest.slice(m[0].length); }
    // Codes are capitals, like a boarding pass — so "Air NZ" in the notes isn't
    // read as an airport. An all-lowercase line ("akl lax jfk") is upper-cased first.
    if (rest === rest.toLowerCase()) rest = rest.replace(/^((?:[a-z]{3}\s*(?:[-–—>→,\s]|to)\s*)+[a-z]{3})\b/, (x) => x.toUpperCase());
    const cm = rest.match(/^((?:[A-Z]{3}\s*(?:[-–—>→,\s]|to)\s*)+[A-Z]{3})\b\s*(.*)$/);
    const codes = cm && parseItinerary(cm[1].replace(/\bto\b/g, ' '));
    if (!codes) { errors.push(`Line ${i + 1}: couldn't read airport codes in “${line}”`); return; }
    out.push({ date, codes, notes: (cm[2] || '').trim() || null, line });
  });
  return { flights: out, errors };
}

// One route record per leg; a layover's legs share the date and carry the
// whole itinerary in their notes, so "AKL → LAX → JFK" reads as one trip.
export function flightLegs(codes, airports, { date = null, notes = null } = {}) {
  const missing = codes.filter((c) => !airports[c]);
  if (missing.length) throw new Error(`Unknown airport code${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  const name = (c) => airports[c][3] || airports[c][2] || c;
  const trip = codes.join(' → ');
  return codes.slice(1).map((to, i) => {
    const from = codes[i];
    const r = flightRoute({ code: from, coord: airports[from].slice(0, 2) }, { code: to, coord: airports[to].slice(0, 2) }, { date, name: `${name(from)} → ${name(to)}` });
    r.source_name = `${from}-${to}`;
    r.notes = [codes.length > 2 ? `Itinerary ${trip} (leg ${i + 1} of ${codes.length - 1})` : null, notes].filter(Boolean).join(' · ') || null;
    return r;
  });
}

// minSize: 3 = large airports only (long-haul jumps land at hubs), 1 = any.
// Within a size, a big airport a bit further still beats a strip next door.
export function nearestAirport(airports, [lon, lat], { maxKm = 400, minSize = 1 } = {}) {
  let best = null;
  for (const [code, a] of Object.entries(airports)) {
    const size = a[5] || (/international|intl/i.test(a[2]) ? 3 : 1);
    if (size < minSize) continue;
    const d = haversineKm([lon, lat], [a[0], a[1]]);
    const score = d / (size === 3 ? 1 : size === 2 ? 0.6 : 0.3);
    if (d <= maxKm && (!best || score < best.score)) best = { code, km: d, score, name: a[2], city: a[3] };
  }
  return best;
}
// Long jumps fly hub to hub; short hops can use regional airports.
export function suggestFlight(airports, a, b, km) {
  const minSize = km > 1500 ? 3 : 2;
  const fa = nearestAirport(airports, a, { minSize, maxKm: 450 }) || nearestAirport(airports, a);
  const fb = nearestAirport(airports, b, { minSize, maxKm: 450 }) || nearestAirport(airports, b);
  return fa && fb && fa.code !== fb.code ? { from: fa.code, to: fb.code, fromName: fa.city || fa.name, toName: fb.city || fb.name } : null;
}

/**
 * Where the trip jumps further than `minKm` with nothing recorded in between.
 * routes: [{id, name, date, type, coords}], places: [{name, lat, lon, date}]
 * Returns [{ d0, d1, km, from, to, a:[lon,lat], b:[lon,lat], suggest? }], biggest first.
 */
export function findMissingTravel(routes, places = [], { minKm = 400, airports = null } = {}) {
  const ev = [];
  for (const p of places) if (p.date && p.lat != null && !p.hidden) ev.push({ date: p.date, t: 0.9, pos: [p.lon, p.lat], what: `Stayed at ${p.name || 'a place'}` });
  for (const r of routes) {
    if (!r.date || !r.coords || r.coords.length < 2 || r.hidden) continue;
    const k = r.started_at ? Date.parse(r.started_at) % 86400000 / 86400000 * 0.5 : 0.3;
    ev.push({ date: r.date, t: 0.1 + k, pos: r.coords[0], what: `Start of ${r.name}`, route: r });
    ev.push({ date: r.date, t: 0.11 + k, pos: r.coords[r.coords.length - 1], what: `End of ${r.name}`, route: r });
  }
  ev.sort((x, y) => x.date.localeCompare(y.date) || x.t - y.t);
  const out = [];
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1], b = ev[i];
    if (a.route && a.route === b.route) continue;               // a route's own start → end
    const km = haversineKm(a.pos, b.pos);
    if (km < minKm) continue;
    const gap = { d0: a.date, d1: b.date, km: Math.round(km), from: a.what, to: b.what, a: a.pos, b: b.pos };
    if (airports) { const s = suggestFlight(airports, a.pos, b.pos, km); if (s) gap.suggest = s; }
    out.push(gap);
  }
  // Same-day multi-part drives produce out-of-order jumps between their parts; keep only jumps
  // whose two ends aren't both on the same day's routes.
  return out.filter((g) => !(g.d0 === g.d1 && /^(Start|End) of/.test(g.from) && /^(Start|End) of/.test(g.to))).sort((x, y) => y.km - x.km);
}
