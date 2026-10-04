// Strava: connect (OAuth), list activities, import the chosen ones at full
// GPS detail. Needs a Strava API application (strava.com/settings/api) with
// "Authorization Callback Domain" = this site's host, and two secrets:
//   wrangler secret put STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET
// Rate limits (100 requests / 15 min, 1,000 / day) are Strava's; an import
// costs one request per activity.
import { json, err, readJson, HttpError } from './shared.js';
import { buildRoute } from '../../web/lib/gpx.js';
import { decodePolyline } from '../../web/lib/geo.js';

const API = 'https://www.strava.com/api/v3';
export const stravaConfigured = (env) => !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);

// Strava sport_type → our transport types.
const SPORT = {
  Walk: 'walk', Hike: 'walk', Run: 'walk', TrailRun: 'walk', Snowshoe: 'walk',
  Ride: 'bike', MountainBikeRide: 'bike', GravelRide: 'bike', EBikeRide: 'bike', EMountainBikeRide: 'bike', VirtualRide: 'bike',
  AlpineSki: 'ski', BackcountrySki: 'ski', NordicSki: 'ski', Snowboard: 'ski',
  Kayaking: 'boat', Canoeing: 'boat', Rowing: 'boat', Sail: 'boat', StandUpPaddling: 'boat', Surfing: 'boat',
};
export const typeForSport = (s) => SPORT[s] || 'other';

async function token(env, email) {
  const link = await env.DB.prepare('SELECT * FROM strava_links WHERE email = ?').bind(email).first();
  if (!link) throw new HttpError(409, 'Strava isn\'t connected — use Import → Connect Strava');
  if (link.expires_at - 120 > Date.now() / 1000) return link.access_token;
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: link.refresh_token }),
  });
  if (!r.ok) throw new HttpError(502, 'Strava refused to refresh the connection — connect it again');
  const t = await r.json();
  await env.DB.prepare('UPDATE strava_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE email = ?').bind(t.access_token, t.refresh_token, t.expires_at, email).run();
  return t.access_token;
}

async function strava(env, email, path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${await token(env, email)}` } });
  if (r.status === 429) throw new HttpError(429, 'Strava rate limit reached — try again in 15 minutes');
  if (!r.ok) throw new HttpError(502, `Strava: ${r.status}`);
  return r.json();
}

// OAuth endpoints live outside /api (they're browser redirects).
export async function handleOAuth(request, env, url, user) {
  if (url.pathname === '/strava/connect') {
    if (!stravaConfigured(env)) return new Response('Strava isn\'t set up on this server yet (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET).', { status: 501 });
    const state = crypto.randomUUID();
    const auth = new URL('https://www.strava.com/oauth/authorize');
    auth.search = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, redirect_uri: `${url.origin}/strava/callback`, response_type: 'code', approval_prompt: 'auto', scope: 'read,activity:read_all', state }).toString();
    return new Response(null, { status: 302, headers: { Location: auth.toString(), 'Set-Cookie': `ta_strava_state=${state}; Path=/strava; HttpOnly; SameSite=Lax; Max-Age=600${url.protocol === 'https:' ? '; Secure' : ''}` } });
  }
  if (url.pathname === '/strava/callback') {
    const state = (request.headers.get('Cookie') || '').match(/ta_strava_state=([\w-]+)/);
    if (!state || state[1] !== url.searchParams.get('state')) return new Response('That Strava link has expired — start again from Import.', { status: 400 });
    if (url.searchParams.get('error')) return Response.redirect(`${url.origin}/#/import?strava=denied`, 302);
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, code: url.searchParams.get('code') || '', grant_type: 'authorization_code' }),
    });
    if (!r.ok) return new Response('Strava didn\'t accept the connection — try again.', { status: 502 });
    const t = await r.json();
    const name = t.athlete ? [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(' ') : null;
    await env.DB.prepare(`INSERT INTO strava_links (email, athlete_id, athlete_name, access_token, refresh_token, expires_at, scope) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET athlete_id = excluded.athlete_id, athlete_name = excluded.athlete_name, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, scope = excluded.scope`)
      .bind(user.email, t.athlete ? t.athlete.id : 0, name, t.access_token, t.refresh_token, t.expires_at, url.searchParams.get('scope')).run();
    return new Response(null, { status: 302, headers: { Location: '/#/import?strava=connected', 'Set-Cookie': 'ta_strava_state=; Path=/strava; Max-Age=0' } });
  }
  return null;
}

