/**
 * A tiny geometry builder for blooms. Petals are modelled, not cards: each is
 * a parametric surface — length u, across v — with a width profile, a cup
 * across its width, a curl along its length, and an optional ruffled edge.
 *
 * Petals are written in their own frame (base at the hinge, running out
 * along +x, face up +y). Where each one sits on the bloom, and how far it is
 * tilted open, is kept in per-vertex attributes so the vertex shader can open
 * and close every petal independently — that is how a bud unfolds petal by
 * petal, and how flowers close at dusk.
 */

/** Per-vertex attribute layout (see headVertex in flowerMaterial.ts). */
export const PART = { petal: 0, centre: 1, floret: 2, sepal: 3, stamen: 4, bell: 5 } as const;

export interface Placement {
  /** Rotation about the bloom's vertical axis. */
  azimuth: number;
  /** 0..1: when this piece opens during the bloom (0 first). */
  order: number;
  /** Elevation of the petal when fully open / fully closed (radians; π/2 = straight up). */
  openTilt: number;
  closedTilt: number;
  /** Hinge: distance out from the axis and height. */
  r0: number;
  y0: number;
  part: number;
  /** 1 when y0 is a fraction of the flowering spike's length (measured down from the tip). */
  spike?: number;
}

export interface PetalShape {
  length: number;
  /** Half width at the widest point. */
  width: number;
  /** Where along the petal it is widest (0..1). */
  widest?: number;
  /** 'round' tips are elliptical; 'point' tips taper to a point. */
  tip?: 'round' | 'point';
  /** Edges lift by cup × v² × width. */
  cup?: number;
  /** Bend along the length, radians over the whole petal (+ up, − reflexed). */
  curl?: number;
  ruffle?: number;
  seed?: number;
  nu?: number;
  nv?: number;
}

export class BloomBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly petal: number[] = [];
  readonly hinge: number[] = [];
  readonly index: number[] = [];

  private get count(): number {
    return this.position.length / 3;
  }

  private pushVertex(p: [number, number, number], n: [number, number, number], u: number, v: number, at: Placement): void {
    this.position.push(...p);
    this.normal.push(...n);
    this.uv.push(u, v);
    this.petal.push(at.azimuth, at.order, at.openTilt, at.closedTilt);
    this.hinge.push(at.r0, at.y0, at.part, at.spike ?? 0);
  }

  /** A parametric surface s(u, v), u∈[0,1], v∈[-1,1], meshed nu × nv. */
  surface(nu: number, nv: number, s: (u: number, v: number) => [number, number, number], at: Placement, flipNormals = false): void {
    const start = this.count;
    const e = 1e-3;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      for (let j = 0; j <= nv; j++) {
        const v = (j / nv) * 2 - 1;
        const p = s(u, v);
        const pu = s(Math.min(1, u + e), v), pu0 = s(Math.max(0, u - e), v);
        const pv = s(u, Math.min(1, v + e)), pv0 = s(u, Math.max(-1, v - e));
        const du = [pu[0] - pu0[0], pu[1] - pu0[1], pu[2] - pu0[2]];
        const dv = [pv[0] - pv0[0], pv[1] - pv0[1], pv[2] - pv0[2]];
        // normal = dv × du (faces +y for a flat petal running along +x)
        let nx = dv[1] * du[2] - dv[2] * du[1];
        let ny = dv[2] * du[0] - dv[0] * du[2];
        let nz = dv[0] * du[1] - dv[1] * du[0];
        const len = Math.hypot(nx, ny, nz) || 1;
        const k = flipNormals ? -1 : 1;
        nx = (nx / len) * k; ny = (ny / len) * k; nz = (nz / len) * k;
        if (!Number.isFinite(nx + ny + nz) || len < 1e-12) { nx = 0; ny = k; nz = 0; }
        this.pushVertex(p, [nx, ny, nz], u, v, at);
      }
    }
    const row = nv + 1;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = start + i * row + j;
        this.index.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    }
  }

  petalSurface(shape: PetalShape, at: Placement): void {
    const { length: L, width: W } = shape;
    const widest = shape.widest ?? 0.5;
    const cup = shape.cup ?? 0;
    const curl = shape.curl ?? 0;
    const ruffle = shape.ruffle ?? 0;
    const seed = shape.seed ?? 0;
    const pw = Math.log(0.5) / Math.log(Math.max(0.05, Math.min(0.95, widest)));
    const half = (u: number) => {
      const t = Math.pow(u, pw);
      const w = shape.tip === 'point' ? Math.sin(Math.PI * t) : Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      // a narrow claw where the petal joins the flower
      return W * w * (0.55 + 0.45 * Math.min(1, u * 5));
    };
    this.surface(Math.round((shape.nu ?? 9) * 1.4), Math.round((shape.nv ?? 6) * 1.3), (u, v) => {
      // bend along the length: integrate the curl angle analytically
      const a = curl * u;
      const x = curl === 0 ? u * L : (Math.sin(a) / curl) * L;
      let y = curl === 0 ? 0 : ((1 - Math.cos(a)) / curl) * L;
      const w = half(u);
      y += cup * v * v * w;
      y += ruffle * W * Math.sin(v * 5.5 + u * 7 + seed) * u * u * Math.abs(v);
      return [x, y, v * w];
    }, at);
  }

  /** A flared tube along +x (foxglove bells), open at the far end. */
  bell(length: number, r0: number, r1: number, at: Placement): void {
    const radius = (u: number) => r0 + (r1 - r0) * Math.pow(u, 1.6) + (u > 0.85 ? (u - 0.85) * r1 * 1.6 : 0);
    this.surface(8, 12, (u, v) => {
      const a = v * Math.PI;
      const r = radius(u);
      // the lower lip juts out further, like a foxglove's landing lip
      const lip = Math.max(0, -Math.cos(a)) * u ** 3 * length * 0.18;
      return [u * length + lip, Math.cos(a) * r, Math.sin(a) * r];
    }, at, true);
  }

  /** A low dome (flower centres, seed pods) of radius r and height h, faced +y. */
  dome(r: number, h: number, at: Placement, rings = 8, segs = 28): void {
    this.surface(rings, segs, (u, v) => {
      const a = v * Math.PI;
      const rr = r * u;
      const y = h * Math.pow(Math.max(0, 1 - u * u), 0.6);
      return [Math.cos(a) * rr, y, Math.sin(a) * rr];
    }, at, true);
  }

  /** A ball (allium heart, buds). */
  ball(r: number, at: Placement, cy = 0): void {
    this.surface(10, 16, (u, v) => {
      const th = u * Math.PI, a = v * Math.PI;
      return [Math.sin(th) * Math.cos(a) * r, cy + Math.cos(th) * r, Math.sin(th) * Math.sin(a) * r];
    }, at, true);
  }

  arrays() {
    return {
      position: new Float32Array(this.position),
      normal: new Float32Array(this.normal),
      aUv: new Float32Array(this.uv),
      aPetal: new Float32Array(this.petal),
      aHinge: new Float32Array(this.hinge),
      index: new Uint32Array(this.index),
    };
  }
}

export type BloomArrays = ReturnType<BloomBuilder['arrays']>;
