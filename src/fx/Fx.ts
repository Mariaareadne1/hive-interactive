import * as THREE from 'three';
import { Particles } from './Particles';
import { wateringCanGeometry } from '../scene/props';
import { paintMaterial } from '../scene/paint';
import { TILE, terrainHeight } from '../scene/garden';
import { seededRandom } from '../scene/noise';
import type { WorldUniforms } from '../scene/world';

/**
 * The garden's weather and small magic: the pollen puff when a flower opens,
 * a watering can that tips over a flower in a shower of sparkles, petals on
 * the breeze, a soft rain shower, a puff of smoke at the hive, and the dotted
 * trail behind a followed bee.
 */

const GOLD = new THREE.Color('#ffd76a');
const WATER = new THREE.Color('#bfe0f2');
const SPARKLE = new THREE.Color('#ffffff');
const PETALS = ['#f6c2c8', '#fbeede', '#f3d27a', '#d9c4ef'].map((c) => new THREE.Color(c));

interface Pour {
  target: () => THREE.Vector3;
  t: number;
  poured: boolean;
  onPour: () => void;
}

export class Fx {
  readonly group = new THREE.Group();
  readonly particles: Particles;
  private readonly can: THREE.Mesh;
  private pour: Pour | null = null;
  private breeze = 0;
  raining = false;
  private wet = 0;
  private readonly rand = seededRandom(99);
  private trailTimer = 0;
  reducedMotion = false;

  constructor(private readonly world: WorldUniforms) {
    this.group.name = 'fx';
    this.particles = new Particles(world);
    this.group.add(this.particles.mesh);
    this.can = new THREE.Mesh(wateringCanGeometry(), paintMaterial(world, { vertexColors: true, gloss: 0.6 }));
    this.can.visible = false;
    this.can.scale.setScalar(1.5);
    this.group.add(this.can);
  }

