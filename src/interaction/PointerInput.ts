import type { HiveApp } from '../app/HiveApp';
import type { Selection } from '../state/store';
import { DrawingOverlay } from './DrawingOverlay';
import { analyzeStroke, smooth, type Pt } from './stroke';

/**
 * One pointer state machine for mouse, pen and touch:
 *   press on a flower or the hive → select; move past a few pixels → drag it
 *   press on a bee                → select; dragging herds it toward the pointer
 *   press on the ground           → draw (draw tool) or deselect (move tool)
 * While a bee waits for "Visit…", tapping a flower sends it there.
 * A second finger, pointercancel or Escape abandons a stroke cleanly.
 */

type Gesture =
  | { kind: 'none' }
  | { kind: 'press'; sel: NonNullable<Selection>; x: number; y: number; pointerId: number }
  | { kind: 'drag'; pointerId: number }
  | { kind: 'stroke'; points: Pt[]; pointerId: number }
  | { kind: 'press-empty'; pointerId: number };

const DRAG_THRESHOLD = 4;

export class PointerInput {
  private gesture: Gesture = { kind: 'none' };
  private readonly overlay: DrawingOverlay;
  private readonly activePointers = new Set<number>();
  private hoverRaf = 0;
  private lastHover: { x: number; y: number } | null = null;
  /** Feedback hook (toasts) for rejected strokes. */
  onMessage: ((text: string) => void) | null = null;

  constructor(private readonly el: HTMLElement, private readonly app: HiveApp) {
    this.overlay = new DrawingOverlay(el);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.lost);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', this.noMenu);
  }

  get isDrawing(): boolean {
    return this.gesture.kind === 'stroke';
  }

  get ink(): SVGSVGElement {
    return this.overlay.svg;
  }

  /** Only the canvas itself is drawable; the interface floats above it. */
  private onCanvas(e: Event): boolean {
    return (e.target as Element | null)?.tagName === 'CANVAS';
  }

  private down = (e: PointerEvent) => {
    if (!this.onCanvas(e)) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      this.abort(); // pinch / two-finger: not ours
      return;
    }
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or synthetic); events still arrive on the element
    }
    const sel = this.app.pickAt(e.clientX, e.clientY);
    const visiting = this.app.store.get().visiting;
    if (visiting !== null) {
      if (sel?.kind === 'flower') this.app.bees.visit(visiting, sel.id);
      else this.app.store.set({ visiting: null });
      this.gesture = { kind: 'press-empty', pointerId: e.pointerId };
      return;
    }
    if (sel) {
      this.app.select(sel);
      this.gesture = { kind: 'press', sel, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      this.setCursor('grabbing');
      return;
    }
    if (this.app.store.get().tool === 'draw') {
      this.gesture = { kind: 'stroke', points: [{ x: e.clientX, y: e.clientY }], pointerId: e.pointerId };
      this.overlay.begin();
      this.app.store.set({ selection: null });
    } else {
      this.gesture = { kind: 'press-empty', pointerId: e.pointerId };
    }
  };

  private move = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind === 'none') {
      if (!this.onCanvas(e)) return;
      this.lastHover = { x: e.clientX, y: e.clientY };
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.hover);
      return;
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return;
    if (g.kind === 'press') {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD) {
        this.app.beginDrag(g.sel, g.x, g.y);
        this.gesture = { kind: 'drag', pointerId: g.pointerId };
        this.app.dragTo(e.clientX, e.clientY);
      }
      return;
    }
    if (g.kind === 'drag') {
      const ok = this.app.dragTo(e.clientX, e.clientY);
      this.setCursor(ok ? 'grabbing' : 'not-allowed');
      return;
    }
    if (g.kind === 'stroke') {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const c of events.length ? events : [e]) g.points.push({ x: c.clientX, y: c.clientY });
      const a = analyzeStroke(g.points);
      this.overlay.update(smooth(g.points, 1), a.closed && a.length > 120);
    }
  };

  private up = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'none' || ('pointerId' in g && g.pointerId !== e.pointerId)) return;
    this.gesture = { kind: 'none' };
    if (g.kind === 'drag') this.app.endDrag();
    else if (g.kind === 'press-empty' && this.app.store.get().visiting === null) this.app.select(null);
    else if (g.kind === 'stroke') this.finishStroke(g.points);
    this.updateHover(e.clientX, e.clientY);
  };

  private finishStroke(points: Pt[]): void {
    const a = analyzeStroke(points);
    if (a.length < 6) {
      // a tap on the ground: just clears the selection
      this.overlay.settle(false);
      return;
    }
    const result = this.app.createFromStroke(points);
    this.overlay.settle(result.ok);
    if (!result.ok) this.onMessage?.(result.message);
  }

  private cancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.abort();
  };

  private lost = (e: PointerEvent) => {
    // capture lost without pointerup (e.g. window blur): treat as cancel
    if ('pointerId' in this.gesture && this.gesture.pointerId === e.pointerId && !this.activePointers.has(e.pointerId)) this.abort();
  };

  /** Abandon whatever is in progress without creating or committing anything. */
  abort(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'stroke') this.overlay.cancelLive();
    if (g.kind === 'drag') this.app.endDrag(true);
  }

  private wheel = (e: WheelEvent) => {
    const sel = this.app.store.get().selection;
    if (!sel || sel.kind === 'bee' || !this.onCanvas(e)) return;
    e.preventDefault();
    this.app.rotate(Math.sign(e.deltaY || e.deltaX) * 0.12);
  };

  private noMenu = (e: Event) => e.preventDefault();

  private hover = () => {
    this.hoverRaf = 0;
    if (this.lastHover) this.updateHover(this.lastHover.x, this.lastHover.y);
  };

  private updateHover(x: number, y: number): void {
    const sel = this.app.pickAt(x, y);
    this.app.hoverSel = sel;
    const visiting = this.app.store.get().visiting !== null;
    if (sel) this.setCursor(visiting ? 'pointer' : 'grab');
    else if (this.app.store.get().tool !== 'draw') this.setCursor('default');
    else this.setCursor(this.app.canPlantAt(x, y) ? 'draw' : 'nope');
  }

  private setCursor(c: 'grab' | 'grabbing' | 'draw' | 'default' | 'not-allowed' | 'nope' | 'pointer'): void {
    this.el.dataset.cursor = c;
  }

  dispose(): void {
    cancelAnimationFrame(this.hoverRaf);
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('lostpointercapture', this.lost);
    this.el.removeEventListener('wheel', this.wheel);
    this.el.removeEventListener('contextmenu', this.noMenu);
    this.overlay.dispose();
  }
}
