/**
 * The stem follows your stroke. The drawn line is projected (by the app) onto
 * an upright plane through the planting point, facing the camera, which gives
 * points as (lateral, height) in metres. From the lowest point we walk the
 * stroke in whichever direction climbs highest, keeping only rising points,
 * so a straight line becomes a straight stem, a curved line a curved one,
 * and a loop's rising side becomes a gracefully bowed stem with the bloom at
 * the top. The result is normalised to unit height and stored with the
 * flower, so it can be regrown (or watered taller) exactly.
 */

export type P2 = readonly [number, number];

export const PROFILE_POINTS = 12;
/** Bends are kept graceful: no more sideways reach than this fraction of the height. */
export const MAX_LEAN = 0.45;

export interface StemProfile {
  /** (lateral, up) pairs from (0, 0) to (x, 1). */
  readonly points: readonly P2[];
  /** Height actually drawn (m), before the kind's clamp. */
  readonly drawnHeight: number;
  /** True when the stroke gave no usable climb (a dab or a flat line) and a gentle default was used. */
  readonly synthetic: boolean;
}

function climb(pts: readonly P2[], from: number, step: 1 | -1, eps: number): P2[] {
  const out: P2[] = [pts[from]];
  let top = pts[from][1];
  for (let i = from + step; i >= 0 && i < pts.length; i += step) {
    if (pts[i][1] > top + eps) {
      out.push(pts[i]);
      top = pts[i][1];
    }
  }
  return out;
}

function arcResample(pts: readonly P2[], n: number): P2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const out: P2[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * total;
    while (k < cum.length - 2 && cum[k + 1] < d) k++;
    const span = cum[k + 1] - cum[k] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[k]) / span));
    const a = pts[k], b = pts[Math.min(pts.length - 1, k + 1)];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** A soft S-curve for strokes that never climb (dabs, loops drawn flat). */
export function defaultProfile(lean = 0.08): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < PROFILE_POINTS; i++) {
    const t = i / (PROFILE_POINTS - 1);
    out.push([lean * Math.sin(t * Math.PI * 0.9) * t, t]);
  }
  return out;
}

export function profileFromPlanePoints(pts: readonly P2[], minClimb = 0.12): StemProfile {
  if (pts.length < 2) return { points: defaultProfile(), drawnHeight: 0, synthetic: true };
  let base = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[base][1]) base = i;
  let span = 0;
  for (const p of pts) span = Math.max(span, p[1] - pts[base][1]);
  const eps = Math.max(1e-4, span * 0.004);
  const fwd = climb(pts, base, 1, eps);
  const back = climb(pts, base, -1, eps);
  const rise = (c: P2[]) => c[c.length - 1][1] - c[0][1];
  const path = rise(fwd) >= rise(back) ? fwd : back;
  const height = rise(path);
  if (height < minClimb || path.length < 2) return { points: defaultProfile(), drawnHeight: Math.max(height, span), synthetic: true };

  const [bx, by] = path[0];
  const rel: P2[] = path.map(([x, y]) => [x - bx, y - by]);
  const sampled = arcResample(rel, PROFILE_POINTS);
  // light smoothing of the sideways wobble; ends stay put
  const smoothX = sampled.map((p, i) => {
    if (i === 0 || i === sampled.length - 1) return p[0];
    return (sampled[i - 1][0] + 2 * p[0] + sampled[i + 1][0]) / 4;
  });
  const points: P2[] = sampled.map((p, i) => {
    const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, smoothX[i] / height));
    return [round3(lean), round3(p[1] / height)];
  });
  points[0] = [0, 0];
  points[points.length - 1] = [points[points.length - 1][0], 1];
  return { points, drawnHeight: height, synthetic: false };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Validate and repair a stored profile (untrusted input). */
export function sanitizeProfile(raw: unknown): P2[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 32) return defaultProfile();
  const out: P2[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2) return defaultProfile();
    const [x, y] = p;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return defaultProfile();
    out.push([Math.max(-MAX_LEAN, Math.min(MAX_LEAN, x)), Math.max(0, Math.min(1, y))]);
  }
  // heights must rise
  for (let i = 1; i < out.length; i++) if (out[i][1] < out[i - 1][1]) return defaultProfile();
  out[0] = [0, 0];
  out[out.length - 1] = [out[out.length - 1][0], 1];
  return out;
}

/**
 * Sample the stem at n points along its length (by arc length), in the
 * flower's plane: returns (lateral, up) in metres. Spike kinds straighten the
 * flowering top so florets line up along it.
 */
export function sampleStem(profile: readonly P2[], height: number, n: number, spike = 0): P2[] {
  const scaled: P2[] = profile.map(([x, y]) => [x * height, y * height]);
  const pts = arcResample(scaled, n);
  if (spike <= 0) return pts;
  const k0 = Math.max(1, Math.floor((1 - spike) * (n - 1)));
  const a = pts[k0 - 1], b = pts[k0];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // continue the tangent at the spike's foot, bending gently back toward upright
  let dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
  const out = pts.slice(0, k0 + 1);
  const seg = Math.hypot(pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1]) / (n - 1);
  for (let i = k0 + 1; i < n; i++) {
    dx *= 0.82;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy = Math.abs(dy / l);
    const p = out[i - 1];
    out.push([p[0] + dx * seg, p[1] + dy * seg]);
  }
  return out;
}
