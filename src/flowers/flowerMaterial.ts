import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';

/**
 * Flower paint. Three shaders share the painted light ramp:
 *  - the stem, which is generated entirely on the GPU from a curve of
 *    points (so it can grow along your stroke and sway without rebuilding),
 *  - the bloom, whose petals tilt open one by one (with a little overshoot)
 *    and are painted in with MEADOW-style brush strokes — green bud first,
 *    then flat colour, then light and shade,
 *  - leaves.
 * Each has a depth twin so shadows follow the motion.
 */

export const STEM_SAMPLES = 24;
export const STEM_RINGS = 40;
export const STEM_SIDES = 6;

export const CENTRE = { sunflower: 0, daisy: 1, poppy: 2, rose: 3, allium: 4, lavender: 5, foxglove: 6 } as const;

const COMMON = /* glsl */ `
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
vec3 selectGlow(vec3 N, vec3 V, float h) {
  return vec3(0.12, 0.3, 0.75) * h * pow(1.0 - max(dot(N, V), 0.0), 2.0) * 0.7;
}
`;

// --- stem ---------------------------------------------------------------------

export function stemGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const stem: number[] = [];
  const index: number[] = [];
  for (let r = 0; r <= STEM_RINGS; r++) {
    for (let k = 0; k <= STEM_SIDES; k++) stem.push(r / STEM_RINGS, (k / STEM_SIDES) * Math.PI * 2);
  }
  // a cap vertex ring at the tip collapses to a point
  const row = STEM_SIDES + 1;
  for (let r = 0; r < STEM_RINGS; r++) {
    for (let k = 0; k < STEM_SIDES; k++) {
      const a = r * row + k;
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  geo.setAttribute('aStem', new THREE.Float32BufferAttribute(stem, 2));
  // three.js needs a position attribute to count vertices; the shader ignores it
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(stem.length * 1.5), 3));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geo;
}

