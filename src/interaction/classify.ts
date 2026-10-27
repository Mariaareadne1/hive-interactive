import { strokeLength, type Pt } from './stroke';
import type { FlowerKind } from '../flowers/kinds';

/**
 * Reading a doodle as a flower. Forgiving heuristics over a few stroke
 * features — how tall it is, how much it winds, whether the loops share a
 * centre, how many sharp corners and zig-zags it has — each scored 0..1 per
 * kind. The best wins; when it is a close call the runner-up is offered as
 * "Make it a … instead". Any drawing still gives a flower.
 *
 *   tall, mostly vertical (maybe a loop on top)  → sunflower
 *   tall and wobbly / zig-zag                    → foxglove
 *   a spiral, nested loops                       → rose
 *   spiky, star-like, many sharp turns           → daisy
 *   a string of small loops, climbing            → lavender
 *   a clump of small loops                       → allium
 *   one round loop                               → poppy
 */

export interface StrokeFeatures {
  width: number;
  height: number;
  /** height / width */
  aspect: number;
  length: number;
  closed: boolean;
  /** Net winding, in turns (a circle is 1, a spiral 2–3). */
  loops: number;
  /** Corners sharper than ~95°. */
  sharp: number;
  /** Left-right reversals while climbing (zig-zag). */
  reversals: number;
  /** How far apart the loops' centres are, relative to the drawing's size (0 nested .. 1 strung out). */
  spread: number;
  /** How round a single loop is (1 circle). */
  roundness: number;
}

export interface Classification {
  kind: FlowerKind;
  /** The runner-up, offered when the call was close. */
  alternative: FlowerKind | null;
  ambiguous: boolean;
  scores: Record<FlowerKind, number>;
  features: StrokeFeatures;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Evenly spaced points along the line, however sparsely the pointer reported it. */
function resample(pts: readonly Pt[], spacing: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = spacing - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - out[out.length - 1].x, last.y - out[out.length - 1].y) > spacing * 0.3) out.push(last);
  return out;
}

function turnAngle(a: Pt, b: Pt, c: Pt): number {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  return Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1));
}

export function strokeFeatures(raw: readonly Pt[]): StrokeFeatures {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const diag = Math.hypot(width, height);
  const length = strokeLength(raw);
  const first = raw[0] ?? { x: 0, y: 0 };
  const last = raw[raw.length - 1] ?? first;
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < Math.max(16, 0.25 * Math.max(width, height));

  // winding and corners on an evenly spaced copy of the line
  const pts = resample(raw, Math.max(2.5, diag * 0.025));
  let net = 0;
  let sharp = 0;
  const turnsAt: number[] = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = turnAngle(pts[i - 1], pts[i], pts[i + 1]);
    net += a;
    turnsAt.push(Math.abs(net));
  }
  // corners: the turn accumulated over a short window, so a rounded hairpin counts once
  const win = 2;
  for (let i = win; i < pts.length - win; i++) {
    let local = 0;
    for (let k = i - win + 1; k <= i + win - 1; k++) local += turnAngle(pts[k - 1], pts[k], pts[k + 1]);
    const here = Math.abs(turnAngle(pts[i - 1], pts[i], pts[i + 1]));
    if (Math.abs(local) > 1.65 && here > 0.7) {
      sharp++;
      i += win;
    }
  }
  const loops = Math.abs(net) / (Math.PI * 2);

  // zig-zag: sideways direction changes with a real swing, counted along the climb
  let reversals = 0;
  let dir = 0;
  let anchor = pts[0]?.x ?? 0;
  for (const p of pts) {
    const dx = p.x - anchor;
    if (Math.abs(dx) > Math.max(5, width * 0.18)) {
      const d = Math.sign(dx);
      if (dir !== 0 && d !== dir) reversals++;
      dir = d;
      anchor = p.x;
    } else if (dir !== 0 && Math.sign(dx) === dir) anchor = dir > 0 ? Math.max(anchor, p.x) : Math.min(anchor, p.x);
  }

  // loop centres: cut the line every full turn and compare where each turn was centred
  const centres: Pt[] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if ((turnsAt[Math.min(i, turnsAt.length - 1)] ?? 0) - (turnsAt[start] ?? 0) >= Math.PI * 2 * 0.9 || i === pts.length - 1) {
      const chunk = pts.slice(start, i + 1);
      if (chunk.length >= 3) {
        centres.push({ x: chunk.reduce((s, p) => s + p.x, 0) / chunk.length, y: chunk.reduce((s, p) => s + p.y, 0) / chunk.length });
      }
      start = i;
    }
  }
  let spread = 0;
  for (let i = 0; i < centres.length; i++) {
    for (let j = i + 1; j < centres.length; j++) spread = Math.max(spread, Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y));
  }
  spread = centres.length > 1 ? spread / diag : 0;

  // roundness: 4πA/P² of the outline (1 for a circle)
  let area = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length];
    area += a.x * b.y - b.x * a.y;
  }
  const roundness = clamp01((4 * Math.PI * Math.abs(area / 2)) / Math.max(1, length * length));

  return { width, height, aspect: height / width, length, closed, loops, sharp, reversals, spread, roundness };
}

export function scoreKinds(f: StrokeFeatures): Record<FlowerKind, number> {
  const tall = ramp(f.aspect, 1.5, 2.6);
  const wobbly = ramp(f.reversals, 2, 4);
  const many = ramp(f.loops, 1.4, 2.2);
  const strung = ramp(f.spread, 0.22, 0.45);
  const spiky = ramp(f.sharp, 3, 6);
  return {
    sunflower: tall * (1 - wobbly) * (1 - 0.8 * many) * (1 - 0.7 * spiky),
    foxglove: ramp(f.aspect, 1.2, 2.0) * wobbly * (1 - 0.5 * many),
    rose: many * (1 - strung) * (1 - 0.6 * spiky),
    daisy: spiky * (1 - 0.5 * tall) * (1 - 0.6 * wobbly * tall),
    lavender: many * strung * ramp(f.aspect, 1.0, 1.8),
    allium: many * strung * (1 - ramp(f.aspect, 1.0, 1.8)),
    poppy: ramp(f.loops, 0.6, 0.95) * (1 - ramp(f.loops, 1.35, 1.8)) * (1 - tall) * (1 - spiky) * (0.5 + 0.5 * ramp(f.roundness, 0.3, 0.7)),
  };
}

export function classifyStroke(points: readonly Pt[]): Classification {
  const features = strokeFeatures(points);
  const scores = scoreKinds(features);
  const ranked = (Object.entries(scores) as [FlowerKind, number][]).sort((a, b) => b[1] - a[1]);
  let [kind, best] = ranked[0];
  const [second, next] = ranked[1];
  if (best < 0.08) {
    // nothing fits: tall things become sunflowers, round-ish things poppies, the rest daisies
    kind = features.aspect > 1.6 ? 'sunflower' : features.closed ? 'poppy' : 'daisy';
    best = 0;
  }
  const ambiguous = best < 0.55 || best - next < 0.4;
  const alternative = ambiguous ? (second !== kind ? second : ranked[0][0] !== kind ? ranked[0][0] : null) : null;
  return { kind, alternative, ambiguous, scores, features };
}
