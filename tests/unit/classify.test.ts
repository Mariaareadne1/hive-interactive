import { describe, expect, test } from 'vitest';
import { classifyStroke } from '../../src/interaction/classify';
import { circle, concat, line, loopChain, loopClump, spiral, star, zigzag } from './fixtures';

describe('stroke → flower', () => {
  test('a tall straight line is a sunflower', () => {
    expect(classifyStroke(line(400, 600, 300)).kind).toBe('sunflower');
  });

  test('a gently curved tall line is a sunflower', () => {
    expect(classifyStroke(line(400, 600, 320, 25)).kind).toBe('sunflower');
  });

  test('a tall line ending in a loop is a sunflower', () => {
    const stroke = concat(line(400, 620, 380), circle(400, 350, 30, 1, 60, Math.PI / 2));
    expect(classifyStroke(stroke).kind).toBe('sunflower');
  });

  test('a tall wobbly zig-zag is a foxglove', () => {
    expect(classifyStroke(zigzag(400, 620, 330, 7, 18)).kind).toBe('foxglove');
  });

  test('a spiral is a rose', () => {
    expect(classifyStroke(spiral(400, 400, 70, 2.6)).kind).toBe('rose');
  });

  test('a star is a daisy', () => {
    expect(classifyStroke(star(400, 400, 70, 6)).kind).toBe('daisy');
  });

  test('small loops climbing upward are lavender', () => {
    expect(classifyStroke(loopChain(400, 600, 6, 16, 1, -40)).kind).toBe('lavender');
  });

  test('a clump of small loops is an allium', () => {
    expect(classifyStroke(loopClump(400, 400, 6, 16, 26)).kind).toBe('allium');
  });

  test('one round loop is a poppy', () => {
    expect(classifyStroke(circle(400, 400, 50)).kind).toBe('poppy');
  });

  test('every classification has a valid kind and scores in 0..1', () => {
    for (const s of [line(1, 1, 2), circle(0, 0, 5, 0.3), star(0, 0, 10, 2), spiral(0, 0, 3, 5)]) {
      const c = classifyStroke(s);
      expect(c.kind).toBeTruthy();
      for (const v of Object.values(c.scores)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  test('an in-between drawing offers a runner-up', () => {
    // an upright oval: part poppy, part sunflower
    const oval = circle(400, 400, 40, 1, 80).map((p) => ({ x: p.x, y: 400 + (p.y - 400) * 1.9 }));
    const c = classifyStroke(oval);
    expect(c.ambiguous).toBe(true);
    expect(c.alternative).not.toBeNull();
    expect(c.alternative).not.toBe(c.kind);
  });
});
