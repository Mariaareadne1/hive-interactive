import * as THREE from 'three';
import { TILE, edgeDistance, nearestBed, pathDistance, stoneDistance, hedgeDistance, terrainHeight, HIVE_HOME, APRON_RADIUS, OBSTACLES } from './garden';
import { fbm2, seededRandom } from './noise';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { GROUND_GLSL } from './groundGlsl';
import type { WorldUniforms } from './world';

/**
 * Little painted marks on the ground: tufts of grass along the lawn's edges,
 * clover leaves with the odd white clover flower, tiny daisies in the lawn,
 * and a few fallen petals on the gravel. Instanced and clustered by noise.
 */

type Where = 'lawn' | 'gravel';

function onLawn(x: number, z: number): boolean {
  return (
    edgeDistance(x, z) > 0.55 &&
    nearestBed(x, z).d > 0.12 &&
    pathDistance(x, z) > 0.08 &&
    Math.hypot(x - HIVE_HOME.x, z - HIVE_HOME.z) > APRON_RADIUS + 0.08 &&
    stoneDistance(x, z) > 0.06 &&
    hedgeDistance(x, z) > -0.1 &&
    !OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r * 0.8)
  );
}

function onGravel(x: number, z: number): boolean {
  return edgeDistance(x, z) > 0.6 && (pathDistance(x, z) < -0.05 || Math.hypot(x - HIVE_HOME.x, z - HIVE_HOME.z) < APRON_RADIUS - 0.1);
}

function scatter(count: number, seed: number, where: Where, accept: (x: number, z: number, r: number) => boolean) {
  const rand = seededRandom(seed);
  const out: [number, number][] = [];
  const test = where === 'lawn' ? onLawn : onGravel;
  let attempts = 0;
  while (out.length < count && attempts < count * 40) {
    attempts++;
    const x = (rand() * 2 - 1) * TILE.halfX;
    const z = (rand() * 2 - 1) * TILE.halfZ;
    if (!test(x, z) || !accept(x, z, rand())) continue;
    out.push([x, z]);
  }
  return out;
}

// --- tufts ------------------------------------------------------------------

function tuftGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const pos: number[] = [];
  const tip: number[] = [];
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI + 0.3;
    const lean = (b - 1) * 0.35;
    const cx = Math.cos(a), cz = Math.sin(a);
    pos.push(-0.008 * cx, 0, -0.008 * cz, 0.008 * cx, 0, 0.008 * cz, lean * 0.05, 1, 0);
    tip.push(0, 0, 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  return geo;
}

