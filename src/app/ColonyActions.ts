import type { HiveApp } from './HiveApp';

/**
 * Asking the bees and the hive for things: follow a bee, send it to a
 * flower, have it dance or rest or go home; wake or quieten the hive, set
 * off a swarm, calm everyone with a puff of smoke. Also the garden-wide
 * weather and time of day. None of this is undoable — it is the garden's
 * life, not its layout.
 */
export class ColonyActions {
  constructor(private readonly app: HiveApp) {}

  private get colony() {
    return this.app.living.colony.colony;
  }

  private get world() {
    return this.app.living.colony.current;
  }

  private beeId(id?: number): number | null {
    if (id !== undefined) return id;
    const sel = this.app.store.get().selection;
    return sel?.kind === 'bee' ? sel.id : null;
  }

  // --- a bee -------------------------------------------------------------

  follow(id?: number): void {
    const b = this.beeId(id);
    if (b === null) return;
    const on = this.app.living.following !== b;
    this.app.living.follow(on ? b : null);
    this.app.store.set({ following: on ? b : null });
  }

  /** "Visit…": the next flower tapped is where this bee goes. */
  beginVisit(id?: number): void {
    const b = this.beeId(id);
    if (b === null) return;
    this.app.store.set({ visiting: b });
    this.app.store.toast('Tap a flower to send the bee there.');
  }

  visit(beeId: number, flowerId: string): void {
    this.colony.visit(beeId, flowerId, this.world);
    this.app.store.set({ visiting: null, selection: { kind: 'bee', id: beeId } });
  }

  dance(id?: number): void {
    const b = this.beeId(id);
    if (b !== null) this.colony.sendHome(b, this.world, true);
  }

  rest(id?: number): void {
    const b = this.beeId(id);
    if (b === null) return;
    if (this.world.flowers.length === 0) {
      this.app.store.toast('There are no leaves to rest on yet.');
      return;
    }
    this.colony.rest(b, this.world);
  }

  home(id?: number): void {
    const b = this.beeId(id);
    if (b !== null) this.colony.sendHome(b, this.world);
  }

  // --- the hive ------------------------------------------------------------

  toggleAwake(): void {
    const awake = !this.colony.awake;
    this.colony.setAwake(awake);
    this.app.store.toast(awake ? 'The hive wakes up.' : 'The bees fly home and the hive goes quiet.');
    this.app.store.set({});
  }

  swarm(): void {
    if (this.app.living.raining) return;
    this.colony.swarm(this.app.engine.reducedMotion ? 4 : 6);
  }

  calm(): void {
    this.colony.calm(10);
    this.app.living.fx.smoke(this.app.living.garden.hive.board());
  }

  // --- the garden ------------------------------------------------------------

  breeze(): void {
    this.app.living.breeze(this.app.engine.reducedMotion ? 3 : 6);
  }

  rain(): void {
    if (this.app.living.raining) return;
    this.app.living.rain(9);
    this.app.store.set({ raining: true });
  }

  setGolden(t: number): void {
    this.app.living.goldenTarget = Math.min(1, Math.max(0, t));
    this.app.store.set({ golden: this.app.living.goldenTarget });
  }
}
