// /api/routes — the journey lines. Parsing happens in the browser (web/lib/gpx.js)
// so a 160k-point hike never touches the Worker's CPU budget; the Worker
// validates the already-simplified record, de-duplicates and stores it.
import { json, err, readJson, bumpVersion, dataVersion, pick, v, setClause, chunks, isId, HttpError, ISO_DATE } from './shared.js';
import { TYPE_IDS } from '../../web/lib/types.js';
import { decodePolyline } from '../../web/lib/geo.js';

const EDITABLE = {
  name: v.name,
  date: v.date,
  type: v.oneOf(TYPE_IDS),
  leg_id: (x) => (x == null || x === '' ? null : v.int(1, 1e9)(x)),
  country: v.text(40),
  region: v.text(120),
  notes: v.text(4000),
  color: v.color,
  width: v.num(0.25, 20),
  hidden: v.bool,
  review: (x) => (x == null ? null : v.json(2000)(x)),
};

// What the list sends: everything the map and the library table need. The
// whole trip is ~0.6 MB of geometry, so it goes in one cacheable response.
const LIST_COLS = `id, name, date, date_source, trip_day, type, leg_id, country, region, notes, color, width, hidden,
  distance_km, point_count, bbox, geom, geom_lo, started_at, source_name, source_folder, source_kind, source_hash, review,
  updated_by, updated_at`;

