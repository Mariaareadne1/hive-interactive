import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store, Selection } from '../state/store';
import {
  addFlowers, emptyDoc, findFlower, MAX_FLOWERS, newFlowerId, newSeed, removeFlower, updateFlower, updateHive,
  type FlowerRecord, type GardenDoc,
} from '../state/document';
import { saveDoc } from '../state/persistence';
import { analyzeStroke, smooth, type Pt } from '../interaction/stroke';
import { classifyStroke } from '../interaction/classify';
import { drawingHeading, plantPoint, toPlane } from '../interaction/planting';
import { screenToTerrain } from '../interaction/terrainRay';
import { profileFromPlanePoints } from '../flowers/stem';
import { clampHeight, forcedKind, KINDS, type FlowerKind } from '../flowers/kinds';
import { GROW_DURATION } from '../flowers/growth';
import { clampHive, edgeDistance, HIVE_RADIUS, isPlantable, nearestPlantable, surfaceAt, surfaceMessage, terrainHeight } from '../scene/garden';
import { Living } from './Living';
import { FlowerActions } from './FlowerActions';
import { ColonyActions } from './ColonyActions';

/**
 * Application commands. UI and pointer input call these; they turn intent
 * into document edits (undoable) or live requests to the garden's life
 * (not undoable — bees, weather, time of day).
 */

export type StrokeResult =
  | { ok: true; id: string; kind: FlowerKind; alternative: FlowerKind | null }
  | { ok: false; message: string };

type Drag =
  | { kind: 'flower'; id: string; offsetX: number; offsetZ: number; startX: number; startZ: number; valid: boolean; record: FlowerRecord }
  | { kind: 'hive'; offsetX: number; offsetZ: number; startX: number; startZ: number; valid: boolean }
  | { kind: 'bee'; id: number };

export class HiveApp {
  readonly living: Living;
  readonly flower: FlowerActions;
  readonly bees: ColonyActions;
  private drag: Drag | null = null;
  private lastRotate = { key: '', at: 0 };
  private saveTimer = 0;
  private suggestionTimer = 0;
  private readonly unsub: (() => void)[] = [];
  hoverSel: Selection = null;

  constructor(readonly engine: Engine, readonly store: Store) {
    this.living = new Living(engine);
    this.flower = new FlowerActions(this);
    this.bees = new ColonyActions(this);
  }

  start(): void {
    const { flowers } = this.living;
    let prevDoc: GardenDoc | null = null;
    const onChange = () => {
      const doc = this.store.doc;
      if (doc === prevDoc) return;
      prevDoc = doc;
      flowers.sync(doc);
      this.placeHive(doc.hive.x, doc.hive.z, doc.hive.heading);
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveDoc(this.store.doc), 250);
    };
    this.unsub.push(this.store.subscribe(onChange));
    onChange();

    flowers.onError = (m) => this.store.set({ fatal: `The flowers could not be built: ${m}` });
    this.living.colony.load((m) => this.store.set({ fatal: `The bees could not be built: ${m}` }));
    flowers.preload().then(() => this.store.set({ loading: false }));

    let honeyShown = -1;
    this.unsub.push(
      this.engine.onFrame(() => {
        const s = this.store.get();
        const sel = s.selection, hov = this.hoverSel;
        flowers.setHighlight(sel?.kind === 'flower' ? sel.id : null, hov?.kind === 'flower' ? hov.id : null);
        this.living.garden.hive.setHighlight(sel?.kind === 'hive' ? 1 : hov?.kind === 'hive' ? 0.45 : 0);
        const r = this.living.colony.renderer;
        r.selectedId = sel?.kind === 'bee' ? sel.id : null;
        r.hoverId = hov?.kind === 'bee' ? hov.id : null;
        // a bee that went home drops out of the selection
        if (sel?.kind === 'bee' && !r.drawn.has(sel.id) && !this.drag) this.store.set({ selection: null });
        const honey = Math.round(this.living.colony.colony.honey * 100);
        if (honey !== honeyShown) {
          honeyShown = honey;
          this.store.set({ honey: honey / 100 });
        }
        this.living.butterflies.avoid = sel ? this.selectionCentre(sel) : null;
      }),
    );
    this.living.onRainEnd = () => this.store.set({ raining: false });
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  private placeHive(x: number, z: number, heading: number): void {
    const hive = this.living.garden.hive;
    hive.place(x, z, heading);
    this.engine.world.uHive.value.set(x, z);
  }

  // --- drawing ---------------------------------------------------------------

