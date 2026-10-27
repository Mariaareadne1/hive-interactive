import * as THREE from 'three';
import { MAX_BEES, type Bee, type Colony, type HiveSite } from './colony';
import { createBeeMaterials, wingGeometry } from './beeMaterial';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from '../scene/world';

/**
 * Draws the colony: one instanced draw for every bee's fuzzy body and one
 * for all their wings. The simulation decides where bees are; this decides
 * how they look doing it — bobbing flight, a lean into turns, a wiggle in
 * the petals, the waggle on the board, a squeeze through the doorway.
 */

export const BEE_SIZE = 0.3;
/** Height of the body's centre above whatever it stands on (world m). */
const STAND = 0.3 * BEE_SIZE;
const HINGE = new THREE.Vector3(0.1, 0.17, 0.075);

const FLYING = new Set(['wander', 'approach', 'home', 'swarm', 'herd', 'takeoff']);
const STANDING = new Set(['forage', 'dance', 'rest', 'peek']);

interface Look {
  yaw: number;
  pitch: number;
  bank: number;
}

export class BeeRenderer {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh | null = null;
  private readonly wings: THREE.InstancedMesh;
  private readonly beeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BEES * 4), 4);
  private readonly wingAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BEES * 2 * 2), 2);
  private readonly looks = new Map<number, Look>();
  private readonly mats: ReturnType<typeof createBeeMaterials>;
  /** Where each bee was drawn this frame (for picking, overlays and trails). */
  readonly drawn = new Map<number, THREE.Vector3>();
  selectedId: number | null = null;
  hoverId: number | null = null;
  reducedMotion = false;

  constructor(world: WorldUniforms) {
    this.group.name = 'bees';
    this.mats = createBeeMaterials(world);
    const wg = wingGeometry();
    wg.setAttribute('aWing', this.wingAttr);
    this.wings = new THREE.InstancedMesh(wg, this.mats.wing, MAX_BEES * 2);
    this.wings.frustumCulled = false;
    this.wings.count = 0;
    this.wings.renderOrder = 2;
    this.group.add(this.wings);
  }

  setGeometry(geo: THREE.BufferGeometry): void {
    geo.setAttribute('aBee', this.beeAttr);
    this.body = new THREE.InstancedMesh(geo, this.mats.body, MAX_BEES);
    this.body.frustumCulled = false;
    this.body.count = 0;
    this.body.layers.enable(SHADOW_LAYER);
    this.group.add(this.body);
  }

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly wm = new THREE.Matrix4();
  private readonly hingeM = new THREE.Matrix4();

  update(colony: Colony, hive: HiveSite, flowerUp: (id: string) => THREE.Vector3 | null, time: number, dt: number): void {
    const body = this.body;
    let n = 0;
    let w = 0;
    this.drawn.clear();
    const calm = this.reducedMotion ? 0.5 : 1;
    for (const bee of colony.bees) {
      if (bee.state === 'inside') {
        this.looks.delete(bee.id);
        continue;
      }
      const look = this.looks.get(bee.id) ?? { yaw: Math.atan2(-hive.out.z, hive.out.x), pitch: 0, bank: 0 };
      this.looks.set(bee.id, look);
      const flying = FLYING.has(bee.state) || (bee.state === 'emerge' && bee.t > 0.25) || (bee.state === 'land' && bee.t < bee.span * 0.8);
      const standing = STANDING.has(bee.state) || (bee.state === 'land' && !flying) || (bee.state === 'emerge' && !flying);
      this.p.copy(bee.pos);
      this.up.set(0, 1, 0);
      let size = BEE_SIZE;

      if (flying) {
        const speed = bee.vel.length();
        if (speed > 0.15) {
          const yaw = Math.atan2(-bee.vel.z, bee.vel.x);
          let dy = yaw - look.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          look.yaw += dy * Math.min(1, dt * 8);
          look.bank += (Math.max(-0.6, Math.min(0.6, -dy * 3)) - look.bank) * Math.min(1, dt * 5);
          look.pitch += (Math.max(-0.5, Math.min(0.5, bee.vel.y / speed)) - look.pitch) * Math.min(1, dt * 5);
        }
        // the gentle bob of a bumbling flight
        this.p.y += Math.sin(time * 7 * calm + bee.id * 1.3) * 0.035 * calm;
      } else {
        look.bank *= 0.8;
        look.pitch *= 0.8;
      }
      if (bee.state === 'forage' || bee.state === 'land') {
        const up = bee.flower ? flowerUp(bee.flower) : null;
        if (up) this.up.copy(up);
        this.p.addScaledVector(this.up, STAND);
        // a busy little wiggle in the petals
        look.yaw += Math.sin(time * 9 + bee.id) * 0.04 * calm;
      } else if (standing) {
        this.p.y += STAND;
      }
      if (bee.state === 'dance') {
        const k = bee.t / bee.span;
        const a = ((k * 2) % 1) * Math.PI * 2;
        const side = Math.atan2(-hive.out.z, hive.out.x) + Math.PI / 2;
        look.yaw = side + (Math.cos(a) > 0 ? 0 : Math.PI) + Math.sin(time * 26) * 0.35 * calm;
      }
      if (bee.state === 'emerge' || bee.state === 'enter' || bee.state === 'peek') {
        // squeeze through the doorway: small inside it, full size once out
        const d = bee.pos.distanceTo(hive.entrance);
        size *= 0.45 + 0.55 * Math.min(1, d / 0.25);
        if (bee.state === 'peek') look.yaw = Math.atan2(-hive.out.z, hive.out.x) + Math.sin(time * 2.2) * 0.6;
        if (bee.state === 'enter') look.yaw = Math.atan2(hive.out.z, -hive.out.x);
      }

      this.e.set(look.bank, look.yaw, look.pitch, 'YZX');
      this.q.setFromEuler(this.e);
      if (this.up.y < 0.999) this.q.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.up));
      if (bee.state === 'rest') {
        // grooming: the head dips and the front lifts, twice a second
        this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(time * 12) * 0.12 * calm));
      }
      this.s.setScalar(size);
      this.m.compose(this.p, this.q, this.s);
      this.drawn.set(bee.id, this.p.clone());
      if (!body || n >= MAX_BEES) continue;
      body.setMatrixAt(n, this.m);
      const legs = flying ? (bee.state === 'approach' ? 0.3 : 0) : 1;
      const hl = bee.id === this.selectedId ? 1 : bee.id === this.hoverId ? 0.45 : 0;
      this.beeAttr.setXYZW(n, bee.pollen, hl, legs, bee.id % 13);
      n++;

      // wings: a shimmering blur in flight, folded back and crisp at rest
      for (const side of [1, -1]) {
        if (w >= MAX_BEES * 2) break;
        const flap = Math.sin(time * 60 + bee.id + side) * 0.25;
        const yaw = flying ? 0.35 : 1.15;
        const lift = flying ? 0.35 + flap : 0.12;
        this.hingeM.makeTranslation(HINGE.x, HINGE.y, HINGE.z * side);
        this.wm.makeRotationFromEuler(new THREE.Euler(lift * side, yaw * side, 0, 'YXZ'));
        this.hingeM.multiply(this.wm);
        this.wm.makeScale(flying ? 0.75 : 0.58, 1, (flying ? 0.75 : 0.58) * side);
        this.hingeM.multiply(this.wm);
        this.wm.copy(this.m).multiply(this.hingeM);
        this.wings.setMatrixAt(w, this.wm);
        this.wingAttr.setXY(w, flying ? 1 : 0, hl);
        w++;
      }
    }
    if (body) {
      body.count = n;
      body.instanceMatrix.needsUpdate = true;
      this.beeAttr.needsUpdate = true;
    }
    this.wings.count = w;
    this.wings.instanceMatrix.needsUpdate = true;
    this.wingAttr.needsUpdate = true;
  }

  /** The bee drawn nearest a screen point (within a generous radius), or null. */
  pick(clientX: number, clientY: number, camera: THREE.Camera, rect: DOMRect): number | null {
    let best: number | null = null;
    let bestD = 22;
    const v = new THREE.Vector3();
    for (const [id, p] of this.drawn) {
      v.copy(p).project(camera);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(clientX - sx, clientY - sy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  dispose(): void {
    this.body?.dispose();
    this.wings.dispose();
    this.mats.body.dispose();
    this.mats.wing.dispose();
  }
}

export type { Bee };
