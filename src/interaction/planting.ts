import * as THREE from 'three';
import type { Pt } from './stroke';
import type { P2 } from '../flowers/stem';

/**
 * Projecting the drawn line into the garden. The flower is planted where the
 * stroke's lowest point meets the ground; the rest of the line is cast onto
 * an upright plane through that point, square to the camera, so the stem can
 * follow the exact shape you drew.
 */

/** The lowest point of the stroke on screen (largest y): where it is planted. */
export function plantPoint(points: readonly Pt[]): Pt {
  let best = points[0];
  for (const p of points) if (p.y > best.y) best = p;
  return best;
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();

/** The camera's yaw: the lateral axis of the drawing plane is the camera's right. */
export function drawingHeading(camera: THREE.Camera): number {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return Math.atan2(-right.z, right.x);
}

/**
 * Stroke points → (lateral, up) metres in the upright plane through `base`
 * whose lateral axis points along `heading`. Points whose rays miss (behind
 * the camera, parallel) are skipped.
 */
export function toPlane(
  camera: THREE.PerspectiveCamera,
  rect: { left: number; top: number; width: number; height: number },
  points: readonly Pt[],
  base: THREE.Vector3,
  heading: number,
): P2[] {
  const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  const normal = new THREE.Vector3(0, 1, 0).cross(right).normalize();
  plane.setFromNormalAndCoplanarPoint(normal, base);
  const out: P2[] = [];
  for (const p of points) {
    ndc.set(((p.x - rect.left) / rect.width) * 2 - 1, -((p.y - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) continue;
    out.push([hit.clone().sub(base).dot(right), hit.y - base.y]);
  }
  return out;
}
