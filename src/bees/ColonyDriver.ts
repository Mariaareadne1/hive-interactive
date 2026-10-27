import * as THREE from 'three';
import { Colony, type FlowerSite, type World } from './colony';
import { BeeRenderer } from './BeeRenderer';
import type { Obstacles } from './flight';
import { loadGeometry } from '../engine/geometryCache';
import { BLOOM_SCALE } from '../flowers/kinds';
import { HIVE_RADIUS, OBSTACLES, terrainHeight } from '../scene/garden';
import { SKEP_HEIGHT } from '../scene/hive';
import type { FlowerManager } from '../flowers/FlowerManager';
import type { Hive } from '../scene/hive';
import type { WorldUniforms } from '../scene/world';

/**
 * Connects the colony simulation to the garden: each frame it describes the
 * flowers (where to land, which way is up, a leaf to rest on) and the solid
 * things to fly around, steps the simulation, tells flowers how many bees
 * are standing on them, and hands the result to the renderer.
 */
export class ColonyDriver {
  readonly colony: Colony;
  readonly renderer: BeeRenderer;
  private world: World;
  private readonly sites = new Map<string, FlowerSite>();
  private readonly tree = OBSTACLES.find((o) => o.name === 'apple tree');

  constructor(worldUniforms: WorldUniforms, private readonly flowers: FlowerManager, private readonly hive: Hive, seed = 7) {
    this.colony = new Colony(seed);
    this.renderer = new BeeRenderer(worldUniforms);
    this.world = { flowers: [], hive: this.hiveSite(), obstacles: { capsules: [], spheres: [], cylinders: [] } };
  }

  load(onError: (m: string) => void): void {
    loadGeometry('bee').then((g) => this.renderer.setGeometry(g)).catch((e: Error) => onError(e.message));
  }

  private hiveSite() {
    return { entrance: this.hive.entrance(), board: this.hive.board(), out: this.hive.outward() };
  }

  /** Rebuild the colony's view of the garden (cheap: a few dozen vectors). */
  describe(): World {
    const list: FlowerSite[] = [];
    const obstacles: Obstacles = { capsules: [], spheres: [], cylinders: [] };
    const seen = new Set<string>();
    for (const f of this.flowers.all()) {
      seen.add(f.id);
      const site = this.sites.get(f.id) ?? { id: f.id, blooming: false, landing: new THREE.Vector3(), up: new THREE.Vector3(), leaf: new THREE.Vector3() };
      this.sites.set(f.id, site);
      site.blooming = f.blooming;
      f.landingPoint(site.landing);
      f.bloomUp(site.up);
      f.leafPoint(site.leaf);
      list.push(site);
      const pts = f.stemPoints();
      const top = pts[pts.length - 1];
      const r = f.spec.stemRadius * 1.4 + 0.03;
      // the stem below the bloom, in a few straight pieces
      for (let i = 0; i < pts.length - 6; i += 6) obstacles.capsules.push({ a: pts[i], b: pts[Math.min(pts.length - 1, i + 6)], r, owner: f.id });
      const hr = f.spec.headRadius * f.record.scale * BLOOM_SCALE;
      if (f.spec.spike > 0) obstacles.capsules.push({ a: f.headCentre(new THREE.Vector3()), b: top, r: hr * 0.8, owner: f.id });
      else obstacles.spheres.push({ c: f.headCentre(new THREE.Vector3()), r: hr * 0.55, owner: f.id });
    }
    for (const id of this.sites.keys()) if (!seen.has(id)) this.sites.delete(id);
    const hy = terrainHeight(this.hive.x, this.hive.z);
    obstacles.cylinders.push({ x: this.hive.x, z: this.hive.z, r: HIVE_RADIUS + 0.05, y0: hy - 1, y1: hy + SKEP_HEIGHT + 0.2, owner: 'hive' });
    if (this.tree) obstacles.spheres.push({ c: new THREE.Vector3(this.tree.x, terrainHeight(this.tree.x, this.tree.z) + 1.4, this.tree.z), r: 1.3, owner: 'tree' });
    this.world = { flowers: list, hive: this.hiveSite(), obstacles };
    return this.world;
  }

  get current(): World {
    return this.world;
  }

  update(dt: number, time: number): void {
    const world = this.describe();
    this.colony.advance(dt, world);
    this.flowers.loads = this.colony.loads();
    this.hive.setHoney(this.colony.honey, time);
    this.hive.setAwake(this.colony.awake ? 1 : 0);
    const up = (id: string) => this.sites.get(id)?.up ?? null;
    this.renderer.update(this.colony, world.hive, up, time, dt);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
