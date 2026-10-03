// /api/styles and /api/maps — map styles and album maps (one printed page each).
import { json, err, readJson, pick, v, setClause, HttpError } from './shared.js';
import { resolveStyle, validateStyle } from '../../web/lib/style.js';
import { TYPE_IDS } from '../../web/lib/types.js';

function styleSpec(x) {
  if (!x || typeof x !== 'object') throw new HttpError(400, 'Style must be an object');
  const spec = resolveStyle(x);
  const e = validateStyle(spec);
  if (e) throw new HttpError(400, e);
  return JSON.stringify(spec);
}

// filter: {from, to, types[], legs[], countries[], include[], exclude[]}
function filterSpec(x) {
  const f = x && typeof x === 'object' ? x : {};
  const ids = (a) => (Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n > 0).slice(0, 2000) : []);
  return JSON.stringify({
    from: v.date(f.from), to: v.date(f.to),
    types: Array.isArray(f.types) ? f.types.filter((t) => TYPE_IDS.includes(t)) : [],
    legs: ids(f.legs),
    countries: Array.isArray(f.countries) ? f.countries.filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 60) : [],
    include: ids(f.include), exclude: ids(f.exclude),
    places: f.places !== false,
  });
}

function viewSpec(x) {
  if (x == null) return null;
  const b = x.bounds;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[1] < -90 || b[3] > 90 || b[1] >= b[3])
    throw new HttpError(400, 'View needs bounds [w,s,e,n]');
  return JSON.stringify({ bounds: b.map((n) => Math.round(n * 1e6) / 1e6), bearing: Number.isFinite(x.bearing) ? x.bearing : 0 });
}

// Paper in mm at a dpi. Pixel size is capped where browsers' WebGL can still
// draw it (MAX_RENDERBUFFER_SIZE is 16384 on most Macs; the exporter checks
// the real limit and tiles above it).
function paperSpec(x) {
  const w = v.num(20, 1200)(x && x.w), h = v.num(20, 1200)(x && x.h), dpi = v.int(72, 600)(x && x.dpi);
  if (!w || !h || !dpi) throw new HttpError(400, 'Paper needs w, h (mm) and dpi');
  return JSON.stringify({ w, h, dpi, bleed: v.num(0, 20)(x.bleed) || 0 });
}

const STYLE = { name: v.name, spec: styleSpec };
const MAP = {
  name: v.name, filter: filterSpec, view: viewSpec, paper: paperSpec,
  style_id: (x) => (x == null ? null : v.int(1, 1e9)(x)),
  overrides: (x) => v.json(20000)(x || {}),
  title: v.text(200), notes: v.text(4000), sort_order: v.int(0, 1e6),
};

async function insert(env, table, f, user) {
  const cols = Object.keys(f);
  const extra = table === 'album_maps' ? ', created_by, updated_by' : ', updated_by';
  const extraVals = table === 'album_maps' ? [user.email, user.email] : [user.email];
  const { results } = await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}${extra}) VALUES (${cols.map(() => '?').join(', ')}${extraVals.map(() => ', ?').join('')}) RETURNING id`
  ).bind(...cols.map((k) => f[k]), ...extraVals).all();
  return results[0].id;
}

export async function handle(request, env, url, user) {
  const p = url.pathname, m = request.method;

  if (p === '/api/styles' && m === 'POST') {
    const f = pick(await readJson(request), STYLE);
    try { return json({ ok: true, id: await insert(env, 'map_styles', f, user) }); } catch (e) {
      if (/UNIQUE/.test(String(e))) return err('A style with that name already exists');
      throw e;
    }
  }
  const st = p.match(/^\/api\/styles\/(\d+)$/);
  if (st && m === 'PUT') {
    const f = pick(await readJson(request), STYLE);
    const { sql, args } = setClause(f);
    if (!sql) return err('Nothing to change');
    await env.DB.prepare(`UPDATE map_styles SET ${sql}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(...args, user.email, +st[1]).run();
    return json({ ok: true });
  }
  if (st && m === 'DELETE') {
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM album_maps WHERE style_id = ?').bind(+st[1]).first();
    if (used.n) return err(`Used by ${used.n} album map${used.n === 1 ? '' : 's'} — switch them to another style first`, 409);
    await env.DB.prepare('DELETE FROM map_styles WHERE id = ?').bind(+st[1]).run();
    return json({ ok: true });
  }

  if (p === '/api/maps' && m === 'POST') {
    const f = pick(await readJson(request), MAP);
    if (!f.paper) f.paper = paperSpec({ w: 300, h: 300, dpi: 300 });
    return json({ ok: true, id: await insert(env, 'album_maps', f, user) });
  }
  const am = p.match(/^\/api\/maps\/(\d+)$/);
  if (am && m === 'PUT') {
    const f = pick(await readJson(request), MAP);
    const { sql, args } = setClause(f);
    if (!sql) return err('Nothing to change');
    await env.DB.prepare(`UPDATE album_maps SET ${sql}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(...args, user.email, +am[1]).run();
    return json({ ok: true });
  }
  if (am && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM album_maps WHERE id = ?').bind(+am[1]).run();
    return json({ ok: true });
  }
  const ex = p.match(/^\/api\/maps\/(\d+)\/exported$/);
  if (ex && m === 'POST') {
    const b = await readJson(request);
    const px = Array.isArray(b.px) ? b.px.slice(0, 2).map(Number) : null;
    await env.DB.prepare('UPDATE album_maps SET last_export = ? WHERE id = ?')
      .bind(JSON.stringify({ at: new Date().toISOString(), by: user.email, px }), +ex[1]).run();
    return json({ ok: true });
  }

  return undefined;
}
