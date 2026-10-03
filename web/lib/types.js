// Transport types — declared once. Colours here are only the defaults a new
// map style starts from; every style can override them (Style → Routes).
// `words` are the filename tokens that imply the type (see names.js), taken
// from the real file names in GPX-Files-Raw: "busing", "bussing", "ubering"…
// `tolerance` is the Douglas–Peucker tolerance (m) used when storing the
// detailed geometry — a hike needs to keep its switchbacks, a drive doesn't.

export const TYPES = [
  { id: 'drive', label: 'Driving', color: '#3b6ea8', width: 2.5, tolerance: 15, words: ['drive', 'driving', 'car', 'roadtrip'] },
  { id: 'taxi', label: 'Taxi / rideshare', color: '#5d86b8', width: 2, tolerance: 15, words: ['taxi', 'uber', 'ubering', 'cab', 'rideshare'] },
  { id: 'bus', label: 'Bus', color: '#c77d2e', width: 2.5, tolerance: 15, words: ['bus', 'busing', 'bussing', 'coach'] },
  { id: 'train', label: 'Train', color: '#8a5a9e', width: 2.5, tolerance: 15, words: ['train', 'rail', 'railway'] },
  { id: 'boat', label: 'Boat / ferry', color: '#2a9d8f', width: 2.5, tolerance: 10, words: ['boat', 'ferry', 'rib', 'sailing', 'boating', 'cruise'] },
  { id: 'walk', label: 'Walking / hiking', color: '#c0392b', width: 2.5, tolerance: 4, words: ['walk', 'walking', 'hike', 'hiking', 'trail', 'trek', 'summit', 'loop', 'stroll'] },
  { id: 'bike', label: 'Cycling', color: '#d35400', width: 2.5, tolerance: 6, words: ['bike', 'cycle', 'cycling', 'ride'] },
  { id: 'ski', label: 'Skiing', color: '#4aa3df', width: 2, tolerance: 6, words: ['ski', 'skiing', 'snowboard'] },
  { id: 'flight', label: 'Flight', color: '#7f8c8d', width: 1.5, tolerance: 2000, dash: true, words: ['flight', 'fly', 'plane'] },
  { id: 'other', label: 'Other', color: '#6b7684', width: 2, tolerance: 10, words: [] },
];

export const TYPE_IDS = TYPES.map((t) => t.id);
export const typeById = (id) => TYPES.find((t) => t.id === id) || TYPES[TYPES.length - 1];

const WORD_TO_TYPE = new Map();
for (const t of TYPES) for (const w of t.words) WORD_TO_TYPE.set(w, t.id);

// Order matters when a name has two hints ("Boat Ride Out & Walk"): the first
// transport word wins, except that "ride" (bike) is a weak hint that loses to
// anything else.
export function typeFromWords(words) {
  let weak = null;
  for (const w of words) {
    const t = WORD_TO_TYPE.get(w.toLowerCase());
    if (!t) continue;
    if (w.toLowerCase() === 'ride' || ['trail', 'loop', 'summit'].includes(w.toLowerCase())) { weak = weak || t; continue; }
    return t;
  }
  return weak;
}

// What a source folder implies, for files whose names carry no hint
// ("Cathedral_Rock_Trail" lives in Walking/).
export function typeFromFolder(path) {
  const parts = String(path || '').toLowerCase().split('/').slice(0, -1);
  for (const p of parts.reverse()) {
    if (/walk|hik|strava/.test(p)) return /ski/.test(p) ? 'ski' : 'walk';
    if (/ski/.test(p)) return 'ski';
    if (/driv/.test(p)) return 'drive';
    if (/boat|ferry/.test(p)) return 'boat';
    if (/public transport|bus/.test(p)) return 'bus';
    if (/flight/.test(p)) return 'flight';
  }
  return null;
}
