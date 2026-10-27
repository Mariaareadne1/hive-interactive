import { BEDS, HEDGE, PATH_END_Z, PATH_HALF_WIDTH, STONES, TILE, APRON_RADIUS } from './garden';

/**
 * GLSL twin of garden.ts — the painted ground shared by the terrain and by
 * every little detail that takes its colour from the ground under it. The
 * layout numbers are written in from the TypeScript data so the two can
 * never disagree.
 */

const f = (n: number) => n.toFixed(4);

const bedFns = BEDS.map((b, i) => `
float bed${i}(vec2 p) {
  vec2 d = p - vec2(${f(b.x)}, ${f(b.z)});
  float c = ${f(Math.cos(b.rot))}, s = ${f(Math.sin(b.rot))};
  vec2 l = abs(vec2(c * d.x + s * d.y, -s * d.x + c * d.y));
  vec2 q = l - vec2(${f(b.hx - b.r)}, ${f(b.hz - b.r)});
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ${f(b.r)};
}
vec2 bedLocal${i}(vec2 p) {
  vec2 d = p - vec2(${f(b.x)}, ${f(b.z)});
  float c = ${f(Math.cos(b.rot))}, s = ${f(Math.sin(b.rot))};
  return vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
}`).join('\n');

const bedPick = BEDS.map((_, i) => `  { float d = bed${i}(p); if (d < best) { best = d; local = bedLocal${i}(p); } }`).join('\n');

const stoneSum = STONES.map((s) => {
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  return `  { vec2 d = p - vec2(${f(s.x)}, ${f(s.z)}); vec2 l = vec2(${f(c)} * d.x + ${f(sn)} * d.y, ${f(-sn)} * d.x + ${f(c)} * d.y) / vec2(${f(s.rx)}, ${f(s.rz)}); best = min(best, (length(l) - 1.0) * ${f(Math.min(s.rx, s.rz))}); }`;
}).join('\n');

