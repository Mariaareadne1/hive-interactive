import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { BEE_STATES, Colony, MAX_BEES, STEP, desiredBees, type BeeState, type FlowerSite, type World } from '../../src/bees/colony';
import { clearance, type Obstacles } from '../../src/bees/flight';

/** A little static garden: flowers on stems, a hive with its doorway facing +z. */
function makeWorld(n: number, blooming = true): World {
  const flowers: FlowerSite[] = [];
  const obstacles: Obstacles = { capsules: [], spheres: [], cylinders: [] };
  for (let i = 0; i < n; i++) {
    const x = -3 + (i % 5) * 1.6, z = -2 + Math.floor(i / 5) * 1.8;
    const h = 1 + (i % 3) * 0.3;
    const id = `f${i}`;
    flowers.push({ id, blooming, landing: new THREE.Vector3(x, h + 0.12, z), up: new THREE.Vector3(0, 1, 0), leaf: new THREE.Vector3(x + 0.2, h * 0.4, z) });
    obstacles.capsules.push({ a: new THREE.Vector3(x, 0, z), b: new THREE.Vector3(x, h - 0.1, z), r: 0.06, owner: id });
    obstacles.spheres.push({ c: new THREE.Vector3(x, h, z), r: 0.12, owner: id });
  }
  obstacles.cylinders.push({ x: -6, z: -4, r: 1, y0: -1, y1: 1.7, owner: 'hive' });
  return {
    flowers,
    obstacles,
    hive: { entrance: new THREE.Vector3(-6, 0.2, -3.1), board: new THREE.Vector3(-6, 0.15, -2.9), out: new THREE.Vector3(0, 0, 1) },
  };
}

function run(colony: Colony, world: World, seconds: number, each?: (c: Colony, t: number) => void): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    colony.step(STEP, world);
    each?.(colony, i * STEP);
  }
}

const FLYING: BeeState[] = ['wander', 'approach', 'home', 'swarm', 'herd'];

