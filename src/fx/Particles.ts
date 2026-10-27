import * as THREE from 'three';
import type { WorldUniforms } from '../scene/world';

/**
 * Small painted particles — pollen puffs, water sparkles, falling drops,
 * drifting petals, smoke, rain, flight-trail dots — as one instanced draw of
 * camera-facing quads. Particles are plain objects stepped on the CPU (there
 * are never more than a few hundred).
 */

export type ParticleShape = 'dot' | 'sparkle' | 'streak' | 'petal' | 'smoke';
const SHAPE: Record<ParticleShape, number> = { dot: 0, sparkle: 1, streak: 2, petal: 3, smoke: 4 };

export interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  age: number;
  size: number;
  color: THREE.Color;
  shape: ParticleShape;
  /** Downward pull (m/s²); negative floats up. */
  gravity: number;
  drag: number;
  spin: number;
  alpha: number;
}

const MAX = 1400;

const vertex = /* glsl */ `
attribute vec4 aPos;    // xyz, size
attribute vec4 aColor;  // rgb, alpha
attribute vec2 aShape;  // shape, spin
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aShape.y), s = sin(aShape.y);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  vec2 stretch = aShape.x > 1.5 && aShape.x < 2.5 ? vec2(0.25, 2.6) : vec2(1.0);
  vec3 wp = aPos.xyz + (right * q.x * stretch.x + up * q.y * stretch.y) * aPos.w;
  vUv = position.xy * 2.0;
  vColor = aColor;
  vShape = aShape.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 uSunColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  float r = length(vUv);
  float a;
  if (vShape < 0.5) a = smoothstep(1.0, 0.45, r);
  else if (vShape < 1.5) {
    float star = max(smoothstep(0.18, 0.0, abs(vUv.x)) * smoothstep(1.0, 0.0, abs(vUv.y)), smoothstep(0.18, 0.0, abs(vUv.y)) * smoothstep(1.0, 0.0, abs(vUv.x)));
    a = max(star, smoothstep(0.45, 0.0, r));
  } else if (vShape < 2.5) a = smoothstep(1.0, 0.3, r);
  else if (vShape < 3.5) a = smoothstep(1.0, 0.85, length(vUv * vec2(1.0, 1.8)));
  else a = smoothstep(1.0, 0.0, r) * 0.6;
  a *= vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * mix(vec3(1.0), uSunColor, 0.4), a);
}
`;

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly list: Particle[] = [];
  private readonly aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  private readonly aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  private readonly aShape = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);

  constructor(world: WorldUniforms) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aShape', this.aShape);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSunColor: world.uSunColor },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  get count(): number {
    return this.list.length;
  }

  add(p: Partial<Particle> & { pos: THREE.Vector3 }): void {
    if (this.list.length >= MAX) return;
    this.list.push({
      vel: new THREE.Vector3(),
      life: 1,
      age: 0,
      size: 0.04,
      color: new THREE.Color(1, 1, 1),
      shape: 'dot',
      gravity: 0,
      drag: 1,
      spin: 0,
      alpha: 1,
      ...p,
      pos: p.pos.clone(),
    });
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.list.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
    }
    for (const p of this.list) {
      const k = p.age / p.life;
      // fade in quickly, out gently
      const fade = Math.min(1, k * 8) * (1 - k * k);
      const grow = p.shape === 'smoke' ? 0.5 + k * 1.4 : 1;
      this.aPos.setXYZW(n, p.pos.x, p.pos.y, p.pos.z, p.size * grow);
      this.aColor.setXYZW(n, p.color.r, p.color.g, p.color.b, p.alpha * fade);
      this.aShape.setXY(n, SHAPE[p.shape], p.spin * p.age + (p.shape === 'petal' ? p.life * 7 : 0));
      n++;
    }
    this.mesh.count = n;
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aShape.needsUpdate = true;
  }

  clear(): void {
    this.list.length = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
