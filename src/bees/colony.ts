import * as THREE from 'three';
import { seededRandom } from '../scene/noise';
import { arrive, resolve, steer, type Obstacles } from './flight';
import { TILE, terrainHeight } from '../scene/garden';
import { WANDER_LANES, wanderOffset } from './wander';

/**
 * The colony: a small emergent simulation, deterministic for a seed and a
 * fixed timestep. Each bee runs a little state machine —
 *
 *   inside → emerge → wander → approach → land → forage → takeoff
 *        ↑                                                  ↓
 *        └──────── enter ← dance (if the flower was rich) ← home
 *
 * plus the moments you can ask for: rest on a leaf, herd toward the pointer,
 * visit a flower, swarm over the hive, peek out of an empty garden. Flowers
 * keep their own nectar, which bees drink and which slowly refills; bees
 * carry it home as pollen and the hive's honey rises.
 */

export type BeeState =
  | 'inside' | 'emerge' | 'wander' | 'approach' | 'land' | 'forage' | 'takeoff'
  | 'home' | 'dance' | 'enter' | 'peek' | 'rest' | 'swarm' | 'herd';

export const BEE_STATES: readonly BeeState[] = ['inside', 'emerge', 'wander', 'approach', 'land', 'forage', 'takeoff', 'home', 'dance', 'enter', 'peek', 'rest', 'swarm', 'herd'];

/** What the colony needs to know about a flower this step. */
export interface FlowerSite {
  id: string;
  blooming: boolean;
  landing: THREE.Vector3;
  up: THREE.Vector3;
  /** A leaf to rest on. */
  leaf: THREE.Vector3;
}

export interface HiveSite {
  entrance: THREE.Vector3;
  board: THREE.Vector3;
  /** Unit vector out of the doorway. */
  out: THREE.Vector3;
}

export interface World {
  flowers: readonly FlowerSite[];
  hive: HiveSite;
  obstacles: Obstacles;
}

export interface Bee {
  readonly id: number;
  state: BeeState;
  /** Time in the current state. */
  t: number;
  /** How long the current state lasts (for timed states). */
  span: number;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  /** Where flight states are heading. */
  readonly goal: THREE.Vector3;
  /** Start point of a scripted move (land, enter, emerge). */
  readonly from: THREE.Vector3;
  flower: string | null;
  pollen: number;
  /** Nectar the flower had when the bee arrived: rich flowers earn a dance. */
  richness: number;
  visits: number;
  readonly visited: Set<string>;
  lane: number;
  /** A request from the user that overrides choice (visit, rest, dance, home). */
  order: { kind: 'visit'; flower: string } | { kind: 'rest' } | { kind: 'dance' } | { kind: 'home' } | null;
  /** Leaving the colony for good once inside (the garden shrank). */
  retiring: boolean;
  /** Seconds left of a slow, lazy drift (Calm). */
  calm: number;
}

export const MAX_BEES = 14;
export const STEP = 1 / 60;
const CRUISE = 1.7;
const MARGIN = 0.12;
const FLY_MIN = 0.35;
const FLY_MAX = 3.2;
const FORAGE_RATE = 0.22;
const NECTAR_REFILL = 0.035;

export function desiredBees(blooming: number): number {
  return blooming <= 0 ? 0 : Math.min(MAX_BEES, Math.ceil(blooming / 1.5));
}

export class Colony {
  readonly bees: Bee[] = [];
  readonly nectar = new Map<string, number>();
  honey = 0;
  awake = true;
  /** Rain: everyone shelters until it stops. */
  sheltering = false;
  swarmTime = 0;
  calmTime = 0;
  herdPoint: THREE.Vector3 | null = null;
  time = 0;
  private readonly rand: () => number;
  private nextId = 1;
  private spawnCooldown = 0;
  private peekTimer = 4;
  private accum = 0;
  /** Fired when a bee delivers to the hive (for the honey jar). */
  onDeliver: ((amount: number) => void) | null = null;
  /** Fired when a bee settles on a flower (for pollen puffs). */
  onLand: ((bee: Bee) => void) | null = null;
  slow = 1;

  constructor(readonly seed = 1) {
    this.rand = seededRandom(seed);
  }