describe('the colony', () => {
  test('population follows the blooms, capped at 14', () => {
    expect(desiredBees(0)).toBe(0);
    expect(desiredBees(3)).toBe(2);
    expect(desiredBees(100)).toBe(MAX_BEES);
  });

  test('is deterministic for a seed and a fixed step', () => {
    const w = makeWorld(6);
    const a = new Colony(42), b = new Colony(42);
    run(a, w, 20);
    run(b, w, 20);
    expect(a.bees.map((x) => [x.state, x.pos.x.toFixed(6), x.pos.y.toFixed(6), x.pos.z.toFixed(6)]))
      .toEqual(b.bees.map((x) => [x.state, x.pos.x.toFixed(6), x.pos.y.toFixed(6), x.pos.z.toFixed(6)]));
    const c = new Colony(43);
    run(c, w, 20);
    expect(c.bees.map((x) => x.pos.x.toFixed(4))).not.toEqual(a.bees.map((x) => x.pos.x.toFixed(4)));
  });

  test('bees leave the hive and land on a flower, exactly on its landing point', () => {
    const w = makeWorld(4);
    const colony = new Colony(1);
    let landed = -1;
    run(colony, w, 40, (c, t) => {
      const b = c.bees.find((x) => x.state === 'forage');
      if (b && landed < 0) {
        landed = t;
        const site = w.flowers.find((f) => f.id === b.flower)!;
        expect(b.pos.distanceTo(site.landing)).toBeLessThan(1e-6);
      }
    });
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThan(25);
  });

  test('never flies through stems, blooms or the hive', () => {
    const w = makeWorld(10);
    const colony = new Colony(9);
    let checks = 0;
    run(colony, w, 90, (c) => {
      for (const b of c.bees) {
        if (!FLYING.includes(b.state)) continue;
        const ignore = b.state === 'approach' ? b.flower : b.state === 'home' ? 'hive' : null;
        expect(clearance(b.pos, w.obstacles, ignore)).toBeGreaterThan(-1e-3);
        checks++;
      }
    });
    expect(checks).toBeGreaterThan(1000);
  });

  test('every state is reachable and every bee moves on', () => {
    const w = makeWorld(8);
    const colony = new Colony(5);
    const seen = new Set<BeeState>();
    const stuck = new Map<number, { state: BeeState; since: number }>();
    const watch = (c: Colony, t: number) => {
      for (const b of c.bees) {
        seen.add(b.state);
        const s = stuck.get(b.id);
        if (!s || s.state !== b.state) stuck.set(b.id, { state: b.state, since: t });
        else if (!['inside', 'herd'].includes(b.state)) expect(t - s.since).toBeLessThan(26);
      }
    };
    run(colony, w, 30, watch);
    const bee = colony.bees.find((b) => b.state !== 'inside')!;
    colony.rest(bee.id, w);
    run(colony, w, 8, watch);
    colony.herd(bee.id, new THREE.Vector3(2, 1, 2), w);
    run(colony, w, 2, watch);
    colony.herd(bee.id, null, w);
    colony.sendHome(bee.id, w, true);
    run(colony, w, 12, watch);
    colony.swarm(3);
    run(colony, w, 6, watch);
    colony.sheltering = true;
    run(colony, w, 20, watch);
    expect(colony.bees.filter((b) => b.state !== 'inside').map((b) => b.state)).toEqual([]);
    colony.sheltering = false;
    // an empty garden: a bee peeks out now and then
    const bare = makeWorld(0);
    run(colony, bare, 30, watch);
    for (const s of BEE_STATES) expect(seen.has(s), `state ${s}`).toBe(true);
  });

  test('nectar drains and refills; honey rises with deliveries', () => {
    const w = makeWorld(3);
    const colony = new Colony(3);
    let delivered = 0;
    colony.onDeliver = (g) => (delivered += g);
    let minNectar = 1;
    run(colony, w, 120, (c) => {
      for (const v of c.nectar.values()) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        minNectar = Math.min(minNectar, v);
      }
      for (const b of c.bees) expect(b.pollen).toBeLessThanOrEqual(1);
    });
    expect(minNectar).toBeLessThan(0.95);
    expect(colony.honey).toBeGreaterThan(0);
    expect(colony.honey).toBeCloseTo(Math.min(1.5, delivered), 6);
    colony.refill('f0');
    expect(colony.nectar.get('f0')).toBe(1);
  });

  test('sleep sends everyone home; waking brings them back', () => {
    const w = makeWorld(6);
    const colony = new Colony(11);
    run(colony, w, 15);
    colony.setAwake(false);
    run(colony, w, 25);
    expect(colony.bees.every((b) => b.state === 'inside')).toBe(true);
    colony.setAwake(true);
    run(colony, w, 10);
    expect(colony.bees.some((b) => b.state !== 'inside')).toBe(true);
  });

  test('calling a bee sends the nearest free one to that flower', () => {
    const w = makeWorld(6);
    const colony = new Colony(2);
    run(colony, w, 12);
    const bee = colony.callTo('f3', w)!;
    expect(bee).toBeTruthy();
    run(colony, w, 15, (c) => {
      const b = c.get(bee.id);
      if (b?.state === 'forage') expect(b.flower).toBe('f3');
    });
  });

  test('survives fuzzed requests without NaNs or runaway bees', () => {
    const w = makeWorld(12);
    const colony = new Colony(77);
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000; i++) {
      colony.step(STEP, w);
      if (r() < 0.02 && colony.bees.length) {
        const b = colony.bees[Math.floor(r() * colony.bees.length)];
        const k = r();
        if (k < 0.2) colony.visit(b.id, `f${Math.floor(r() * 12)}`, w);
        else if (k < 0.4) colony.rest(b.id, w);
        else if (k < 0.55) colony.sendHome(b.id, w, r() < 0.5);
        else if (k < 0.7) colony.herd(b.id, r() < 0.5 ? new THREE.Vector3(r() * 8 - 4, 1, r() * 6 - 3) : null, w);
        else if (k < 0.8) colony.swarm(2);
        else if (k < 0.9) colony.calm(3);
        else colony.setAwake(r() < 0.7);
      }
      for (const b of colony.bees) {
        expect(Number.isFinite(b.pos.x + b.pos.y + b.pos.z)).toBe(true);
        expect(Math.abs(b.pos.x)).toBeLessThan(12);
        expect(b.pos.y).toBeGreaterThan(-0.5);
        expect(b.pos.y).toBeLessThan(5);
      }
      expect(colony.bees.length).toBeLessThanOrEqual(MAX_BEES);
    }
  });
});
