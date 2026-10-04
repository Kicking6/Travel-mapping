// Trip Atlas as an MCP server (Model Context Protocol, Streamable HTTP).
//
//   POST /mcp            Authorization: Bearer ta_…   (Claude Code, Claude Desktop, scripts)
//   POST /mcp/ta_…       token in the path            (claude.ai custom connectors)
//
// Tokens are made in Trip & people → Connectors and act as their owner.
// Tools reuse the app's own API handlers (api/index.js dispatch), so
// validation, de-duplication and the data version are exactly the app's.
import { dispatch } from './api/index.js';
import { identifyToken } from './auth.js';
import { routesFromGpx, buildRoute } from '../web/lib/gpx.js';
import { decodePolyline, simplify } from '../web/lib/geo.js';
import { TYPE_IDS } from '../web/lib/types.js';
import { parseFlightLines, parseItinerary, flightLegs, findMissingTravel } from '../web/lib/travel.js';
import { resolveStyle, mergeStyle, PRESETS, applyPreset, applyPalette, ROUTE_PALETTES } from '../web/lib/style.js';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'trip-atlas', title: 'Trip Atlas', version: '1.0.0' };
const INSTRUCTIONS = `Trip Atlas holds Rory and Eva's OE trip (Jul 2024 – Oct 2025): routes (drives, walks, buses, boats, ski days, flights), places they stayed, legs (trip sections), album map pages and map styles.
- Dates are local calendar dates (YYYY-MM-DD). Trip day 1 is in trip_summary.
- Find things with list_routes / list_places before changing them; changes are shared with both people immediately.
- Flights: add_flights takes itineraries like "AKL LAX JFK" (layovers become one leg each).
- find_missing_travel lists jumps the trip has no route for (usually missing flights), with airport suggestions.
- Large GPX recordings (> 1.5 MB) belong in the web app's Import page; add_route accepts coordinates or waypoints instead.
- Feedback: list_feedback shows what Rory and Eva reported in the app (✎ Feedback); reply_feedback answers or closes a report.`;

class ToolError extends Error {}
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (d) => ({ type: 'string', description: d });
const int = (d) => ({ type: 'integer', description: d });
const ids = { type: 'array', items: { type: 'integer' }, description: 'Route ids' };
const date = (d) => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: d });

let airportsCache = null;
async function airports(env, url) {
  if (!airportsCache) airportsCache = env.ASSETS.fetch(new Request(`${url.origin}/data/airports.json`)).then((r) => r.json());
  return airportsCache;
}

