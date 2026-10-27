import * as THREE from 'three';
import { TILE, terrainHeight, terrainNormal } from './garden';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { GROUND_GLSL } from './groundGlsl';
import type { WorldUniforms } from './world';

/**
 * The painted ground. Colour is laid in the way a gouache illustrator would:
 * broad washes of lawn green, dark raked beds, a pale gravel path, then
 * pigment grain and pale dry-brush flecks over everything, and a ragged
 * edge where the paint runs out onto the paper.
 */

const vertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${GROUND_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec2 xz = vWorld.xz;
  // dry-brush edge: paint thins, then breaks into specks on the paper
  float edge = paintEdge(xz);
  float cover = smoothstep(-0.05, 0.5, edge);
  if (hash12(floor(xz * 28.0)) > cover * 1.08) discard;

  float grassy, soil;
  vec3 albedo = groundPaint(xz, grassy, soil);
  // pigment grain: a fine stipple, and the odd pale fleck of dry brush
  albedo *= 0.95 + 0.1 * vnoise(xz * 30.0);
  float fleck = step(0.986, hash12(floor(xz * 13.0))) * grassy;
  albedo = mix(albedo, albedo * 1.25 + srgb(vec3(0.08, 0.07, 0.0)), fleck * 0.8);
  // rain leaves a cool sheen on the lawn
  albedo = mix(albedo, albedo * vec3(0.86, 0.92, 0.96), uWet * grassy * 0.5);

  vec3 N = normalize(vNormal);
  float sunVis = castLight(vWorld, 0.03);
  vec3 col = paintLight(albedo, N, sunVis, 1.0, 0.2);
  // where the paint thins at the edge, the paper shows through
  col = mix(uPaper, col, 0.55 + 0.45 * smoothstep(0.0, 0.7, edge));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildGeometry(): THREE.BufferGeometry {
  const step = 0.06;
  const cols = Math.round((TILE.halfX * 2) / step);
  const rows = Math.round((TILE.halfZ * 2) / step);
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const normals = new Float32Array(positions.length);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    const z = -TILE.halfZ + r * step;
    for (let c = 0; c <= cols; c++) {
      const x = -TILE.halfX + c * step;
      const [nx, ny, nz] = terrainNormal(x, z);
      positions[k] = x;
      positions[k + 1] = terrainHeight(x, z);
      positions[k + 2] = z;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
      k += 3;
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], o);
      o += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

export function createTerrain(world: WorldUniforms): THREE.Mesh {
  const material = new THREE.ShaderMaterial({ uniforms: world, vertexShader: vertex, fragmentShader: fragment });
  const mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.name = 'terrain';
  return mesh;
}
