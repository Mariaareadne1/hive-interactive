/**
 * The planting reveal as pure functions of time, so it can be tested and
 * scrubbed: the stem grows up along the stroke, a bud swells at its tip, the
 * petals break open one by one, a puff of pollen catches the light. ~1.6 s.
 */

export const GROW_DURATION = 1.6;

export interface GrowthFrame {
  /** Fraction of the stem grown (0..1). */
  grow: number;
  /** Bud swell (0..1). */
  bud: number;
  /** Bloom timeline (0..1), fed to the petal shader. */
  bloom: number;
  /** The pollen puff fires once, when this first passes 1. */
  pollen: number;
  stemShadow: boolean;
  headShadow: boolean;
  done: boolean;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export function growthAt(t: number, duration = GROW_DURATION): GrowthFrame {
  const k = t / duration;
  const grow = easeOut(span(k, 0, 0.42));
  const bud = easeOut(span(k, 0.28, 0.55));
  const bloom = span(k, 0.42, 1);
  return {
    grow,
    bud,
    bloom,
    pollen: span(k, 0, 0.8),
    stemShadow: grow > 0.5,
    headShadow: bloom > 0.3,
    done: k >= 1,
  };
}

/** A fully grown flower (loaded scenes, undo). */
export const GROWN: GrowthFrame = growthAt(1, 1);

/** How far a leaf at stem fraction s has unfurled when the stem has grown to g. */
export function leafUnfurl(s: number, g: number): number {
  return easeOut(clamp01((g - s) / 0.25));
}
