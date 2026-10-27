import * as THREE from 'three';
import { terrainHeight } from '../scene/garden';

/**
 * Exact screen-to-ground intersection against the analytic terrain: march the
 * view ray until it dips under the surface, then bisect. Returns null when the
 * ray goes over the crest into the sky.
 */
export function raycastTerrain(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance = 420,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  const dir = direction;
  const above = (t: number) => origin.y + dir.y * t - terrainHeight(origin.x + dir.x * t, origin.z + dir.z * t);
  let prev = 0;
  if (above(prev) < 0) return null;
  let t = 0.05;
  while (t < maxDistance) {
    if (above(t) < 0) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) < 0) hi = mid;
        else lo = mid;
      }
      return target.copy(origin).addScaledVector(dir, hi);
    }
    prev = t;
    t += 0.04 + t * 0.012;
  }
  return null;
}

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();

/** Client (CSS pixel) coordinates -> terrain point, using the canvas rect. */
export function screenToTerrain(
  camera: THREE.PerspectiveCamera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return raycastTerrain(ray.ray.origin, ray.ray.direction, 420, target);
}

/** World point -> client coordinates (CSS pixels). */
export function worldToScreen(
  camera: THREE.PerspectiveCamera,
  rect: { left: number; top: number; width: number; height: number },
  p: THREE.Vector3,
): { x: number; y: number; behind: boolean } {
  const v = p.clone().project(camera);
  return {
    x: rect.left + ((v.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - v.y) / 2) * rect.height,
    behind: v.z > 1,
  };
}
