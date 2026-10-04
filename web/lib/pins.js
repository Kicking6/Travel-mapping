// Pin shapes and symbols for places — one definition, three renderers: the
// map (bitmaps drawn at the map's pixel ratio), SVG export (paths) and PDF
// export (fill paths). Paths are absolute M/L/C/Z in a 24×24 box so they can
// be transformed by scaling coordinate pairs and converted to PDF operators.

const R = 9, K = 0.5523; // circle radius in the box; bezier circle constant
const circle = (cx, cy, r) => `M${cx} ${cy - r}C${cx + r * K} ${cy - r} ${cx + r} ${cy - r * K} ${cx + r} ${cy}C${cx + r} ${cy + r * K} ${cx + r * K} ${cy + r} ${cx} ${cy + r}C${cx - r * K} ${cy + r} ${cx - r} ${cy + r * K} ${cx - r} ${cy}C${cx - r} ${cy - r * K} ${cx - r * K} ${cy - r} ${cx} ${cy - r}Z`;
const poly = (pts) => `M${pts.map(([x, y]) => `${+x.toFixed(3)} ${+y.toFixed(3)}`).join('L')}Z`;
const star = (cx, cy, ro, ri, n = 5) => poly(Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? ri : ro; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }));

// center: where a symbol sits; anchor: the point that marks the location (0–1 of the box).
export const SHAPES = {
  circle: { label: 'Circle', d: circle(12, 12, R), center: [12, 12], anchor: 'center' },
  pin: { label: 'Map pin', d: 'M12 23C12 23 3.5 14.6 3.5 9.5C3.5 4.8 7.3 1 12 1C16.7 1 20.5 4.8 20.5 9.5C20.5 14.6 12 23 12 23Z', center: [12, 9.5], anchor: 'bottom' },
  square: { label: 'Square', d: poly([[4, 4], [20, 4], [20, 20], [4, 20]]), center: [12, 12], anchor: 'center' },
  rounded: { label: 'Rounded square', d: 'M7 4L17 4C18.7 4 20 5.3 20 7L20 17C20 18.7 18.7 20 17 20L7 20C5.3 20 4 18.7 4 17L4 7C4 5.3 5.3 4 7 4Z', center: [12, 12], anchor: 'center' },
  diamond: { label: 'Diamond', d: poly([[12, 2], [22, 12], [12, 22], [2, 12]]), center: [12, 12], anchor: 'center' },
  triangle: { label: 'Triangle', d: poly([[12, 2.5], [22, 20.5], [2, 20.5]]), center: [12, 14.5], anchor: 'center' },
  hexagon: { label: 'Hexagon', d: poly(Array.from({ length: 6 }, (_, i) => [12 + 10 * Math.cos((Math.PI / 3) * i + Math.PI / 6), 12 + 10 * Math.sin((Math.PI / 3) * i + Math.PI / 6)])), center: [12, 12], anchor: 'center' },
  star: { label: 'Star', d: star(12, 12.5, 11, 4.6), center: [12, 13], anchor: 'center' },
  dot: { label: 'Small dot', d: circle(12, 12, 4.5), center: [12, 12], anchor: 'center' },
};