export const GROUND_GLSL = /* glsl */ `
const float HALF_X = ${f(TILE.halfX)};
const float HALF_Z = ${f(TILE.halfZ)};
const float PATH_HW = ${f(PATH_HALF_WIDTH)};
const float PATH_END = ${f(PATH_END_Z)};
const float APRON_R = ${f(APRON_RADIUS)};
uniform vec2 uHive;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float pathX(float z) { return -3.75 + 0.54 * z + 0.5 * sin(z * 0.55 + 0.6); }
float pathDist(vec2 p) { return max(abs(p.x - pathX(p.y)) - PATH_HW, PATH_END - p.y); }
float apronDist(vec2 p) { return length(p - uHive) - APRON_R; }
float hedgeZ(float x) { return -6.55 + 0.12 * sin(x * 0.4); }
float hedgeDist(vec2 p) {
  float along = max(max(${f(HEDGE.x0)} - p.x, p.x - ${f(HEDGE.x1)}), 0.0);
  float across = abs(p.y - hedgeZ(clamp(p.x, ${f(HEDGE.x0)}, ${f(HEDGE.x1)}))) - ${f(HEDGE.halfDepth)};
  return along > 0.0 ? length(vec2(along, max(across, 0.0))) : across;
}
float stoneDist(vec2 p) {
  float best = 9.0;
${stoneSum}
  return best;
}
${bedFns}
/** Nearest bed: distance, and the point in that bed's own frame (for raking). */
float bedDist(vec2 p, out vec2 local) {
  float best = 99.0;
  local = vec2(0.0);
${bedPick}
  return best;
}

vec3 lawnPaint(vec2 xz) {
  // fresh greens laid in broad, slightly uneven washes
  float wash = fbm2lite(xz * 0.11 + 4.0);
  vec3 c = mix(srgb(vec3(0.52, 0.71, 0.32)), srgb(vec3(0.64, 0.77, 0.35)), smoothstep(0.3, 0.75, wash));
  // warm light pooling across the lawn, like a glaze
  float glow = fbm2lite(xz * 0.09 - 2.0);
  c = mix(c, c * vec3(1.1, 1.08, 0.9) + srgb(vec3(0.06, 0.05, 0.0)), smoothstep(0.5, 0.8, glow) * 0.6);
  // the faint stripes of a lawn mown a few days ago
  float stripe = smoothstep(0.35, 0.65, abs(fract(xz.x * 0.36 + vnoise(xz * 0.3) * 0.25) - 0.5) * 2.0);
  c *= 0.97 + 0.05 * stripe;
  // long dry-brush strokes
  float stroke = vnoise(vec2(xz.x * 0.7, xz.y * 7.5)) * 0.65 + vnoise(vec2(xz.x * 2.0, xz.y * 17.0)) * 0.35;
  c *= 0.93 + 0.13 * stroke;
  // clover patches: a cooler, deeper green
  float clover = smoothstep(0.6, 0.72, vnoise(xz * 0.55 + 11.0));
  c = mix(c, c * vec3(0.9, 0.95, 0.93), clover * 0.5);
  return c;
}

vec3 soilPaint(vec2 xz, vec2 local, float d) {
  vec3 soil = mix(srgb(vec3(0.47, 0.32, 0.22)), srgb(vec3(0.58, 0.42, 0.29)), smoothstep(0.25, 0.75, fbm2lite(xz * 0.45)));
  // warm light pooling in the loam
  soil = mix(soil, soil * vec3(1.12, 1.06, 0.95), smoothstep(0.5, 0.8, fbm2lite(xz * 0.2 + 3.0)) * 0.6);
  // raked lines along the bed's length, each furrow a little wavering
  float rake = sin((local.y + (vnoise(local * vec2(0.6, 2.0)) - 0.5) * 0.3) * 19.0);
  soil *= 0.86 + 0.16 * smoothstep(-0.2, 0.8, rake);
  soil = mix(soil, soil * vec3(1.3, 1.22, 1.12), smoothstep(0.82, 1.0, rake) * 0.55 * vnoise(local * vec2(0.9, 3.0) + 2.0));
  // long dry-brush drags across the furrows
  soil *= 0.94 + 0.1 * vnoise(vec2(local.x * 0.8, local.y * 9.0));
  // crumbs: dark clods and pale grit
  vec2 cc = xz * 26.0;
  float crumb = hash12(floor(cc));
  float round_ = smoothstep(0.45, 0.25, length(fract(cc) - 0.5));
  soil *= 1.0 + round_ * (crumb > 0.9 ? -0.28 : (crumb < 0.06 ? 0.26 : 0.0));
  // a darker cut edge where the soil drops away from the lawn
  soil *= 1.0 - 0.3 * smoothstep(-0.16, 0.0, d);
  soil = mix(soil, soil * vec3(1.15, 1.1, 1.0), smoothstep(-0.3, -0.18, d) * smoothstep(-0.08, -0.18, d) * 0.5);
  // rain darkens and enriches it
  soil = mix(soil, soil * vec3(0.62, 0.58, 0.6), uWet * 0.85);
  return soil;
}

vec3 gravelPaint(vec2 xz) {
  vec3 g = srgb(vec3(0.86, 0.82, 0.73));
  // pebbles: each little cell its own warm or cool grey
  vec2 cell = floor(xz * 11.0);
  float h = hash12(cell);
  g *= 0.9 + 0.16 * h;
  g = mix(g, g * vec3(0.95, 0.97, 1.04), step(0.7, hash12(cell + 7.0)) * 0.6);
  float dark = step(0.94, hash12(floor(xz * 23.0)));
  g *= 1.0 - dark * 0.3;
  g *= 0.95 + 0.08 * vnoise(xz * 3.0);
  return mix(g, g * 0.82, uWet * 0.6);
}

/** The garden's base paint at a point, before light. grassy = 1 on the lawn. soil = 1 in a bed. */
vec3 groundPaint(vec2 xz, out float grassy, out float soil) {
  vec3 c = lawnPaint(xz);
  grassy = 1.0;
  soil = 0.0;

  // shade under the hedge: deeper green where its roots are
  float hd = hedgeDist(xz);
  c = mix(c, srgb(vec3(0.28, 0.46, 0.24)), (1.0 - smoothstep(-0.2, 0.35, hd)) * 0.8);

  // beds
  vec2 local;
  float bd = bedDist(xz, local) + (vnoise(xz * 2.4) - 0.5) * 0.08;
  float inBed = 1.0 - smoothstep(-0.03, 0.03, bd);
  // the lawn is edged with a spade: a thin pale line of cut turf
  c = mix(c, c * vec3(1.12, 1.1, 0.95), smoothstep(0.12, 0.0, abs(bd - 0.05)) * 0.5);
  c = mix(c, soilPaint(xz, local, bd), inBed);
  grassy *= 1.0 - inBed;
  soil = inBed;

  // gravel: the path and the hive's apron, with ragged edges
  float gd = min(pathDist(xz), apronDist(xz)) + (vnoise(xz * 3.1) - 0.5) * 0.09;
  float onGravel = 1.0 - smoothstep(-0.04, 0.05, gd);
  c = mix(c, gravelPaint(xz), onGravel);
  c *= 1.0 - smoothstep(0.1, 0.0, abs(gd)) * 0.12;
  grassy *= 1.0 - onGravel;

  // a soft contact shadow ring painted under each stepping stone
  float sd = stoneDist(xz);
  c *= 1.0 - 0.22 * smoothstep(0.12, 0.0, sd) * step(-0.02, sd);
  return c;
}

/** Signed distance inside the tile's rounded edge, roughened like dry-brush paint. */
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(HALF_X, HALF_Z) + 0.9;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.9;
  float rough = (vnoise(xz * 1.1) - 0.5) * 0.45 + (vnoise(xz * 4.0) - 0.5) * 0.22;
  return -box + rough;
}
`;