  /** Advance by real time in fixed steps (deterministic for a given dt sequence). */
  advance(dt: number, world: World): void {
    this.accum = Math.min(this.accum + dt, 0.25);
    while (this.accum >= STEP) {
      this.accum -= STEP;
      this.step(STEP, world);
    }
  }

  step(dt: number, world: World): void {
    this.time += dt;
    this.swarmTime = Math.max(0, this.swarmTime - dt);
    this.calmTime = Math.max(0, this.calmTime - dt);
    for (const f of world.flowers) {
      const n = this.nectar.get(f.id) ?? 1;
      this.nectar.set(f.id, Math.min(1, n + NECTAR_REFILL * dt));
    }
    for (const id of [...this.nectar.keys()]) if (!world.flowers.some((f) => f.id === id)) this.nectar.delete(id);
    this.population(dt, world);
    for (const bee of this.bees) this.think(bee, dt, world);
    this.separate(dt);
    for (let i = this.bees.length - 1; i >= 0; i--) {
      const b = this.bees[i];
      if (b.state === 'inside' && b.retiring && b.t > 0.2) this.bees.splice(i, 1);
    }
  }

  // --- population ---------------------------------------------------------

  private population(dt: number, world: World): void {
    const blooming = world.flowers.filter((f) => f.blooming).length;
    const quiet = !this.awake || this.sheltering;
    const want = quiet ? 0 : this.swarmTime > 0 ? MAX_BEES : desiredBees(blooming);
    const out = this.bees.filter((b) => b.state !== 'inside' && !b.retiring).length;
    this.spawnCooldown -= dt;
    if (out < want && this.spawnCooldown <= 0) {
      const sleeper = this.bees.find((b) => b.state === 'inside' && !b.retiring && b.t > b.span);
      if (sleeper) this.enter(sleeper, 'emerge', world);
      else if (this.bees.length < MAX_BEES) this.spawn(world);
      this.spawnCooldown = this.swarmTime > 0 ? 0.12 : 0.55;
    }
    if (out > want) {
      // send the extras home, a few at a time
      const extra = this.bees.filter((b) => !b.retiring && b.state !== 'inside' && b.state !== 'enter' && b.state !== 'home');
      for (const b of extra.slice(0, out - want)) {
        if (quiet || b.state !== 'forage') {
          b.retiring = !quiet;
          b.order = { kind: 'home' };
          if (b.state !== 'land' && b.state !== 'forage') this.enter(b, 'home', world);
        }
      }
    }
    // an empty garden: one bee peeks out now and then, and goes back in
    if (want === 0 && this.awake && !this.sheltering) {
      this.peekTimer -= dt;
      if (this.peekTimer <= 0 && !this.bees.some((b) => b.state === 'peek')) {
        this.peekTimer = 7 + this.rand() * 4;
        const b = this.bees.find((x) => x.state === 'inside') ?? (this.bees.length < MAX_BEES ? this.spawn(world, false) : null);
        if (b) this.enter(b, 'peek', world);
      }
    }
  }

  private spawn(world: World, emerge = true): Bee {
    const bee: Bee = {
      id: this.nextId++,
      state: 'inside',
      t: 0,
      span: 0,
      pos: world.hive.entrance.clone(),
      vel: new THREE.Vector3(),
      goal: new THREE.Vector3(),
      from: new THREE.Vector3(),
      flower: null,
      pollen: 0,
      richness: 0,
      visits: 0,
      visited: new Set(),
      lane: Math.floor(this.rand() * WANDER_LANES),
      order: null,
      retiring: false,
      calm: 0,
    };
    this.bees.push(bee);
    if (emerge) this.enter(bee, 'emerge', world);
    return bee;
  }

  // --- state machine -----------------------------------------------------------

