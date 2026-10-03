// Carries the desktop app's tuned map look (app_config 'mapstyle.*' in
// ~/.gpx_manager/routes.db) over as a named style. Opens the old database
// read-only; changes nothing there.
//   node scripts/legacy-style.mjs --url http://127.0.0.1:8788 --email you@example.com
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { styleFromLegacy } from '../web/lib/style.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--url', 'http://127.0.0.1:8788'), email = arg('--email');
const dbPath = arg('--db', `${os.homedir()}/.gpx_manager/routes.db`);
const db = new DatabaseSync(dbPath, { readOnly: true });
const cfg = Object.fromEntries(db.prepare("SELECT key, value FROM app_config WHERE key LIKE 'mapstyle.%'").all().map((r) => [r.key, r.value]));
db.close();
const spec = styleFromLegacy(cfg);
console.log(`${Object.keys(cfg).length} legacy settings → land ${spec.land}, water ${spec.water}, labels ${spec.labels.show ? spec.labels.density : 'off'}`);

const form = (b) => ({ method: 'POST', body: new URLSearchParams(b), redirect: 'manual' });
const page = await (await fetch(`${base}/auth/code`, form({ email }))).text();
const code = (page.match(/Your code is <strong>(\d{6})<\/strong>/) || [])[1];
if (!code) throw new Error('This script signs in with a dev code; run it against a local server (DEV_SHOW_CODE=1)');
const cookie = ((await fetch(`${base}/auth/verify`, form({ email, code }))).headers.get('set-cookie') || '').split(';')[0];
const res = await fetch(`${base}/api/styles`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Desktop app look', spec }) });
console.log(res.status, await res.text());
