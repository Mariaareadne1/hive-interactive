import { seededRandom } from '../scene/noise';
import { BloomBuilder, PART, type BloomArrays, type Placement } from './petal';
import type { FlowerKind } from './kinds';

/**
 * Blooms, one builder per kind. Everything is in the bloom's own frame: the
 * stem tip at the origin, the flower's face looking up +y. Spike kinds
 * (lavender, foxglove) hang their florets down the stem, placed as fractions
 * of the spike so one geometry fits any stem height.
 */

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TAU = Math.PI * 2;

function sepals(b: BloomBuilder, n: number, length: number, width: number, r0: number, open = -0.5): void {
  for (let i = 0; i < n; i++) {
    b.petalSurface(
      { length, width, tip: 'point', cup: 0.3, curl: -0.4, nu: 5, nv: 3 },
      { azimuth: (i / n) * TAU + 0.3, order: 0, openTilt: open, closedTilt: 1.2, r0: r0 * 0.9, y0: -0.035, part: PART.sepal },
    );
  }
}

function sunflower(rand: () => number): BloomBuilder {
  const b = new BloomBuilder();
  const disc = 0.24;
  b.dome(disc, 0.075, { azimuth: 0, order: 0, openTilt: 0, closedTilt: 0, r0: 0, y0: 0.015, part: PART.centre }, 10, 36);
  for (let ring = 0; ring < 2; ring++) {
    const n = 21;
    for (let i = 0; i < n; i++) {
      const az = (i / n) * TAU + ring * (Math.PI / n);
      b.petalSurface(
        { length: 0.34 + rand() * 0.06 - ring * 0.03, width: 0.062, widest: 0.45, tip: 'point', cup: 0.35, curl: 0.25 - ring * 0.25, ruffle: 0.08, seed: rand() * 9, nu: 9, nv: 4 },
        { azimuth: az, order: ring * 0.25 + rand() * 0.55, openTilt: 0.12 - ring * 0.12 + (rand() - 0.5) * 0.12, closedTilt: 1.45, r0: disc * 0.9, y0: 0.012 + ring * 0.004, part: PART.petal },
      );
    }
  }
  sepals(b, 14, 0.15, 0.045, disc * 0.85, -0.35);
  return b;
}

function daisy(rand: () => number): BloomBuilder {
  const b = new BloomBuilder();
  const eye = 0.075;
  b.dome(eye, 0.05, { azimuth: 0, order: 0, openTilt: 0, closedTilt: 0, r0: 0, y0: 0.01, part: PART.centre }, 7, 24);
  const n = 21;
  for (let i = 0; i < n; i++) {
    b.petalSurface(
      { length: 0.25 + rand() * 0.04, width: 0.026, widest: 0.6, tip: 'round', cup: 0.25, curl: 0.12, ruffle: 0.04, seed: rand() * 9, nu: 8, nv: 3 },
      { azimuth: (i / n) * TAU + rand() * 0.08, order: rand(), openTilt: 0.1 + (rand() - 0.5) * 0.14, closedTilt: 1.5, r0: eye * 0.85, y0: 0.012, part: PART.petal },
    );
  }
  sepals(b, 10, 0.07, 0.02, eye * 0.8, -0.3);
  return b;
}

function poppy(rand: () => number): BloomBuilder {
  const b = new BloomBuilder();
  // four papery petals: an outer pair and an inner pair across them
  for (let i = 0; i < 4; i++) {
    const inner = i >= 2;
    b.petalSurface(
      { length: 0.3, width: 0.21, widest: 0.66, tip: 'round', cup: 0.75, curl: 0.35, ruffle: 0.12, seed: rand() * 9, nu: 11, nv: 8 },
      { azimuth: (i % 2) * Math.PI + (inner ? Math.PI / 2 : 0) + (rand() - 0.5) * 0.15, order: inner ? 0.45 + rand() * 0.2 : rand() * 0.2, openTilt: inner ? 0.78 : 0.5, closedTilt: 1.5, r0: 0.02, y0: inner ? 0.012 : 0, part: PART.petal },
    );
  }
  // a crown of dark stamens round a grey-green seed pod
  const n = 34;
  for (let i = 0; i < n; i++) {
    b.petalSurface(
      { length: 0.055, width: 0.005, tip: 'point', nu: 2, nv: 1 },
      { azimuth: i * GOLDEN, order: 0.6, openTilt: 0.9 + rand() * 0.3, closedTilt: 1.5, r0: 0.03, y0: 0.01, part: PART.stamen },
    );
  }
  b.dome(0.042, 0.075, { azimuth: 0, order: 0, openTilt: 0, closedTilt: 0, r0: 0, y0: 0.01, part: PART.centre }, 6, 20);
  return b;
}

