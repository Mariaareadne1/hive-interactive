// Stroke shapes in screen pixels, shared by the QA and demo scripts.
export function shapePoints(shape, cx, cy) {
  const pts = [];
  const add = (x, y) => pts.push([x, y]);
  if (shape === 'line') for (let i = 0; i <= 40; i++) add(cx + Math.sin(i / 40 * 3) * 14, cy + 110 - i * 5.5);
  if (shape === 'circle') for (let i = 0; i <= 50; i++) { const a = Math.PI / 2 + (i / 50) * Math.PI * 2; add(cx + Math.cos(a) * 40, cy + Math.sin(a) * 38); }
  if (shape === 'spiral') for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * 2.6 * Math.PI * 2; add(cx + Math.cos(a) * 55 * (1 - 0.8 * t), cy + Math.sin(a) * 55 * (1 - 0.8 * t)); }
  if (shape === 'star') for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 22 : 60; add(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  if (shape === 'loops') for (let i = 0; i <= 180; i++) { const t = i / 30, a = t * Math.PI * 2; add(cx + Math.cos(a) * 14, cy + 90 - t * 30 + Math.sin(a) * 14); }
  if (shape === 'clump') for (let i = 0; i <= 180; i++) { const t = i / 30, a = t * Math.PI * 2, b = (t / 6) * Math.PI * 2; add(cx + Math.cos(b) * 22 + Math.cos(a) * 14, cy + Math.sin(b) * 22 + Math.sin(a) * 14); }
  if (shape === 'zigzag') for (let i = 0; i <= 70; i++) { const t = i / 70; add(cx + Math.sin(t * 7 * Math.PI) * 16, cy + 120 - t * 260); }
  return pts;
}
