import type { Pt } from '../../src/interaction/stroke';

/** Hand-like stroke fixtures in screen pixels (y grows downward). */

const jitter = (i: number, a = 1.2) => Math.sin(i * 12.9898) * a;

export function line(x: number, y0: number, y1: number, bend = 0, n = 60): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { x: x + Math.sin(t * Math.PI) * bend + jitter(i), y: y0 + (y1 - y0) * t };
  });
}

export function circle(cx: number, cy: number, r: number, turns = 1, n = 80, start = Math.PI / 2): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = start + (i / n) * turns * Math.PI * 2;
    return { x: cx + Math.cos(a) * r + jitter(i, 0.8), y: cy + Math.sin(a) * r * 0.95 + jitter(i + 3, 0.8) };
  });
}

export function spiral(cx: number, cy: number, r: number, turns = 2.6, n = 160): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const rr = r * (1 - 0.8 * t);
    return { x: cx + Math.cos(a) * rr + jitter(i, 0.6), y: cy + Math.sin(a) * rr + jitter(i + 5, 0.6) };
  });
}

export function star(cx: number, cy: number, r: number, points = 6): Pt[] {
  const out: Pt[] = [];
  const corners = points * 2;
  for (let k = 0; k <= corners; k++) {
    const a = (k / corners) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.35;
    const p = { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
    const prev = out[out.length - 1];
    if (prev) for (let s = 1; s <= 6; s++) out.push({ x: prev.x + ((p.x - prev.x) * s) / 6, y: prev.y + ((p.y - prev.y) * s) / 6 });
    else out.push(p);
  }
  return out;
}

export function zigzag(x: number, y0: number, y1: number, swings = 6, amp = 16): Pt[] {
  const out: Pt[] = [];
  const n = swings * 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: x + Math.sin(t * swings * Math.PI) * amp, y: y0 + (y1 - y0) * t });
  }
  return out;
}

/** Small loops strung along a direction (dx, dy per loop). */
export function loopChain(x: number, y: number, loops: number, r: number, dx: number, dy: number): Pt[] {
  const out: Pt[] = [];
  const n = loops * 30;
  for (let i = 0; i <= n; i++) {
    const t = i / 30;
    const a = t * Math.PI * 2;
    out.push({ x: x + dx * t + Math.cos(a) * r, y: y + dy * t + Math.sin(a) * r });
  }
  return out;
}

/** Small loops wandering round a little circle (a clump). */
export function loopClump(cx: number, cy: number, loops: number, r: number, R: number): Pt[] {
  const out: Pt[] = [];
  const n = loops * 30;
  for (let i = 0; i <= n; i++) {
    const t = i / 30;
    const a = t * Math.PI * 2;
    const b = (t / loops) * Math.PI * 2;
    out.push({ x: cx + Math.cos(b) * R + Math.cos(a) * r, y: cy + Math.sin(b) * R + Math.sin(a) * r });
  }
  return out;
}

export const concat = (...parts: Pt[][]): Pt[] => parts.flat();