function rose(rand: () => number): BloomBuilder {
  const b = new BloomBuilder();
  const rings = [3, 4, 5, 5, 6];
  let az = rand() * TAU;
  rings.forEach((n, k) => {
    const t = k / (rings.length - 1);
    for (let i = 0; i < n; i++) {
      az += TAU / n + 0.4;
      b.petalSurface(
        { length: 0.11 + t * 0.12, width: 0.085 + t * 0.075, widest: 0.62, tip: 'round', cup: 0.85 - t * 0.35, curl: 0.2 - t * 0.85, ruffle: 0.05 + t * 0.06, seed: rand() * 9, nu: 10, nv: 7 },
        { azimuth: az, order: 1 - t * 0.85 + rand() * 0.1, openTilt: 1.3 - t * 1.0, closedTilt: 1.48 - t * 0.08, r0: 0.008 + t * 0.03, y0: 0.06 - t * 0.045, part: PART.petal },
      );
    }
  });
  b.dome(0.03, 0.04, { azimuth: 0, order: 0, openTilt: 0, closedTilt: 0, r0: 0, y0: 0.04, part: PART.centre }, 4, 12);
  sepals(b, 5, 0.1, 0.022, 0.02, -0.7);
  return b;
}

/** Florets climbing the top of the stem, opening from the bottom up. */
function lavender(rand: () => number): BloomBuilder {
  const b = new BloomBuilder();
  const whorls = 16;
  for (let w = 0; w < whorls; w++) {
    const f = w / (whorls - 1); // 0 top .. 1 bottom
    const n = w < 2 ? 3 : 6;
    const size = 0.6 + 0.4 * Math.min(1, f * 3);
    for (let i = 0; i < n; i++) {
      const at: Placement = {
        azimuth: (i / n) * TAU + w * 0.9 + rand() * 0.3,
        order: 1 - f * 0.9 + rand() * 0.1,
        openTilt: 0.55 + rand() * 0.3,
        closedTilt: 1.3,
        r0: 0.012,
        y0: f * 0.92 + 0.03,
        part: PART.floret,
        spike: 1,
      };
      b.petalSurface({ length: 0.042 * size, width: 0.019 * size, widest: 0.6, tip: 'round', cup: 1.4, curl: 0.6, nu: 4, nv: 3 }, at);
    }
  }
  return b;
}

/** Bells hanging from one side of the spike, biggest at the bottom, buds at the top. */
function foxglove(rand: () => number): BloomBuilder {
  const b = new BloomBuilder();
  const bells = 15;
  for (let k = 0; k < bells; k++) {
    const f = k / (bells - 1); // 0 top .. 1 bottom
    const size = 0.45 + 0.55 * f;
    const at: Placement = {
      // mostly toward the viewer's side, as foxgloves turn to the light
      azimuth: -Math.PI / 2 + (k % 2 ? 0.75 : -0.75) * (0.5 + rand() * 0.5) + (rand() - 0.5) * 0.4,
      order: 1 - f,
      openTilt: -0.45 - rand() * 0.25,
      closedTilt: 1.2,
      r0: 0.02,
      y0: f * 0.9 + 0.05,
      part: PART.bell,
      spike: 1,
    };
    b.bell(0.15 * size, 0.02 * size, 0.045 * size, at);
  }
  return b;
}

/** A ball of starry florets on a tall bare stem. */
function allium(rand: () => number): BloomBuilder {
  const b = new BloomBuilder();
  const cy = 0.2;
  b.ball(0.085, { azimuth: 0, order: 0, openTilt: 0, closedTilt: 0, r0: 0, y0: 0, part: PART.centre }, cy);
  const n = 150;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 1.8; // skip the very bottom, where the stem joins
    const elev = Math.asin(Math.max(-1, Math.min(1, y)));
    const L = 0.12 + rand() * 0.035;
    b.petalSurface(
      { length: L, width: 0.016, tip: 'point', cup: 0.6, curl: 0.15, nu: 4, nv: 2 },
      { azimuth: i * GOLDEN, order: rand(), openTilt: elev, closedTilt: elev, r0: 0.03 * Math.cos(elev), y0: cy + 0.03 * Math.sin(elev), part: PART.floret },
    );
  }
  return b;
}

const BUILDERS: Record<FlowerKind, (rand: () => number) => BloomBuilder> = {
  sunflower, daisy, poppy, rose, lavender, foxglove, allium,
};

export const HEAD_VARIANTS = 2;

export function buildHead(kind: FlowerKind, variant: number): BloomArrays {
  return BUILDERS[kind](seededRandom(variant * 7919 + kind.length * 31 + 7)).arrays();
}
