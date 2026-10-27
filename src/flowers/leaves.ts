import * as THREE from 'three';
import type { LeafShape } from './kinds';

/**
 * Leaves as tapered painted ribbons: a blade running out along +x with a
 * folded midrib, drooping toward its tip. One geometry per shape, shared.
 */

interface LeafSpec { length: number; width: number; widest: number; fold: number; droop: number; lobes?: number }

const SPECS: Record<LeafShape, LeafSpec> = {
  heart: { length: 0.36, width: 0.17, widest: 0.32, fold: 0.25, droop: -0.7 },
  lance: { length: 0.24, width: 0.032, widest: 0.42, fold: 0.4, droop: -0.6 },
  oval: { length: 0.17, width: 0.065, widest: 0.45, fold: 0.35, droop: -0.5 },
  needle: { length: 0.15, width: 0.012, widest: 0.4, fold: 0.2, droop: -0.3 },
  lobed: { length: 0.24, width: 0.07, widest: 0.5, fold: 0.3, droop: -0.8, lobes: 3 },
  strap: { length: 0.55, width: 0.03, widest: 0.3, fold: 0.5, droop: -1.4 },
};

const cache = new Map<LeafShape, THREE.BufferGeometry>();

export function leafGeometry(shape: LeafShape): THREE.BufferGeometry {
  const hit = cache.get(shape);
  if (hit) return hit;
  const s = SPECS[shape];
  const nu = 10, nv = 4;
  const pw = Math.log(0.5) / Math.log(s.widest);
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const t = Math.pow(u, pw);
    let half = s.width * Math.sin(Math.PI * t) * (0.3 + 0.7 * Math.min(1, u * 6));
    if (s.lobes) half *= 0.7 + 0.3 * Math.abs(Math.sin(u * Math.PI * (s.lobes + 0.5)));
    const a = s.droop * u;
    const x = s.droop === 0 ? u * s.length : (Math.sin(a) / s.droop) * s.length;
    const y = s.droop === 0 ? 0 : ((1 - Math.cos(a)) / s.droop) * s.length;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      pos.push(x, y + Math.abs(v) * half * s.fold, v * half);
      uv.push(u, v);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      index.push(a, a + 1, a + nv + 1, a + 1, a + nv + 2, a + nv + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  cache.set(shape, geo);
  return geo;
}
