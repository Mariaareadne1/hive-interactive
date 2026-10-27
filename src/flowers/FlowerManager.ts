import * as THREE from 'three';
import { Flower, type FlowerEnv } from './Flower';
import { GROW_DURATION } from './growth';
import { HEAD_VARIANTS } from './heads';
import { BLOOM_SCALE, FLOWER_KINDS, type FlowerKind } from './kinds';
import { loadGeometry, readyGeometry } from '../engine/geometryCache';
import type { FlowerRecord, GardenDoc } from '../state/document';
import type { WorldUniforms } from '../scene/world';

/**
 * Keeps the living flowers in step with the document. The document is the
 * source of truth for what grows where; the Flower objects own the life in
 * between edits. Removed flowers fold up and sink back into the soil.
 */

const headKey = (kind: FlowerKind, seed: number) => `head:${kind}:${seed % HEAD_VARIANTS}`;

export class FlowerManager {
  readonly group = new THREE.Group();
  private readonly flowers = new Map<string, Flower>();
  private readonly pendingGrow = new Map<string, number>();
  private readonly leaving: { flower: Flower; t: number }[] = [];
  env: FlowerEnv = { wind: 1, golden: 0, load: 0, reducedMotion: false };
  /** Bees standing on each flower (set by the colony each frame). */
  loads = new Map<string, number>();
  onPollen: ((p: THREE.Vector3) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(private readonly world: WorldUniforms) {
    this.group.name = 'flowers';
  }

  /** Build every bloom shape in the background, so new flowers open instantly. */
  preload(): Promise<unknown> {
    const jobs: Promise<unknown>[] = [];
    for (const kind of FLOWER_KINDS) for (let v = 0; v < HEAD_VARIANTS; v++) jobs.push(loadGeometry(headKey(kind, v)));
    return Promise.all(jobs).catch((e: Error) => this.onError?.(e.message));
  }

  /** The next flower with this id grows from its stroke (instead of simply being there). */
  expectGrowth(id: string, duration = GROW_DURATION): void {
    this.pendingGrow.set(id, duration);
  }

  sync(doc: GardenDoc): void {
    const seen = new Set<string>();
    for (const record of doc.flowers) {
      seen.add(record.id);
      const f = this.flowers.get(record.id);
      if (f) f.setRecord(record);
      else this.create(record);
    }
    for (const [id, f] of this.flowers) {
      if (!seen.has(id)) {
        this.flowers.delete(id);
        this.leaving.push({ flower: f, t: 0 });
      }
    }
  }

  private create(record: FlowerRecord): void {
    const duration = this.pendingGrow.get(record.id);
    this.pendingGrow.delete(record.id);
    // flowers loaded from a saved garden still rise briefly out of the soil
    const flower = new Flower(record, this.world, { grow: true, duration: duration ?? 0.7 });
    flower.onPollen = duration !== undefined ? (p) => this.onPollen?.(p) : null;
    this.flowers.set(record.id, flower);
    this.group.add(flower.root);
    const key = headKey(record.kind, record.seed);
    const ready = readyGeometry(key);
    if (ready) flower.setHeadGeometry(ready);
    else loadGeometry(key).then((g) => flower.setHeadGeometry(g)).catch((e: Error) => this.onError?.(e.message));
  }

  update(dt: number, time: number): void {
    for (const f of this.flowers.values()) {
      this.env.load = this.loads.get(f.id) ?? 0;
      f.update(dt, time, this.env);
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.t += dt;
      const k = Math.max(0, 1 - l.t / 0.5);
      l.flower.wither(k * k);
      if (k <= 0) {
        l.flower.dispose();
        this.leaving.splice(i, 1);
      } else l.flower.update(dt, time, { ...this.env, load: 0 });
    }
  }

  get(id: string): Flower | undefined {
    return this.flowers.get(id);
  }

  all(): Flower[] {
    return [...this.flowers.values()];
  }

  ids(): string[] {
    return [...this.flowers.keys()];
  }

  isGrown(id: string): boolean {
    return !!this.flowers.get(id)?.grown;
  }

  /** A gust through one flower nudges its neighbours too. */
  gustAround(id: string, strength: number): void {
    const src = this.flowers.get(id);
    if (!src) return;
    for (const f of this.flowers.values()) {
      const dx = f.record.x - src.record.x, dz = f.record.z - src.record.z;
      const d = Math.hypot(dx, dz);
      if (d > 3) continue;
      const k = f === src ? 1 : 0.5 * (1 - d / 3);
      f.gust(d > 0.01 ? dx / d : 1, d > 0.01 ? dz / d : 0.2, strength * k);
    }
  }

  /**
   * Nearest flower under a screen point: within the bloom's projected radius
   * or a few pixels of its stem. Nearer flowers win.
   */
  pick(clientX: number, clientY: number, camera: THREE.PerspectiveCamera, rect: DOMRect, ppm: (p: THREE.Vector3) => number): string | null {
    let best: string | null = null;
    let bestDepth = Infinity;
    const v = new THREE.Vector3();
    const toScreen = (p: THREE.Vector3) => {
      v.copy(p).project(camera);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z] as const;
    };
    for (const f of this.flowers.values()) {
      const hc = f.headCentre(new THREE.Vector3());
      const [hx, hy, hz] = toScreen(hc);
      const r = Math.max(14, f.spec.headRadius * f.record.scale * BLOOM_SCALE * ppm(hc) * 0.95);
      let hit = Math.hypot(clientX - hx, clientY - hy) < r;
      if (!hit) {
        const pts = f.stemPoints();
        for (let i = 0; i < pts.length - 1 && !hit; i += 2) {
          const [ax, ay] = toScreen(pts[i]);
          const [bx, by] = toScreen(pts[Math.min(pts.length - 1, i + 2)]);
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((clientX - ax) * dx + (clientY - ay) * dy) / (dx * dx + dy * dy || 1)));
          hit = Math.hypot(clientX - (ax + dx * t), clientY - (ay + dy * t)) < 9;
        }
      }
      if (hit && hz < bestDepth) {
        bestDepth = hz;
        best = f.id;
      }
    }
    return best;
  }

  setHighlight(id: string | null, hoverId: string | null): void {
    for (const [fid, f] of this.flowers) f.highlight = fid === id ? 1 : fid === hoverId ? 0.45 : 0;
  }

  dispose(): void {
    for (const f of this.flowers.values()) f.dispose();
    for (const l of this.leaving) l.flower.dispose();
    this.flowers.clear();
    this.leaving.length = 0;
  }
}