const stemVertex = /* glsl */ `
attribute vec2 aStem; // s along 0..1, angle around
uniform vec3 uCurve[${STEM_SAMPLES}];
uniform float uGrow;
uniform float uRadius;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vS;
varying float vAround;
vec3 curveAt(float s) {
  float f = clamp(s, 0.0, 1.0) * ${(STEM_SAMPLES - 1).toFixed(1)};
  int i = int(min(floor(f), ${(STEM_SAMPLES - 2).toFixed(1)}));
  return mix(uCurve[i], uCurve[i + 1], f - float(i));
}
void main() {
  float s = min(aStem.x, uGrow);
  vec3 c = curveAt(s);
  vec3 t = normalize(curveAt(s + 0.02) - curveAt(s - 0.02) + vec3(0.0, 1e-4, 0.0));
  vec3 side = normalize(cross(t, abs(t.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 up = cross(side, t);
  vec3 n = side * cos(aStem.y) + up * sin(aStem.y);
  // tapering toward the top, and to a soft point at the growing tip
  float tip = smoothstep(0.0, 0.05, uGrow - aStem.x + 0.0001) * step(aStem.x, uGrow + 0.0001);
  float r = uRadius * (1.0 - 0.4 * s) * mix(0.0, 1.0, tip);
  if (aStem.x > uGrow) r = 0.0;
  vec3 wp = c + n * r;
  vWorld = wp;
  vNormalW = n;
  vS = s;
  vAround = aStem.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const stemFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${COMMON}
uniform vec3 uStemColor;
uniform float uHighlight;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vS;
varying float vAround;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  // darker and warmer at the base, fresher toward the bloom, with a painted stroke down its length
  vec3 albedo = uStemColor * mix(vec3(0.78, 0.8, 0.7), vec3(1.08, 1.06, 0.95), smoothstep(0.0, 0.8, vS));
  albedo *= 0.93 + 0.12 * vnoise(vec2(vAround * 2.0, vS * 30.0));
  float sunVis = castLightFast(vWorld, 0.04);
  vec3 col = paintLight(albedo, N, sunVis, 1.0, 0.3);
  col += selectGlow(N, V, uHighlight) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

// --- bloom --------------------------------------------------------------------

const headVertex = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aPetal;  // azimuth, order, openTilt, closedTilt
attribute vec4 aHinge;  // r0, y0, part, spike
uniform float uBloom;   // 0..1 the opening timeline
uniform float uOpen;    // 1 open .. 0 folded (Close, dusk)
uniform float uBud;     // bud swell 0..1
uniform float uSpikeLen;
uniform float uTime;
varying vec2 vUv;
varying float vPart;
varying float vPaint;
varying float vOrder;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;

float backOut(float t) {
  float x = t - 1.0;
  return 1.0 + 2.4 * x * x * x + 1.4 * x * x;
}

vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

void main() {
  float part = aHinge.z;
  float order = aPetal.y;
  float local = clamp((uBloom - 0.18 - order * 0.5) / 0.32, 0.0, 1.0);
  float o = backOut(local);
  vPaint = clamp((uBloom - 0.2 - order * 0.5) / 0.3, 0.0, 1.0);
  float openness = o * uOpen;
  // sepals part first, as the bud breaks
  if (part > 2.5 && part < 3.5) openness = smoothstep(0.05, 0.4, uBloom) * mix(0.6, 1.0, uOpen);
  float tilt = mix(aPetal.w, aPetal.z, openness);
  vec3 p = position;
  vec3 n = normal;
  // florets, bells and stamens grow out of nothing at their hinge
  bool grows = (part > 1.5 && part < 2.5) || part > 3.5;
  if (grows) {
    float g = backOut(local);
    p *= max(0.001, g);
    if (part > 4.5) tilt = mix(aPetal.w, aPetal.z, smoothstep(0.0, 1.0, local) * uOpen);
  }
  // a breath of flutter at the petal tips
  p.y += sin(uTime * 2.3 + aPetal.x * 5.0 + order * 9.0) * 0.004 * aUv.x * step(part, 0.5);
  p = rotZ(p, tilt);
  n = rotZ(n, tilt);
  float y0 = aHinge.w > 0.5 ? -aHinge.y * uSpikeLen : aHinge.y;
  p += vec3(aHinge.x, y0, 0.0);
  p = rotY(p, aPetal.x);
  n = rotY(n, aPetal.x);
  // the bud swells before it breaks (spikes keep their length; their florets grow instead)
  float bud = aHinge.w > 0.5 ? 1.0 : mix(0.3, 1.0, uBud);
  p *= bud;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vLocal = p;
  vNormalW = normalize(mat3(modelMatrix) * n);
  vUv = aUv;
  vPart = part;
  vOrder = order;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const headFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${COMMON}
uniform vec3 uBase;
uniform vec3 uTip;
uniform vec3 uAccent;
uniform vec3 uLeafColor;
uniform float uCentre;
uniform float uHighlight;
uniform float uSeed;
uniform float uPollen;
uniform float uBloom;
uniform float uGloss;
varying vec2 vUv;
varying float vPart;
varying float vPaint;
varying float vOrder;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;

vec3 centrePaint(float u, float a) {
  if (uCentre < 0.5) {
    // sunflower: seeds in crossing spirals, a ring of golden florets at the rim, pollen on top
    float r = u;
    float s1 = sin(a * 21.0 * 3.1416 + r * 46.0);
    float s2 = sin(-a * 34.0 * 3.1416 + r * 46.0);
    float seeds = smoothstep(-0.2, 0.7, s1 * s2);
    vec3 c = mix(uAccent * 0.65, uAccent * 1.25, seeds);
    c = mix(c, srgb(vec3(0.42, 0.3, 0.12)), smoothstep(0.25, 0.0, r) * 0.6);
    c = mix(c, uBase * 0.9, smoothstep(0.72, 0.9, r));
    return c;
  }
  if (uCentre < 1.5) {
    float dots = smoothstep(0.3, 0.8, vnoise(vec2(a * 9.0, u * 9.0) + uSeed));
    vec3 c = mix(uAccent * 0.85, uAccent * 1.12, dots);
    return mix(c, c * vec3(0.92, 1.0, 0.75), smoothstep(0.35, 0.0, u) * 0.5);
  }
  if (uCentre < 2.5) {
    // poppy pod: grey-green, with the dark rays of its stigma on the lid
    vec3 c = srgb(vec3(0.55, 0.62, 0.48));
    float ray = smoothstep(0.6, 0.95, abs(cos(a * 3.1416 * 4.0))) * smoothstep(0.75, 0.2, u);
    return mix(c, uAccent, ray * 0.85);
  }
  if (uCentre < 3.5) return uAccent;
  return mix(uAccent, uBase, 0.4);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (dot(N, V) < 0.0) N = -N;
  float u = vUv.x, v = vUv.y;
  vec3 budGreen = uLeafColor * vec3(1.05, 1.05, 0.9);
  vec3 albedo;
  float paint = 1.0;
  float ao = 1.0;
  float front = 0.0;

  if (vPart < 0.5 || (vPart > 1.5 && vPart < 2.5) || vPart > 4.5) {
    // petals, florets and bells: deeper at the heart, paler to the tip
    vec3 col = mix(uBase, uTip, smoothstep(0.05, 0.95, u));
    // painted veins, fading out toward the tip
    float veins = smoothstep(0.08, 0.0, abs(fract(v * 3.5 + 0.5) - 0.5)) * (1.0 - u) * step(vPart, 0.5);
    col *= 1.0 - veins * 0.16;
    if (uCentre > 1.5 && uCentre < 2.5) {
      // poppy: a dark satin blotch at the base of each petal
      float blotch = smoothstep(0.24, 0.16, u + (vnoise(vec2(v * 6.0, u * 4.0) + uSeed) - 0.5) * 0.08);
      col = mix(col, uAccent, blotch * 0.92);
    } else if (uCentre > 2.5 && uCentre < 3.5) {
      col = mix(uAccent, col, smoothstep(0.0, 0.45, u));
    } else if (uCentre > 5.5) {
      // foxglove: freckles inside the throat, toward the lip
      vec2 sc = vec2(u * 9.0, v * 6.0);
      float spot = step(0.6, hash12(floor(sc) + uSeed)) * smoothstep(0.38, 0.18, length(fract(sc) - 0.5)) * smoothstep(0.3, 0.6, u) * smoothstep(0.98, 0.8, u);
      col = mix(col, uAccent, spot * 0.85);
      col = mix(col * 0.82, col, smoothstep(0.0, 0.5, u));
    } else if (uCentre < 0.5) {
      col = mix(col * vec3(0.95, 0.82, 0.75), col, smoothstep(0.0, 0.3, u));
    }
    // brush strokes laid from the heart of the petal to its tip
    float stroke = vnoise(vec2(v * 2.2 + vOrder * 31.0, u * 1.5)) * 0.6 + vnoise(vec2(v * 7.0, u * 4.0 + vOrder * 7.0)) * 0.4;
    float gap = vPaint * 1.3 - (u * 0.85 + stroke * 0.4);
    paint = step(0.0, gap);
    front = 1.0 - smoothstep(0.0, 0.14, gap);
    albedo = mix(budGreen, col, paint);
    ao = mix(0.72, 1.0, smoothstep(0.0, 0.35, u));
  } else if (vPart < 1.5) {
    albedo = centrePaint(u, v);
    // pollen: soft gold specks that brighten as the flower ripens
    vec2 cell = vLocal.xz * 140.0;
    float speck = step(0.82, hash12(floor(cell))) * smoothstep(0.42, 0.2, length(fract(cell) - 0.5)) * uPollen;
    albedo = mix(albedo, srgb(vec3(1.0, 0.86, 0.38)), speck * 0.7);
    albedo = mix(budGreen * 0.9, albedo, smoothstep(0.15, 0.45, uBloom));
    ao = mix(0.75, 1.0, u);
  } else if (vPart < 3.5) {
    albedo = uLeafColor * (0.85 + 0.2 * u);
  } else {
    // stamens: dark filaments with pollen-dusted tips
    albedo = mix(uAccent, srgb(vec3(0.95, 0.8, 0.35)) * 0.8, smoothstep(0.6, 1.0, u) * uPollen);
  }
  albedo *= 0.95 + 0.08 * vnoise(vLocal.xz * 90.0 + uSeed);

  float sunVis = castLight(vWorld, 0.06);
  // petals take the shade gently: a soft cool grey-lavender, never purple
  float ndl = dot(N, uSunDir);
  float form = smoothstep(-0.45, 0.45, ndl) * sunVis;
  vec3 petalShade = mix(uShadeColor, vec3(0.93, 0.92, 0.95), 0.45) * mix(0.85, 1.0, ao);
  vec3 lit = albedo * mix(petalShade, uSunColor * (0.96 + 0.1 * smoothstep(0.5, 1.0, ndl)), form);
  // petals glow when the sun shines through them
  float through = max(dot(-N, uSunDir), 0.0) * sunVis;
  lit += albedo * uSunColor * through * 0.3 * step(vPart, 0.5);
  // after rain: glossy highlights
  vec3 H = normalize(uSunDir + V);
  lit += uSunColor * smoothstep(0.9, 0.99, dot(N, H)) * (uWet * 0.5 + uGloss) * sunVis;
  vec3 flatPaint = albedo * mix(vec3(1.0), petalShade, 0.3);
  vec3 col = mix(flatPaint, lit, smoothstep(0.35, 1.0, vPaint) * 0.7 + 0.3);
  col = mix(col, col * 0.84, front * 0.7);
  col += selectGlow(N, V, uHighlight);
  gl_FragColor = vec4(col, 1.0);
}
`;

