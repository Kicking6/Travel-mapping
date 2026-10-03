// Helpers every API module uses. Each module exports handle(request, env, url, user)
// and returns a Response, or undefined when the path isn't its own (the
// akahu-ledger api/<domain>.js dispatcher pattern).

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
export const err = (message, status = 400) => json({ error: message }, status);

export async function readJson(request, maxBytes = 8 * 1024 * 1024) {
  const len = +request.headers.get('Content-Length') || 0;
  if (len > maxBytes) throw new HttpError(413, 'Request too large');
  try { return await request.json(); } catch (_) { throw new HttpError(400, 'Body must be JSON'); }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function bumpVersion(env) {
  await env.DB.prepare('UPDATE data_version SET version = version + 1 WHERE id = 1').run();
}
export async function dataVersion(env) {
  const r = await env.DB.prepare('SELECT version FROM data_version WHERE id = 1').first();
  return r ? r.version : 0;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const HEX = /^#[0-9a-f]{6}$/i;
export const isId = (v) => Number.isInteger(v) && v > 0;

// Field whitelist + coercion for PATCH bodies. `spec` maps field → validator
// returning the stored value or throwing. Unknown fields are an error, so a
// typo in the front end can't silently do nothing.
export function pick(body, spec) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!(k in spec)) throw new HttpError(400, `Unknown field: ${k}`);
    out[k] = spec[k](v);
  }
  return out;
}

export const v = {
  text: (max = 500) => (x) => {
    if (x == null || x === '') return null;
    if (typeof x !== 'string') throw new HttpError(400, 'Expected text');
    return x.trim().slice(0, max) || null;
  },
  name: (x) => {
    const s = typeof x === 'string' ? x.trim().slice(0, 200) : '';
    if (!s) throw new HttpError(400, 'Name is required');
    return s;
  },
  date: (x) => {
    if (x == null || x === '') return null;
    if (!ISO_DATE.test(x) || Number.isNaN(Date.parse(x))) throw new HttpError(400, `Not a date: ${x}`);
    return x;
  },
  color: (x) => {
    if (x == null || x === '') return null;
    if (!HEX.test(x)) throw new HttpError(400, `Not a #rrggbb colour: ${x}`);
    return x.toLowerCase();
  },
  num: (min, max) => (x) => {
    if (x == null || x === '') return null;
    const n = Number(x);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Out of range (${min}–${max})`);
    return n;
  },
  int: (min, max) => (x) => {
    if (x == null || x === '') return null;
    const n = Number(x);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Out of range (${min}–${max})`);
    return n;
  },
  bool: (x) => (x ? 1 : 0),
  oneOf: (list) => (x) => {
    if (!list.includes(x)) throw new HttpError(400, `Must be one of ${list.join(', ')}`);
    return x;
  },
  json: (max = 20000) => (x) => {
    const s = JSON.stringify(x ?? null);
    if (s.length > max) throw new HttpError(400, 'Too large');
    return s;
  },
};

export function setClause(fields) {
  const keys = Object.keys(fields);
  return { sql: keys.map((k) => `${k} = ?`).join(', '), args: keys.map((k) => fields[k]) };
}

// D1 caps bound parameters at 100 per statement.
export function chunks(list, n = 90) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
