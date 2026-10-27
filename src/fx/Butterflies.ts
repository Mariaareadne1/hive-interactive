import * as THREE from 'three';
import { seededRandom, noise2 } from '../scene/noise';
import { TILE, terrainHeight } from '../scene/garden';
import type { WorldUniforms } from '../scene/world';

/**
 * Butterflies drift in once the garden is lush (six or more flowers in
 * bloom): a lazy, tumbling flight from flower to flower that never settles
 * long over the same spot, and away off the edge of the page when the
 * garden thins again.
 */

export const BUTTERFLY_THRESHOLD = 6;
const MAX = 3;

const vertex = /* glsl */ `
attribute vec3 aTint;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vUv = uv;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 uSunColor;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  // a forewing and a hindwing, painted: soft colour, a darker margin, two pale spots
  vec2 q = vUv;
  float fore = length((q - vec2(0.42, 0.62)) * vec2(1.1, 1.6));
  float hind = length((q - vec2(0.3, 0.25)) * vec2(1.5, 1.7));
  float d = min(fore, hind);
  if (d > 0.5) discard;
  vec3 col = mix(vTint, vTint * 0.45, smoothstep(0.36, 0.48, d));
  col = mix(col, vec3(0.98, 0.96, 0.9), smoothstep(0.08, 0.04, length(q - vec2(0.62, 0.7))) * 0.9);
  col = mix(col, vTint * 0.6, smoothstep(0.12, 0.0, q.x) * 0.6);
  gl_FragColor = vec4(col * mix(vec3(1.0), uSunColor, 0.5), 1.0);
}
`;

interface Butterfly {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  goal: THREE.Vector3;
  t: number;
  leaving: boolean;
  seed: number;
  tint: THREE.Color;
}

const TINTS = ['#f0a24a', '#f4f0e4', '#9fc0ea'].map((c) => new THREE.Color(c));

export class Butterflies {
  readonly mesh: THREE.InstancedMesh;
  private readonly list: Butterfly[] = [];
  private readonly rand = seededRandom(23);
  private readonly tint = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2 * 3), 3);
  private spawnTimer = 2;
  private readonly m = new THREE.Matrix4();
  private readonly w = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  /** World points butterflies should not hover over (the selected thing). */
  avoid: THREE.Vector3 | null = null;

  constructor(world: WorldUniforms) {
    const geo = new THREE.PlaneGeometry(0.2, 0.2);
    geo.translate(0.1, 0, 0);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('aTint', this.tint);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: { uSunColor: world.uSunColor }, vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide }),
      MAX * 2,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.list.length;
  }

  private edgePoint(): THREE.Vector3 {
    const side = this.rand() < 0.5 ? -1 : 1;
    return new THREE.Vector3(side * (TILE.halfX + 1.5), 2.2, (this.rand() * 2 - 1) * TILE.halfZ * 0.7);
  }

  update(dt: number, time: number, blooms: readonly THREE.Vector3[]): void {
    const lush = blooms.length >= BUTTERFLY_THRESHOLD;
    const want = lush ? Math.min(MAX, 1 + Math.floor((blooms.length - BUTTERFLY_THRESHOLD) / 4)) : 0;
    this.spawnTimer -= dt;
    const staying = this.list.filter((b) => !b.leaving);
    if (staying.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 4;
      const start = this.edgePoint();
      this.list.push({ pos: start, vel: new THREE.Vector3(), goal: start.clone(), t: 0, leaving: false, seed: this.rand() * 100, tint: TINTS[this.list.length % TINTS.length] });
    }
    if (staying.length > want) staying[0].leaving = true;

    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t -= dt;
      if (b.leaving) {
        if (b.t <= 0) {
          b.goal.copy(this.edgePoint());
          b.t = 99;
        }
        if (Math.abs(b.pos.x) > TILE.halfX + 1) {
          this.list.splice(i, 1);
          continue;
        }
      } else if (b.t <= 0 || b.pos.distanceTo(b.goal) < 0.3) {
        // the next flower, but never lingering over what the visitor has selected
        const options = blooms.filter((p) => !this.avoid || p.distanceTo(this.avoid) > 1.5);
        const pick = options[Math.floor(this.rand() * options.length)] ?? this.edgePoint();
        b.goal.copy(pick).add(new THREE.Vector3((this.rand() - 0.5) * 0.6, 0.45 + this.rand() * 0.4, (this.rand() - 0.5) * 0.6));
        b.t = 2.5 + this.rand() * 2.5;
      }
      const desired = b.goal.clone().sub(b.pos);
      const d = desired.length();
      desired.multiplyScalar(Math.min(1.2, d) / Math.max(d, 1e-3));
      desired.x += noise2(time * 0.9, b.seed) * 0.9;
      desired.y += noise2(time * 1.3, b.seed + 30) * 0.7;
      desired.z += noise2(time * 0.9, b.seed + 60) * 0.9;
      b.vel.lerp(desired, 1 - Math.exp(-2 * dt));
      b.pos.addScaledVector(b.vel, dt);
      b.pos.y = Math.max(terrainHeight(b.pos.x, b.pos.z) + 0.5, b.pos.y);

      const yaw = Math.atan2(-b.vel.z, b.vel.x);
      const flap = Math.sin(time * 14 + b.seed) * 0.9 + 0.2;
      this.q.setFromEuler(new THREE.Euler(0, yaw, 0));
      this.m.compose(b.pos, this.q, new THREE.Vector3(1, 1, 1));
      for (const side of [1, -1]) {
        if (n >= MAX * 2) break;
        // wings hinge along the body; fold up and down together
        this.w.makeRotationY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
        this.w.premultiply(new THREE.Matrix4().makeRotationX(side * flap));
        this.mesh.setMatrixAt(n, this.m.clone().multiply(this.w));
        this.tint.setXYZ(n, b.tint.r, b.tint.g, b.tint.b);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
