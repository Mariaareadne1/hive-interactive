import type * as THREE from 'three';
import { noise2 } from '../scene/noise';

/**
 * Each bee meanders on its own smooth "lane" of noise, so a flight is a
 * lazy curving line rather than a beeline. Pure function of (lane, time).
 */

export const WANDER_LANES = 64;

export function wanderOffset(lane: number, time: number, out: THREE.Vector3, amount: number): THREE.Vector3 {
  const t = time * 0.7;
  out.x += noise2(t, lane * 7.3) * amount;
  out.y += noise2(t * 1.3, lane * 7.3 + 101.7) * amount * 0.5;
  out.z += noise2(t, lane * 7.3 + 53.1) * amount;
  return out;
}