// --- leaves -------------------------------------------------------------------

const leafVertex = /* glsl */ `
attribute vec2 aUv;
uniform float uTime;
uniform float uWind;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 p = position;
  p.y += sin(uTime * 1.7 + modelMatrix[3].x * 3.0 + modelMatrix[3].z * 2.0) * 0.02 * aUv.x * aUv.x * uWind;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vUv = aUv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const leafFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${COMMON}
uniform vec3 uLeafColor;
uniform float uHighlight;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  bool under = dot(N, V) < 0.0;
  if (under) N = -N;
  float u = vUv.x, v = vUv.y;
  vec3 albedo = uLeafColor * (0.9 + 0.18 * u);
  // a paler midrib and a few side veins, painted with one stroke each
  float rib = smoothstep(0.1, 0.0, abs(v)) * (1.0 - u * 0.6);
  float side = smoothstep(0.07, 0.0, abs(fract(u * 5.0 - abs(v) * 1.6) - 0.5)) * smoothstep(0.1, 0.3, abs(v)) * 0.6;
  albedo = mix(albedo, albedo * vec3(1.25, 1.2, 1.05), max(rib, side) * 0.45);
  if (under) albedo *= vec3(1.05, 1.08, 1.12) * 0.92;
  albedo *= 0.94 + 0.1 * vnoise(vUv * vec2(8.0, 4.0));
  float sunVis = castLightFast(vWorld, 0.05);
  vec3 col = paintLight(albedo, N, sunVis, mix(0.8, 1.0, u), 0.3);
  col += albedo * uSunColor * max(dot(-N, uSunDir), 0.0) * 0.2 * sunVis;
  col += uSunColor * smoothstep(0.9, 0.99, dot(N, normalize(uSunDir + V))) * uWet * 0.4 * sunVis;
  col += selectGlow(N, V, uHighlight) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

const depthFragment = /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`;