async function api(ctx, method, path, body) {
  const req = new Request(ctx.url.origin + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await dispatch(req, ctx.env, new URL(req.url), ctx.user);
  const data = res ? await res.json() : { error: 'Not found' };
  if (!res || !res.ok) throw new ToolError(data.error || `Failed (${res && res.status})`);
  return data;
}
const tripStart = async (env) => ((await env.DB.prepare("SELECT value FROM trip_settings WHERE key = 'trip_start'").first()) || {}).value;

async function importRoutes(ctx, routes) {
  const out = { inserted: [], skipped: [], flagged: [] };
  for (let i = 0; i < routes.length; i += 60) {
    const r = await api(ctx, 'POST', '/api/routes/import', { routes: routes.slice(i, i + 60) });
    out.inserted.push(...r.inserted); out.skipped.push(...r.skipped); out.flagged.push(...r.flagged);
  }
  return out;
}

async function follow(mode, pts) {
  if (mode === 'straight' || pts.length < 2) return pts;
  const lonlat = pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`);
  const url = mode === 'hiking'
    ? `https://brouter.de/brouter?lonlats=${lonlat.join('|')}&profile=hiking-mountain&alternativeidx=0&format=geojson`
    : `https://routing.openstreetmap.de/${{ roads: 'routed-car', paths: 'routed-foot', bike: 'routed-bike' }[mode] || 'routed-car'}/route/v1/driving/${lonlat.join(';')}?overview=full&geometries=geojson`;
  const r = await fetch(url, { headers: { 'User-Agent': 'TripAtlas/1.0' } });
  if (!r.ok) throw new ToolError(`Routing service ${r.status} — try follow: "straight"`);
  const j = await r.json();
  const coords = mode === 'hiking' ? j.features && j.features[0] && j.features[0].geometry.coordinates.map(([x, y]) => [x, y]) : j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
  if (!coords || coords.length < 2) throw new ToolError('No route found between those points');
  return coords;
}

const ROUTE_FIELDS = { name: str('Route name'), date: date('Local date'), type: { type: 'string', enum: TYPE_IDS }, leg_id: { type: ['integer', 'null'] }, country: str('Country name(s), comma-separated'), region: str('Region'), notes: str('Notes'), color: { type: ['string', 'null'], description: '#rrggbb or null for the style colour' }, width: { type: ['number', 'null'] }, hidden: { type: 'boolean' } };

const TOOLS = [
  { name: 'trip_summary', title: 'Trip summary', annotations: { readOnlyHint: true }, description: 'Totals by transport type, date span, trip day 1, legs, places, photos and how many routes need review.', inputSchema: S({}),
    async run(ctx) {
      const env = ctx.env;
      const [types, span, legs, counts, settings] = await Promise.all([
        env.DB.prepare('SELECT type, COUNT(*) n, ROUND(SUM(distance_km)) km FROM routes WHERE hidden = 0 GROUP BY type ORDER BY km DESC').all(),
        env.DB.prepare('SELECT MIN(date) first, MAX(date) last, COUNT(*) n, SUM(date IS NULL) undated, SUM(review IS NOT NULL) flagged, SUM(country IS NULL AND type != \'flight\') no_country, SUM(type = \'other\') unknown_type FROM routes WHERE hidden = 0').first(),
        env.DB.prepare('SELECT id, name, start_date, end_date FROM legs ORDER BY start_date').all(),
        env.DB.prepare('SELECT (SELECT COUNT(*) FROM places) places, (SELECT COUNT(*) FROM photos) photos, (SELECT COUNT(*) FROM album_maps) album_maps, (SELECT COUNT(*) FROM map_styles) styles').first(),
        env.DB.prepare('SELECT key, value FROM trip_settings').all(),
      ]);
      return ok({ trip: Object.fromEntries(settings.results.map((r) => [r.key, r.value])), routes: span, byType: types.results, legs: legs.results, ...counts });
    } },
  { name: 'list_routes', title: 'List routes', annotations: { readOnlyHint: true }, description: 'Find routes. All filters optional; returns compact rows (no geometry).',
    inputSchema: S({ from: date('On or after'), to: date('On or before'), type: { type: 'string', enum: TYPE_IDS }, leg_id: int('Leg'), country: str('Country name contains'), search: str('Name / notes / file name contains'), needs_review: { type: 'boolean', description: 'Only routes with no date, a guessed year, unknown type, or a duplicate flag' }, include_hidden: { type: 'boolean' }, limit: int('Max rows (default 100, max 500)'), offset: int('Skip rows') }),
    async run(ctx, a) {
      const w = [], b = [];
      if (a.from) { w.push('date >= ?'); b.push(a.from); }
      if (a.to) { w.push('date <= ?'); b.push(a.to); }
      if (a.type) { w.push('type = ?'); b.push(a.type); }
      if (a.leg_id) { w.push('leg_id = ?'); b.push(a.leg_id); }
      if (a.country) { w.push('country LIKE ?'); b.push(`%${a.country}%`); }
      if (a.search) { w.push('(name LIKE ? OR notes LIKE ? OR source_name LIKE ?)'); b.push(`%${a.search}%`, `%${a.search}%`, `%${a.search}%`); }
      if (!a.include_hidden) w.push('hidden = 0');
      if (a.needs_review) w.push("(date IS NULL OR date_source = 'suggested' OR type = 'other' OR review IS NOT NULL)");
      const limit = Math.min(500, a.limit || 100), offset = a.offset || 0;
      const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
      const total = await ctx.env.DB.prepare(`SELECT COUNT(*) n FROM routes ${where}`).bind(...b).first();
      const { results } = await ctx.env.DB.prepare(`SELECT id, name, date, date_source, type, ROUND(distance_km, 1) km, country, leg_id, hidden, substr(notes, 1, 160) notes, source_name, review FROM routes ${where} ORDER BY date IS NULL, date, id LIMIT ? OFFSET ?`).bind(...b, limit, offset).all();
      for (const r of results) r.review = r.review ? JSON.parse(r.review) : undefined;
      return ok({ total: total.n, offset, routes: results });
    } },
  { name: 'get_route', title: 'Get a route', annotations: { readOnlyHint: true }, description: 'Everything about one route. geometry: "none" (default), "overview" (~250 m), or "detail" (capped at 2,000 points).',
    inputSchema: S({ id: int('Route id'), geometry: { type: 'string', enum: ['none', 'overview', 'detail'] } }, ['id']),
    async run(ctx, a) {
      const r = await ctx.env.DB.prepare('SELECT * FROM routes WHERE id = ?').bind(a.id).first();
      if (!r) throw new ToolError(`No route ${a.id}`);
      const g = a.geometry || 'none';
      let coords;
      if (g !== 'none') { coords = decodePolyline(g === 'overview' ? r.geom_lo || r.geom : r.geom); let tol = 2; while (coords.length > 2000) coords = simplify(coords, (tol *= 2)); }
      delete r.geom; delete r.geom_lo;
      return ok({ ...r, bbox: r.bbox && JSON.parse(r.bbox), review: r.review && JSON.parse(r.review), coordinates: coords });
    } },
  { name: 'update_routes', title: 'Update routes', annotations: { idempotentHint: true }, description: 'Set fields on one or many routes. Setting date marks it as set by hand. color/width null = back to the style.',
    inputSchema: S({ ids, fields: S(ROUTE_FIELDS) }, ['ids', 'fields']),
    async run(ctx, a) {
      const f = { ...a.fields };
      if ('hidden' in f) f.hidden = !!f.hidden;
      return ok(await api(ctx, 'PATCH', '/api/routes', { ids: a.ids, fields: f }));
    } },
  { name: 'delete_routes', title: 'Delete routes', annotations: { destructiveHint: true }, description: 'Permanently delete routes for both people. Prefer update_routes {hidden:true} to keep them off maps. Requires confirm: true.',
    inputSchema: S({ ids, confirm: { type: 'boolean' } }, ['ids', 'confirm']),
    async run(ctx, a) { if (a.confirm !== true) throw new ToolError('Pass confirm: true to delete'); return ok(await api(ctx, 'DELETE', '/api/routes', { ids: a.ids })); } },
  { name: 'import_gpx', title: 'Import a GPX file', description: 'Import GPX text (≤ 1.5 MB). Dates come from GPS times or the file name; duplicates are skipped or flagged. Optional overrides apply to every track in the file.',
    inputSchema: S({ gpx: str('The GPX file contents'), file_name: str('Original file name — used for dating/naming'), name: str('Override name'), date: date('Override date'), type: { type: 'string', enum: TYPE_IDS } }, ['gpx']),
    async run(ctx, a) {
      if (a.gpx.length > 1.5e6) throw new ToolError('Over 1.5 MB — use the web app\'s Import page for big recordings');
      const { routes, warnings } = routesFromGpx(a.gpx, { fileName: a.file_name || 'imported.gpx', tripStart: await tripStart(ctx.env) });
      if (!routes.length) throw new ToolError(warnings.join('; ') || 'No tracks found');
      for (const r of routes) { if (a.name) r.name = a.name; if (a.type) r.type = a.type; if (a.date) { r.date = a.date; r.date_source = 'manual'; } r.source_kind = 'gpx'; }
      return ok({ ...(await importRoutes(ctx, routes)), warnings });
    } },
  { name: 'add_route', title: 'Add a route', description: 'Add a route from coordinates ([[lon,lat],…]) or from waypoints the line should follow: roads (driving), paths (walking), hiking (mountain trails, BRouter), bike, or straight (boats, off-trail).',
    inputSchema: S({ name: str('Name'), date: date('Local date'), type: { type: 'string', enum: TYPE_IDS }, coordinates: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, description: 'The full line as [lon, lat] pairs' }, waypoints: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, description: 'Points to route through, [lon, lat]' }, follow: { type: 'string', enum: ['roads', 'paths', 'hiking', 'bike', 'straight'] }, notes: str('Notes') }, ['name', 'type']),
    async run(ctx, a) {
      const line = a.coordinates && a.coordinates.length > 1 ? a.coordinates : a.waypoints && a.waypoints.length > 1 ? await follow(a.follow || 'roads', a.waypoints) : null;
      if (!line) throw new ToolError('Give coordinates or at least two waypoints');
      const r = buildRoute(line, { fileName: a.name, type: a.type, sourceKind: 'manual' });
      Object.assign(r, { name: a.name, date: a.date || null, date_source: a.date ? 'manual' : null, notes: a.notes || null });
      return ok({ ...(await importRoutes(ctx, [r])), km: r.distance_km });
    } },
  { name: 'add_flights', title: 'Add flights', description: 'Add flights, layovers included. Either itineraries [{route:"AKL LAX JFK", date, notes}] or text with one flight per line ("2024-07-23 AKL LAX JFK Air NZ"). Each hop becomes a dashed great-circle leg.',
    inputSchema: S({ itineraries: { type: 'array', items: S({ route: str('Airport codes in order, e.g. "LIM SCL PUQ"'), date: date('Date'), notes: str('Booking ref, airline…') }, ['route']) }, text: str('One flight per line') }),
    async run(ctx, a) {
      const ap = await airports(ctx.env, ctx.url);
      let list = (a.itineraries || []).map((x) => ({ codes: parseItinerary(x.route), date: x.date || null, notes: x.notes || null, line: x.route }));
      const errors = [];
      if (a.text) { const p = parseFlightLines(a.text); list = list.concat(p.flights); errors.push(...p.errors); }
      const routes = [];
      for (const f of list) {
        if (!f.codes) { errors.push(`Couldn't read “${f.line}”`); continue; }
        try { routes.push(...flightLegs(f.codes, ap, f)); } catch (e) { errors.push(e.message); }
      }
      if (!routes.length) throw new ToolError(errors.join('; ') || 'No flights');
      return ok({ ...(await importRoutes(ctx, routes)), legs: routes.length, errors });
    } },
  { name: 'find_missing_travel', title: 'Find missing travel', annotations: { readOnlyHint: true }, description: 'Jumps between consecutive routes/stays with nothing recorded in between — usually missing flights or drives — with suggested airports.',
    inputSchema: S({ min_km: int('Smallest jump to report (default 400)'), limit: int('Max results (default 40)') }),
    async run(ctx, a) {
      const { results: rs } = await ctx.env.DB.prepare('SELECT id, name, date, type, started_at, geom_lo, geom, hidden FROM routes WHERE hidden = 0 AND date IS NOT NULL').all();
      const routes = rs.map((r) => { const c = decodePolyline(r.geom_lo || r.geom); return { ...r, coords: [c[0], c[c.length - 1]] }; });
      const { results: places } = await ctx.env.DB.prepare('SELECT name, lat, lon, date, hidden FROM places WHERE hidden = 0').all();
      const gaps = findMissingTravel(routes, places, { minKm: a.min_km || 400 }).slice(0, a.limit || 40);
      const ap = await airports(ctx.env, ctx.url);
      const { suggestFlight } = await import('../web/lib/travel.js');
      // Only airports near each end are considered — keeps the Worker's CPU low.
      const around = (pt) => Object.fromEntries(Object.entries(ap).filter(([, v]) => Math.abs(v[0] - pt[0]) < 5 && Math.abs(v[1] - pt[1]) < 5));
      for (const g of gaps) { const s = suggestFlight({ ...around(g.a), ...around(g.b) }, g.a, g.b, g.km); if (s) g.suggest = `${s.from} ${s.to}`; }
      return ok({ gaps });
    } },
  { name: 'list_places', title: 'List places', annotations: { readOnlyHint: true }, description: 'Accommodation and other pins. Filters optional.',
    inputSchema: S({ from: date('On or after'), to: date('On or before'), kind: str('Kind, e.g. tent, freedom, campground, stay, friends, hut'), search: str('Name or notes contain') }),
    async run(ctx, a) {
      const w = [], b = [];
      if (a.from) { w.push('date >= ?'); b.push(a.from); }
      if (a.to) { w.push('date <= ?'); b.push(a.to); }
      if (a.kind) { w.push('kind = ?'); b.push(a.kind); }
      if (a.search) { w.push('(name LIKE ? OR notes LIKE ?)'); b.push(`%${a.search}%`, `%${a.search}%`); }
      const { results } = await ctx.env.DB.prepare(`SELECT id, name, lat, lon, kind, date, nights, substr(notes, 1, 200) notes, hidden FROM places ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY date, id LIMIT 500`).bind(...b).all();
      return ok({ places: results });
    } },
  { name: 'save_places', title: 'Add or edit places', description: 'Create places (no id) or update them (with id). Fields: name, lat, lon, kind, date, nights, notes, hidden.',
    inputSchema: S({ places: { type: 'array', items: S({ id: int('Existing place'), name: str('Name'), lat: { type: 'number' }, lon: { type: 'number' }, kind: str('Kind'), date: date('Night of'), nights: int('Nights'), notes: str('Notes'), hidden: { type: 'boolean' } }) } }, ['places']),
    async run(ctx, a) {
      let created = 0, updated = 0;
      for (const p of a.places) {
        const { id, ...f } = p;
        if (id) { await api(ctx, 'PUT', `/api/places/${id}`, f); updated++; } else { await api(ctx, 'POST', '/api/places', f); created++; }
      }
      return ok({ created, updated });
    } },
  { name: 'delete_places', title: 'Delete places', annotations: { destructiveHint: true }, description: 'Delete places. Requires confirm: true.', inputSchema: S({ ids: { type: 'array', items: { type: 'integer' } }, confirm: { type: 'boolean' } }, ['ids', 'confirm']),
    async run(ctx, a) { if (a.confirm !== true) throw new ToolError('Pass confirm: true'); return ok(await api(ctx, 'DELETE', '/api/places', { ids: a.ids })); } },
  { name: 'save_leg', title: 'Add or edit a leg', description: 'Legs are named trip sections. Routes belong to a leg by date unless pinned (update_routes leg_id).',
    inputSchema: S({ id: int('Existing leg (omit to create)'), name: str('Name'), start_date: date('Start'), end_date: date('End'), color: str('#rrggbb') }, ['name']),
    async run(ctx, a) { const { id, ...f } = a; return ok(id ? await api(ctx, 'PUT', `/api/legs/${id}`, f) : await api(ctx, 'POST', '/api/legs', f)); } },
  { name: 'list_album_maps', title: 'List album maps', annotations: { readOnlyHint: true }, description: 'The album pages: filter, paper, style, title.', inputSchema: S({}),
    async run(ctx) { const b = await api(ctx, 'GET', '/api/bootstrap'); return ok({ maps: b.maps.map(({ id, name, title, filter, paper, style_id, last_export }) => ({ id, name, title, filter, paper, style_id, last_export })), styles: b.styles.map(({ id, name }) => ({ id, name })) }); } },
  { name: 'save_album_map', title: 'Add or edit an album page', description: 'Create (no id) or update an album page. filter: {from,to,types[],legs[],countries[]}; paper: {w,h (mm), dpi, bleed}. A new page frames its routes automatically.',
    inputSchema: S({ id: int('Existing page'), name: str('Name'), title: str('Printed title'), filter: { type: 'object' }, paper: { type: 'object' }, style_id: int('Style') }),
    async run(ctx, a) {
      const { id, ...f } = a;
      if (id) return ok(await api(ctx, 'PUT', `/api/maps/${id}`, f));
      if (!f.name) throw new ToolError('A new page needs a name');
      return ok(await api(ctx, 'POST', '/api/maps', f));
    } },
  { name: 'get_style', title: 'Get a map style', annotations: { readOnlyHint: true }, description: 'The full spec of a map style (with every default filled in), or the list of styles and presets when id is omitted.',
    inputSchema: S({ id: int('Style id') }),
    async run(ctx, a) {
      const b = await api(ctx, 'GET', '/api/bootstrap');
      if (!a.id) return ok({ styles: b.styles.map(({ id, name }) => ({ id, name })), presets: PRESETS.map(({ id, label }) => ({ id, label })) });
      const s = b.styles.find((x) => x.id === a.id);
      if (!s) throw new ToolError(`No style ${a.id}`);
      return ok({ id: s.id, name: s.name, spec: resolveStyle(s.spec) });
    } },
  { name: 'update_style', title: 'Change a map style', description: 'Deep-merge changes into a style (recolour every route type at once with palette), e.g. {"land":"#efe3c8","routes":{"walk":{"color":"#c0392b","width":3}},"detail":{"coastline":"50m"}}. Or apply a preset first with preset.',
    inputSchema: S({ id: int('Style id'), changes: { type: 'object' }, preset: str('Preset id to start from'), name: str('Rename'),
      palette: S({ id: str(`Route palette: ${ROUTE_PALETTES.map((p) => `${p.id} (${p.for})`).join(', ')}`), hue: int('Hue shift −180…180°'), saturation: int('Saturation −100…100 %'), lightness: int('Lighter/darker −50…50 %'), fit: { type: 'boolean', description: 'Push colours until they stand out from the land colour' }, contrast: { type: 'number', description: 'Minimum contrast ratio when fit (default 3)' } }) }, ['id']),
    async run(ctx, a) {
      const b = await api(ctx, 'GET', '/api/bootstrap');
      const s = b.styles.find((x) => x.id === a.id);
      if (!s) throw new ToolError(`No style ${a.id}`);
      let spec = resolveStyle(s.spec);
      if (a.preset) spec = applyPreset(spec, a.preset);
      if (a.changes) spec = mergeStyle(spec, a.changes);
      if (a.palette) spec = applyPalette(spec, a.palette);
      await api(ctx, 'PUT', `/api/styles/${a.id}`, { name: a.name || s.name, spec });
      return ok({ ok: true, id: a.id });
    } },
  { name: 'review_queue', title: 'Review queue', annotations: { readOnlyHint: true }, description: 'Routes that need a person: no date, guessed year, possible duplicates, unknown type, no country.', inputSchema: S({}),
    async run(ctx) {
      const q = (where) => ctx.env.DB.prepare(`SELECT id, name, date, type, ROUND(distance_km,1) km, review FROM routes WHERE hidden = 0 AND ${where} ORDER BY date LIMIT 100`).all().then((r) => r.results.map((x) => ({ ...x, review: x.review ? JSON.parse(x.review) : undefined })));
      const [noDate, guessed, dup, unknown, noCountry] = await Promise.all([q('date IS NULL'), q("date_source = 'suggested'"), q('review IS NOT NULL'), q("type = 'other'"), q("country IS NULL AND type != 'flight'")]);
      return ok({ noDate, guessedYear: guessed, possibleDuplicates: dup, unknownType: unknown, noCountry });
    } },
  { name: 'list_feedback', title: 'Feedback inbox', annotations: { readOnlyHint: true }, description: 'Reports filed in the app (✎ Feedback): text, kind, urgency, status, the page and the thing clicked (a route id, a map point…), the map camera, captured errors, and any reply. Screenshots are viewable in the app.',
    inputSchema: S({ status: str('new | triaged | done | wontfix (default: all open)'), kind: str('bug | idea | question') }),
    async run(ctx, a) {
      const qs = new URLSearchParams(); if (a.status) qs.set('status', a.status); if (a.kind) qs.set('kind', a.kind);
      const r = await api(ctx, 'GET', '/api/feedback/all?' + qs);
      const open = a.status ? r.reports : r.reports.filter((x) => x.status === 'new' || x.status === 'triaged');
      return ok({ reports: open.map((f) => ({ code: f.code, id: f.id, author: f.author_email, body: f.body, kind: f.kind, criticality: f.criticality, status: f.status, created_at: f.created_at,
        page: f.route, clicked: f.element_label, subject: f.subject_type ? `${f.subject_type} ${f.subject_id}` : null, map: f.context && f.context.where && f.context.where.map,
        errors: f.context && f.context.diagnostics, hasScreenshot: !!f.screenshot_key, reply: f.resolution_note })) });
    } },
  { name: 'reply_feedback', title: 'Reply to / close feedback', description: 'Reply to a report (the author sees it on their Feedback page) and/or set its status: new, triaged, done, wontfix.',
    inputSchema: S({ id: int('Report id (TA-<id>)'), reply: str('Reply text'), status: str('new | triaged | done | wontfix') }, ['id']),
    async run(ctx, a) {
      if (!a.reply && !a.status) throw new ToolError('Give a reply, a status, or both');
      if (a.status) await api(ctx, 'PUT', `/api/feedback/${a.id}/status`, { status: a.status, note: a.reply });
      else await api(ctx, 'PUT', `/api/feedback/${a.id}/reply`, { note: a.reply });
      return ok({ ok: true, code: 'TA-' + a.id });
    } },
  { name: 'set_trip', title: 'Trip settings', description: 'Rename the trip or move day 1 (re-dates every "day N" route).', inputSchema: S({ trip_name: str('Name'), trip_start: date('Day 1') }),
    async run(ctx, a) { return ok(await api(ctx, 'PATCH', '/api/trip', a)); } },
  { name: 'search_airports', title: 'Search airports', annotations: { readOnlyHint: true }, description: 'Find IATA codes by city or airport name.', inputSchema: S({ query: str('City, airport name or code') }, ['query']),
    async run(ctx, a) {
      const ap = await airports(ctx.env, ctx.url), q = a.query.toLowerCase();
      // Exact code, then exact city, then name matches — bigger airports first.
      const rank = ([k, v]) => (k.toLowerCase() === q ? 0 : (v[3] || '').toLowerCase() === q ? 1 : 2) * 10 - (v[5] || 1);
      const hits = Object.entries(ap).filter(([k, v]) => k.toLowerCase() === q || `${v[2]} ${v[3]}`.toLowerCase().includes(q)).sort((x, y) => rank(x) - rank(y)).slice(0, 15);
      return ok({ airports: hits.map(([code, v]) => ({ code, name: v[2], city: v[3], country: v[4], lon: v[0], lat: v[1] })) });
    } },
];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