// Symbols, drawn in a 24 box centred on (12,12) at about 12 px across; scaled
// into the shape's `center`.
export const GLYPHS = {
  none: { label: 'None', d: '' },
  tent: { label: 'Tent', d: 'M12 6L19 18L5 18Z M12 11L14.5 18L9.5 18Z' },
  bed: { label: 'Bed', d: 'M5 9L7 9L7 13L19 13L19 18L17 18L17 16L7 16L7 18L5 18Z M8 10.5L11.5 10.5L11.5 12.5L8 12.5Z M12.5 10L17.5 10C18.4 10 19 10.6 19 11.5L19 12.5L12.5 12.5Z' },
  house: { label: 'House', d: 'M12 5L19.5 11.5L17.5 11.5L17.5 18.5L13.5 18.5L13.5 14L10.5 14L10.5 18.5L6.5 18.5L6.5 11.5L4.5 11.5Z' },
  car: { label: 'Car / van', d: 'M6.5 11L8 7.5C8.3 6.9 8.9 6.5 9.6 6.5L14.4 6.5C15.1 6.5 15.7 6.9 16 7.5L17.5 11L18.5 11C19.3 11 20 11.7 20 12.5L20 16L18 16L18 17.5L15.5 17.5L15.5 16L8.5 16L8.5 17.5L6 17.5L6 16L4 16L4 12.5C4 11.7 4.7 11 5.5 11Z M8.7 11L15.3 11L14.3 8.5L9.7 8.5Z' },
  heart: { label: 'Heart', d: 'M12 19C12 19 4.5 14.2 4.5 9.6C4.5 7.4 6.2 5.8 8.3 5.8C9.8 5.8 11.2 6.7 12 8C12.8 6.7 14.2 5.8 15.7 5.8C17.8 5.8 19.5 7.4 19.5 9.6C19.5 14.2 12 19 12 19Z' },
  star: { label: 'Star', d: star(12, 12.5, 7, 3) },
  mountain: { label: 'Mountain', d: 'M3.5 18.5L9.5 8L12.5 13L14.5 10L20.5 18.5Z' },
  flag: { label: 'Flag', d: 'M7 5L9 5L9 6L18 6L15.5 9.5L18 13L9 13L9 19L7 19Z' },
  cabin: { label: 'Cabin', d: 'M12 4.5L20 11L18 11L18 18.5L6 18.5L6 11L4 11Z M10 13L14 13L14 18.5L10 18.5Z' },
  camera: { label: 'Camera', d: 'M9 7L10.2 5.5L13.8 5.5L15 7L18 7C18.8 7 19.5 7.7 19.5 8.5L19.5 16.5C19.5 17.3 18.8 18 18 18L6 18C5.2 18 4.5 17.3 4.5 16.5L4.5 8.5C4.5 7.7 5.2 7 6 7Z' },
  dot: { label: 'Dot', d: circle(12, 12, 3.2) },
  number: { label: 'Night number', d: '' },
};

// Map every coordinate pair of an absolute M/L/C/Z path through f([x, y]).
export function mapPath(d, f) {
  return d.replace(/(-?\d*\.?\d+(?:e-?\d+)?)[ ,]+(-?\d*\.?\d+(?:e-?\d+)?)/g, (_, x, y) => { const [a, b] = f([+x, +y]); return `${+a.toFixed(3)} ${+b.toFixed(3)}`; });
}

// The glyph path moved into a shape's centre, scaled to `scale` of the box.
export function glyphIn(shapeId, glyphId, scale = 0.62) {
  const g = GLYPHS[glyphId], s = SHAPES[shapeId] || SHAPES.circle;
  if (!g || !g.d) return '';
  const k = scale * (shapeId === 'dot' ? 0.5 : 1);
  return mapPath(g.d, ([x, y]) => [s.center[0] + (x - 12) * k, s.center[1] + (y - 12) * k]);
}

// A whole pin as SVG-ish parts in a box `px` wide whose anchor sits at (x, y).
export function pinParts(kind, { x = 0, y = 0, px = 16 } = {}) {
  const s = SHAPES[kind.shape] || SHAPES.circle;
  const k = px / 24;
  const ox = x - 12 * k, oy = s.anchor === 'bottom' ? y - 23 * k : y - 12 * k;
  const t = (d) => mapPath(d, ([a, b]) => [ox + a * k, oy + b * k]);
  return { shape: t(s.d), glyph: kind.glyph && kind.glyph !== 'number' ? t(glyphIn(kind.shape, kind.glyph)) : '', center: [ox + s.center[0] * k, oy + s.center[1] * k], k };
}

// SVG path (absolute M L C Z only) → PDF path operators. `fy(y)` flips y.
export function pathToPdf(d, fx = (v) => v, fy = (v) => v) {
  const out = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
    const pts = [];
    for (let i = 0; i < n.length; i += 2) pts.push(`${(+fx(n[i]).toFixed(3))} ${(+fy(n[i + 1]).toFixed(3))}`);
    if (m[1] === 'M') out.push(`${pts[0]} m`);
    else if (m[1] === 'L') pts.forEach((p) => out.push(`${p} l`));
    else if (m[1] === 'C') for (let i = 0; i < pts.length; i += 3) out.push(`${pts[i]} ${pts[i + 1]} ${pts[i + 2]} c`);
    else out.push('h');
  }
  return out.join('\n');
}
