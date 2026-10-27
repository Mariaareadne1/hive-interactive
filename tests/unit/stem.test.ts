import { describe, expect, test } from 'vitest';
import { MAX_LEAN, PROFILE_POINTS, defaultProfile, profileFromPlanePoints, sampleStem, sanitizeProfile, type P2 } from '../../src/flowers/stem';

/** Distance from p to the polyline. */
function distToPath(p: P2, path: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t)));
  }
  return best;
}

describe('the stem follows the stroke', () => {
  test('a gently curved stroke becomes a stem of the same shape', () => {
    // drawn top to bottom, as people often do
    const drawn: P2[] = Array.from({ length: 50 }, (_, i) => {
      const t = 1 - i / 49;
      return [0.18 * Math.sin(t * Math.PI), t * 1.6];
    });
    const p = profileFromPlanePoints(drawn);
    expect(p.synthetic).toBe(false);
    expect(p.drawnHeight).toBeCloseTo(1.6, 2);
    expect(p.points).toHaveLength(PROFILE_POINTS);
    // scaled back to metres, every stem point lies on the drawn line (within 2 cm)
    const stem = sampleStem(p.points, p.drawnHeight, 24);
    for (const q of stem) expect(distToPath(q, drawn)).toBeLessThan(0.02);
  });

  test('the stem starts at the planting point and ends at the top', () => {
    const drawn: P2[] = Array.from({ length: 30 }, (_, i) => [0.05 * i / 29, 0.2 + i * 0.04]);
    const p = profileFromPlanePoints(drawn);
    expect(p.points[0]).toEqual([0, 0]);
    expect(p.points.at(-1)![1]).toBe(1);
  });

  test('a loop gives a bowed stem up one side, not a tangle', () => {
    const loop: P2[] = Array.from({ length: 80 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 79) * Math.PI * 2;
      return [Math.cos(a) * 0.4, 0.4 + Math.sin(a) * 0.4];
    });
    const p = profileFromPlanePoints(loop);
    for (let i = 1; i < p.points.length; i++) expect(p.points[i][1]).toBeGreaterThanOrEqual(p.points[i - 1][1]);
    for (const [x] of p.points) expect(Math.abs(x)).toBeLessThanOrEqual(MAX_LEAN);
  });

  test('a flat dab falls back to a gentle default stem', () => {
    const dab: P2[] = [[0, 0], [0.05, 0.01], [0.1, 0]];
    expect(profileFromPlanePoints(dab).synthetic).toBe(true);
  });

  test('stored profiles are validated', () => {
    expect(sanitizeProfile('nope')).toEqual(defaultProfile());
    expect(sanitizeProfile([[0, 0], [NaN, 1]])).toEqual(defaultProfile());
    expect(sanitizeProfile([[0, 0], [0, 0.6], [0, 0.4], [0, 1]])).toEqual(defaultProfile());
    expect(sanitizeProfile([[0.1, 0.1], [9, 1]])).toEqual([[0, 0], [MAX_LEAN, 1]]);
  });

  test('spike kinds straighten the flowering top', () => {
    const bent: P2[] = Array.from({ length: 12 }, (_, i) => [0.3 * (i / 11) ** 2, i / 11]);
    const s = sampleStem(bent, 1.2, 24, 0.4);
    const a = s[20], b = s[23];
    const lean = Math.abs(b[0] - a[0]) / (b[1] - a[1]);
    expect(lean).toBeLessThan(0.5);
  });
});
