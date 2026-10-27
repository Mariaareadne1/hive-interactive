import { describe, expect, test } from 'vitest';
import { GROW_DURATION, growthAt, leafUnfurl } from '../../src/flowers/growth';

describe('the planting reveal', () => {
  test('stem first, then bud, then bloom, in ~1.6 s', () => {
    const early = growthAt(0.3);
    expect(early.grow).toBeGreaterThan(0.3);
    expect(early.bloom).toBe(0);
    const mid = growthAt(0.8);
    expect(mid.grow).toBe(1);
    expect(mid.bud).toBeGreaterThan(0.8);
    expect(mid.bloom).toBeGreaterThan(0);
    expect(growthAt(GROW_DURATION).done).toBe(true);
    expect(growthAt(GROW_DURATION - 0.01).done).toBe(false);
  });

  test('shadows never arrive before what casts them', () => {
    for (let t = 0; t <= GROW_DURATION; t += 0.02) {
      const f = growthAt(t);
      if (f.stemShadow) expect(f.grow).toBeGreaterThan(0.5);
      if (f.headShadow) expect(f.bloom).toBeGreaterThan(0.3);
    }
  });

  test('everything is monotonic', () => {
    let prev = growthAt(0);
    for (let t = 0.01; t <= 2; t += 0.01) {
      const f = growthAt(t);
      expect(f.grow).toBeGreaterThanOrEqual(prev.grow);
      expect(f.bud).toBeGreaterThanOrEqual(prev.bud);
      expect(f.bloom).toBeGreaterThanOrEqual(prev.bloom);
      prev = f;
    }
  });

  test('reduced motion halves it', () => {
    expect(growthAt(GROW_DURATION / 2, GROW_DURATION / 2).done).toBe(true);
  });

  test('leaves unfurl after the stem passes them', () => {
    expect(leafUnfurl(0.5, 0.4)).toBe(0);
    expect(leafUnfurl(0.5, 1)).toBe(1);
  });
});