export async function handle(request, env, url, user) {
  const p = url.pathname, m = request.method;

  if (p === '/api/routes' && m === 'GET') {
    const version = await dataVersion(env);
    const etag = `"r${version}"`;
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    const { results } = await env.DB.prepare(`SELECT ${LIST_COLS} FROM routes ORDER BY date IS NULL, date, started_at, id`).all();
    for (const r of results) {
      r.bbox = r.bbox ? JSON.parse(r.bbox) : null;
      r.review = r.review ? JSON.parse(r.review) : null;
    }
    return json({ version, routes: results }, 200, { ETag: etag, 'Cache-Control': 'private, no-cache' });
  }

  if (p === '/api/routes/import' && m === 'POST') return importRoutes(request, env, user);

  if (p === '/api/routes' && m === 'PATCH') {
    const body = await readJson(request);
    const ids = (body.ids || []).filter(isId);
    if (!ids.length) return err('No routes selected');
    const fields = pick(body.fields, EDITABLE);
    if ('date' in fields) fields.date_source = fields.date ? 'manual' : null;
    if (!Object.keys(fields).length) return err('Nothing to change');
    const { sql, args } = setClause(fields);
    for (const c of chunks(ids)) {
      await env.DB.prepare(`UPDATE routes SET ${sql}, updated_by = ?, updated_at = datetime('now') WHERE id IN (${c.map(() => '?').join(',')})`)
        .bind(...args, user.email, ...c).run();
    }
    await bumpVersion(env);
    return json({ ok: true, updated: ids.length });
  }

  if (p === '/api/routes' && m === 'DELETE') {
    const body = await readJson(request);
    const ids = (body.ids || []).filter(isId);
    if (!ids.length) return err('No routes selected');
    for (const c of chunks(ids)) {
      await env.DB.prepare(`DELETE FROM routes WHERE id IN (${c.map(() => '?').join(',')})`).bind(...c).run();
    }
    await bumpVersion(env);
    return json({ ok: true, deleted: ids.length });
  }

  // Originals: PUT the file text once at import (keyed by its sha256, so a
  // re-upload is a no-op); GET downloads it back.
  const raw = p.match(/^\/api\/raw\/([0-9a-f]{64})$/);
  if (raw && m === 'PUT') {
    if (!env.ORIGINALS) return err('File storage is not configured', 501);
    const len = +request.headers.get('Content-Length') || 0;
    if (len > 50 * 1024 * 1024) return err('File too large (50 MB max)', 413);
    const key = `raw/${raw[1]}`;
    if (await env.ORIGINALS.head(key)) return json({ ok: true, existed: true });
    let name = request.headers.get('X-File-Name') || 'route.gpx';
    try { name = decodeURIComponent(name); } catch (_) { /* already plain */ }
    name = name.replace(/[\r\n"\\/]/g, '').slice(0, 200) || 'route.gpx';
    await env.ORIGINALS.put(key, request.body, { httpMetadata: { contentType: 'application/gpx+xml' }, customMetadata: { name, by: user.email } });
    return json({ ok: true });
  }
  if (raw && m === 'GET') {
    if (!env.ORIGINALS) return err('File storage is not configured', 501);
    const obj = await env.ORIGINALS.get(`raw/${raw[1]}`);
    if (!obj) return err('Original not kept for this route', 404);
    let name = obj.customMetadata && obj.customMetadata.name;
    if (!name) { // uploaded without metadata (bulk upload): the route remembers its file name
      const r = await env.DB.prepare('SELECT source_name FROM routes WHERE source_hash = ? LIMIT 1').bind(raw[1]).first();
      name = (r && r.source_name) || 'route.gpx';
    }
    return new Response(obj.body, { headers: { 'Content-Type': 'application/gpx+xml', 'Content-Disposition': `attachment; filename="${name.replace(/["\\]/g, '')}"` } });
  }

  return undefined;
}

const MAX_BATCH = 60;
const GEOM_MAX = 900 * 1024; // D1 row limit is 2 MB; a simplified route is ~10 KB

function cleanImported(r) {
  if (!r || typeof r !== 'object') throw new HttpError(400, 'Bad route');
  if (typeof r.geom !== 'string' || !r.geom || r.geom.length > GEOM_MAX) throw new HttpError(400, `${r.name || 'Route'}: geometry missing or too large`);
  const pts = decodePolyline(r.geom);
  if (pts.length < 2 || pts.some(([x, y]) => !(x >= -540 && x <= 540 && y >= -90 && y <= 90))) throw new HttpError(400, `${r.name || 'Route'}: geometry is not a valid line`);
  const bbox = Array.isArray(r.bbox) && r.bbox.length === 4 && r.bbox.every(Number.isFinite) ? r.bbox : null;
  return {
    name: v.name(r.name || 'Untitled'),
    date: r.date && ISO_DATE.test(r.date) ? r.date : null,
    date_source: ['gps-time', 'filename', 'trip-day', 'manual', 'suggested'].includes(r.date_source) ? r.date_source : null,
    trip_day: Number.isInteger(r.trip_day) ? r.trip_day : null,
    type: TYPE_IDS.includes(r.type) ? r.type : 'other',
    country: v.text(40)(r.country),
    region: v.text(120)(r.region),
    distance_km: Number.isFinite(r.distance_km) ? r.distance_km : null,
    point_count: Number.isInteger(r.point_count) ? r.point_count : null,
    bbox: bbox ? JSON.stringify(bbox) : null,
    fingerprint: typeof r.fingerprint === 'string' ? r.fingerprint.slice(0, 120) : null,
    geom: r.geom,
    geom_lo: typeof r.geom_lo === 'string' && r.geom_lo.length <= GEOM_MAX ? r.geom_lo : null,
    started_at: v.text(40)(r.started_at),
    ended_at: v.text(40)(r.ended_at),
    source_name: v.text(300)(r.source_name),
    source_folder: v.text(500)(r.source_folder),
    source_kind: ['gpx', 'csv', 'flight', 'manual'].includes(r.source_kind) ? r.source_kind : 'gpx',
    source_hash: /^[0-9a-f]{64}$/.test(r.source_hash || '') ? r.source_hash : null,
  };
}

// Duplicate policy (see CLAUDE.md "Import"):
//  - same original file (source_hash) or identical line → skipped, it's already here;
//  - a simplified copy of a route already here (same start/end/length, and
//    either from a My Maps CSV or with ≤60% of its points — the old Coordinate
//    Generator's 10 m / 100 m outputs) → skipped;
//  - otherwise same start/end/length → imported, flagged in review for a
//    person to decide. Real data has both: "Drive from Airport 03-03-2025" and
//    "Morning_Walk" are one file under two names; "May 9" and "May 10 2025
//    driving" are different files, same road.
//
// Thresholds come from the real files: the My Maps CSVs and "0.01km
// resolution" GPX keep 2–20% of the points and 54–99% of the measured length
// (thinning cuts the corners off a switchback). Two walks from the same
// house share a start and end but differ in length by far more.
export function duplicateVerdict(r, twin) {
  if (!twin) return null;
  if ((r.source_hash && twin.source_hash === r.source_hash) || twin.geom === r.geom) return 'same';
  const lenR = +String(r.fingerprint).split('~')[1], lenT = +String(twin.fingerprint).split('~')[1];
  const len = lenT ? lenR / lenT : 1;
  const pts = r.point_count && twin.point_count ? r.point_count / twin.point_count : 1;
  // The same Google route exported twice — but only on the same day: the
  // same road driven on two dates is two journeys, so it goes to Review.
  const sameDay = !r.date || !twin.date || r.date === twin.date;
  if (sameDay && Math.abs(len - 1) <= 0.02 && pts >= 0.85 && pts <= 1.15) return 'same';
  if ((pts <= 0.35 || r.source_kind === 'csv') && len >= 0.5 && len <= 1.05) return 'simplified';
  if (Math.abs(len - 1) <= 0.051 || (lenR <= 1 && lenT <= 1)) return 'lookalike';
  return null; // same endpoints, different journey
}
const endpoints = (fp) => String(fp || '').split('~')[0];
async function importRoutes(request, env, user) {
  const body = await readJson(request);
  const list = Array.isArray(body.routes) ? body.routes : [];
  if (!list.length) return err('No routes');
  if (list.length > MAX_BATCH) return err(`At most ${MAX_BATCH} routes per request`);
  const recs = list.map(cleanImported);

  const fps = [...new Set(recs.map((r) => r.fingerprint && r.fingerprint.split('~')[0]).filter(Boolean))];
  const existing = [];
  for (const c of chunks(fps, 80)) {
    const { results } = await env.DB.prepare(
      `SELECT id, name, date, fingerprint, source_hash, geom, point_count FROM routes WHERE substr(fingerprint, 1, instr(fingerprint, '~') - 1) IN (${c.map(() => '?').join(',')})`
    ).bind(...c).all();
    existing.push(...results);
  }

  const inserted = [], skipped = [], flagged = [];
  const stmts = [];
  const seen = [];
  for (const r of recs) {
    const verdicts = existing.concat(seen).filter((e) => endpoints(e.fingerprint) === endpoints(r.fingerprint))
      .map((t) => [t, duplicateVerdict(r, t)]).filter(([, v]) => v);
    const hit = verdicts.find(([, v]) => v === 'same') || verdicts.find(([, v]) => v === 'simplified');
    if (hit) {
      skipped.push({ name: r.name, reason: hit[1] === 'same' ? `already imported as “${hit[0].name}”` : `a simplified copy of “${hit[0].name}”` });
      continue;
    }
    const twin = verdicts.length ? verdicts[0][0] : null;
    const review = twin ? JSON.stringify({ possibleDuplicateOf: twin.id || null, possibleDuplicateName: twin.name }) : null;
    if (twin) flagged.push({ name: r.name, of: twin.name });
    seen.push({ id: null, name: r.name, date: r.date, fingerprint: r.fingerprint, source_hash: r.source_hash, geom: r.geom, point_count: r.point_count });
    const cols = Object.keys(r);
    stmts.push(env.DB.prepare(
      `INSERT INTO routes (${cols.join(', ')}, review, created_by, updated_by) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?) RETURNING id`
    ).bind(...cols.map((k) => r[k]), review, user.email, user.email));
    inserted.push(r.name);
  }
  let ids = [];
  if (stmts.length) {
    const res = await env.DB.batch(stmts);
    ids = res.map((x) => (x.results && x.results[0] ? x.results[0].id : x.meta && x.meta.last_row_id)).filter(Boolean);
    await bumpVersion(env);
  }
  return json({ ok: true, inserted: ids, skipped, flagged });
}
