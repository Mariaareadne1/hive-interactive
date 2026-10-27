import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { paintMaterial, tint } from './paint';
import { HIVE_RADIUS, terrainHeight } from './garden';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from './world';

/**
 * The hive: a woven straw skep on a round wooden stand, its little arched
 * doorway facing into the garden over a landing board. Honey shows as amber
 * creeping up the straw from the base and a drip forming under the board.
 */

export const SKEP_HEIGHT = 1.45;
const STAND_H = 0.12;
const COILS = 9;

/** Skep radius at height y above the stand (y in 0..SKEP_HEIGHT). */
export function skepRadius(y: number): number {
  const t = Math.min(1, Math.max(0, y / SKEP_HEIGHT));
  const dome = Math.pow(1 - Math.pow(t, 2.4), 0.5);
  return HIVE_RADIUS * (0.86 * dome + 0.14 * dome * dome);
}

/** Entrance (local, on the stand top) and the landing board, where bees dance. */
export const ENTRANCE_LOCAL = new THREE.Vector3(0, STAND_H + 0.1, HIVE_RADIUS * 0.84);
export const BOARD_LOCAL = new THREE.Vector3(0, STAND_H + 0.03, HIVE_RADIUS + 0.1);

function skepGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 160;
  for (let i = 0; i <= n; i++) {
    const y = (i / n) * SKEP_HEIGHT;
    // rolled straw coils: each a rounded bulge
    const phase = (y / SKEP_HEIGHT) * COILS;
    const bulge = Math.sqrt(Math.max(0, Math.sin(Math.PI * (phase % 1)))) * 0.028 * (1 - (y / SKEP_HEIGHT) ** 4);
    pts.push(new THREE.Vector2(Math.max(0.001, skepRadius(y) + bulge), y));
  }
  pts.push(new THREE.Vector2(0, SKEP_HEIGHT + 0.01));
  return new THREE.LatheGeometry(pts, 64);
}

const skepVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const skepFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform float uHoney;
uniform float uHighlight;
uniform float uAwake;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float ang = atan(vLocal.x, vLocal.z);           // 0 at the doorway
  float h = vLocal.y / ${SKEP_HEIGHT.toFixed(3)};
  float phase = fract(h * ${COILS.toFixed(1)});
  // straw: warm gold, fibres running round each coil, darker in the grooves
  vec3 straw = mix(srgb(vec3(0.85, 0.64, 0.30)), srgb(vec3(0.93, 0.76, 0.42)), vnoise(vec2(ang * 3.0, h * 40.0)));
  float fibre = vnoise(vec2(ang * 60.0, h * 220.0));
  straw *= 0.9 + 0.16 * fibre;
  float groove = smoothstep(0.18, 0.0, min(phase, 1.0 - phase));
  straw *= 1.0 - groove * 0.35;
  // binding stitches: short darker wraps, offset coil by coil like brickwork
  float coil = floor(h * ${COILS.toFixed(1)});
  float st = fract(ang / 6.2831 * 22.0 + coil * 0.5);
  float stitch = smoothstep(0.06, 0.0, abs(st - 0.5)) * smoothstep(0.15, 0.4, phase) * smoothstep(0.85, 0.6, phase);
  straw = mix(straw, srgb(vec3(0.62, 0.42, 0.18)), stitch * 0.7);
  // honey: amber soaking up from the base as the colony stores more
  float level = uHoney * 0.45 + (vnoise(vec2(ang * 2.0, 3.0)) - 0.5) * 0.06;
  straw = mix(straw, straw * srgb(vec3(0.86, 0.6, 0.32)), smoothstep(level + 0.04, level - 0.04, h) * step(0.001, uHoney));
  // the doorway: a dark little arch at the base
  float arch = smoothstep(0.012, 0.0, h - (0.1 - ang * ang * 1.4)) * step(abs(ang), 0.26);
  vec3 dark = mix(srgb(vec3(0.16, 0.10, 0.07)), srgb(vec3(0.28, 0.17, 0.08)), uAwake * 0.6);
  vec3 albedo = mix(straw, dark, arch * 0.95);

  float sunVis = castLight(vWorld, 0.03);
  vec3 col = paintLight(albedo, N, sunVis, mix(0.7, 1.0, phase * (1.0 - phase) * 4.0), 0.2);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += albedo * rim * 0.12 * max(dot(N, uSunDir), 0.0) * sunVis;
  col += vec3(0.12, 0.3, 0.75) * uHighlight * pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Hive {
  readonly group = new THREE.Group();
  readonly proxy: THREE.Mesh;
  private readonly skepMat: THREE.ShaderMaterial;
  private readonly drip: THREE.Mesh;
  private readonly casters: THREE.Mesh[] = [];
  honey = 0;

  constructor(world: WorldUniforms) {
    this.group.name = 'hive';
    this.skepMat = new THREE.ShaderMaterial({
      uniforms: { ...world, uHoney: { value: 0 }, uHighlight: { value: 0 }, uAwake: { value: 1 } },
      vertexShader: skepVertex,
      fragmentShader: skepFragment,
    });
    const skep = new THREE.Mesh(skepGeometry(), this.skepMat);
    skep.position.y = STAND_H;
    this.add(skep);

    const wood = paintMaterial(world, { vertexColors: true, softness: 0.15, gloss: 0.15 });
    const stand = tint(new THREE.CylinderGeometry(HIVE_RADIUS + 0.12, HIVE_RADIUS + 0.16, STAND_H, 28).toNonIndexed(), '#a87c56');
    stand.translate(0, STAND_H / 2, 0);
    stand.deleteAttribute('uv');
    const board = tint(new THREE.BoxGeometry(0.42, 0.035, 0.26).toNonIndexed(), '#b88b60');
    board.translate(BOARD_LOCAL.x, BOARD_LOCAL.y, BOARD_LOCAL.z);
    board.deleteAttribute('uv');
    const top = tint(new THREE.SphereGeometry(0.07, 10, 8).toNonIndexed(), '#c4913f');
    top.translate(0, STAND_H + SKEP_HEIGHT + 0.02, 0);
    top.deleteAttribute('uv');
    this.add(new THREE.Mesh(mergeGeometries([stand, board, top]), wood));

    // a honey drip under the board, swelling as honey is stored
    const dripGeo = tint(new THREE.SphereGeometry(0.035, 10, 8).toNonIndexed(), '#e0a032');
    dripGeo.deleteAttribute('uv');
    dripGeo.scale(1, 1.5, 1);
    this.drip = new THREE.Mesh(dripGeo, paintMaterial(world, { vertexColors: true, gloss: 2.0 }));
    this.drip.position.set(0.12, BOARD_LOCAL.y - 0.05, BOARD_LOCAL.z + 0.11);
    this.drip.scale.setScalar(0.001);
    this.group.add(this.drip);

    this.proxy = new THREE.Mesh(new THREE.CylinderGeometry(HIVE_RADIUS + 0.1, HIVE_RADIUS + 0.15, SKEP_HEIGHT + STAND_H, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.position.y = (SKEP_HEIGHT + STAND_H) / 2;
    this.proxy.userData.kind = 'hive';
    this.group.add(this.proxy);
  }

  private add(mesh: THREE.Mesh): void {
    mesh.layers.enable(SHADOW_LAYER);
    this.casters.push(mesh);
    this.group.add(mesh);
  }

  place(x: number, z: number, heading: number): void {
    this.group.position.set(x, terrainHeight(x, z) - 0.02, z);
    this.group.rotation.y = heading;
    this.group.updateMatrixWorld(true);
  }

  get x(): number { return this.group.position.x; }
  get z(): number { return this.group.position.z; }
  get heading(): number { return this.group.rotation.y; }

  /** World positions of the doorway and the landing board. */
  entrance(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(ENTRANCE_LOCAL).applyMatrix4(this.group.matrixWorld);
  }

  board(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(BOARD_LOCAL).applyMatrix4(this.group.matrixWorld);
  }

  /** Unit vector pointing out of the doorway. */
  outward(target = new THREE.Vector3()): THREE.Vector3 {
    const h = this.group.rotation.y;
    return target.set(Math.sin(h), 0, Math.cos(h));
  }

  setHoney(level: number, time: number): void {
    this.honey = level;
    this.skepMat.uniforms.uHoney.value = Math.min(1, level);
    // the drip slowly swells, falls, and forms again
    const cycle = (time * 0.15) % 1;
    const s = Math.min(1, level * 3) * (0.4 + 0.6 * Math.min(1, cycle * 1.4)) * (cycle > 0.92 ? 0 : 1);
    this.drip.scale.setScalar(Math.max(0.001, s));
    this.drip.position.y = BOARD_LOCAL.y - 0.05 - (cycle > 0.85 ? (cycle - 0.85) * 0.6 : 0);
  }

  setAwake(awake: number): void {
    this.skepMat.uniforms.uAwake.value = awake;
  }

  setHighlight(v: number): void {
    this.skepMat.uniforms.uHighlight.value = v;
  }

  bounds(target = new THREE.Box3()): THREE.Box3 {
    this.group.updateMatrixWorld(true);
    target.makeEmpty();
    for (const m of this.casters) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      target.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
    }
    return target;
  }
}