  pollenPuff(at: THREE.Vector3, amount = 1): void {
    const n = Math.round((this.reducedMotion ? 8 : 18) * amount);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, r = 0.2 + this.rand() * 0.5;
      this.particles.add({
        pos: at,
        vel: new THREE.Vector3(Math.cos(a) * r, 0.3 + this.rand() * 0.5, Math.sin(a) * r),
        life: 1.1 + this.rand() * 0.6,
        size: 0.03 + this.rand() * 0.03,
        color: GOLD,
        gravity: -0.05,
        drag: 2.5,
        alpha: 0.9,
      });
    }
    this.particles.add({ pos: at, life: 0.5, size: 0.18, color: SPARKLE, shape: 'sparkle', alpha: 0.8, spin: 1 });
  }

  /** A watering can appears beside the flower, tips, and showers it. */
  water(target: () => THREE.Vector3, onPour: () => void): void {
    this.pour = { target, t: 0, poured: false, onPour };
  }

  get pouring(): boolean {
    return this.pour !== null;
  }

  gustPetals(seconds: number): void {
    this.breeze = Math.max(this.breeze, seconds);
  }

  smoke(at: THREE.Vector3): void {
    for (let i = 0; i < 14; i++) {
      this.particles.add({
        pos: at.clone().add(new THREE.Vector3((this.rand() - 0.5) * 0.3, 0.2 + this.rand() * 0.3, (this.rand() - 0.5) * 0.3)),
        vel: new THREE.Vector3((this.rand() - 0.5) * 0.3, 0.35 + this.rand() * 0.3, (this.rand() - 0.5) * 0.3),
        life: 2.5 + this.rand() * 1.5,
        size: 0.35 + this.rand() * 0.25,
        color: new THREE.Color('#eceae6'),
        shape: 'smoke',
        drag: 0.6,
        alpha: 0.55,
      });
    }
  }

  trail(at: THREE.Vector3, dt: number): void {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = 0.06;
    this.particles.add({ pos: at, life: 6, size: 0.035, color: new THREE.Color('#fff4d6'), alpha: 0.85 });
  }

  sparkle(at: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      this.particles.add({
        pos: at.clone().add(new THREE.Vector3((this.rand() - 0.5) * 0.5, this.rand() * 0.4, (this.rand() - 0.5) * 0.5)),
        life: 0.6 + this.rand() * 0.5,
        size: 0.06 + this.rand() * 0.06,
        color: SPARKLE,
        shape: 'sparkle',
        spin: 2,
        gravity: 0.2,
      });
    }
  }

  update(dt: number, time: number): void {
    this.updatePour(dt);
    // petals drift across on the breeze
    if (this.breeze > 0) {
      this.breeze -= dt;
      const rate = this.reducedMotion ? 6 : 16;
      if (this.rand() < rate * dt) {
        const z = (this.rand() * 2 - 1) * TILE.halfZ * 0.8;
        const x = -TILE.halfX * 0.9 + this.rand() * 4;
        this.particles.add({
          pos: new THREE.Vector3(x, terrainHeight(x, z) + 0.8 + this.rand() * 1.4, z),
          vel: new THREE.Vector3(2 + this.rand(), -0.15, (this.rand() - 0.5) * 0.6),
          life: 5 + this.rand() * 2,
          size: 0.06,
          color: PETALS[Math.floor(this.rand() * PETALS.length)],
          shape: 'petal',
          drag: 0.05,
          spin: 2 + this.rand() * 3,
        });
      }
    }
    // rain: soft streaks, beds darken, then dry slowly afterward
    if (this.raining) {
      const n = Math.round((this.reducedMotion ? 90 : 260) * dt * 3);
      for (let i = 0; i < n; i++) {
        const x = (this.rand() * 2 - 1) * TILE.halfX * 0.95, z = (this.rand() * 2 - 1) * TILE.halfZ * 0.95;
        const y = terrainHeight(x, z);
        this.particles.add({
          pos: new THREE.Vector3(x + 0.6, y + 3.4, z),
          vel: new THREE.Vector3(-0.6, -9, 0),
          life: 0.36,
          size: 0.075,
          color: WATER,
          shape: 'streak',
          alpha: 0.8,
        });
      }
    }
    this.wet += ((this.raining ? 1 : 0) - this.wet) * Math.min(1, dt * (this.raining ? 0.6 : 0.08));
    this.world.uWet.value = this.wet;
    this.particles.update(dt);
    void time;
  }

  private updatePour(dt: number): void {
    const p = this.pour;
    if (!p) return;
    p.t += dt;
    const T = this.reducedMotion ? 1.2 : 1.9;
    const k = p.t / T;
    const target = p.target();
    // the can floats in from the side, tips forward, pours, rights itself and fades
    const appear = Math.min(1, k / 0.18);
    const tip = Math.sin(Math.min(1, Math.max(0, (k - 0.15) / 0.6)) * Math.PI);
    this.can.visible = k < 1;
    this.can.position.copy(target).add(new THREE.Vector3(-0.75, 0.55 + (1 - appear) * 0.3, 0.1));
    this.can.rotation.set(0, 0, -0.95 * tip);
    this.can.scale.setScalar(1.5 * (k > 0.9 ? Math.max(0.01, (1 - k) * 10) : appear));
    if (tip > 0.5) {
      // drops and sparkles from the rose
      const spout = new THREE.Vector3(0.48 * 1.5, 0.39 * 1.5, 0).applyEuler(this.can.rotation).add(this.can.position);
      for (let i = 0; i < 3; i++) {
        this.particles.add({
          pos: spout,
          vel: new THREE.Vector3(0.6 + this.rand() * 0.4, -0.2 - this.rand() * 0.4, (this.rand() - 0.5) * 0.4),
          life: 0.7,
          size: 0.03,
          color: WATER,
          shape: 'streak',
          gravity: 6,
          drag: 0.3,
          alpha: 0.8,
        });
      }
      if (this.rand() < 0.4) this.sparkle(target);
    }
    if (!p.poured && k > 0.45) {
      p.poured = true;
      p.onPour();
    }
    if (k >= 1) {
      this.can.visible = false;
      this.pour = null;
    }
  }

  dispose(): void {
    this.particles.dispose();
    this.can.geometry.dispose();
    (this.can.material as THREE.Material).dispose();
  }
}
