import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { meshSDF, sdCapsule, sdEllipsoid, smin } from './sdf';
import { woolField } from './wool';
import { HEDGE, OBSTACLES, STONES, hedgeZ, terrainHeight } from './garden';
import { noise3 } from './noise';
import { paintMaterial, tint, withAO } from './paint';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from './world';

/**
 * The garden's still life: a low clipped hedge along the back, stepping
 * stones across the lawn, a watering can by the path, a terracotta water
 * dish, two leafy clumps — one with a ladybird on it — and a snail resting
 * on a stone. All painted with the shared gouache material.
 */

const caster = (m: THREE.Mesh) => {
  m.layers.enable(SHADOW_LAYER);
  return m;
};

/** Plain three.js geometry, made mergeable: no uvs, with colour and AO. */
function part(geo: THREE.BufferGeometry, hex: string, m?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (m) g.applyMatrix4(m);
  return tint(g, hex);
}

const M = () => new THREE.Matrix4();

// --- hedge --------------------------------------------------------------------

function hedgeSegment(seed: number, length: number): THREE.BufferGeometry {
  const hx = length / 2, hz = HEDGE.halfDepth, hy = HEDGE.height / 2;
  // a clipped hedge: a soft rounded box, fluffed into leafy clumps
  const base = (x: number, y: number, z: number) => {
    const qx = Math.abs(x) - hx + 0.25, qy = Math.abs(y - hy) - hy + 0.25, qz = Math.abs(z) - hz + 0.25;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.25;
  };
  const min: [number, number, number] = [-hx - 0.25, -0.15, -hz - 0.25];
  const max: [number, number, number] = [hx + 0.25, HEDGE.height + 0.25, hz + 0.25];
  return meshSDF(
    woolField(base, {
      seed,
      min,
      max,
      inset: 0.05,
      layers: [{ count: Math.round(length * 22), rMin: 0.09, rMax: 0.15 }, { count: Math.round(length * 40), rMin: 0.05, rMax: 0.08 }],
      blend: 0.06,
      curl: 0.006,
    }),
    { min, max, cell: 0.045, ao: true },
  );
}

function createHedge(world: WorldUniforms): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hedge';
  const segments = 4;
  const len = (HEDGE.x1 - HEDGE.x0) / segments;
  const geos = [hedgeSegment(3, len + 0.3), hedgeSegment(8, len + 0.3)];
  const mat = paintMaterial(world, { color: '#5e9a44', ragged: true, softness: 0.3, shadeTint: '#8c9fd0' });
  for (let i = 0; i < segments; i++) {
    const x = HEDGE.x0 + len * (i + 0.5);
    const z = hedgeZ(x);
    const mesh = caster(new THREE.Mesh(geos[i % 2], mat));
    mesh.position.set(x, terrainHeight(x, z) - 0.06, z);
    mesh.rotation.y = -Math.atan(0.048 * Math.cos(x * 0.4));
    group.add(mesh);
  }
  return group;
}

// --- stones -------------------------------------------------------------------

function stoneGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.08 * noise3(x * 2 + seed, y * 2, z * 2);
    p.setXYZ(i, x * k, y * 0.16 * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function createStones(world: WorldUniforms): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stones';
  const mat = paintMaterial(world, { color: '#beb6a8', softness: 0.2 });
  STONES.forEach((s, i) => {
    const mesh = caster(new THREE.Mesh(withAO(stoneGeometry(i * 3.1)), mat));
    mesh.position.set(s.x, terrainHeight(s.x, s.z) - 0.01, s.z);
    mesh.scale.set(s.rx, 1, s.rz);
    mesh.rotation.y = -s.rot;
    group.add(mesh);
  });
  return group;
}

// --- watering can -------------------------------------------------------------

