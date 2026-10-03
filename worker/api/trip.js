// /api/bootstrap, /api/trip (settings), /api/legs, /api/places, /api/people.
import { json, err, readJson, bumpVersion, dataVersion, pick, v, setClause, chunks, isId, HttpError } from './shared.js';
import { normaliseEmail, forgetAll } from '../auth.js';
import { validCoord } from '../../web/lib/geo.js';

const LEG = { name: v.name, start_date: v.date, end_date: v.date, color: v.color, notes: v.text(2000), sort_order: v.int(0, 1e6) };
const PLACE = {
  name: v.text(200), lat: v.num(-90, 90), lon: v.num(-180, 180), kind: (x) => (v.text(30)(x) || 'other').toLowerCase(),
  date: v.date, nights: v.int(0, 400), notes: v.text(2000), hidden: v.bool,
};

export async function handle(request, env, url, user) {
  const p = url.pathname, m = request.method;

  if (p === '/api/bootstrap' && m === 'GET') {
    const [settings, legs, styles, maps, version] = await Promise.all([
      env.DB.prepare('SELECT key, value FROM trip_settings').all(),
      env.DB.prepare('SELECT * FROM legs ORDER BY start_date IS NULL, start_date, sort_order, id').all(),
      env.DB.prepare('SELECT id, name, spec, updated_at FROM map_styles ORDER BY id').all(),
      env.DB.prepare('SELECT * FROM album_maps ORDER BY sort_order, id').all(),
      dataVersion(env),
    ]);
    const trip = Object.fromEntries(settings.results.map((r) => [r.key, r.value]));
    for (const s of styles.results) s.spec = JSON.parse(s.spec);
    for (const a of maps.results) for (const k of ['filter', 'view', 'paper', 'overrides', 'last_export']) a[k] = a[k] ? JSON.parse(a[k]) : null;
    let settingsJson = {};
    try { settingsJson = JSON.parse(user.settings || '{}'); } catch (_) { /* keep {} */ }
    return json({
      me: { email: user.email, name: user.name, isAdmin: !!user.is_admin, settings: settingsJson },
      trip, legs: legs.results, styles: styles.results, maps: maps.results, version,
    });
  }

  if (p === '/api/me' && m === 'PATCH') {
    const body = await readJson(request);
    const f = pick(body, { name: v.text(80), settings: v.json(20000) });
    if (!Object.keys(f).length) return err('Nothing to change');
    const { sql, args } = setClause(f);
    await env.DB.prepare(`UPDATE users SET ${sql} WHERE email = ?`).bind(...args, user.email).run();
    forgetAll();
    return json({ ok: true });
  }

  // Trip settings. Changing trip_start re-dates every route whose date came
  // from its "day N" file name — and only those.
  if (p === '/api/trip' && m === 'PATCH') {
    const body = await readJson(request);
    const f = pick(body, { trip_start: v.date, trip_name: v.text(120) });
    for (const [k, val] of Object.entries(f)) {
      await env.DB.prepare('INSERT INTO trip_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, val).run();
    }
    let redated = 0;
    if (f.trip_start) {
      const r = await env.DB.prepare(
        `UPDATE routes SET date = date(?, '+' || (trip_day - 1) || ' days'), updated_at = datetime('now')
          WHERE date_source = 'trip-day' AND trip_day IS NOT NULL`
      ).bind(f.trip_start).run();
      redated = r.meta.changes;
      await bumpVersion(env);
    }
    return json({ ok: true, redated });
  }

  // ── Legs ──
  if (p === '/api/legs' && m === 'POST') {
    const f = pick(await readJson(request), LEG);
    if (!f.name) return err('Name is required');
    const { results } = await env.DB.prepare(`INSERT INTO legs (${Object.keys(f).join(', ')}) VALUES (${Object.keys(f).map(() => '?').join(', ')}) RETURNING *`)
      .bind(...Object.values(f)).all();
    return json({ ok: true, leg: results[0] });
  }
  const leg = p.match(/^\/api\/legs\/(\d+)$/);
  if (leg && m === 'PUT') {
    const f = pick(await readJson(request), LEG);
    const { sql, args } = setClause(f);
    if (!sql) return err('Nothing to change');
    await env.DB.prepare(`UPDATE legs SET ${sql} WHERE id = ?`).bind(...args, +leg[1]).run();
    return json({ ok: true });
  }
  if (leg && m === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('UPDATE routes SET leg_id = NULL WHERE leg_id = ?').bind(+leg[1]),
      env.DB.prepare('DELETE FROM legs WHERE id = ?').bind(+leg[1]),
    ]);
    await bumpVersion(env);
    return json({ ok: true });
  }

  // ── Places ──
  if (p === '/api/places' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM places ORDER BY date IS NULL, date, id').all();
    return json({ places: results });
  }
  if (p === '/api/places/import' && m === 'POST') {
    const body = await readJson(request);
    const list = Array.isArray(body.places) ? body.places : [];
    if (!list.length) return err('No places');
    if (list.length > 2000) return err('At most 2000 places at once');
    if (body.replace) await env.DB.prepare('DELETE FROM places').run();
    const rows = list.map((x) => {
      const f = pick({ name: x.name, lat: x.lat, lon: x.lon, kind: x.kind, date: x.date || null, notes: x.notes }, PLACE);
      if (!validCoord(f.lon, f.lat)) throw new HttpError(400, `${f.name || 'Place'}: invalid coordinates`);
      return f;
    });
    for (const c of chunks(rows, 50)) {
      await env.DB.batch(c.map((f) => env.DB.prepare('INSERT INTO places (name, lat, lon, kind, date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(f.name, f.lat, f.lon, f.kind, f.date, f.notes, user.email)));
    }
    await bumpVersion(env);
    return json({ ok: true, inserted: rows.length });
  }
  if (p === '/api/places' && m === 'POST') {
    const f = pick(await readJson(request), PLACE);
    if (!validCoord(f.lon, f.lat)) return err('Invalid coordinates');
    const { results } = await env.DB.prepare(`INSERT INTO places (${Object.keys(f).join(', ')}, created_by) VALUES (${Object.keys(f).map(() => '?').join(', ')}, ?) RETURNING *`)
      .bind(...Object.values(f), user.email).all();
    await bumpVersion(env);
    return json({ ok: true, place: results[0] });
  }
  const place = p.match(/^\/api\/places\/(\d+)$/);
  if (place && m === 'PUT') {
    const f = pick(await readJson(request), PLACE);
    const { sql, args } = setClause(f);
    if (!sql) return err('Nothing to change');
    await env.DB.prepare(`UPDATE places SET ${sql}, updated_at = datetime('now') WHERE id = ?`).bind(...args, +place[1]).run();
    await bumpVersion(env);
    return json({ ok: true });
  }
  if (p === '/api/places' && m === 'DELETE') {
    const ids = ((await readJson(request)).ids || []).filter(isId);
    for (const c of chunks(ids)) await env.DB.prepare(`DELETE FROM places WHERE id IN (${c.map(() => '?').join(',')})`).bind(...c).run();
    await bumpVersion(env);
    return json({ ok: true, deleted: ids.length });
  }

  // ── People (admin) ──
  if (p === '/api/people') {
    if (!user.is_admin) return err('Only an admin can manage people', 403);
    if (m === 'GET') {
      const { results } = await env.DB.prepare('SELECT email, name, status, is_admin, last_seen_at FROM users ORDER BY created_at').all();
      return json({ people: results });
    }
    if (m === 'POST') {
      const body = await readJson(request);
      const email = normaliseEmail(body.email);
      if (!email) return err('Enter a valid email');
      await env.DB.prepare("INSERT INTO users (email, name, status) VALUES (?, ?, 'active') ON CONFLICT(email) DO UPDATE SET status = 'active', name = COALESCE(excluded.name, name)")
        .bind(email, v.text(80)(body.name)).run();
      forgetAll();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      const email = normaliseEmail((await readJson(request)).email);
      if (!email || email === user.email) return err("You can't remove yourself");
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET status = 'paused' WHERE email = ?").bind(email),
        env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email),
      ]);
      forgetAll();
      return json({ ok: true });
    }
  }

  return undefined;
}
