import * as THREE from 'three';
import { BLOOM_SCALE, KINDS, type FlowerKind, type KindSpec } from './kinds';
import { sampleStem, type P2 } from './stem';
import { CENTRE, STEM_SAMPLES, createFlowerMaterials, createFlowerUniforms, stemGeometry, type FlowerMaterials, type FlowerUniforms } from './flowerMaterial';
import { growthAt, leafUnfurl, GROWN, type GrowthFrame } from './growth';
import { leafGeometry } from './leaves';
import { seededRandom, noise2 } from '../scene/noise';
import { terrainHeight } from '../scene/garden';
import { SHADOW_LAYER, setDepthMaterial } from '../engine/shadows';
import type { FlowerRecord } from '../state/document';
import type { WorldUniforms } from '../scene/world';

/**
 * One living flower. The document says what it is and where; this object
 * owns its moment-to-moment life: growing up along the stroke, opening,
 * swaying in the breeze, dipping when a bee lands, perking up when watered,
 * folding at dusk. Its bloom geometry is shared per kind; everything that
 * moves is uniforms and a few transforms.
 */

const LEAF_COLOR: Record<FlowerKind, string> = {
  sunflower: '#5f9a3d', foxglove: '#6c9a4c', rose: '#4f8a3c', daisy: '#62a046', lavender: '#8fa784', allium: '#6fa058', poppy: '#7f9f72',
};
const STEM_COLOR: Record<FlowerKind, string> = {
  sunflower: '#6a9a42', foxglove: '#6f9a4e', rose: '#557f3a', daisy: '#69a24a', lavender: '#8ba37f', allium: '#72a05a', poppy: '#7c9e6c',
};

/** Where on the bloom a bee lands, in bloom-local coordinates (spike values are fractions of the spike). */
function landingLocal(kind: FlowerKind, spikeLen: number): THREE.Vector3 {
  switch (kind) {
    case 'sunflower': return new THREE.Vector3(0, 0.1, 0);
    case 'daisy': return new THREE.Vector3(0, 0.07, 0);
    case 'poppy': return new THREE.Vector3(0, 0.1, 0);
    case 'rose': return new THREE.Vector3(0, 0.15, 0);
    case 'allium': return new THREE.Vector3(0, 0.33, 0);
    case 'lavender': return new THREE.Vector3(0, -0.2 * spikeLen, 0.05);
    case 'foxglove': return new THREE.Vector3(0, -0.6 * spikeLen, 0.12);
  }
}