const tuftVertex = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
attribute vec4 aOffset; // xyz base, w yaw
attribute vec2 aSize;   // height, rand
attribute float aTip;
varying vec3 vWorld;
varying float vTip;
varying float vRand;
void main() {
  float c = cos(aOffset.w), s = sin(aOffset.w);
  vec3 p = position;
  p = vec3(c * p.x - s * p.z, p.y * aSize.x, s * p.x + c * p.z);
  float sway = (vnoise(aOffset.xz * 0.5 + uTime * 0.5) - 0.5) * 0.05 * uWind;
  p.x += sway * aTip;
  vec4 wp = vec4(aOffset.xyz + p, 1.0);
  vWorld = wp.xyz;
  vTip = aTip;
  vRand = aSize.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const tuftFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${GROUND_GLSL}
varying vec3 vWorld;
varying float vTip;
varying float vRand;
void main() {
  float grassy, soil;
  vec3 ground = groundPaint(vWorld.xz, grassy, soil);
  vec3 base = ground * srgb(vec3(0.62, 0.74, 0.6));
  vec3 tip = mix(ground * 1.12, srgb(vec3(0.82, 0.86, 0.48)), 0.3 + 0.2 * vRand);
  vec3 albedo = mix(base, tip, vTip);
  float sunVis = castLight(vWorld, 0.04);
  gl_FragColor = vec4(paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2), 1.0);
}
`;

// --- flat marks: clover, lawn daisies, fallen petals -----------------------------

/** A flat rosette mark facing up: kind 0 clover leaf, 1 lawn daisy, 2 white clover flower, 3 fallen petal. */
function markGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const pos: number[] = [0, 0, 0];
  const uv: number[] = [0, 0];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pos.push(Math.cos(a), 0, Math.sin(a));
    uv.push(Math.cos(a), Math.sin(a));
  }
  const index: number[] = [];
  for (let i = 1; i <= steps; i++) index.push(0, i + 1, i);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

const markVertex = /* glsl */ `
attribute vec4 aOffset; // xyz, radius
attribute vec3 aKind;   // kind, rand, yaw
attribute vec2 aUv;
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vKind;
void main() {
  float c = cos(aKind.z), s = sin(aKind.z);
  vec3 p = vec3(c * position.x - s * position.z, 0.0, s * position.x + c * position.z) * aOffset.w;
  vec4 wp = vec4(aOffset.xyz + p + vec3(0.0, 0.012, 0.0), 1.0);
  vWorld = wp.xyz;
  vUv = aUv;
  vKind = aKind.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const markFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vKind;
void main() {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x);
  vec3 albedo;
  if (vKind.x < 0.5) {
    // clover: three round hearts
    float lobe = 0.62 + 0.38 * abs(cos(a * 1.5));
    if (r > lobe) discard;
    albedo = srgb(vec3(0.38, 0.6, 0.3)) * (0.9 + 0.2 * vKind.y);
    albedo = mix(albedo, srgb(vec3(0.62, 0.78, 0.5)), smoothstep(0.35, 0.5, r) * smoothstep(0.62, 0.5, r) * 0.4);
  } else if (vKind.x < 1.5) {
    // lawn daisy: white rays, gold eye, a blush at the tips
    float ray = 0.7 + 0.3 * abs(cos(a * 7.0));
    if (r > ray) discard;
    albedo = mix(srgb(vec3(0.97, 0.94, 0.89)), srgb(vec3(0.95, 0.78, 0.82)), smoothstep(0.6, 0.95, r) * 0.6);
    albedo = mix(srgb(vec3(0.96, 0.76, 0.22)), albedo, smoothstep(0.24, 0.3, r));
  } else if (vKind.x < 2.5) {
    // white clover head: a fuzzy cream ball of florets
    if (r > 0.75 + 0.25 * vnoise(vUv * 6.0)) discard;
    albedo = mix(srgb(vec3(0.97, 0.95, 0.9)), srgb(vec3(0.9, 0.82, 0.84)), vnoise(vUv * 9.0) * 0.6);
  } else {
    // a fallen petal: a soft oval, pink or cream, with a darker base
    vec2 q = vUv * vec2(1.0, 1.9);
    if (length(q) > 1.0) discard;
    vec3 pink = mix(srgb(vec3(0.96, 0.74, 0.76)), srgb(vec3(0.98, 0.94, 0.86)), step(0.5, vKind.y));
    albedo = mix(pink * 0.88, pink, smoothstep(-0.6, 0.4, vUv.x));
  }
  float sunVis = castLight(vWorld, 0.04);
  gl_FragColor = vec4(paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2), 1.0);
}
`;

export function createDetails(world: WorldUniforms, density = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'details';
  const rand = seededRandom(5);

  // tufts: gathered where the lawn meets beds, path and hedge
  const tufts = scatter(Math.round(2600 * density), 31, 'lawn', (x, z, r) => {
    const edge = Math.min(nearestBed(x, z).d, pathDistance(x, z), stoneDistance(x, z) + 0.1, edgeDistance(x, z) - 0.5);
    return r < 0.25 + 0.75 * Math.exp(-edge * 2.5) + 0.3 * Math.max(0, fbm2(x / 2, z / 2, 2));
  });
  const tOffset = new Float32Array(tufts.length * 4);
  const tSize = new Float32Array(tufts.length * 2);
  tufts.forEach(([x, z], i) => {
    tOffset.set([x, terrainHeight(x, z), z, rand() * Math.PI * 2], i * 4);
    tSize.set([0.09 + rand() * 0.1, rand()], i * 2);
  });
  const tg = tuftGeometry();
  tg.setAttribute('aOffset', new THREE.InstancedBufferAttribute(tOffset, 4));
  tg.setAttribute('aSize', new THREE.InstancedBufferAttribute(tSize, 2));
  tg.instanceCount = tufts.length;
  const tuftMesh = new THREE.Mesh(tg, new THREE.ShaderMaterial({ uniforms: world, vertexShader: tuftVertex, fragmentShader: tuftFragment, side: THREE.DoubleSide }));
  tuftMesh.frustumCulled = false;
  group.add(tuftMesh);

  // flat marks
  const marks: { x: number; z: number; r: number; kind: number }[] = [];
  for (const [x, z] of scatter(Math.round(1400 * density), 77, 'lawn', (x, z, r) => r < Math.max(0, fbm2(x / 1.8 + 11, z / 1.8, 2) + 0.05) * 3)) {
    marks.push({ x, z, r: 0.035 + rand() * 0.02, kind: rand() < 0.07 ? 2 : 0 });
  }
  for (const [x, z] of scatter(Math.round(320 * density), 91, 'lawn', (x, z, r) => r < Math.max(0, fbm2(x / 2.5 - 4, z / 2.5 + 2, 2) - 0.05) * 4)) {
    marks.push({ x, z, r: 0.03 + rand() * 0.015, kind: 1 });
  }
  for (const [x, z] of scatter(Math.round(70 * density), 13, 'gravel', () => true)) {
    marks.push({ x, z, r: 0.04 + rand() * 0.02, kind: 3 });
  }
  const mOffset = new Float32Array(marks.length * 4);
  const mKind = new Float32Array(marks.length * 3);
  marks.forEach((m, i) => {
    mOffset.set([m.x, terrainHeight(m.x, m.z), m.z, m.r], i * 4);
    mKind.set([m.kind, rand(), rand() * Math.PI * 2], i * 3);
  });
  const mg = markGeometry();
  mg.setAttribute('aOffset', new THREE.InstancedBufferAttribute(mOffset, 4));
  mg.setAttribute('aKind', new THREE.InstancedBufferAttribute(mKind, 3));
  mg.instanceCount = marks.length;
  const markMesh = new THREE.Mesh(mg, new THREE.ShaderMaterial({ uniforms: world, vertexShader: markVertex, fragmentShader: markFragment, side: THREE.DoubleSide }));
  markMesh.frustumCulled = false;
  group.add(markMesh);

  return group;
}
