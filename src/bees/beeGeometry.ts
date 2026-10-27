import { meshSDF, sdCapsule, sdEllipsoid, smin, type SDF } from '../scene/sdf';
import { woolField } from '../scene/wool';

/**
 * The bee, modelled like MEADOW's sheep at a much smaller scale: a round
 * body of soft fuzzy puffs (head, thorax, a plump striped abdomen), two big
 * friendly eyes, short antennae and six little legs. Bee units: about one
 * unit nose to tail, +x forward, +y up. Built in the geometry worker.
 *
 * aPart: 0 body fuzz, 1 head, 2 eyes, 3 antennae, 4 legs.
 */

const EYE = { x: 0.405, y: 0.05, z: 0.085, rx: 0.05, ry: 0.075, rz: 0.045 };

function eyes(x: number, y: number, z: number): number {
  return Math.min(
    sdEllipsoid(x, y, z, EYE.x, EYE.y, EYE.z, EYE.rx, EYE.ry, EYE.rz),
    sdEllipsoid(x, y, z, EYE.x, EYE.y, -EYE.z, EYE.rx, EYE.ry, EYE.rz),
  );
}

function antennae(x: number, y: number, z: number): number {
  let d = Infinity;
  for (const s of [1, -1]) {
    d = Math.min(
      d,
      sdCapsule(x, y, z, 0.44, 0.12, 0.04 * s, 0.5, 0.25, 0.08 * s, 0.014),
      sdCapsule(x, y, z, 0.5, 0.25, 0.08 * s, 0.6, 0.29, 0.1 * s, 0.013),
      sdEllipsoid(x, y, z, 0.61, 0.29, 0.1 * s, 0.026, 0.022, 0.022),
    );
  }
  return d;
}

function legs(x: number, y: number, z: number): number {
  let d = Infinity;
  for (const s of [1, -1]) {
    for (const [lx, fx] of [[0.2, 0.26], [0.1, 0.08], [0.0, -0.12]]) {
      d = Math.min(
        d,
        sdCapsule(x, y, z, lx, -0.1, 0.07 * s, (lx + fx) / 2, -0.21, 0.15 * s, 0.022),
        sdCapsule(x, y, z, (lx + fx) / 2, -0.21, 0.15 * s, fx, -0.3, 0.13 * s, 0.018),
      );
    }
  }
  return d;
}

function body(x: number, y: number, z: number): number {
  const abdomen = sdEllipsoid(x, y, z, -0.2, -0.005, 0, 0.33, 0.255, 0.255);
  const thorax = sdEllipsoid(x, y, z, 0.12, 0.035, 0, 0.19, 0.19, 0.185);
  const head = sdEllipsoid(x, y, z, 0.35, 0.02, 0, 0.12, 0.13, 0.14);
  return smin(smin(abdomen, thorax, 0.08), head, 0.06);
}

export function beeSDF(): SDF {
  const min: [number, number, number] = [-0.6, -0.4, -0.38];
  const max: [number, number, number] = [0.55, 0.4, 0.38];
  const fuzz = woolField(body, {
    seed: 5,
    min,
    max,
    inset: 0.02,
    layers: [{ count: 70, rMin: 0.05, rMax: 0.08 }, { count: 120, rMin: 0.025, rMax: 0.045 }],
    blend: 0.035,
    curl: 0.004,
  });
  return (x, y, z) => Math.min(fuzz(x, y, z), eyes(x, y, z), antennae(x, y, z), legs(x, y, z));
}

export function buildBee(): Record<string, Float32Array | Uint32Array> {
  const sdf = beeSDF();
  const geo = meshSDF(sdf, { min: [-0.62, -0.4, -0.4], max: [0.7, 0.4, 0.4], cell: 0.016, ao: true });
  const pos = geo.getAttribute('position');
  const part = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (eyes(x, y, z) < 0.012) part[i] = 2;
    else if (antennae(x, y, z) < 0.012) part[i] = 3;
    else if (legs(x, y, z) < 0.012) part[i] = 4;
    else if (x > 0.27) part[i] = 1;
  }
  return {
    position: new Float32Array(pos.array as ArrayLike<number>),
    normal: new Float32Array(geo.getAttribute('normal').array as ArrayLike<number>),
    aAO: new Float32Array(geo.getAttribute('aAO').array as ArrayLike<number>),
    aPart: part,
    index: new Uint32Array(geo.getIndex()!.array as ArrayLike<number>),
  };
}