export interface FlowerEnv {
  /** Wind strength multiplier (breeze action raises it). */
  wind: number;
  /** 0 noon .. 1 golden hour. */
  golden: number;
  /** Bees standing on it right now. */
  load: number;
  reducedMotion: boolean;
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class Flower {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly uniforms: FlowerUniforms;
  readonly materials: FlowerMaterials;
  readonly spec: KindSpec;
  record: FlowerRecord;
  private readonly stem: THREE.Mesh;
  private headMesh: THREE.Mesh | null = null;
  private readonly leaves: { mesh: THREE.Mesh; s: number; az: number; tilt: number; size: number }[] = [];
  private samples: P2[] = [];
  private shownHeight: number;
  private growT: number;
  private growDuration: number;
  private frame: GrowthFrame;
  /** Sway: a damped spring pushed by the wind field and by gusts. */
  private sway = { x: 0, z: 0, vx: 0, vz: 0 };
  private dip = { y: 0, v: 0 };
  private perk = { y: 0, v: 0 };
  private open: number;
  private colourFade = 1;
  private readonly fromColours = { base: new THREE.Color(), tip: new THREE.Color(), accent: new THREE.Color() };
  private readonly curve: THREE.Vector3[] = [];
  private readonly tipTangent = new THREE.Vector3(0, 1, 0);
  private pollenFired = false;
  private shadowsOn = { stem: false, head: false };
  /** Called once when the reveal throws its pollen puff (world position). */
  onPollen: ((p: THREE.Vector3) => void) | null = null;
  highlight = 0;

  constructor(record: FlowerRecord, world: WorldUniforms, opts: { grow: boolean; duration: number }) {
    this.record = record;
    this.spec = KINDS[record.kind];
    this.uniforms = createFlowerUniforms();
    this.materials = createFlowerMaterials(world, this.uniforms);
    this.root.name = `flower-${record.id}`;
    this.shownHeight = record.height;
    this.growDuration = opts.duration;
    this.growT = opts.grow ? 0 : opts.duration;
    this.frame = opts.grow ? growthAt(0, opts.duration) : GROWN;
    this.pollenFired = !opts.grow;
    this.open = record.open ? 1 : 0;

    const u = this.uniforms;
    u.uRadius.value = this.spec.stemRadius * 1.35 * (0.8 + 0.2 * record.scale);
    u.uStemColor.value.set(STEM_COLOR[record.kind]);
    u.uLeafColor.value.set(LEAF_COLOR[record.kind]);
    u.uCentre.value = CENTRE[record.kind];
    u.uSeed.value = (record.seed % 97) + 0.5;
    this.applyPalette(record.palette, true);

    for (let i = 0; i < STEM_SAMPLES; i++) this.curve.push(u.uCurve.value[i]);
    this.stem = new THREE.Mesh(stemGeometry(), this.materials.stem);
    this.stem.frustumCulled = false;
    setDepthMaterial(this.stem, this.materials.stemDepth);
    this.root.add(this.stem);
    this.root.add(this.head);
    this.buildLeaves();
    this.resample();
    this.update(0, 0, { wind: 1, golden: 0, load: 0, reducedMotion: false });
  }

  get id(): string {
    return this.record.id;
  }

  get kind(): FlowerKind {
    return this.record.kind;
  }

  get grown(): boolean {
    return this.frame.done;
  }

  /** Blooming flowers count for the colony (open, and finished growing). */
  get blooming(): boolean {
    return this.frame.bloom > 0.8 && this.open > 0.5;
  }

  setHeadGeometry(geo: THREE.BufferGeometry): void {
    if (this.headMesh) return;
    this.headMesh = new THREE.Mesh(geo, this.materials.head);
    this.headMesh.frustumCulled = false;
    setDepthMaterial(this.headMesh, this.materials.headDepth);
    this.head.add(this.headMesh);
    this.head.scale.setScalar(this.record.scale * BLOOM_SCALE);
  }

  private buildLeaves(): void {
    const rand = seededRandom(this.record.seed * 31 + 7);
    const geo = leafGeometry(this.spec.leaf);
    const basal = this.record.kind === 'foxglove' || this.record.kind === 'allium';
    const n = this.spec.leaves;
    let az = rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      az += basal ? (Math.PI * 2) / n + rand() * 0.4 : 2.4 + rand() * 0.3;
      const top = 1 - this.spec.spike - 0.12;
      const s = basal ? 0.015 + rand() * 0.02 : 0.12 + (i / Math.max(1, n - 1)) * (top - 0.12) + rand() * 0.04;
      const size = (basal ? 1.15 : 1.05 - (i / n) * 0.35) * (0.9 + rand() * 0.2);
      const mesh = new THREE.Mesh(geo, this.materials.leaf);
      mesh.layers.enable(SHADOW_LAYER);
      this.leaves.push({ mesh, s, az, tilt: basal ? 0.35 : 0.55 + rand() * 0.35, size });
      this.root.add(mesh);
    }
  }

  /** Recompute stem samples (shape or height changed). */
  private resample(): void {
    this.samples = sampleStem(this.record.stem, this.shownHeight, STEM_SAMPLES, this.spec.spike);
    // in bloom-local units: the bloom is scaled, the spike must still span the stem's top
    this.uniforms.uSpikeLen.value = (this.shownHeight * this.spec.spike) / (this.record.scale * BLOOM_SCALE);
  }

  setRecord(record: FlowerRecord): void {
    const prev = this.record;
    this.record = record;
    if (prev.palette !== record.palette) this.applyPalette(record.palette, false);
    if (prev.stem !== record.stem) this.resample();
    if (prev.scale !== record.scale) {
      this.head.scale.setScalar(record.scale * BLOOM_SCALE);
      this.resample();
    }
    // heights ease toward the new value in update()
  }

  private applyPalette(index: number, instant: boolean): void {
    const p = this.spec.palettes[index % this.spec.palettes.length];
    const u = this.uniforms;
    this.fromColours.base.copy(u.uBase.value);
    this.fromColours.tip.copy(u.uTip.value);
    this.fromColours.accent.copy(u.uAccent.value);
    this.target = { base: new THREE.Color(p.base), tip: new THREE.Color(p.tip), accent: new THREE.Color(p.accent) };
    this.colourFade = instant ? 1 : 0;
    if (instant) {
      u.uBase.value.copy(this.target.base);
      u.uTip.value.copy(this.target.tip);
      u.uAccent.value.copy(this.target.accent);
    }
  }
  private target = { base: new THREE.Color(), tip: new THREE.Color(), accent: new THREE.Color() };

  /** A push of wind (Sway action, breeze, a neighbour's gust). */
  gust(dx: number, dz: number, strength: number): void {
    this.sway.vx += dx * strength;
    this.sway.vz += dz * strength;
  }

