// GPX and WKT-CSV parsing → route records. String scanning, no DOMParser, so
// the same code runs in the browser (import), the Worker and node --test.
import { lengthKm, bbox, simplify, encodePolyline, fingerprint, validCoord, greatCircle } from './geo.js';
import { parseFileName } from './names.js';
import { typeById, typeFromFolder } from './types.js';

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`));
  return m ? m[1] : null;
};
const decodeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

// Returns { tracks: [{ name, coords, times }], waypoints: [{ name, coord, type }], name, warnings }.
// Track segments of one file are joined into one line — every source file in
// this trip is one journey; a file with several *tracks* keeps them apart.
export function parseGpx(text) {
  const warnings = [];
  if (!/<gpx[\s>]/i.test(text)) return { tracks: [], waypoints: [], name: null, warnings: ['Not a GPX file'] };
  const strip = (s) => s.replace(/<(\/?)[a-z0-9]+:/gi, '<$1'); // drop namespace prefixes
  const body = strip(text);
  const meta = body.match(/<metadata>[\s\S]*?<\/metadata>/i);
  const metaName = meta && (meta[0].match(/<name>([\s\S]*?)<\/name>/i) || [])[1];

  const tracks = [];
  const blocks = body.match(/<(trk|rte)\b[\s\S]*?<\/\1>/gi) || [];
  let bad = 0;
  for (const blk of blocks) {
    const nm = (blk.match(/<name>([\s\S]*?)<\/name>/i) || [])[1];
    const coords = [], times = [];
    const ptRe = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi;
    let m;
    while ((m = ptRe.exec(blk))) {
      const lat = parseFloat(attr(m[2], 'lat')), lon = parseFloat(attr(m[2], 'lon'));
      if (!validCoord(lon, lat)) { bad++; continue; }
      coords.push([Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
      const t = m[4] && m[4].match(/<time>([^<]+)<\/time>/i);
      if (t) times.push(t[1].trim());
    }
    if (coords.length) tracks.push({ name: nm ? decodeXml(nm) : null, coords, times });
  }
  const waypoints = [];
  const wRe = /<wpt\b([^>]*?)(\/>|>([\s\S]*?)<\/wpt>)/gi;
  let w;
  while ((w = wRe.exec(body))) {
    const lat = parseFloat(attr(w[1], 'lat')), lon = parseFloat(attr(w[1], 'lon'));
    if (!validCoord(lon, lat)) { bad++; continue; }
    const inner = w[3] || '';
    const nm = (inner.match(/<name>([\s\S]*?)<\/name>/i) || [])[1];
    const ty = (inner.match(/<type>([\s\S]*?)<\/type>/i) || [])[1];
    waypoints.push({ name: nm ? decodeXml(nm) : null, coord: [lon, lat], type: ty ? decodeXml(ty) : null });
  }
  if (bad) warnings.push(`${bad} invalid coordinate${bad === 1 ? '' : 's'} skipped`);
  if (!tracks.length && !waypoints.length) warnings.push('No track, route or waypoint found');
  return { tracks, waypoints, name: metaName ? decodeXml(metaName) : null, warnings };
}

// A GPS timestamp is UTC; the album wants the local calendar day. Longitude
// gives the solar offset — exact enough to land on the right day except
// within an hour or so of midnight.
export function localDate(isoTime, lon) {
  const t = Date.parse(isoTime);
  if (!Number.isFinite(t)) return null;
  return new Date(t + Math.round(lon / 15) * 3600000).toISOString().slice(0, 10);
}

// One parsed line → the record the API stores. `source` describes where it
// came from; `opts.tripStart` dates "day N" files.
export function buildRoute(coords, { fileName, folderPath, trackName, times = [], tripStart, sourceKind = 'gpx', type } = {}) {
  const info = parseFileName(fileName || trackName || 'Untitled', { tripStart, folderPath });
  const rtype = type || info.type || typeFromFolder(folderPath) || 'other';
  let date = info.date, dateSource = info.dateSource;
  // Recorded timestamps beat the file name. One timestamp alone is the file's
  // export time (mapstogpx writes one), not the trip — ignore it.
  if (times.length > 1) {
    const d = localDate(times[0], coords[0][0]);
    if (d) { date = d; dateSource = 'gps-time'; }
  }
  const tol = typeById(rtype).tolerance;
  const detail = simplify(coords, tol);
  const overview = simplify(coords, Math.max(tol, 250));
  const nameFromTrack = trackName && !/^(track|route|untitled)\b/i.test(trackName) ? trackName : null;
  return {
    name: info.name || nameFromTrack || defaultName(rtype, date, info.tripDay),
    date,
    date_source: dateSource,
    trip_day: info.tripDay,
    type: rtype,
    distance_km: Math.round(lengthKm(coords) * 10) / 10,
    point_count: coords.length,
    bbox: bbox(coords),
    fingerprint: fingerprint(coords),
    geom: encodePolyline(detail),
    geom_lo: encodePolyline(overview),
    source_name: fileName || null,
    source_folder: folderPath || null,
    source_kind: sourceKind,
    started_at: times.length > 1 ? times[0] : null,
    ended_at: times.length > 1 ? times[times.length - 1] : null,
  };
}

function defaultName(type, date, day) {
  const t = typeById(type).label.split(' /')[0];
  if (day) return `Day ${day} ${t.toLowerCase()}`;
  return date ? `${t} ${date}` : t;
}

export function routesFromGpx(text, ctx = {}) {
  const g = parseGpx(text);
  const routes = [];
  const join = g.tracks.length > 1 && g.tracks.every((t) => !t.name || t.name === g.tracks[0].name);
  const groups = join ? [{ name: g.tracks[0].name, coords: g.tracks.flatMap((t) => t.coords), times: g.tracks.flatMap((t) => t.times) }] : g.tracks;
  for (const t of groups) {
    if (t.coords.length < 2) continue;
    routes.push(buildRoute(t.coords, { ...ctx, trackName: t.name || g.name, times: t.times }));
  }
  return { routes, waypoints: g.waypoints, warnings: g.warnings };
}

// Google My Maps / Coordinate Generator CSV: WKT,name,description.
export function routesFromWktCsv(text, ctx = {}) {
  const rows = parseCsv(text);
  const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const iW = head.indexOf('wkt'), iN = head.indexOf('name'), iD = head.indexOf('description');
  if (iW < 0) return { routes: [], waypoints: [], warnings: ['No WKT column — expected a Google My Maps export (WKT,name,description)'] };
  const routes = [], waypoints = [], warnings = [];
  rows.forEach((r, i) => {
    const wkt = r[iW] || '';
    const pairs = [...wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]]);
    const coords = pairs.filter(([x, y]) => validCoord(x, y));
    const nm = iN >= 0 ? r[iN] : `Row ${i + 2}`;
    if (/^POINT/i.test(wkt) && coords.length) { waypoints.push({ name: nm, coord: coords[0], type: iD >= 0 ? r[iD] : null }); return; }
    if (coords.length < 2) { warnings.push(`Row ${i + 2} (${nm}): no line`); return; }
    if (coords.length < pairs.length) warnings.push(`Row ${i + 2} (${nm}): ${pairs.length - coords.length} invalid point(s) dropped`);
    routes.push(buildRoute(coords, { ...ctx, fileName: nm, sourceKind: 'csv' }));
  });
  return { routes, waypoints, warnings };
}

export function flightRoute(from, to, { date, name } = {}) {
  const coords = greatCircle(from.coord, to.coord);
  const r = buildRoute(coords, { fileName: name || `${from.code} to ${to.code}`, type: 'flight', sourceKind: 'flight' });
  r.date = date || null;
  r.date_source = date ? 'manual' : null;
  return r;
}

// RFC 4180-ish CSV (quoted fields, doubled quotes, newlines inside quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Places CSV (accommodation, campsites): name, lat, lon, kind/type, date, notes.
export function placesFromCsv(text) {
  const rows = parseCsv(text);
  const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const col = (...names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iLat = col('lat', 'latitude'), iLon = col('lon', 'lng', 'long', 'longitude');
  if (iLat < 0 || iLon < 0) return { places: [], warnings: ['Need lat and lon columns (name, lat, lon, kind, date, notes)'] };
  const iName = col('name', 'title'), iKind = col('kind', 'type', 'category'), iDate = col('date', 'check_in', 'from'), iNotes = col('notes', 'description');
  const places = [], warnings = [];
  rows.forEach((r, i) => {
    const lat = parseFloat(r[iLat]), lon = parseFloat(r[iLon]);
    if (!validCoord(lon, lat)) { warnings.push(`Row ${i + 2}: invalid lat/lon — skipped`); return; }
    places.push({
      name: iName >= 0 ? r[iName].trim() || null : null,
      lat, lon,
      kind: iKind >= 0 ? (r[iKind].trim().toLowerCase() || 'other') : 'other',
      date: iDate >= 0 ? r[iDate].trim() || null : null,
      notes: iNotes >= 0 ? r[iNotes].trim() || null : null,
    });
  });
  return { places, warnings };
}
