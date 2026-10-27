import * as THREE from 'three';

/**
 * Small, pure flight helpers: steering toward a point with arrival, smooth
 * per-bee wandering, and pushing a point out of the garden's solid things
 * (stems as capsules, blooms and the hive as spheres/cylinders). The colony
 * uses these; tests use them to prove bees never pass through flowers.
 */

export interface Capsule { a: THREE.Vector3; b: THREE.Vector3; r: number; owner: string }
export interface Sphere { c: THREE.Vector3; r: number; owner: string }
export interface Cylinder { x: number; z: number; r: number; y0: number; y1: number; owner: string }

export interface Obstacles {
  capsules: Capsule[];
  spheres: Sphere[];
  cylinders: Cylinder[];
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const ab = tmp2.copy(b).sub(a);
  const t = Math.max(0, Math.min(1, tmp.copy(p).sub(a).dot(ab) / (ab.lengthSq() || 1)));
  return target.copy(a).addScaledVector(ab, t);
}

/** Signed clearance from p to the nearest obstacle not owned by `ignore` (negative = inside). */
export function clearance(p: THREE.Vector3, obs: Obstacles, ignore: string | null = null): number {
  let d = Infinity;
  const q = new THREE.Vector3();
  for (const c of obs.capsules) if (c.owner !== ignore) d = Math.min(d, p.distanceTo(closestOnSegment(p, c.a, c.b, q)) - c.r);
  for (const s of obs.spheres) if (s.owner !== ignore) d = Math.min(d, p.distanceTo(s.c) - s.r);
  for (const c of obs.cylinders) {
    if (c.owner === ignore) continue;
    const radial = Math.hypot(p.x - c.x, p.z - c.z) - c.r;
    const vertical = Math.max(c.y0 - p.y, p.y - c.y1);
    d = Math.min(d, vertical > 0 ? Math.hypot(Math.max(radial, 0), vertical) : radial);
  }
  return d;
}

/**
 * Push p out of every obstacle (except `ignore`) by at least `margin`, and
 * return the steering push that would have kept it clear (for avoidance).
 */
export function resolve(p: THREE.Vector3, obs: Obstacles, margin: number, ignore: string | null, push: THREE.Vector3): void {
  push.set(0, 0, 0);
  const q = new THREE.Vector3();
  const away = new THREE.Vector3();
  const look = margin * 3;
  for (const c of obs.capsules) {
    if (c.owner === ignore) continue;
    closestOnSegment(p, c.a, c.b, q);
    away.copy(p).sub(q);
    const d = away.length();
    const need = c.r + margin;
    if (d < need + look) {
      if (d < 1e-5) away.set(1, 0, 0);
      else away.divideScalar(d);
      push.addScaledVector(away, (need + look - d) / look);
      if (d < need) p.copy(q).addScaledVector(away, need);
    }
  }
  for (const s of obs.spheres) {
    if (s.owner === ignore) continue;
    away.copy(p).sub(s.c);
    const d = away.length();
    const need = s.r + margin;
    if (d < need + look) {
      if (d < 1e-5) away.set(0, 1, 0);
      else away.divideScalar(d);
      push.addScaledVector(away, (need + look - d) / look);
      if (d < need) p.copy(s.c).addScaledVector(away, need);
    }
  }
  for (const c of obs.cylinders) {
    if (c.owner === ignore) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    const radial = Math.hypot(dx, dz);
    const need = c.r + margin;
    if (p.y > c.y1 + margin || p.y < c.y0) continue;
    if (radial < need + look) {
      const nx = radial > 1e-5 ? dx / radial : 1, nz = radial > 1e-5 ? dz / radial : 0;
      push.x += nx * (need + look - radial) / look;
      push.z += nz * (need + look - radial) / look;
      push.y += 0.5 * (need + look - radial) / look;
      if (radial < need) {
        // over the top is usually the shorter way out
        if (c.y1 + margin - p.y < need - radial) p.y = c.y1 + margin;
        else { p.x = c.x + nx * need; p.z = c.z + nz * need; }
      }
    }
  }
}

/** Velocity that heads for `target`, slowing smoothly within `slowRadius`. */
export function arrive(pos: THREE.Vector3, target: THREE.Vector3, maxSpeed: number, slowRadius: number, out: THREE.Vector3): THREE.Vector3 {
  out.copy(target).sub(pos);
  const d = out.length();
  if (d < 1e-6) return out.set(0, 0, 0);
  const speed = maxSpeed * Math.min(1, d / slowRadius);
  return out.multiplyScalar(speed / d);
}

/** Exponential approach of v toward desired (frame-rate independent). */
export function steer(v: THREE.Vector3, desired: THREE.Vector3, responsiveness: number, dt: number): void {
  v.lerp(desired, 1 - Math.exp(-responsiveness * dt));
}
