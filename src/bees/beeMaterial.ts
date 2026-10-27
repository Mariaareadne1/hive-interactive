import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';

/**
 * Bee paint: honey-gold fuzz with soft charcoal bands, a dark head, big
 * friendly eyes with a catchlight, legs that gather gold pollen, and wings —
 * crisp, veined, translucent cream at rest; a soft shimmering blur in flight.
 */

const bodyVertex = /* glsl */ `
attribute float aAO;
attribute float aPart;
attribute vec4 aBee;      // pollen, highlight, legs out (0..1), seed
uniform float uTime;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAO;
varying float vPart;
varying vec4 vBee;
void main() {
  vec3 p = position;
  // antennae bob; legs tuck under in flight and reach down to land
  if (aPart > 2.5 && aPart < 3.5) {
    float bob = sin(uTime * 7.0 + aBee.w * 11.0 + sign(p.z) * 0.6) * 0.03 * max(0.0, p.x - 0.44);
    p.y += bob * 3.0;
  }
  if (aPart > 3.5) {
    float tuck = 1.0 - aBee.z;
    p.y += tuck * (-p.y - 0.1) * 0.55;
    p.x -= tuck * 0.06 * (-p.y - 0.1);
  }
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#else
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
#endif
  vLocal = position;
  vWorld = wp.xyz;
  vAO = aAO;
  vPart = aPart;
  vBee = aBee;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const bodyFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAO;
varying float vPart;
varying vec4 vBee;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 gold = srgb(vec3(0.96, 0.72, 0.26));
  vec3 charcoal = srgb(vec3(0.24, 0.2, 0.2));
  vec3 albedo;
  float x = vLocal.x;
  if (vPart < 0.5) {
    // soft bands round the abdomen, a fuzzy gold collar on the thorax, a charcoal tail tip
    float bands = smoothstep(0.25, 0.45, sin((x + 0.03) * 26.0 + (vnoise(vLocal.yz * 20.0) - 0.5) * 0.8));
    albedo = mix(gold, charcoal, bands * step(x, -0.06) * smoothstep(-0.52, -0.46, x));
    albedo = mix(albedo, charcoal, smoothstep(-0.46, -0.52, x));
    albedo = mix(albedo, srgb(vec3(0.98, 0.8, 0.36)), smoothstep(-0.02, 0.06, x) * 0.6);
    albedo *= 0.92 + 0.14 * vnoise(vLocal.xz * 70.0 + vBee.w);
  } else if (vPart < 1.5) {
    albedo = charcoal * 1.15;
    // a faint golden blush of fuzz on the face
    albedo = mix(albedo, gold * 0.7, smoothstep(0.42, 0.47, x) * 0.4);
  } else if (vPart < 2.5) {
    albedo = srgb(vec3(0.07, 0.06, 0.07));
  } else if (vPart < 3.5) {
    albedo = charcoal * 0.9;
  } else {
    // legs, dusted with gold as the bee forages
    albedo = mix(charcoal, srgb(vec3(1.0, 0.82, 0.3)), vBee.x * smoothstep(-0.12, -0.25, vLocal.y));
  }
  float sunVis = castLightFast(vWorld, 0.02);
  float ndl = dot(N, uSunDir);
  float lit = smoothstep(-0.4, 0.5, ndl) * sunVis;
  vec3 shade = mix(uShadeColor, vec3(0.9, 0.88, 0.92), 0.35) * mix(0.75, 1.0, vAO);
  vec3 col = albedo * mix(shade, uSunColor * 1.04, lit);
  // fuzz glows at the rim where the sun catches it
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  col += albedo * rim * 0.35 * max(ndl, 0.0) * step(vPart, 1.5);
  if (vPart > 1.5 && vPart < 2.5) {
    // a bright catchlight, so the eyes read as friendly even when tiny
    vec3 H = normalize(uSunDir + V + vec3(0.0, 0.4, 0.0));
    col += vec3(1.0) * smoothstep(0.82, 0.92, dot(N, H)) * 0.9;
    col += vec3(0.35, 0.33, 0.4) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.4;
  }
  col += vec3(0.12, 0.3, 0.75) * vBee.y * rim * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** A flat wing, hinge at the origin, reaching out along +z, trailing back along -x. */
export function wingGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(-0.25, 0, 0.5);
  return g;
}

const wingVertex = /* glsl */ `
attribute vec2 aWing; // blur, highlight
varying vec2 vUv2;
varying float vBlur;
varying vec3 vWorld;
void main() {
  vUv2 = vec2(position.x + 0.25, position.z);  // x: -0.5..0.5 along body, y: 0..1 out
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
#endif
  vWorld = wp.xyz;
  vBlur = aWing.x;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const wingFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
varying vec2 vUv2;
varying float vBlur;
varying vec3 vWorld;
void main() {
  vec2 q = vUv2;
  // crisp wing: a long oval, slightly swept back, with a few painted veins
  vec2 e = vec2((q.x + q.y * 0.35) / 0.32, (q.y - 0.5) / 0.5);
  float wing = 1.0 - smoothstep(0.92, 1.0, length(e));
  float veins = smoothstep(0.05, 0.0, abs(fract(e.x * 1.6 + e.y * 0.8) - 0.5)) * wing;
  // flight blur: a soft fan with streaks across the beat
  float r = length(vec2(q.x * 1.4, q.y));
  float fan = (1.0 - smoothstep(0.7, 1.0, r)) * smoothstep(0.0, 0.15, q.y);
  float streak = 0.75 + 0.25 * sin(atan(q.x, q.y) * 24.0 + uTime * 40.0);
  float a = mix(wing * (0.55 + 0.25 * veins), fan * streak * 0.3, vBlur);
  if (a < 0.01) discard;
  vec3 cream = vec3(0.97, 0.95, 0.9);
  vec3 col = mix(cream, vec3(0.8, 0.82, 0.92), veins * 0.5 * (1.0 - vBlur));
  col = mix(col, col * uSunColor * 1.1, 0.5);
  gl_FragColor = vec4(col, a);
}
`;

export function createBeeMaterials(world: WorldUniforms) {
  const body = new THREE.ShaderMaterial({ uniforms: world, vertexShader: bodyVertex, fragmentShader: bodyFragment });
  const wing = new THREE.ShaderMaterial({
    uniforms: world,
    vertexShader: wingVertex,
    fragmentShader: wingFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { body, wing };
}
