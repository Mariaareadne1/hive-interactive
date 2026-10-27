import * as THREE from 'three';
import { addFlowers, findFlower, MAX_FLOWERS, newFlowerId, newSeed, updateFlower, type FlowerRecord } from '../state/document';
import { KINDS } from '../flowers/kinds';
import { isPlantable, surfaceAt } from '../scene/garden';
import { seededRandom } from '../scene/noise';
import type { HiveApp } from './HiveApp';

/**
 * What you can do to a flower from its bar: water it, open or fold it, send
 * a gust through it, let it seed, change its colour, call a bee to it.
 * Edits that change the garden are undoable; the rest is just life.
 */
export class FlowerActions {
  constructor(private readonly app: HiveApp) {}

  private selected(): FlowerRecord | undefined {
    const sel = this.app.store.get().selection;
    return sel?.kind === 'flower' ? findFlower(this.app.store.doc, sel.id) : undefined;
  }

  private target(id?: string): FlowerRecord | undefined {
    return id ? findFlower(this.app.store.doc, id) : this.selected();
  }

  /** A little watering can tips over it: it perks up, grows ~10% taller, its nectar refills. */
  water(id?: string): void {
    const f = this.target(id);
    if (!f) return;
    const { living, store } = this.app;
    const live = living.flowers.get(f.id);
    if (!live || living.fx.pouring) return;
    living.fx.water(() => live.headCentre(new THREE.Vector3()), () => {
      const current = findFlower(store.doc, f.id);
      if (!current) return;
      const max = KINDS[current.kind].maxHeight * 1.25;
      store.commit(updateFlower(store.doc, f.id, { height: Math.min(max, current.height * 1.1) }));
      live.perkUp();
      live.uniforms.uGloss.value = 0.6;
      living.colony.colony.refill(f.id);
    });
  }

  /** Open the petals, or fold them up. */
  toggleBloom(id?: string): void {
    const f = this.target(id);
    if (f) this.app.store.commit(updateFlower(this.app.store.doc, f.id, { open: !f.open }));
  }

  /** A gust passes through it; its neighbours sway a little too. */
  sway(id?: string): void {
    const f = this.target(id);
    if (!f) return;
    this.app.living.flowers.gustAround(f.id, 1.6);
    this.app.living.fx.gustPetals(1.2);
  }

  /** Scatter 2–3 seedlings nearby that grow into smaller copies (one undo step). */
  seed(id?: string): number {
    const f = this.target(id);
    if (!f) return 0;
    const { store, living } = this.app;
    const room = MAX_FLOWERS - store.doc.flowers.length;
    if (room <= 0) {
      store.toast('The garden is full.');
      return 0;
    }
    const rand = seededRandom(f.seed + store.doc.flowers.length * 17);
    const want = Math.min(room, 2 + Math.floor(rand() * 2));
    const out: FlowerRecord[] = [];
    for (let tries = 0; tries < 40 && out.length < want; tries++) {
      const a = rand() * Math.PI * 2, r = 0.6 + rand() * 0.7;
      const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
      if (!isPlantable(surfaceAt(x, z, store.doc.hive))) continue;
      if ([...store.doc.flowers, ...out].some((o) => Math.hypot(o.x - x, o.z - z) < 0.45)) continue;
      out.push({ ...f, id: newFlowerId(), seed: newSeed(), x, z, scale: 0.55 + rand() * 0.15, height: f.height * (0.6 + rand() * 0.12), open: true });
    }
    if (!out.length) {
      store.toast('No room nearby for seedlings.');
      return 0;
    }
    for (const s of out) living.flowers.expectGrowth(s.id, 2.6);
    store.commit(addFlowers(store.doc, ...out));
    return out.length;
  }

  /** Cycle through this flower's palette (a soft cross-fade). */
  recolour(id?: string): void {
    const f = this.target(id);
    if (!f) return;
    const n = KINDS[f.kind].palettes.length;
    this.app.store.commit(updateFlower(this.app.store.doc, f.id, { palette: (f.palette + 1) % n }));
  }

  /** The nearest free bee flies to it. */
  callBee(id?: string): number | null {
    const f = this.target(id);
    if (!f) return null;
    const { living, store } = this.app;
    if (!living.colony.colony.awake) living.colony.colony.setAwake(true);
    const bee = living.colony.colony.callTo(f.id, living.colony.describe());
    if (!bee) store.toast('The bees are all busy — try again in a moment.');
    return bee?.id ?? null;
  }
}