  private enter(bee: Bee, state: BeeState, world: World): void {
    bee.state = state;
    bee.t = 0;
    bee.from.copy(bee.pos);
    const { hive } = world;
    switch (state) {
      case 'inside':
        bee.span = 1.5 + this.rand() * 2.5;
        bee.vel.set(0, 0, 0);
        bee.pos.copy(hive.entrance);
        if (bee.pollen > 0) {
          const gift = bee.pollen * 0.04;
          this.honey = Math.min(1.5, this.honey + gift);
          this.onDeliver?.(gift);
          bee.pollen = 0;
        }
        bee.visits = 0;
        bee.visited.clear();
        break;
      case 'emerge':
      case 'peek':
        bee.pos.copy(hive.entrance);
        bee.from.copy(hive.entrance);
        bee.goal.copy(hive.board).addScaledVector(hive.out, 0.25).add(new THREE.Vector3(0, state === 'peek' ? 0.06 : 0.35, 0));
        bee.span = state === 'peek' ? 3.2 : 0.8;
        break;
      case 'wander':
        bee.span = 1.2 + this.rand() * 2.2;
        this.pickWaypoint(bee);
        break;
      case 'approach':
        bee.span = 12;
        break;
      case 'land':
        bee.span = 0.7;
        break;
      case 'forage':
        bee.span = 2.6 + this.rand() * 2;
        bee.vel.set(0, 0, 0);
        this.onLand?.(bee);
        break;
      case 'takeoff':
        bee.span = 0.5;
        break;
      case 'home':
        bee.span = 20;
        break;
      case 'dance':
        bee.span = 2.8;
        bee.vel.set(0, 0, 0);
        break;
      case 'enter':
        bee.span = 0.55;
        break;
      case 'rest':
        bee.span = 6;
        break;
      case 'swarm':
        bee.span = Math.max(0.5, this.swarmTime);
        break;
      case 'herd':
        bee.span = 1e9;
        break;
    }
  }

  private pickWaypoint(bee: Bee): void {
    const m = 1.2;
    const x = (this.rand() * 2 - 1) * (TILE.halfX - m);
    const z = (this.rand() * 2 - 1) * (TILE.halfZ - m);
    bee.goal.set(x, terrainHeight(x, z) + 0.9 + this.rand() * 1.2, z);
  }

  /** Choose a flower: rich in nectar, near, not already crowded, preferably new to this bee. */
  chooseFlower(bee: Bee, world: World): FlowerSite | null {
    let total = 0;
    const weights: [FlowerSite, number][] = [];
    for (const f of world.flowers) {
      if (!f.blooming) continue;
      const nectar = this.nectar.get(f.id) ?? 1;
      if (nectar < 0.12) continue;
      const crowd = this.bees.filter((b) => b !== bee && b.flower === f.id && b.state !== 'home').length;
      if (crowd >= 2) continue;
      const d = bee.pos.distanceTo(f.landing);
      const w = nectar ** 1.5 * (bee.visited.has(f.id) ? 0.4 : 1) * (crowd ? 0.35 : 1) / (1 + d * 0.3);
      weights.push([f, w]);
      total += w;
    }
    if (total <= 0) return null;
    let r = this.rand() * total;
    for (const [f, w] of weights) {
      r -= w;
      if (r <= 0) return f;
    }
    return weights[weights.length - 1][0];
  }

  private site(world: World, id: string | null): FlowerSite | undefined {
    return id ? world.flowers.find((f) => f.id === id) : undefined;
  }

  private readonly desired = new THREE.Vector3();
  private readonly push = new THREE.Vector3();
  private readonly hover = new THREE.Vector3();