export interface FlowerUniforms {
  [name: string]: THREE.IUniform;
  uCurve: THREE.IUniform<THREE.Vector3[]>;
  uGrow: THREE.IUniform<number>;
  uRadius: THREE.IUniform<number>;
  uStemColor: THREE.IUniform<THREE.Color>;
  uLeafColor: THREE.IUniform<THREE.Color>;
  uBloom: THREE.IUniform<number>;
  uOpen: THREE.IUniform<number>;
  uBud: THREE.IUniform<number>;
  uSpikeLen: THREE.IUniform<number>;
  uBase: THREE.IUniform<THREE.Color>;
  uTip: THREE.IUniform<THREE.Color>;
  uAccent: THREE.IUniform<THREE.Color>;
  uCentre: THREE.IUniform<number>;
  uHighlight: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
  uPollen: THREE.IUniform<number>;
  uGloss: THREE.IUniform<number>;
}

export function createFlowerUniforms(): FlowerUniforms {
  return {
    uCurve: { value: Array.from({ length: STEM_SAMPLES }, () => new THREE.Vector3()) },
    uGrow: { value: 0 },
    uRadius: { value: 0.03 },
    uStemColor: { value: new THREE.Color('#5d9440') },
    uLeafColor: { value: new THREE.Color('#5e9a3e') },
    uBloom: { value: 0 },
    uOpen: { value: 1 },
    uBud: { value: 0 },
    uSpikeLen: { value: 0.4 },
    uBase: { value: new THREE.Color('#ffffff') },
    uTip: { value: new THREE.Color('#ffffff') },
    uAccent: { value: new THREE.Color('#333333') },
    uCentre: { value: 0 },
    uHighlight: { value: 0 },
    uSeed: { value: 0 },
    uPollen: { value: 1 },
    uGloss: { value: 0 },
  };
}

export interface FlowerMaterials {
  stem: THREE.ShaderMaterial;
  stemDepth: THREE.ShaderMaterial;
  head: THREE.ShaderMaterial;
  headDepth: THREE.ShaderMaterial;
  leaf: THREE.ShaderMaterial;
}

export function createFlowerMaterials(world: WorldUniforms, flower: FlowerUniforms): FlowerMaterials {
  const uniforms = { ...world, ...flower };
  const mat = (vertexShader: string, fragmentShader: string, side: THREE.Side = THREE.FrontSide) =>
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side });
  return {
    stem: mat(stemVertex, stemFragment),
    stemDepth: mat(stemVertex, depthFragment),
    head: mat(headVertex, headFragment, THREE.DoubleSide),
    headDepth: mat(headVertex, depthFragment, THREE.DoubleSide),
    leaf: mat(leafVertex, leafFragment, THREE.DoubleSide),
  };
}
