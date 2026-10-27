import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import { GardenScene } from '../scene/GardenScene';
import { FlowerManager } from '../flowers/FlowerManager';
import { ColonyDriver } from '../bees/ColonyDriver';
import { Fx } from '../fx/Fx';
import { Butterflies } from '../fx/Butterflies';
import { setGolden } from '../scene/world';

/**
 * Everything alive in the garden, put together: the fixed scene, the
 * flowers, the colony, the weather and small magic, the butterflies. One
 * frame callback steps them in order (flowers before bees, so bees land on
 * where blooms are this frame).
 */
export class Living {
  readonly garden: GardenScene;
  readonly flowers: FlowerManager;
  readonly colony: ColonyDriver;
  readonly fx: Fx;
  readonly butterflies: Butterflies;
  /** Garden-wide wind, eased toward its target (breeze). */
  wind = 1;
  windTarget = 1;
  private breezeTime = 0;
  golden = 0;
  goldenTarget = 0;
  /** The followed bee's id, whose trail is drawn. */
  following: number | null = null;
  private followTime = 0;
  private rainTime = 0;
  onRainEnd: (() => void) | null = null;

  constructor(readonly engine: Engine) {
    const { world, scene } = engine;
    this.garden = new GardenScene(engine);
    this.flowers = new FlowerManager(world);
    scene.add(this.flowers.group);
    this.colony = new ColonyDriver(world, this.flowers, this.garden.hive);
    scene.add(this.colony.renderer.group);
    this.fx = new Fx(world);
    scene.add(this.fx.group);
    this.butterflies = new Butterflies(world);
    scene.add(this.butterflies.mesh);
    const calm = engine.reducedMotion;
    this.fx.reducedMotion = calm;
    this.colony.renderer.reducedMotion = calm;
    this.flowers.env.reducedMotion = calm;
    if (calm) this.colony.colony.slow = 0.7;
    this.flowers.onPollen = (p) => this.fx.pollenPuff(p);
    this.colony.colony.onLand = (bee) => {
      if (this.colony.colony.bees.length < 10) this.fx.pollenPuff(bee.pos, 0.35);
    };
    engine.onFrame((dt, t) => this.update(dt, t));
  }

  breeze(seconds = 6): void {
    this.breezeTime = seconds;
    this.fx.gustPetals(seconds);
    for (const f of this.flowers.all()) f.gust(1, 0.2, 0.5 + Math.random() * 0.4);
  }

  rain(seconds = 9): void {
    this.rainTime = seconds;
    this.fx.raining = true;
    this.colony.colony.sheltering = true;
  }

  get raining(): boolean {
    return this.rainTime > 0;
  }

  follow(id: number | null, seconds = 9): void {
    this.following = id;
    this.followTime = seconds;
  }

  private update(dt: number, time: number): void {
    // wind eases toward a stronger breeze and back
    if (this.breezeTime > 0) this.breezeTime -= dt;
    this.windTarget = this.breezeTime > 0 ? 3.2 : 1;
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 1.5);
    const calmWind = this.engine.reducedMotion ? 0.35 : 1;
    this.engine.world.uWind.value = this.wind * calmWind;
    this.flowers.env.wind = this.wind;
    // time of day
    this.golden += (this.goldenTarget - this.golden) * Math.min(1, dt * 3);
    setGolden(this.engine.world, this.golden);
    this.flowers.env.golden = this.golden;
    // rain, then the bees come back out once it has passed
    if (this.rainTime > 0) {
      this.rainTime -= dt;
      if (this.rainTime <= 0) {
        this.fx.raining = false;
        this.colony.colony.sheltering = false;
        this.onRainEnd?.();
      }
    }

    this.flowers.update(dt, time);
    this.colony.update(dt, time);
    if (this.following !== null) {
      this.followTime -= dt;
      const p = this.colony.renderer.drawn.get(this.following);
      if (p) this.fx.trail(p, dt);
      if (this.followTime <= 0) this.following = null;
    }
    const blooms: THREE.Vector3[] = [];
    for (const f of this.flowers.all()) if (f.blooming) blooms.push(f.headCentre(new THREE.Vector3()));
    this.butterflies.update(dt, time, blooms);
    this.fx.update(dt, time);
  }

  dispose(): void {
    this.flowers.dispose();
    this.colony.dispose();
    this.fx.dispose();
    this.butterflies.dispose();
  }
}