  private think(bee: Bee, dt: number, world: World): void {
    bee.t += dt;
    const { hive } = world;
    bee.calm = this.calmTime;
    const pace = (this.calmTime > 0 ? 0.45 : 1) * this.slow;
    // shelter and sleep override everything airborne
    if ((this.sheltering || !this.awake) && !['inside', 'enter', 'home', 'dance'].includes(bee.state)) {
      bee.order = { kind: 'home' };
      if (bee.state !== 'land' || bee.t > 0.3) this.enter(bee, 'home', world);
    }
    if (this.swarmTime > 0 && ['wander', 'approach', 'takeoff', 'emerge', 'rest', 'forage', 'herd'].includes(bee.state) && bee.order === null) {
      bee.flower = null;
      this.enter(bee, 'swarm', world);
    }

    switch (bee.state) {
      case 'inside':
        break;

      case 'emerge':
      case 'peek': {
        const k = Math.min(1, bee.t / 0.8);
        const e = k * k * (3 - 2 * k);
        if (bee.state === 'peek' && bee.t > bee.span - 0.8) {
          // back in again
          const back = Math.min(1, (bee.t - (bee.span - 0.8)) / 0.8);
          bee.pos.copy(bee.goal).lerp(hive.entrance, back * back);
        } else bee.pos.copy(bee.from).lerp(bee.goal, e);
        if (bee.t >= bee.span) this.enter(bee, bee.state === 'peek' ? 'inside' : 'wander', world);
        break;
      }

      case 'wander': {
        if (bee.pos.distanceTo(bee.goal) < 0.5) this.pickWaypoint(bee);
        this.fly(bee, bee.goal, CRUISE * 0.75 * pace, dt, world, null);
        if (bee.t >= bee.span) {
          if (bee.order?.kind === 'home') this.enter(bee, 'home', world);
          else if (bee.pollen >= 0.85 || bee.visits >= 3) this.enter(bee, 'home', world);
          else {
            const f = this.chooseFlower(bee, world);
            if (f) {
              bee.flower = f.id;
              this.enter(bee, 'approach', world);
            } else this.enter(bee, 'wander', world);
          }
        }
        break;
      }

      case 'approach': {
        const f = this.site(world, bee.flower);
        if (!f || !f.blooming) {
          bee.flower = null;
          this.enter(bee, 'wander', world);
          break;
        }
        this.hover.copy(f.landing).addScaledVector(f.up, 0.45);
        this.fly(bee, this.hover, CRUISE * pace, dt, world, bee.flower, 1.2);
        if (bee.pos.distanceTo(this.hover) < 0.12) {
          bee.richness = this.nectar.get(f.id) ?? 1;
          this.enter(bee, 'land', world);
        } else if (bee.t > bee.span) this.enter(bee, 'wander', world);
        break;
      }

      case 'land': {
        const f = this.site(world, bee.flower);
        if (!f) { this.enter(bee, 'takeoff', world); break; }
        const k = Math.min(1, bee.t / bee.span);
        const e = 1 - (1 - k) ** 3;
        this.hover.copy(f.landing).addScaledVector(f.up, 0.45);
        bee.pos.copy(this.hover).lerp(f.landing, e);
        bee.vel.set(0, 0, 0);
        if (k >= 1) this.enter(bee, 'forage', world);
        break;
      }

      case 'forage': {
        const f = this.site(world, bee.flower);
        if (!f) { this.enter(bee, 'takeoff', world); break; }
        bee.pos.copy(f.landing);
        const n = this.nectar.get(f.id) ?? 0;
        const sip = Math.min(n, FORAGE_RATE * dt);
        this.nectar.set(f.id, n - sip);
        bee.pollen = Math.min(1, bee.pollen + sip * 1.6);
        if (bee.t >= bee.span || (n <= 0.02 && bee.t > 1)) {
          bee.visits++;
          bee.visited.add(f.id);
          this.enter(bee, 'takeoff', world);
        }
        break;
      }

      case 'takeoff': {
        const f = this.site(world, bee.flower);
        const up = f?.up ?? new THREE.Vector3(0, 1, 0);
        bee.vel.copy(up).multiplyScalar(0.9).add(new THREE.Vector3(0, 0.5, 0));
        bee.pos.addScaledVector(bee.vel, dt);
        if (bee.t >= bee.span) {
          const order = bee.order;
          bee.flower = null;
          if (order?.kind === 'home' || order?.kind === 'dance' || bee.pollen >= 0.85 || bee.visits >= 3) this.enter(bee, 'home', world);
          else if (order?.kind === 'visit') {
            bee.flower = order.flower;
            bee.order = null;
            this.enter(bee, 'approach', world);
          } else this.enter(bee, 'wander', world);
        }
        break;
      }

      case 'home': {
        bee.flower = null;
        this.hover.copy(hive.board).addScaledVector(hive.out, 0.35).add(new THREE.Vector3(0, 0.3, 0));
        this.fly(bee, this.hover, CRUISE * pace, dt, world, 'hive', 1.0);
        if (bee.pos.distanceTo(this.hover) < 0.12) {
          const dance = bee.order?.kind === 'dance' || (bee.richness > 0.6 && bee.pollen > 0.3 && !bee.retiring);
          this.enter(bee, dance && this.awake && !this.sheltering ? 'dance' : 'enter', world);
        }
        break;
      }

      case 'dance': {
        // a waggle dance on the landing board: a figure-eight with a wiggling straight run
        const k = bee.t / bee.span;
        const s = (k * 2) % 1;
        const loop = k < 0.5 ? 1 : -1;
        const a = s * Math.PI * 2;
        const side = new THREE.Vector3(-hive.out.z, 0, hive.out.x);
        const along = Math.sin(a) * 0.09;
        const across = loop * (1 - Math.cos(a)) * 0.06;
        bee.pos.copy(hive.board).addScaledVector(side, along).addScaledVector(hive.out, across - 0.02).add(new THREE.Vector3(0, 0.05, 0));
        if (k < 0.08) bee.pos.lerp(bee.from, 1 - k / 0.08);
        if (bee.t >= bee.span) {
          if (bee.order?.kind === 'dance') bee.order = null;
          this.enter(bee, 'enter', world);
        }
        break;
      }

      case 'enter': {
        const k = Math.min(1, bee.t / bee.span);
        bee.pos.copy(bee.from).lerp(hive.entrance, k * k);
        if (k >= 1) {
          if (bee.order?.kind === 'home') bee.order = null;
          this.enter(bee, 'inside', world);
          if (!bee.retiring) bee.span = Math.max(bee.span, 2.5);
        }
        break;
      }

      case 'rest': {
        const f = this.site(world, bee.flower);
        if (!f) { this.enter(bee, 'wander', world); break; }
        if (bee.t < 0.9) {
          this.hover.copy(f.leaf).add(new THREE.Vector3(0, 0.05, 0));
          bee.pos.lerp(this.hover, 1 - Math.exp(-6 * dt));
        } else bee.pos.copy(f.leaf).add(new THREE.Vector3(0, 0.05, 0));
        bee.vel.set(0, 0, 0);
        if (bee.t >= bee.span) {
          bee.order = null;
          bee.flower = null;
          this.enter(bee, 'wander', world);
        }
        break;
      }

      case 'swarm': {
        // a joyful cloud of loop-de-loops above the hive
        const phase = bee.id * 1.7;
        const w = 1.6 + (bee.id % 3) * 0.25;
        const a = this.time * w + phase;
        const R = 1.1 + (bee.id % 4) * 0.22;
        this.hover.set(
          hive.board.x - hive.out.x * 0.9 + Math.cos(a) * R,
          hive.board.y + 2.1 + Math.sin(a * 2 + phase) * 0.45 + Math.sin(a * 0.5) * 0.3,
          hive.board.z - hive.out.z * 0.9 + Math.sin(a) * R,
        );
        this.fly(bee, this.hover, CRUISE * 1.5, dt, world, null, 0.3, 6);
        if (this.swarmTime <= 0) this.enter(bee, 'wander', world);
        break;
      }

      case 'herd': {
        if (!this.herdPoint) { this.enter(bee, 'wander', world); break; }
        this.fly(bee, this.herdPoint, CRUISE * 1.1, dt, world, null, 0.6);
        break;
      }
    }
  }

