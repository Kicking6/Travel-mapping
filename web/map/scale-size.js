// Multiply a text-size by k. Zoom curves must stay top-level, so scale their
// output stops ("interpolate" / "step" / legacy {stops}) rather than wrapping them.
export function scaleSize(v, k) {
  if (k === 1 || v == null) return v;
  if (typeof v === 'number') return v * k;
  if (Array.isArray(v) && (v[0] === 'interpolate' || v[0] === 'interpolate-hcl' || v[0] === 'interpolate-lab')) return v.map((x, i) => (i >= 3 && i % 2 === 0 ? scaleSize(x, k) : x));
  if (Array.isArray(v) && v[0] === 'step') return v.map((x, i) => (i >= 2 && i % 2 === 0 ? scaleSize(x, k) : x));
  if (v && Array.isArray(v.stops)) return { ...v, stops: v.stops.map(([z, s]) => [z, scaleSize(s, k)]) };
  return ['*', k, v];
}
