// What a file name tells us: date, trip day, transport type, a readable name.
//
// Every pattern here comes from a real file in GPX-Files-Raw — the legacy
// parser missed most of them, which is why 130 of 208 routes had no date:
//   "Le_Grammont - 18:05:2025"          DD:MM:YYYY with colons (macOS shows "/" as ":")
//   "Churup 23-11-2024"                  DD-MM-YYYY
//   "August 02 2025 driving"             Month DD YYYY
//   "April 25 driving", "May 2 driving"  Month DD, no year → year inferred from the trip
//   "July 1_2 2025"                      Month D_part YYYY
//   "day 103 busing", "day 81.1 driving" trip day N (date = trip start + N − 1)
//   "BOAT - June 24 2025 Boat Ride In"
//   "Salkantay Day 1 05-12-2024"         "Day 1" of a hike, not of the trip — a real date wins
import { typeFromWords } from './types.js';

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const pad = (n) => String(n).padStart(2, '0');
function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// Returns { date, matched } — `matched` is the substring consumed, so the
// caller can strip it from the display name.
export function dateFromText(text, { tripStart } = {}) {
  let m;
  // YYYY-MM-DD / YYYY_MM_DD
  if ((m = text.match(/(\d{4})[-_.:/](\d{1,2})[-_.:/](\d{1,2})/))) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) return { date: v, matched: m[0] };
  }
  // DD-MM-YYYY, DD:MM:YYYY, DD_MM_YYYY, DD.MM.YYYY — the trip is NZ/European, so day first.
  if ((m = text.match(/(\d{1,2})[-_.:/](\d{1,2})[-_.:/](\d{4})/))) {
    const v = iso(+m[3], +m[2], +m[1]) || iso(+m[3], +m[1], +m[2]);
    if (v) return { date: v, matched: m[0] };
  }
  // Month D[_part| part] YYYY  ("July 1_2 2025", "June 12 1 2025", "August 02 2025")
  const re1 = new RegExp(`\\b(${MONTH_RE})[\\s_-]*(\\d{1,2})(?:[_.]\\d|\\s\\d)?,?[\\s_-]+(\\d{4})\\b`, 'i');
  if ((m = text.match(re1))) {
    const v = iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    if (v) return { date: v, matched: m[0] };
  }
  // D Month YYYY
  const re2 = new RegExp(`\\b(\\d{1,2})[\\s_-]*(${MONTH_RE})[\\s_-]*(\\d{4})\\b`, 'i');
  if ((m = text.match(re2))) {
    const v = iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    if (v) return { date: v, matched: m[0] };
  }
  // Month D (no year) — pick the year that puts the date inside the trip.
  const re3 = new RegExp(`\\b(${MONTH_RE})[\\s_-]*(\\d{1,2})(?:[_.]\\d)?\\b`, 'i');
  if ((m = text.match(re3)) && tripStart) {
    const mo = MONTHS[m[1].toLowerCase()], d = +m[2];
    const y0 = +tripStart.slice(0, 4);
    for (const y of [y0, y0 + 1, y0 + 2]) {
      const v = iso(y, mo, d);
      if (v && v >= tripStart) return { date: v, matched: m[0], inferredYear: true };
    }
  }
  return { date: null, matched: '' };
}

// "day 103 busing" / "day 81.1 driving" → { day: 103, part: 1 }. Only when the
// name *starts* with "day" — "Salkantay Day 1" is a hike's own day count.
export function tripDayFromText(text) {
  const m = text.match(/^\s*day[\s_-]*(\d{1,3})(?:\.(\d))?\b/i);
  return m ? { day: +m[1], part: m[2] ? +m[2] : null, matched: m[0] } : null;
}

function tidy(s) {
  return s
    .replace(/[_]+/g, ' ')
    .replace(/\s*[-–]\s*$/, '')
    .replace(/^\s*[-–]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function titleCase(s) {
  // Unicode-aware word start: JS \b treats “ö” as a break, which gave “GöTeborg”.
  return s.replace(/(?<![\p{L}\p{N}'])(\p{Ll})([\p{L}']*)/gu, (_, a, b) => a.toUpperCase() + b);
}

const NOISE = /\b(gps coords|prt \d+|part \d+)\b/gi;

export function parseFileName(fileName, { tripStart, folderPath } = {}) {
  const stem = String(fileName).replace(/^.*[\\/]/, '').replace(/\.(gpx|csv|kml)$/i, '');
  const words = stem.split(/[\s_\-:.&]+/).filter(Boolean);
  const type = typeFromWords(words);

  const tripDay = tripDayFromText(stem);
  let { date, matched, inferredYear } = dateFromText(stem, { tripStart });
  // A year we had to guess is a suggestion, not a fact: the trip has an
  // August–September in both 2024 (USA) and 2025 (Europe).
  let dateSource = date ? (inferredYear ? 'suggested' : 'filename') : null;
  if (!date && tripDay && tripStart) {
    date = addDays(tripStart, tripDay.day - 1);
    dateSource = 'trip-day';
  }

  // Readable name: drop the date and trip-day tokens and transport words that
  // only restate the type; keep everything else the person typed.
  let name = stem;
  if (matched) name = name.replace(matched, ' ');
  name = name.replace(/\b\d{1,2}[_:.]\d{2}(?:[_:.]\d{2})?\b/g, ' '); // a time of day (SkiTracks: 2025_01_17_09_59_44)
  if (tripDay) name = name.replace(tripDay.matched, ' ');
  name = name.replace(/^\s*BOAT\s*-\s*/i, ' ').replace(NOISE, ' ');
  const typeWords = new Set(['driving', 'drive', 'busing', 'bussing', 'ubering', 'taxi', 'walking', 'gps', 'coords']);
  name = tidy(name.split(/\s+/).filter((w) => !typeWords.has(w.toLowerCase())).join(' '));
  name = name.replace(/^\d+\s+/, '').trim();
  const generic = !name || /^([\d\s]+|[a-z]{1,2})$/i.test(name);

  return {
    stem,
    name: generic ? null : titleCase(name),
    date,
    dateSource,
    inferredYear: !!inferredYear,
    tripDay: tripDay ? tripDay.day : null,
    type,
    folder: folderPath || null,
  };
}