  createFromStroke(points: readonly Pt[]): StrokeResult {
    const a = analyzeStroke(points);
    if (!a.valid) return { ok: false, message: 'Draw a little bigger — a line, a loop, a star…' };
    if (this.store.doc.flowers.length >= MAX_FLOWERS) return { ok: false, message: 'The garden is full. Remove a flower to make room.' };

    const cam = this.engine.camera;
    const rect = this.rect;
    const base2d = plantPoint(points);
    const hit = screenToTerrain(cam, rect, base2d.x, base2d.y);
    const hive = this.store.doc.hive;
    if (!hit || edgeDistance(hit.x, hit.z) < 0) return { ok: false, message: 'Plant inside the garden.' };
    const surface = surfaceAt(hit.x, hit.z, hive);
    if (!isPlantable(surface)) return { ok: false, message: surfaceMessage(surface) };

    const classification = classifyStroke(points);
    const forced = forcedKind(this.store.get().plant);
    const kind = forced ?? classification.kind;
    const heading = drawingHeading(cam);
    const base = new THREE.Vector3(hit.x, terrainHeight(hit.x, hit.z), hit.z);
    // corners matter to the classifier, so only the stem's copy of the line is smoothed
    const profile = profileFromPlanePoints(toPlane(cam, rect, smooth(points, 2), base, heading), 0.25);
    const spec = KINDS[kind];
    const drawn = profile.synthetic ? (spec.minHeight + spec.maxHeight) / 2 : profile.drawnHeight;
    const record: FlowerRecord = {
      id: newFlowerId(),
      kind,
      x: hit.x,
      z: hit.z,
      heading,
      height: clampHeight(kind, drawn),
      stem: profile.points,
      palette: Math.floor(Math.random() * spec.palettes.length),
      seed: newSeed(),
      scale: 1,
      open: true,
    };
    this.living.flowers.expectGrowth(record.id, this.growDuration);
    this.store.commit(addFlowers(this.store.doc, record), { hasDrawn: true, selection: null });
    const alternative = forced ? null : classification.alternative;
    if (alternative) this.suggest(record.id, alternative);
    return { ok: true, id: record.id, kind, alternative };
  }

  get growDuration(): number {
    return this.engine.reducedMotion ? GROW_DURATION * 0.5 : GROW_DURATION;
  }

  private suggest(flowerId: string, alternative: FlowerKind): void {
    window.clearTimeout(this.suggestionTimer);
    this.store.set({ suggestion: { id: Date.now(), flowerId, alternative } });
    this.suggestionTimer = window.setTimeout(() => this.store.set({ suggestion: null }), 3000);
  }

  /** "Make it a … instead": the flower regrows as the other kind, in place of the first (one undo step). */
  acceptSuggestion(): void {
    const s = this.store.get().suggestion;
    if (!s) return;
    const f = findFlower(this.store.doc, s.flowerId);
    this.store.set({ suggestion: null });
    if (!f) return;
    const spec = KINDS[s.alternative];
    const record: FlowerRecord = { ...f, id: newFlowerId(), kind: s.alternative, height: clampHeight(s.alternative, f.height), palette: f.palette % spec.palettes.length };
    this.living.flowers.expectGrowth(record.id, this.growDuration);
    this.store.amend(addFlowers(removeFlower(this.store.doc, f.id), record));
  }

  // --- selection ------------------------------------------------------------