  /** Steered flight toward goal, clear of everything solid except `ignore`. */
  private fly(bee: Bee, goal: THREE.Vector3, speed: number, dt: number, world: World, ignore: string | null, slow = 0.8, agility = 3.5): void {
    arrive(bee.pos, goal, speed, slow, this.desired);
    // a meandering, unhurried line: each bee has its own wander lane
    if (this.desired.lengthSq() > 0.01) wanderOffset(bee.lane, this.time, this.desired, speed * 0.45);
    resolve(bee.pos, world.obstacles, MARGIN, ignore, this.push);
    this.desired.addScaledVector(this.push, speed * 1.4);
    steer(bee.vel, this.desired, agility, dt);
    bee.pos.addScaledVector(bee.vel, dt);
    // hard limits: never inside anything, never into the ground, never off the page
    resolve(bee.pos, world.obstacles, MARGIN, ignore, this.push);
    const ground = terrainHeight(bee.pos.x, bee.pos.z);
    const near = bee.pos.distanceTo(goal) < 0.6;
    bee.pos.y = Math.min(ground + FLY_MAX, Math.max(ground + (near ? 0.12 : FLY_MIN), bee.pos.y));
    bee.pos.x = Math.max(-TILE.halfX + 0.4, Math.min(TILE.halfX - 0.4, bee.pos.x));
    bee.pos.z = Math.max(-TILE.halfZ + 0.4, Math.min(TILE.halfZ - 0.4, bee.pos.z));
  }