async function rpc(msg, ctx) {
  const { id, method, params = {} } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null; // a notification
  switch (method) {
    case 'initialize':
      return reply({ protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
    case 'tools/call': {
      const t = BY_NAME.get(params.name);
      if (!t) return fail(-32602, `Unknown tool: ${params.name}`);
      try { return reply(await t.run(ctx, params.arguments || {})); } catch (e) {
        return reply({ content: [{ type: 'text', text: e instanceof ToolError || e.status ? e.message : `Error: ${e.message}` }], isError: true });
      }
    }
    default: return fail(-32601, `Method not found: ${method}`);
  }
}

export async function handleMcp(request, env, url) {
  if (request.method === 'GET' || request.method === 'DELETE') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  const pathToken = url.pathname.match(/^\/mcp\/(ta_[A-Za-z0-9_-]+)$/);
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(ta_[A-Za-z0-9_-]+)$/i);
  const user = await identifyToken(env, (pathToken && pathToken[1]) || (bearer && bearer[1]));
  if (!user) return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or revoked token — make one in Trip Atlas → Trip & people → Connectors' } }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' } });
  let body;
  try { body = await request.json(); } catch (_) { return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
  const ctx = { env, url, user };
  const msgs = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(msgs.map((m) => rpc(m, ctx)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export { TOOLS };