  pickAt(clientX: number, clientY: number): Selection {
    const rect = this.rect;
    const bee = this.living.colony.renderer.pick(clientX, clientY, this.engine.camera, rect);
    if (bee !== null) return { kind: 'bee', id: bee };
    const ppm = (p: THREE.Vector3) => this.engine.pixelsPerMeterAt(p);
    const flower = this.living.flowers.pick(clientX, clientY, this.engine.camera, rect, ppm);
    if (flower) return { kind: 'flower', id: flower };
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.engine.camera);
    if (ray.intersectObject(this.living.garden.hive.proxy, false).length) return { kind: 'hive' };
    return null;
  }

  /** Whether the pointer is over ground a flower could be planted in. */
  canPlantAt(clientX: number, clientY: number): boolean {
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    return !!hit && isPlantable(surfaceAt(hit.x, hit.z, this.store.doc.hive));
  }

  select(sel: Selection): void {
    const cur = this.store.get().selection;
    const same = cur === sel || (cur && sel && cur.kind === sel.kind && (cur as { id?: unknown }).id === (sel as { id?: unknown }).id);
    if (!same) this.store.set({ selection: sel });
  }

  selectionCentre(sel: Selection): THREE.Vector3 | null {
    if (!sel) return null;
    if (sel.kind === 'flower') return this.living.flowers.get(sel.id)?.headCentre(new THREE.Vector3()) ?? null;
    if (sel.kind === 'hive') return this.living.garden.hive.group.position.clone();
    return this.living.colony.renderer.drawn.get(sel.id)?.clone() ?? null;
  }

  // --- dragging --------------------------------------------------------------

  beginDrag(sel: Selection, clientX: number, clientY: number): void {
    if (!sel) return;
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    if (sel.kind === 'bee') {
      this.drag = { kind: 'bee', id: sel.id };
      this.dragTo(clientX, clientY);
      return;
    }
    if (sel.kind === 'flower') {
      const f = findFlower(this.store.doc, sel.id);
      if (!f) return;
      this.drag = { kind: 'flower', id: f.id, offsetX: hit ? f.x - hit.x : 0, offsetZ: hit ? f.z - hit.z : 0, startX: f.x, startZ: f.z, valid: true, record: f };
      return;
    }
    const h = this.store.doc.hive;
    this.drag = { kind: 'hive', offsetX: hit ? h.x - hit.x : 0, offsetZ: hit ? h.z - hit.z : 0, startX: h.x, startZ: h.z, valid: true };
  }

  /** Returns false when the spot under the pointer can't take what is being dragged. */
  dragTo(clientX: number, clientY: number): boolean {
    const d = this.drag;
    if (!d) return false;
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    if (d.kind === 'bee') {
      // herding: the bee is coaxed toward a point a metre above the ground under the pointer
      if (hit) this.living.colony.colony.herd(d.id, hit.clone().setY(hit.y + 1.0), this.living.colony.current);
      return !!hit;
    }
    if (!hit) return (d.valid = false);
    const tx = hit.x + d.offsetX, tz = hit.z + d.offsetZ;
    if (d.kind === 'flower') {
      const hive = this.store.doc.hive;
      const ok = isPlantable(surfaceAt(tx, tz, hive));
      const [x, z] = ok ? [tx, tz] : nearestPlantable(tx, tz, hive);
      d.valid = ok || Math.hypot(x - tx, z - tz) < 0.4;
      const live = this.living.flowers.get(d.id);
      if (live) live.setRecord({ ...live.record, x, z });
      return d.valid;
    }
    const [x, z] = clampHive(tx, tz);
    const blocked = this.store.doc.flowers.some((f) => Math.hypot(f.x - x, f.z - z) < HIVE_RADIUS + 0.35);
    d.valid = !blocked;
    this.placeHive(x, z, this.store.doc.hive.heading);
    return d.valid;
  }

  endDrag(cancel = false): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'bee') {
      this.living.colony.colony.herd(d.id, null, this.living.colony.current);
      return;
    }
    if (d.kind === 'flower') {
      const live = this.living.flowers.get(d.id);
      if (!live) return;
      const { x, z } = live.record;
      if (cancel || !d.valid) {
        live.setRecord({ ...live.record, x: d.startX, z: d.startZ });
        if (!cancel) this.store.toast('Flowers can only be planted in a bed or on the lawn.');
        return;
      }
      if (Math.hypot(x - d.startX, z - d.startZ) > 0.01) this.store.commit(updateFlower(this.store.doc, d.id, { x, z }));
      return;
    }
    const hive = this.living.garden.hive;
    if (cancel || !d.valid) {
      this.placeHive(d.startX, d.startZ, this.store.doc.hive.heading);
      if (!cancel) this.store.toast('The hive needs a clear patch of ground.');
      return;
    }
    if (Math.hypot(hive.x - d.startX, hive.z - d.startZ) > 0.01) this.store.commit(updateHive(this.store.doc, { x: hive.x, z: hive.z }));
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  // --- shared edits -----------------------------------------------------------

  /** Turn the selected flower (its lean) or the hive (its doorway). Bursts coalesce into one undo step. */
  rotate(delta: number): void {
    const sel = this.store.get().selection;
    let next: GardenDoc | null = null;
    let key = '';
    if (sel?.kind === 'flower') {
      const f = findFlower(this.store.doc, sel.id);
      if (!f) return;
      next = updateFlower(this.store.doc, f.id, { heading: Math.atan2(Math.sin(f.heading + delta), Math.cos(f.heading + delta)) });
      key = f.id;
    } else if (sel?.kind === 'hive') {
      const h = this.store.doc.hive;
      next = updateHive(this.store.doc, { heading: Math.atan2(Math.sin(h.heading + delta), Math.cos(h.heading + delta)) });
      key = 'hive';
    }
    if (!next) return;
    const now = performance.now();
    if (this.lastRotate.key === key && now - this.lastRotate.at < 700) this.store.amend(next);
    else this.store.commit(next);
    this.lastRotate = { key, at: now };
  }

  duplicate(): void {
    const sel = this.store.get().selection;
    if (sel?.kind !== 'flower') return;
    const f = findFlower(this.store.doc, sel.id);
    if (!f) return;
    if (this.store.doc.flowers.length >= MAX_FLOWERS) {
      this.store.toast('The garden is full.');
      return;
    }
    const [x, z] = nearestPlantable(f.x + 0.9, f.z + 0.25, this.store.doc.hive);
    const copy: FlowerRecord = { ...f, id: newFlowerId(), seed: newSeed(), x, z };
    this.living.flowers.expectGrowth(copy.id, this.growDuration * 0.7);
    this.store.commit(addFlowers(this.store.doc, copy), { selection: { kind: 'flower', id: copy.id } });
  }

  remove(): void {
    const sel = this.store.get().selection;
    if (sel?.kind !== 'flower') return;
    this.store.commit(removeFlower(this.store.doc, sel.id), { selection: null });
  }

  reset(): void {
    if (this.store.doc.flowers.length === 0) return;
    this.store.commit({ ...emptyDoc(), hive: this.store.doc.hive }, { selection: null });
    this.store.toast('The garden is bare. Undo brings the flowers back.');
  }

  loadDoc(doc: GardenDoc): void {
    this.store.commit(doc, { selection: null });
  }

  undo(): void {
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  dispose(): void {
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.suggestionTimer);
    for (const u of this.unsub) u();
    this.living.dispose();
  }
}
