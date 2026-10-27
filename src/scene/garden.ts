import { fbm2, noise2 } from './noise';

/**
 * The garden is a painted tile — 20 × 15 m of cottage garden — seen from
 * above at a three-quarter angle. World units are metres, y up, the camera
 * sits on the +z side looking toward -z. Everything that needs the ground
 * (mesh, details, raycasts, planting, bees) calls these functions, so nothing
 * floats or sinks, and the GLSL twin in groundGlsl.ts is generated from the
 * same numbers.
 */

export const TILE = { halfX: 10, halfZ: 7.5 };

export interface Bed {
  readonly x: number;
  readonly z: number;
  /** Half extents before rounding. */
  readonly hx: number;
  readonly hz: number;
  readonly rot: number;
  /** Corner radius. */
  readonly r: number;
}

/** Dark loamy beds, slightly mounded, raked along their length. */
export const BEDS: readonly Bed[] = [
  { x: -5.5, z: 3.3, hx: 2.5, hz: 1.75, rot: 0.07, r: 1.0 },
  { x: 4.5, z: 1.4, hx: 3.4, hz: 2.0, rot: -0.05, r: 1.2 },
  { x: 2.6, z: -3.9, hx: 3.6, hz: 1.05, rot: 0.03, r: 0.9 },
  { x: 7.6, z: 5.6, hx: 1.1, hz: 0.85, rot: 0.2, r: 0.85 },
];

/** The straw skep's default spot: back-left, at the head of the path. */
export const HIVE_HOME = { x: -6.9, z: -4.3 };
export const HIVE_RADIUS = 0.95;
/** The gravel apron the hive stands on. */
export const APRON_RADIUS = 1.7;

/** Centre line of the gravel path, x as a function of z (front edge to the hive). */
export function pathX(z: number): number {
  return -3.75 + 0.54 * z + 0.5 * Math.sin(z * 0.55 + 0.6);
}
export const PATH_HALF_WIDTH = 0.52;
/** The path starts at the hive's apron. */
export const PATH_END_Z = -4.2;

/** Stepping stones across the front lawn: centre and radii (ellipses). */
export const STONES: readonly { x: number; z: number; rx: number; rz: number; rot: number }[] = [
  { x: 0.75, z: 5.4, rx: 0.36, rz: 0.27, rot: 0.3 },
  { x: 1.75, z: 5.75, rx: 0.33, rz: 0.26, rot: -0.2 },
  { x: 2.8, z: 5.55, rx: 0.37, rz: 0.28, rot: 0.5 },
  { x: 3.85, z: 5.85, rx: 0.32, rz: 0.25, rot: 0.1 },
  { x: 4.9, z: 5.5, rx: 0.35, rz: 0.27, rot: -0.4 },
];

/** The low clipped hedge along the back edge: x range at a gently curving z. */
export const HEDGE = { x0: -3.6, x1: 9.0, halfDepth: 0.42, height: 0.62 };
export function hedgeZ(x: number): number {
  return -6.55 + 0.12 * Math.sin(x * 0.4);
}

/** Small things standing on the lawn that flowers must not be planted into. */
export const OBSTACLES: readonly { name: string; x: number; z: number; r: number }[] = [
  { name: 'watering can', x: -2.55, z: -0.35, r: 0.6 },
  { name: 'water dish', x: -8.45, z: 0.25, r: 0.55 },
  { name: 'fern', x: -4.3, z: -5.5, r: 0.75 },
  { name: 'fern', x: -9.0, z: 6.5, r: 0.55 },
  { name: 'apple tree', x: 8.75, z: -6.0, r: 0.9 },
];

// --- shapes -------------------------------------------------------------------

/** Signed distance (m) to a bed's edge: negative inside. */
export function bedDistance(b: Bed, x: number, z: number): number {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = x - b.x, dz = z - b.z;
  const lx = Math.abs(c * dx + s * dz), lz = Math.abs(-s * dx + c * dz);
  const qx = lx - b.hx + b.r, qz = lz - b.hz + b.r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - b.r;
}

/** Nearest bed distance and its index. */
export function nearestBed(x: number, z: number): { d: number; index: number } {
  let d = Infinity, index = -1;
  BEDS.forEach((b, i) => {
    const bd = bedDistance(b, x, z);
    if (bd < d) { d = bd; index = i; }
  });
  return { d, index };
}

export function pathDistance(x: number, z: number): number {
  const lateral = Math.abs(x - pathX(z)) - PATH_HALF_WIDTH;
  // the path ends where it meets the hive's gravel apron
  const end = PATH_END_Z - z;
  return Math.max(lateral, end);
}