  /** Watered: a little bounce. */
  perkUp(): void {
    this.perk.v += 2.2;
  }

  /** Replay the opening (Bloom after Close is handled by `record.open`; this restarts the reveal). */
  regrow(duration: number): void {
    this.growT = 0;
    this.growDuration = duration;
    this.pollenFired = false;
  }

  /** Fold back into the soil (k: 1 standing .. 0 gone). */
  wither(k: number): void {
    this.withering = k;
  }
  private withering: number | null = null;

  update(dt: number, time: number, env: FlowerEnv): void {
    // growth timeline
    if (this.withering !== null) {
      this.frame = growthAt(this.withering * 1.6, 1.6);
    } else if (this.growT < this.growDuration) {
      this.growT = Math.min(this.growDuration, this.growT + dt);
      this.frame = growthAt(this.growT, this.growDuration);
    }
    const f = this.frame;
    // heights ease (watering makes it grow ~10% taller)
    if (Math.abs(this.shownHeight - this.record.height) > 1e-4) {
      this.shownHeight += (this.record.height - this.shownHeight) * Math.min(1, dt * 2.5);
      this.resample();
    }
    // open / close, and a little closing at golden hour
    const openTarget = (this.record.open ? 1 : 0) * (1 - 0.4 * env.golden);
    this.open += (openTarget - this.open) * Math.min(1, dt * 2.2);
    // colour cross-fade
    if (this.colourFade < 1) {
      this.colourFade = Math.min(1, this.colourFade + dt * 1.6);
      const k = this.colourFade * this.colourFade * (3 - 2 * this.colourFade);
      this.uniforms.uBase.value.copy(this.fromColours.base).lerp(this.target.base, k);
      this.uniforms.uTip.value.copy(this.fromColours.tip).lerp(this.target.tip, k);
      this.uniforms.uAccent.value.copy(this.fromColours.accent).lerp(this.target.accent, k);
    }

    this.stepSprings(dt, time, env);
    this.layoutCurve(f.grow);
    this.layoutHead(f, env);
    this.layoutLeaves(f.grow);

    const u = this.uniforms;
    u.uGrow.value = f.grow;
    u.uBloom.value = f.bloom;
    u.uBud.value = f.bud;
    u.uOpen.value = this.open;
    u.uHighlight.value = this.highlight;
    u.uPollen.value = 0.4 + 0.6 * Math.min(1, f.bloom * 1.5);
    this.setShadows(f.stemShadow, f.headShadow);

    if (!this.pollenFired && f.pollen >= 1 && this.onPollen) {
      this.pollenFired = true;
      this.onPollen(this.landingPoint(new THREE.Vector3()));
    }
  }

  private stepSprings(dt: number, time: number, env: FlowerEnv): void {
    const h = this.shownHeight;
    const calm = env.reducedMotion ? 0.35 : 1;
    // the wind field: slow noise drifting across the garden, stronger on tall stems
    const w = env.wind * calm;
    const tx = (noise2(this.record.x * 0.15 + time * 0.25, this.record.z * 0.15) * 0.05 + 0.02) * w * h;
    const tz = noise2(this.record.z * 0.15 - time * 0.21, this.record.x * 0.15 + 9.1) * 0.035 * w * h;
    const k = 14 / Math.max(0.6, h), damp = 2.6;
    const s = this.sway;
    s.vx += ((tx - s.x) * k - s.vx * damp) * dt;
    s.vz += ((tz - s.z) * k - s.vz * damp) * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    const maxLean = 0.35 * h;
    s.x = Math.max(-maxLean, Math.min(maxLean, s.x));
    s.z = Math.max(-maxLean, Math.min(maxLean, s.z));
    // a bee's weight dips the bloom
    const dipTarget = Math.min(3, env.load) * 0.035;
    this.dip.v += ((dipTarget - this.dip.y) * 40 - this.dip.v * 7) * dt;
    this.dip.y += this.dip.v * dt;
    this.perk.v += (-this.perk.y * 60 - this.perk.v * 6) * dt;
    this.perk.y += this.perk.v * dt;
  }

  private layoutCurve(grow: number): void {
    const { x, z, heading } = this.record;
    const y0 = terrainHeight(x, z) - 0.02;
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    const n = this.samples.length;
    const top = this.samples[n - 1][1] || 1;
    const scale = 1 + this.perk.y * 0.06;
    for (let i = 0; i < n; i++) {
      const [lat, up] = this.samples[i];
      const t = up / top;
      const bend = t * t;
      const c = this.curve[i];
      c.set(x + rx * lat + this.sway.x * bend, y0 + up * scale - this.dip.y * bend, z + rz * lat + this.sway.z * bend);
    }
    // tip and its direction at the current growth
    const g = Math.max(0.02, grow) * (n - 1);
    const i0 = Math.min(n - 2, Math.floor(g));
    const fr = g - i0;
    this.tipPos.copy(this.curve[i0]).lerp(this.curve[i0 + 1], fr);
    const back = this.curve[Math.max(0, i0 - 1)];
    this.tipTangent.copy(this.curve[i0 + 1]).sub(back).normalize();
  }
  private readonly tipPos = new THREE.Vector3();

