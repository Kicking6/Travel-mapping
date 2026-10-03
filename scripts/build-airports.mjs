// Builds web/data/airports.json from the Global Airport Database
// (GlobalAirportDatabase.txt in the old "Python - OE Trip Map Generator"
// folder): ICAO:IATA:NAME:CITY:COUNTRY:…:lat:lon. Keeps airports with an IATA
// code and real coordinates. Run once: node scripts/build-airports.mjs <path>
import fs from 'node:fs';
const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-airports.mjs GlobalAirportDatabase.txt'); process.exit(1); }
const out = {};
for (const line of fs.readFileSync(src, 'latin1').split(/\r?\n/)) {
  const f = line.split(':');
  if (f.length < 16) continue;
  const iata = f[1].trim(), lat = parseFloat(f[14]), lon = parseFloat(f[15]);
  if (!/^[A-Z0-9]{3}$/.test(iata) || iata === 'N/A' || (!lat && !lon)) continue;
  const tc = (s) => s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  out[iata] = [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, tc(f[2]) === 'N/A' ? '' : tc(f[2]), tc(f[3]), tc(f[4])];
}
fs.writeFileSync(new URL('../web/data/airports.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'airports');

// Missing from the old database, needed for this trip (the legacy flight file
// drew EZE → YYZ from 0,0 because of it).
const extra = { EZE: [-58.5358, -34.8222, 'Ministro Pistarini (Ezeiza)', 'Buenos Aires', 'Argentina'] };
const file = new URL('../web/data/airports.json', import.meta.url);
fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...extra }));
