// Builds web/data/airports.json — IATA code → [lon, lat, name, city, ISO country].
// Source: OurAirports (public domain), https://davidmegginson.github.io/ourairports-data/airports.csv
// Keeps every airport with an IATA code that isn't closed. Run:
//   curl -sL -o /tmp/airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   node scripts/build-airports.mjs /tmp/airports.csv
import fs from 'node:fs';
import { parseCsv } from '../web/lib/gpx.js';
const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-airports.mjs airports.csv'); process.exit(1); }
const rows = parseCsv(fs.readFileSync(src, 'utf8'));
const head = rows.shift();
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const rank = { large_airport: 3, medium_airport: 2, small_airport: 1, seaplane_base: 0, heliport: 0 };
const out = {};
for (const r of rows) {
  const iata = (r[col.iata_code] || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata) || r[col.type] === 'closed') continue;
  const lat = +r[col.latitude_deg], lon = +r[col.longitude_deg];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const prev = out[iata];
  const score = (rank[r[col.type]] ?? 0) + (r[col.scheduled_service] === 'yes' ? 4 : 0);
  if (prev && prev.score >= score) continue; // a code shared by two places: keep the real airport
    // [lon, lat, name, city, ISO country, size: 3 large / 2 medium / 1 small]
  out[iata] = { score, v: [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, r[col.name], r[col.municipality] || '', r[col.iso_country], rank[r[col.type]] || 1] };
}
const flat = Object.fromEntries(Object.entries(out).map(([k, x]) => [k, x.v]));
fs.writeFileSync(new URL('../web/data/airports.json', import.meta.url), JSON.stringify(flat));
console.log(Object.keys(flat).length, 'airports');