  private layoutHead(f: GrowthFrame, env: FlowerEnv): void {
    this.head.position.copy(this.tipPos);
    // the bloom follows the stem, and turns a little toward the viewer (and the light)
    const up = tmpV.copy(this.tipTangent);
    if (this.spec.spike <= 0) {
      up.lerp(UP, 0.35);
      up.z += Math.tan(this.spec.faceTilt) * (1 - 0.5 * env.golden);
      up.x -= Math.tan(this.spec.faceTilt) * 0.25 * env.golden;
    }
    up.normalize();
    this.head.quaternion.setFromUnitVectors(UP, up);
    tmpQ.setFromAxisAngle(UP, (this.record.seed % 628) / 100);
    this.head.quaternion.multiply(tmpQ);
    this.head.visible = f.grow > 0.15;
    this.head.updateMatrixWorld(true);
  }

  private layoutLeaves(grow: number): void {
    const n = this.curve.length;
    const sc = this.record.scale * BLOOM_SCALE;
    for (const leaf of this.leaves) {
      const g = leaf.s * (n - 1);
      const i0 = Math.min(n - 2, Math.floor(g));
      const p = tmpV.copy(this.curve[i0]).lerp(this.curve[i0 + 1], g - i0);
      leaf.mesh.position.copy(p);
      const unfurl = leafUnfurl(leaf.s, grow);
      leaf.mesh.visible = unfurl > 0.01;
      leaf.mesh.scale.setScalar(Math.max(0.001, unfurl * leaf.size * sc));
      // leaves fan out from folded-up to their resting angle as they unfurl
      leaf.mesh.rotation.set(0, leaf.az, leaf.tilt * unfurl + (1 - unfurl) * 1.3, 'YXZ');
    }
  }

  private setShadows(stem: boolean, head: boolean): void {
    if (stem !== this.shadowsOn.stem) {
      this.shadowsOn.stem = stem;
      if (stem) this.stem.layers.enable(SHADOW_LAYER);
      else this.stem.layers.disable(SHADOW_LAYER);
    }
    if (head !== this.shadowsOn.head && this.headMesh) {
      this.shadowsOn.head = head;
      if (head) this.headMesh.layers.enable(SHADOW_LAYER);
      else this.headMesh.layers.disable(SHADOW_LAYER);
    }
  }

  // --- queries ---------------------------------------------------------------

  /** Where a bee lands: on the bloom, moving with it as it sways and dips. */
  landingPoint(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(landingLocal(this.record.kind, this.uniforms.uSpikeLen.value)).applyMatrix4(this.head.matrixWorld);
  }

  /** The bloom's up direction (bees land along it). */
  bloomUp(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(UP).applyQuaternion(this.head.quaternion);
  }

  /** A resting place on the biggest visible leaf (bees groom there). */
  leafPoint(target: THREE.Vector3): THREE.Vector3 {
    const leaf = this.leaves.find((l) => l.mesh.visible) ?? this.leaves[0];
    if (!leaf) return this.landingPoint(target);
    leaf.mesh.updateMatrixWorld();
    return target.set(0.5 * 0.24, 0.0, 0).applyMatrix4(leaf.mesh.matrixWorld);
  }

  headCentre(target: THREE.Vector3): THREE.Vector3 {
    const lift = this.spec.spike > 0 ? -this.uniforms.uSpikeLen.value * 0.5 : this.spec.headHeight * 0.5;
    return target.set(0, lift, 0).applyMatrix4(this.head.matrixWorld);
  }

  /** The stem samples in world space (bees avoid them; tests check stem shape). */
  stemPoints(): readonly THREE.Vector3[] {
    return this.curve;
  }

  get height(): number {
    return this.shownHeight;
  }

  bounds(target = new THREE.Box3()): THREE.Box3 {
    target.makeEmpty();
    for (const c of this.curve) target.expandByPoint(c);
    const r = this.spec.headRadius * this.record.scale * BLOOM_SCALE;
    const hc = this.headCentre(tmpV);
    target.expandByPoint(hc.clone().addScalar(r));
    target.expandByPoint(hc.clone().addScalar(-r));
    return target;
  }

  dispose(): void {
    this.stem.geometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
    this.root.removeFromParent();
  }
}