export function apronDistance(x: number, z: number, hive = HIVE_HOME): number {
  return Math.hypot(x - hive.x, z - hive.z) - APRON_RADIUS;
}

export function stoneDistance(x: number, z: number): number {
  let d = Infinity;
  for (const s of STONES) {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const dx = x - s.x, dz = z - s.z;
    const lx = (c * dx + sn * dz) / s.rx, lz = (-sn * dx + c * dz) / s.rz;
    d = Math.min(d, (Math.hypot(lx, lz) - 1) * Math.min(s.rx, s.rz));
  }
  return d;
}

export function hedgeDistance(x: number, z: number): number {
  const along = Math.max(HEDGE.x0 - x, x - HEDGE.x1, 0);
  const across = Math.abs(z - hedgeZ(Math.min(HEDGE.x1, Math.max(HEDGE.x0, x)))) - HEDGE.halfDepth;
  return along > 0 ? Math.hypot(along, Math.max(across, 0)) : across;
}

/** Distance (m) inside the tile's edge; negative outside. */
export function edgeDistance(x: number, z: number): number {
  return Math.min(TILE.halfX - Math.abs(x), TILE.halfZ - Math.abs(z));
}

// --- height -------------------------------------------------------------------

const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function terrainHeight(x: number, z: number): number {
  // nearly level: a garden, with the faintest roll so the light moves across it
  let h = 0.09 * fbm2(x / 7 + 2.1, z / 7 - 0.6, 2) + 0.015 * noise2(x / 1.4, z / 1.4);
  // beds are mounded soil with soft shoulders
  const { d } = nearestBed(x, z);
  h += 0.11 * smoothstep(0.15, -0.6, d);
  // the path is worn a touch lower
  h -= 0.025 * smoothstep(0.1, -0.2, pathDistance(x, z));
  return h;
}

export function terrainNormal(x: number, z: number, eps = 0.05): [number, number, number] {
  const hx = terrainHeight(x + eps, z) - terrainHeight(x - eps, z);
  const hz = terrainHeight(x, z + eps) - terrainHeight(x, z - eps);
  const nx = -hx, ny = 2 * eps, nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

// --- what is where ------------------------------------------------------------

export type Surface = 'bed' | 'lawn' | 'path' | 'stone' | 'hedge' | 'hive' | 'prop' | 'edge' | 'off';

/** Planting margin from the paint's ragged edge. */
export const EDGE_MARGIN = 0.75;

export function surfaceAt(x: number, z: number, hive = HIVE_HOME): Surface {
  const e = edgeDistance(x, z);
  if (e < 0) return 'off';
  if (e < EDGE_MARGIN) return 'edge';
  if (Math.hypot(x - hive.x, z - hive.z) < HIVE_RADIUS + 0.25) return 'hive';
  if (hedgeDistance(x, z) < 0.12) return 'hedge';
  if (stoneDistance(x, z) < 0.05) return 'stone';
  if (OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r)) return 'prop';
  if (nearestBed(x, z).d < 0) return 'bed';
  if (pathDistance(x, z) < 0.04 || apronDistance(x, z, hive) < 0) return 'path';
  return 'lawn';
}

export const isPlantable = (s: Surface) => s === 'bed' || s === 'lawn';

/** Friendly words for the places you cannot plant. */
export function surfaceMessage(s: Surface): string {
  switch (s) {
    case 'path': return 'That’s the gravel path — plant in a bed or on the lawn.';
    case 'stone': return 'Flowers can’t root in a stepping stone.';
    case 'hedge': return 'The hedge is too thick to plant in.';
    case 'hive': return 'The bees would like their doorway kept clear.';
    case 'prop': return 'Something is already standing there.';
    case 'edge': case 'off': return 'Plant inside the garden.';
    default: return '';
  }
}

/** Nearest plantable spot (for drags and seedlings): spirals outward until one is found. */
export function nearestPlantable(x: number, z: number, hive = HIVE_HOME): [number, number] {
  if (isPlantable(surfaceAt(x, z, hive))) return [x, z];
  for (let r = 0.15; r < 6; r += 0.15) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (isPlantable(surfaceAt(px, pz, hive))) return [px, pz];
    }
  }
  return [x, z];
}

/** Where the hive may be dragged: on the garden, clear of the edge. */
export function clampHive(x: number, z: number): [number, number] {
  const m = EDGE_MARGIN + HIVE_RADIUS + 0.4;
  return [Math.min(TILE.halfX - m, Math.max(-TILE.halfX + m, x)), Math.min(TILE.halfZ - m, Math.max(-TILE.halfZ + m, z))];
}
