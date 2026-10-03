// /api/photos and /api/photo-file — photo records and their two JPEG sizes in R2.
import { json, err, readJson, bumpVersion, pick, v, setClause, chunks, isId, HttpError, ISO_DATE } from './shared.js';
import { validCoord } from '../../web/lib/geo.js';

const SHA = /^[0-9a-f]{64}$/;
const SIZES = ['full', 'thumb'];
const MAX_BYTES = { full: 12 * 1024 * 1024, thumb: 1024 * 1024 };
const EDIT = {
  caption: v.text(500), date: v.date, lat: v.num(-90, 90), lon: v.num(-180, 180), route_id: (x) => (x == null ? null : v.int(1, 1e9)(x)),
  place_source: (x) => (x == null ? null : v.oneOf(['gps', 'route-time', 'route-date', 'manual'])(x)), in_film: v.bool, hidden: v.bool,
};

function cleanNew(p) {
  if (!p || !SHA.test(p.sha || '')) throw new HttpError(400, 'Photo needs its sha256');
  const lat = p.lat == null ? null : Number(p.lat), lon = p.lon == null ? null : Number(p.lon);
  if ((lat != null || lon != null) && !validCoord(lon, lat)) throw new HttpError(400, `${p.file_name || 'Photo'}: invalid GPS`);
  return {
    sha: p.sha, file_name: v.text(200)(p.file_name), taken_at: v.text(40)(p.taken_at), date: p.date && ISO_DATE.test(p.date) ? p.date : null,
    lat, lon, place_source: p.place_source && EDIT.place_source(p.place_source), route_id: Number.isInteger(p.route_id) ? p.route_id : null,
    width: Number.isInteger(p.width) ? p.width : null, height: Number.isInteger(p.height) ? p.height : null, caption: v.text(500)(p.caption),
  };
}

export async function handle(request, env, url, user) {
  const p = url.pathname, m = request.method;

  if (p === '/api/photos' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM photos ORDER BY COALESCE(taken_at, date) IS NULL, COALESCE(taken_at, date), id').all();
    return json({ photos: results });
  }
  if (p === '/api/photos' && m === 'POST') {
    const list = (await readJson(request)).photos;
    if (!Array.isArray(list) || !list.length || list.length > 200) return err('Send 1–200 photos');
    const rows = list.map(cleanNew);
    const cols = Object.keys(rows[0]);
    const res = await env.DB.batch(rows.map((r) => env.DB.prepare(
      `INSERT INTO photos (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?) ON CONFLICT(sha) DO NOTHING`
    ).bind(...cols.map((k) => r[k]), user.email)));
    await bumpVersion(env);
    return json({ ok: true, inserted: res.filter((x) => x.meta && x.meta.changes).length });
  }
  if (p === '/api/photos' && m === 'PATCH') {
    const body = await readJson(request);
    const ids = (body.ids || []).filter(isId);
    if (!ids.length) return err('No photos selected');
    const f = pick(body.fields, EDIT);
    const { sql, args } = setClause(f);
    if (!sql) return err('Nothing to change');
    for (const c of chunks(ids)) await env.DB.prepare(`UPDATE photos SET ${sql}, updated_at = datetime('now') WHERE id IN (${c.map(() => '?').join(',')})`).bind(...args, ...c).run();
    await bumpVersion(env);
    return json({ ok: true });
  }
  if (p === '/api/photos' && m === 'DELETE') {
    const ids = ((await readJson(request)).ids || []).filter(isId);
    for (const c of chunks(ids)) {
      const { results } = await env.DB.prepare(`SELECT sha FROM photos WHERE id IN (${c.map(() => '?').join(',')})`).bind(...c).all();
      if (env.ORIGINALS && results.length) await env.ORIGINALS.delete(results.flatMap((r) => SIZES.map((s) => `photos/${r.sha}-${s}.jpg`)));
      await env.DB.prepare(`DELETE FROM photos WHERE id IN (${c.map(() => '?').join(',')})`).bind(...c).run();
    }
    await bumpVersion(env);
    return json({ ok: true, deleted: ids.length });
  }

  const f = p.match(/^\/api\/photo-file\/([0-9a-f]{64})\/(full|thumb)$/);
  if (f && !env.ORIGINALS) return err('Photo storage is not configured', 501);
  if (f && m === 'PUT') {
    const len = +request.headers.get('Content-Length') || 0;
    if (len > MAX_BYTES[f[2]]) return err('Photo too large', 413);
    if (!/^image\/jpeg/.test(request.headers.get('Content-Type') || '')) return err('Send a JPEG', 415);
    await env.ORIGINALS.put(`photos/${f[1]}-${f[2]}.jpg`, request.body, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { by: user.email } });
    return json({ ok: true });
  }
  if (f && m === 'GET') {
    const obj = await env.ORIGINALS.get(`photos/${f[1]}-${f[2]}.jpg`);
    if (!obj) return err('Not found', 404);
    // Content-addressed by sha, so it never changes: cache for a year.
    return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } });
  }
  return undefined;
}
