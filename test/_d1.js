// Test helper (Site Scout's test/_d1.js pattern): a D1-shaped wrapper over
// Node's built-in SQLite with every migration applied, plus an in-memory R2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));

export function d1() {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(here, '../migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  const prepare = (sql) => {
    let args = [];
    const s = {
      bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return s; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() {
        if (/\bRETURNING\b/i.test(sql)) return { results: db.prepare(sql).all(...args), meta: { changes: 1 } };
        const r = db.prepare(sql).run(...args);
        return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return s;
  };
  return {
    prepare,
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
    raw: db,
  };
}

export function r2() {
  const objects = new Map();
  return {
    objects,
    async head(k) { return objects.has(k) ? {} : null; },
    async get(k) { const o = objects.get(k); return o ? { body: o.body, customMetadata: o.meta } : null; },
    async put(k, v, opts = {}) { objects.set(k, { body: typeof v === 'string' ? v : await new Response(v).text(), meta: opts.customMetadata || {} }); },
    async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
  };
}

export function env(extra = {}) {
  return {
    DB: d1(), ORIGINALS: r2(), OPERATOR_EMAILS: 'rory@x.nz', DEV_SHOW_CODE: '1',
    ASSETS: { fetch: async () => new Response('<!doctype html>app', { headers: { 'Content-Type': 'text/html' } }) },
    ...extra,
  };
}

// Sign a person in through the real /auth endpoints and return a fetch helper
// that carries their session cookie.
export async function signedIn(worker, e, email = 'rory@x.nz') {
  const post = (p, body) => worker.fetch(new Request('https://atlas.test' + p, {
    method: 'POST', body: new URLSearchParams(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }), e);
  const page = await (await post('/auth/code', { email })).text();
  const code = (page.match(/Your code is <strong>(\d{6})<\/strong>/) || [])[1];
  if (!code) throw new Error('no dev code on page: ' + page.slice(0, 300));
  const res = await post('/auth/verify', { email, code });
  const cookie = (res.headers.get('Set-Cookie') || '').split(';')[0];
  return async (method, p, body, headers = {}) => {
    const r = await worker.fetch(new Request('https://atlas.test' + p, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }), e);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: r.status, body: data, headers: r.headers };
  };
}