/** A painted watering can (sage enamel), spout along +x, origin at its base. Shared with the Water action. */
export function wateringCanGeometry(): THREE.BufferGeometry {
  const enamel = '#8db8ad';
  const dark = '#6f9a90';
  const body = part(new THREE.CylinderGeometry(0.2, 0.22, 0.34, 20), enamel, M().makeTranslation(0, 0.17, 0));
  const rim = part(new THREE.TorusGeometry(0.2, 0.018, 6, 20), dark, M().makeRotationX(Math.PI / 2).setPosition(0, 0.34, 0));
  const lid = part(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), dark, M().makeTranslation(0, 0.33, 0));
  const spoutM = M().makeRotationZ(-0.9).setPosition(0.3, 0.26, 0);
  const spout = part(new THREE.CylinderGeometry(0.025, 0.045, 0.42, 8), enamel, spoutM);
  const rose = part(new THREE.CylinderGeometry(0.06, 0.03, 0.07, 10), dark, M().makeRotationZ(-0.9).setPosition(0.47, 0.39, 0));
  const handle = part(new THREE.TorusGeometry(0.17, 0.02, 6, 16, Math.PI), dark, M().makeRotationY(Math.PI / 2).setPosition(-0.02, 0.34, 0));
  const back = part(new THREE.TorusGeometry(0.11, 0.018, 6, 12, Math.PI), dark, M().makeRotationZ(Math.PI / 2).setPosition(-0.2, 0.2, 0));
  const g = mergeGeometries([body, rim, lid, spout, rose, handle, back]);
  g.computeBoundingSphere();
  return g;
}

// --- water dish ---------------------------------------------------------------

function createDish(world: WorldUniforms, x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.36, 0.06), new THREE.Vector2(0.38, 0.09), new THREE.Vector2(0.33, 0.09), new THREE.Vector2(0.3, 0.04), new THREE.Vector2(0, 0.04)];
  const saucer = caster(new THREE.Mesh(withAO(new THREE.LatheGeometry(profile, 24)), paintMaterial(world, { color: '#d08a62', softness: 0.2 })));
  const water = new THREE.Mesh(withAO(new THREE.CircleGeometry(0.31, 24).rotateX(-Math.PI / 2)), paintMaterial(world, { color: '#9cc9e3', gloss: 2.4 }));
  water.position.y = 0.075;
  water.name = 'water';
  group.add(saucer, water);
  group.position.set(x, terrainHeight(x, z), z);
  return group;
}

// --- leafy clumps, ladybird, snail ----------------------------------------------

function clumpGeometry(seed: number, r: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, r * 0.2, 0, r, r * 0.6, r);
  const ext = r * 1.3;
  const min: [number, number, number] = [-ext, -0.1, -ext];
  const max: [number, number, number] = [ext, r * 1.05, ext];
  return meshSDF(
    woolField(base, { seed, min, max, inset: r * 0.1, layers: [{ count: 26, rMin: r * 0.25, rMax: r * 0.36 }, { count: 30, rMin: r * 0.13, rMax: r * 0.2 }], blend: r * 0.1, curl: 0.004 }),
    { min, max, cell: r / 16, ao: true },
  );
}

function ladybirdGeometry(): THREE.BufferGeometry {
  const shell = part(new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#d23a2c', M().makeScale(1, 0.8, 1.15));
  const head = part(new THREE.SphereGeometry(0.03, 8, 6), '#1c1816', M().makeTranslation(0, 0.012, 0.065));
  const spots = [[0.025, 0.035, 0.02], [-0.025, 0.035, 0.02], [0.03, 0.03, -0.03], [-0.03, 0.03, -0.03], [0, 0.05, -0.005]].map(([x, y, z]) =>
    part(new THREE.SphereGeometry(0.012, 6, 4), '#1c1816', M().makeTranslation(x, y, z)),
  );
  return mergeGeometries([shell, head, ...spots]);
}

function snailGeometry(): THREE.BufferGeometry {
  // the shell: a whorl of spheres winding inward, smoothly joined
  const shell = (x: number, y: number, z: number) => {
    let d = Infinity;
    for (let i = 0; i < 14; i++) {
      const a = i * 0.62;
      const rad = 0.075 * Math.exp(-i * 0.12);
      d = smin(d, Math.hypot(x - Math.cos(a) * rad * 0.9, y - (0.1 + Math.sin(a) * rad * 0.9), z) - rad * 0.75, 0.03);
    }
    return d;
  };
  const shellGeo = meshSDF(shell, { min: [-0.16, -0.02, -0.08], max: [0.16, 0.24, 0.08], cell: 0.008, ao: true });
  const sg = tint(shellGeo, '#c98c4e');
  const foot = (x: number, y: number, z: number) =>
    Math.min(sdCapsule(x, y, z, -0.12, 0.02, 0, 0.14, 0.03, 0, 0.03), sdCapsule(x, y, z, 0.13, 0.03, 0.015, 0.17, 0.09, 0.03, 0.006), sdCapsule(x, y, z, 0.13, 0.03, -0.015, 0.17, 0.09, -0.03, 0.006));
  const fg = tint(meshSDF(foot, { min: [-0.17, -0.02, -0.06], max: [0.2, 0.12, 0.06], cell: 0.006, ao: true }), '#cbbba6');
  return mergeGeometries([sg, fg]);
}

function createAppleTree(world: WorldUniforms, x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'apple tree';
  const r = 1.05;
  const trunk = part(new THREE.CylinderGeometry(0.07, 0.11, 1.2, 8), '#86644a', M().makeTranslation(0, 0.6, 0));
  const crownGeo = clumpGeometry(41, r);
  const crown = caster(new THREE.Mesh(crownGeo, paintMaterial(world, { color: '#7bb655', ragged: true, softness: 0.3, shadeTint: '#8c9fd0' })));
  crown.position.y = 0.95;
  crown.scale.set(1, 1.25, 1);
  // a scatter of little red apples on the sunny side of the crown
  const apples: THREE.BufferGeometry[] = [trunk];
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39996 + 0.3, h = 0.25 + ((i * 0.618) % 1) * 0.55;
    const rr = r * Math.sqrt(1 - h * h) * 0.98 + 0.02;
    apples.push(part(new THREE.SphereGeometry(0.055, 8, 6), i % 3 ? '#d9483a' : '#e8833a', M().makeTranslation(Math.cos(a) * rr, 0.95 + (0.2 + h * r * 0.6) * 1.25, Math.sin(a) * rr)));
  }
  const rest = caster(new THREE.Mesh(mergeGeometries(apples), paintMaterial(world, { vertexColors: true, gloss: 0.8 })));
  group.add(crown, rest);
  group.position.set(x, terrainHeight(x, z) - 0.04, z);
  return group;
}