export async function handle(request, env, url, user) {
  const p = url.pathname, m = request.method;
  if (!p.startsWith('/api/strava')) return undefined;

  if (p === '/api/strava' && m === 'GET') {
    const link = await env.DB.prepare('SELECT athlete_name, athlete_id, created_at FROM strava_links WHERE email = ?').bind(user.email).first();
    return json({ configured: stravaConfigured(env), connected: !!link, athlete: link ? link.athlete_name : null, callbackDomain: url.host });
  }
  if (p === '/api/strava' && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM strava_links WHERE email = ?').bind(user.email).run();
    return json({ ok: true });
  }
  // Activities in a date window, newest first, marked if already in the trip.
  if (p === '/api/strava/activities' && m === 'GET') {
    const q = new URLSearchParams({ per_page: String(Math.min(100, +url.searchParams.get('per_page') || 60)), page: String(+url.searchParams.get('page') || 1) });
    for (const k of ['after', 'before']) { const d = url.searchParams.get(k); if (d) q.set(k, String(Math.floor(Date.parse(d + 'T00:00:00Z') / 1000) + (k === 'before' ? 86400 : 0))); }
    const acts = await strava(env, user.email, `/athlete/activities?${q}`);
    const ids = acts.map((a) => `strava:${a.id}`);
    const have = new Set();
    if (ids.length) {
      const { results } = await env.DB.prepare(`SELECT source_name FROM routes WHERE source_name IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      results.forEach((r) => have.add(r.source_name));
    }
    return json({
      activities: acts.map((a) => ({
        id: a.id, name: a.name, sport: a.sport_type || a.type, type: typeForSport(a.sport_type || a.type), date: (a.start_date_local || '').slice(0, 10),
        km: Math.round((a.distance || 0) / 100) / 10, hasMap: !!(a.map && a.map.summary_polyline), imported: have.has(`strava:${a.id}`),
        preview: a.map && a.map.summary_polyline ? a.map.summary_polyline : null,
      })),
    });
  }
  // Import chosen activities at full detail (GPS streams). ≤ 15 per call keeps
  // within the Worker's subrequest budget; the page sends them in batches.
  if (p === '/api/strava/import' && m === 'POST') {
    const body = await readJson(request);
    const ids = (body.ids || []).filter((x) => Number.isSafeInteger(x)).slice(0, 15);
    if (!ids.length) return err('No activities chosen');
    const tripStart = (await env.DB.prepare("SELECT value FROM trip_settings WHERE key = 'trip_start'").first() || {}).value;
    const routes = [], failed = [];
    for (const id of ids) {
      try {
        const a = await strava(env, user.email, `/activities/${id}`);
        let coords = null, times = [];
        try {
          const s = await strava(env, user.email, `/activities/${id}/streams?keys=latlng,time&key_by_type=true`);
          if (s.latlng && s.latlng.data.length > 1) {
            coords = s.latlng.data.map(([la, lo]) => [lo, la]);
            const t0 = Date.parse(a.start_date);
            if (s.time) times = s.time.data.map((sec) => new Date(t0 + sec * 1000).toISOString());
          }
        } catch (_) { /* fall back to the summary line */ }
        // Google-encoded, lat first — decodePolyline already returns [lon, lat].
        if (!coords && a.map && (a.map.polyline || a.map.summary_polyline)) coords = decodePolyline(a.map.polyline || a.map.summary_polyline);
        if (!coords || coords.length < 2) { failed.push({ id, reason: 'no GPS' }); continue; }
        const r = buildRoute(coords, { fileName: a.name, type: typeForSport(a.sport_type || a.type), times, tripStart, sourceKind: 'gpx' });
        r.name = a.name;
        r.date = (a.start_date_local || '').slice(0, 10) || r.date;
        r.date_source = 'gps-time';
        r.source_name = `strava:${id}`;
        r.source_folder = 'Strava';
        routes.push(r);
      } catch (e) { failed.push({ id, reason: e.message }); }
    }
    return json({ ok: true, routes, failed });
  }
  return undefined;
}

