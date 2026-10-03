// Where and when a photo belongs — pure, so the tests can cover it.
import { haversineKm, lengthKm } from './geo.js';

// Distance from a point to a line (segments, not just vertices — a simplified
// drive can have vertices kilometres apart), on a local flat projection.
export function distanceToLineKm(pt, coords) {
  const kx = 111.32 * Math.cos((pt[1] * Math.PI) / 180), ky = 110.574;
  let best = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const ax = (coords[i][0] - pt[0]) * kx, ay = (coords[i][1] - pt[1]) * ky;
    if (i === 0) { best = Math.min(best, Math.hypot(ax, ay)); continue; }
    const bx = (coords[i - 1][0] - pt[0]) * kx, by = (coords[i - 1][1] - pt[1]) * ky;
    const dx = ax - bx, dy = ay - by, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(bx * dx + by * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(bx + t * dx, by + t * dy));
  }
  return best;
}

// Point a fraction of the way along a line, by distance.
export function pointAlong(coords, f) {
  if (!coords.length) return null;
  const total = lengthKm(coords), target = total * Math.max(0, Math.min(1, f));
  let t = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineKm(coords[i - 1], coords[i]);
    if (t + d >= target) {
      const k = d ? (target - t) / d : 0;
      return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * k, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * k];
    }
    t += d;
  }
  return coords[coords.length - 1];
}

/**
 * Place a photo. `p`: { lat, lon, taken_at, date }. `routes`: with coords,
 * date, started_at, ended_at. Returns { lat, lon, route_id, place_source }.
 *  - GPS in the photo → use it; link the route on that date that passes within 3 km.
 *  - no GPS, a time inside a recorded route's start–end → interpolate along it.
 *  - no GPS, only a date → the middle of that day's longest route (approximate).
 */
export function placePhoto(p, routes) {
  const sameDay = p.date ? routes.filter((r) => r.date === p.date && r.coords && r.coords.length) : [];
  if (p.lat != null && p.lon != null) {
    let best = null;
    for (const r of sameDay) {
      const d = distanceToLineKm([p.lon, p.lat], r.coords);
      if (d < 3 && (!best || d < best.d)) best = { d, id: r.id };
    }
    return { lat: p.lat, lon: p.lon, route_id: best ? best.id : null, place_source: 'gps' };
  }
  if (p.taken_at) {
    // A camera time with no zone is local wall-clock; GPS tracks are UTC.
    // Convert per route using its longitude (solar offset), never the
    // browser's own zone — this trip was nowhere near New Zealand.
    const zoned = /([zZ]|[+-]\d{2}:\d{2})$/.test(p.taken_at);
    const utcFor = (r) => (zoned ? Date.parse(p.taken_at) : Date.parse(p.taken_at + 'Z') - Math.round(r.coords[0][0] / 15) * 3600000);
    let t = null;
    const hit = routes.find((r) => {
      if (!r.started_at || !r.ended_at || !r.coords || !r.coords.length) return false;
      t = utcFor(r);
      return t >= Date.parse(r.started_at) && t <= Date.parse(r.ended_at);
    });
    if (hit) {
      const [lon, lat] = pointAlong(hit.coords, (t - Date.parse(hit.started_at)) / (Date.parse(hit.ended_at) - Date.parse(hit.started_at)));
      return { lat, lon, route_id: hit.id, place_source: 'route-time' };
    }
  }
  if (sameDay.length) {
    const r = sameDay.reduce((a, b) => ((b.distance_km || 0) > (a.distance_km || 0) ? b : a));
    const [lon, lat] = pointAlong(r.coords, 0.5);
    return { lat, lon, route_id: r.id, place_source: 'route-date' };
  }
  return { lat: null, lon: null, route_id: null, place_source: null };
}

// EXIF "2025:05:18 14:03:22" (+ optional "+02:00" OffsetTimeOriginal) → ISO
// and the local calendar date (the camera's clock is already local).
export function exifTime(dto, offset) {
  if (!dto) return { taken_at: null, date: null };
  const s = dto instanceof Date ? null : String(dto);
  if (s) {
    const m = s.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return { taken_at: null, date: null };
    const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    const off = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null;
    return { taken_at: off ? new Date(local + off).toISOString() : local, date: `${m[1]}-${m[2]}-${m[3]}` };
  }
  // exifr hands back a Date built from local wall-clock fields
  const d = dto, pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const local = `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const off = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null;
  return { taken_at: off ? new Date(local + off).toISOString() : local, date };
}
