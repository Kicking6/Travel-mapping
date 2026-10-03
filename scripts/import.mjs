// Bulk import from folders on this Mac — the same parser, de-duplication and
// country lookup as the Import page (web/lib/*), for loading hundreds of files
// at once or re-loading after a reset.
//
//   node scripts/import.mjs --url http://127.0.0.1:8788 --email you@example.com [--keep-originals] <folder|file>...
//
// Signs in with a 6-digit code: locally (DEV_SHOW_CODE=1) it reads the code
// off the page; against the live site it asks you to type the emailed code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { routesFromGpx, routesFromWktCsv } from '../web/lib/gpx.js';
import { decodePolyline } from '../web/lib/geo.js';
import { loadCountries, countriesFor } from '../web/lib/countries.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const base = opt('--url', 'http://127.0.0.1:8788');
const email = opt('--email');
const keep = flag('--keep-originals');
const dryRun = flag('--dry-run');
if (!email || !args.length) { console.error('usage: node scripts/import.mjs --url <site> --email <you> [--keep-originals] [--dry-run] <folder|file>...'); process.exit(1); }

function walk(p, root = path.dirname(p)) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return fs.readdirSync(p).filter((n) => !n.startsWith('.')).flatMap((n) => walk(path.join(p, n), root));
  return /\.(gpx|csv)$/i.test(p) ? [{ abs: p, rel: path.relative(root, p) }] : [];
}

let cookie = '';
async function signIn() {
  const form = (b) => ({ method: 'POST', body: new URLSearchParams(b), redirect: 'manual' });
  const page = await (await fetch(`${base}/auth/code`, form({ email }))).text();
  let code = (page.match(/Your code is <strong>(\d{6})<\/strong>/) || [])[1];
  if (!code) {
    if (/Not on the list/.test(page)) throw new Error(`${email} can't sign in to ${base}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    code = (await rl.question(`Code emailed to ${email}: `)).trim();
    rl.close();
  }
  const res = await fetch(`${base}/auth/verify`, form({ email, code }));
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('Sign-in failed — wrong code?');
}
async function api(method, p, body, headers = {}, retried = false) {
  let res;
  try {
    res = await fetch(base + p, { method, headers: { Cookie: cookie, Origin: base, ...(typeof body === 'string' ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  } catch (e) {
    // A pooled keep-alive socket the server already closed — one retry on a fresh one.
    if (!retried && /ECONNRESET|socket|fetch failed/i.test(String(e.cause || e))) return api(method, p, body, headers, true);
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${p} → ${res.status}`);
  return data;
}

const files = args.flatMap((a) => walk(path.resolve(a)));
console.log(`${files.length} files`);
// Trip start is needed to date "day N" files; fetch it, then parse, then sign
// in again only if the parse outlived the connection (handled by api's retry).
await signIn();
const { trip } = await api('GET', '/api/bootstrap');
const countries = await loadCountries();

const recs = [];
let problems = 0;
for (const { abs, rel } of files) {
  const text = fs.readFileSync(abs, 'utf8');
  const ctx = { fileName: path.basename(abs), folderPath: rel, tripStart: trip.trip_start };
  const res = /\.csv$/i.test(abs) ? routesFromWktCsv(text, ctx) : routesFromGpx(text, ctx);
  if (!res.routes.length) { problems++; console.warn(`  ! ${rel}: ${res.warnings.join('; ')}`); }
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  for (const r of res.routes) {
    r.source_hash = res.routes.length === 1 ? hash : null;
    r.country = countriesFor(countries, decodePolyline(r.geom_lo || r.geom));
    recs.push({ r, text: res.routes.length === 1 && /\.gpx$/i.test(abs) ? text : null });
  }
}
console.log(`${recs.length} routes parsed (${problems} files unreadable); ${recs.filter((x) => !x.r.date).length} without a date`);
if (dryRun) process.exit(0);

let inserted = 0, skipped = 0, flagged = 0;
for (let i = 0; i < recs.length; i += 40) {
  const d = await api('POST', '/api/routes/import', { routes: recs.slice(i, i + 40).map((x) => x.r) });
  inserted += d.inserted.length; skipped += d.skipped.length; flagged += d.flagged.length;
  process.stdout.write(`\r  ${Math.min(i + 40, recs.length)} / ${recs.length}`);
}
console.log(`\n${inserted} imported, ${skipped} already there, ${flagged} flagged as possible duplicates`);
if (keep) {
  let n = 0;
  for (const { r, text } of recs) {
    if (!text || !r.source_hash) continue;
    await api('PUT', `/api/raw/${r.source_hash}`, text, { 'X-File-Name': encodeURIComponent(r.source_name || 'route.gpx'), 'Content-Type': 'application/gpx+xml' });
    if (++n % 25 === 0) process.stdout.write(`\r  originals kept: ${n}`);
  }
  console.log(`\r  originals kept: ${n}`);
}