  /** Loose separation between flying bees. */
  private separate(dt: number): void {
    const flying = this.bees.filter((b) => ['wander', 'approach', 'home', 'swarm', 'herd'].includes(b.state));
    for (let i = 0; i < flying.length; i++) {
      for (let j = i + 1; j < flying.length; j++) {
        const a = flying[i], b = flying[j];
        const d = a.pos.distanceTo(b.pos);
        if (d < 0.35 && d > 1e-5) {
          const k = ((0.35 - d) / d) * dt * 3;
          const dx = (a.pos.x - b.pos.x) * k, dy = (a.pos.y - b.pos.y) * k, dz = (a.pos.z - b.pos.z) * k;
          a.vel.x += dx; a.vel.y += dy; a.vel.z += dz;
          b.vel.x -= dx; b.vel.y -= dy; b.vel.z -= dz;
        }
      }
    }
  }

  // --- requests -------------------------------------------------------------------

  get(id: number): Bee | undefined {
    return this.bees.find((b) => b.id === id);
  }

  /** Bees standing on each flower right now. */
  loads(): Map<string, number> {
    const m = new Map<string, number>();
    for (const b of this.bees) if (b.flower && (b.state === 'forage' || b.state === 'land')) m.set(b.flower, (m.get(b.flower) ?? 0) + 1);
    return m;
  }

  refill(flowerId: string): void {
    this.nectar.set(flowerId, 1);
  }

  /** The nearest free bee flies to this flower; spawns one if the hive is awake and nobody is out. */
  callTo(flowerId: string, world: World): Bee | null {
    const target = world.flowers.find((f) => f.id === flowerId);
    if (!target) return null;
    const free = this.bees
      .filter((b) => !b.retiring && ['wander', 'approach', 'takeoff', 'swarm', 'rest', 'inside', 'emerge'].includes(b.state))
      .sort((a, b) => a.pos.distanceTo(target.landing) - b.pos.distanceTo(target.landing))[0];
    const bee = free ?? (this.bees.length < MAX_BEES && this.awake ? this.spawn(world) : null);
    if (!bee) return null;
    this.visit(bee.id, flowerId, world);
    return bee;
  }

  visit(beeId: number, flowerId: string, world: World): void {
    const bee = this.get(beeId);
    if (!bee) return;
    this.nectar.set(flowerId, Math.max(this.nectar.get(flowerId) ?? 1, 0.5));
    if (bee.state === 'inside' || bee.state === 'emerge' || bee.state === 'peek') {
      bee.order = { kind: 'visit', flower: flowerId };
      if (bee.state === 'inside') this.enter(bee, 'emerge', world);
      return;
    }
    if (bee.state === 'forage' || bee.state === 'land') {
      bee.order = { kind: 'visit', flower: flowerId };
      this.enter(bee, 'takeoff', world);
      return;
    }
    bee.order = null;
    bee.flower = flowerId;
    this.enter(bee, 'approach', world);
  }

  sendHome(beeId: number, world: World, dance = false): void {
    const bee = this.get(beeId);
    if (!bee || bee.state === 'inside') return;
    bee.order = { kind: dance ? 'dance' : 'home' };
    if (dance) bee.pollen = Math.max(bee.pollen, 0.5);
    if (bee.state === 'forage' || bee.state === 'land') this.enter(bee, 'takeoff', world);
    else if (bee.state !== 'enter' && bee.state !== 'dance') this.enter(bee, 'home', world);
  }

  rest(beeId: number, world: World): void {
    const bee = this.get(beeId);
    if (!bee || bee.state === 'inside' || world.flowers.length === 0) return;
    const nearest = [...world.flowers].sort((a, b) => a.leaf.distanceTo(bee.pos) - b.leaf.distanceTo(bee.pos))[0];
    bee.order = { kind: 'rest' };
    bee.flower = nearest.id;
    this.enter(bee, 'rest', world);
  }

  herd(beeId: number, point: THREE.Vector3 | null, world: World): void {
    const bee = this.get(beeId);
    if (!bee) return;
    this.herdPoint = point;
    if (point && bee.state !== 'herd' && bee.state !== 'inside') {
      bee.flower = null;
      this.enter(bee, 'herd', world);
    }
    if (!point && bee.state === 'herd') this.enter(bee, 'wander', world);
  }

  swarm(seconds = 6): void {
    this.awake = true;
    this.swarmTime = seconds;
  }

  calm(seconds = 10): void {
    this.calmTime = seconds;
  }

  setAwake(awake: boolean): void {
    this.awake = awake;
  }
}
