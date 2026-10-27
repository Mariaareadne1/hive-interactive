import { describe, expect, test } from 'vitest';
import { BEDS, HIVE_HOME, OBSTACLES, STONES, TILE, isPlantable, nearestPlantable, pathX, surfaceAt, surfaceMessage, terrainHeight, clampHive } from '../../src/scene/garden';

describe('where flowers can grow', () => {
  test('beds and lawn are plantable', () => {
    for (const b of BEDS) expect(surfaceAt(b.x, b.z)).toBe('bed');
    expect(isPlantable(surfaceAt(7.5, -1.5))).toBe(true);
  });

  test('path, stones, hive, hedge, props and the edge are not', () => {
    expect(surfaceAt(pathX(2), 2)).toBe('path');
    expect(surfaceAt(STONES[0].x, STONES[0].z)).toBe('stone');
    expect(surfaceAt(HIVE_HOME.x, HIVE_HOME.z)).toBe('hive');
    expect(surfaceAt(4, -6.55)).toBe('hedge');
    expect(surfaceAt(OBSTACLES[0].x, OBSTACLES[0].z)).toBe('prop');
    expect(surfaceAt(TILE.halfX - 0.2, 0)).toBe('edge');
    expect(surfaceAt(TILE.halfX + 1, 0)).toBe('off');
    for (const s of ['path', 'stone', 'hive', 'hedge', 'prop', 'edge', 'off'] as const) {
      expect(isPlantable(s)).toBe(false);
      expect(surfaceMessage(s).length).toBeGreaterThan(5);
    }
  });

  test('the nearest plantable spot is close and valid', () => {
    const [x, z] = nearestPlantable(pathX(1), 1);
    expect(isPlantable(surfaceAt(x, z))).toBe(true);
    expect(Math.hypot(x - pathX(1), z - 1)).toBeLessThan(1.2);
  });

  test('beds are mounded, the garden is nearly level', () => {
    const bed = BEDS[1];
    expect(terrainHeight(bed.x, bed.z)).toBeGreaterThan(terrainHeight(7.5, -1.5));
    for (let x = -9; x <= 9; x += 1.5) for (let z = -7; z <= 7; z += 1.5) expect(Math.abs(terrainHeight(x, z))).toBeLessThan(0.3);
  });

  test('the hive stays inside the garden', () => {
    const [x, z] = clampHive(50, -50);
    expect(Math.abs(x)).toBeLessThan(TILE.halfX);
    expect(Math.abs(z)).toBeLessThan(TILE.halfZ);
  });
});