export interface Props {
  group: THREE.Group;
  update(dt: number, time: number): void;
  wateringCan: THREE.Object3D;
}

export function createProps(world: WorldUniforms): Props {
  const group = new THREE.Group();
  group.name = 'props';
  group.add(createHedge(world), createStones(world));

  const vc = paintMaterial(world, { vertexColors: true, gloss: 0.6, softness: 0.15 });
  const can = OBSTACLES[0];
  const wateringCan = caster(new THREE.Mesh(wateringCanGeometry(), vc));
  wateringCan.position.set(can.x, terrainHeight(can.x, can.z), can.z);
  wateringCan.rotation.y = 2.4;
  wateringCan.scale.setScalar(1.6);
  group.add(wateringCan);

  const dish = OBSTACLES[1];
  const dishGroup = createDish(world, dish.x, dish.z);
  dishGroup.scale.setScalar(1.4);
  group.add(dishGroup);

  const leaf = paintMaterial(world, { color: '#73ab4e', ragged: true, softness: 0.3, shadeTint: '#8c9fd0' });
  const clumps = OBSTACLES.filter((o) => o.name === 'fern');
  clumps.forEach((c, i) => {
    const mesh = caster(new THREE.Mesh(clumpGeometry(20 + i, c.r * 0.95), leaf));
    mesh.position.set(c.x, terrainHeight(c.x, c.z) - 0.03, c.z);
    group.add(mesh);
  });

  const ladybird = new THREE.Mesh(ladybirdGeometry(), vc);
  const lb = OBSTACLES[2];
  ladybird.position.set(lb.x + 0.18, terrainHeight(lb.x, lb.z) + lb.r * 0.72, lb.z + 0.32);
  ladybird.rotation.set(0.25, 0.8, 0);
  ladybird.scale.setScalar(1.7);
  group.add(ladybird);

  const st = STONES[3];
  const snail = caster(new THREE.Mesh(snailGeometry(), vc));
  snail.position.set(st.x - 0.05, terrainHeight(st.x, st.z) + 0.15, st.z);
  snail.rotation.y = 0.5;
  snail.scale.setScalar(1.9);
  group.add(snail);

  const tree = OBSTACLES.find((o) => o.name === 'apple tree')!;
  group.add(createAppleTree(world, tree.x, tree.z));

  return {
    group,
    wateringCan,
    update(_dt: number, time: number) {
      // the ladybird ambles round its leaf now and then
      const a = Math.sin(time * 0.11) * 1.2;
      ladybird.position.x = lb.x + Math.cos(a) * 0.22;
      ladybird.position.z = lb.z + 0.18 + Math.sin(a) * 0.18;
      ladybird.rotation.y = -a + Math.PI / 2 * Math.sign(Math.cos(time * 0.11));
    },
  };
}
