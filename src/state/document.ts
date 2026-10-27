import { FLOWER_KINDS, KINDS, clampHeight, type FlowerKind } from '../flowers/kinds';
import { defaultProfile, sanitizeProfile, type P2 } from '../flowers/stem';
import { HIVE_HOME, clampHive, isPlantable, nearestPlantable, surfaceAt } from '../scene/garden';

/**
 * The persisted garden: plain, versioned, immutable data. Flowers keep the
 * shape of the stroke that grew them; the hive keeps its place. Bees are
 * simulation state, recreated from the flowers, and are never saved.
 */

export interface FlowerRecord {
  readonly id: string;
  readonly kind: FlowerKind;
  readonly x: number;
  readonly z: number;
  /** Yaw of the upright plane the stem was drawn in (its lateral axis). */
  readonly heading: number;
  /** Stem height in metres. */
  readonly height: number;
  /** Stem shape: (lateral, up) normalised to unit height. */
  readonly stem: readonly P2[];
  readonly palette: number;
  readonly seed: number;
  /** Overall size of bloom and leaves (seedlings are smaller). */
  readonly scale: number;
  /** Petals open (true) or folded (Close). */
  readonly open: boolean;
}

export interface HiveRecord {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface GardenDoc {
  readonly version: 1;
  readonly flowers: readonly FlowerRecord[];
  readonly hive: HiveRecord;
}

export const DOC_VERSION = 1;
export const MAX_FLOWERS = 40;
export const DEFAULT_HIVE: HiveRecord = { x: HIVE_HOME.x, z: HIVE_HOME.z, heading: 0.55 };

export const emptyDoc = (): GardenDoc => ({ version: DOC_VERSION, flowers: [], hive: DEFAULT_HIVE });

let counter = 0;
export function newFlowerId(): string {
  counter = (counter + 1) % 1e6;
  return `f${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

export function addFlowers(doc: GardenDoc, ...flowers: FlowerRecord[]): GardenDoc {
  return { ...doc, flowers: [...doc.flowers, ...flowers].slice(0, MAX_FLOWERS) };
}

export function updateFlower(doc: GardenDoc, id: string, patch: Partial<Omit<FlowerRecord, 'id'>>): GardenDoc {
  return { ...doc, flowers: doc.flowers.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function removeFlower(doc: GardenDoc, id: string): GardenDoc {
  return { ...doc, flowers: doc.flowers.filter((f) => f.id !== id) };
}

export function updateHive(doc: GardenDoc, patch: Partial<HiveRecord>): GardenDoc {
  return { ...doc, hive: { ...doc.hive, ...patch } };
}

export function findFlower(doc: GardenDoc, id: string | null): FlowerRecord | undefined {
  return id ? doc.flowers.find((f) => f.id === id) : undefined;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Repair one flower from untrusted data, or null if it is unusable. */
function parseFlower(raw: unknown, seen: Set<string>, hive: HiveRecord): FlowerRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!FLOWER_KINDS.includes(r.kind as FlowerKind)) return null;
  if (!isNum(r.x) || !isNum(r.z)) return null;
  const kind = r.kind as FlowerKind;
  const id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) && !seen.has(r.id) ? r.id : newFlowerId();
  seen.add(id);
  let [x, z] = [r.x, r.z];
  if (!isPlantable(surfaceAt(x, z, hive))) [x, z] = nearestPlantable(x, z, hive);
  const palettes = KINDS[kind].palettes.length;
  return {
    id,
    kind,
    x,
    z,
    heading: isNum(r.heading) ? wrap(r.heading) : 0,
    height: clampHeight(kind, isNum(r.height) ? r.height : KINDS[kind].minHeight),
    stem: r.stem === undefined ? defaultProfile() : sanitizeProfile(r.stem),
    palette: isNum(r.palette) ? Math.abs(Math.floor(r.palette)) % palettes : 0,
    seed: isNum(r.seed) ? Math.abs(Math.floor(r.seed)) % 1e6 : 0,
    scale: isNum(r.scale) ? Math.min(1.25, Math.max(0.45, r.scale)) : 1,
    open: r.open !== false,
  };
}

/**
 * Validate untrusted input (localStorage, imported files). Bad flowers are
 * dropped rather than failing the whole file; a wrong shape returns null.
 */
export function parseDoc(input: unknown): GardenDoc | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { version?: unknown; flowers?: unknown; hive?: unknown };
  if (raw.version !== DOC_VERSION || !Array.isArray(raw.flowers)) return null;
  let hive = DEFAULT_HIVE;
  if (raw.hive && typeof raw.hive === 'object') {
    const h = raw.hive as Record<string, unknown>;
    if (isNum(h.x) && isNum(h.z)) {
      const [x, z] = clampHive(h.x, h.z);
      hive = { x, z, heading: isNum(h.heading) ? wrap(h.heading) : DEFAULT_HIVE.heading };
    }
  }
  const seen = new Set<string>();
  const flowers: FlowerRecord[] = [];
  for (const f of raw.flowers.slice(0, MAX_FLOWERS)) {
    const rec = parseFlower(f, seen, hive);
    if (rec) flowers.push(rec);
  }
  return { version: DOC_VERSION, flowers, hive };
}

// --- arrangements -----------------------------------------------------------------

const flower = (id: string, kind: FlowerKind, x: number, z: number, height: number, palette: number, lean = 0.06, seed = 1): FlowerRecord => ({
  id, kind, x, z, heading: 0, height: clampHeight(kind, height), stem: defaultProfile(lean), palette, seed, scale: 1, open: true,
});

/** What a first-time visitor sees: a few flowers already up, so the bees have somewhere to go. */
export function defaultDoc(): GardenDoc {
  return {
    version: DOC_VERSION,
    hive: DEFAULT_HIVE,
    flowers: [
      flower('first-sun', 'sunflower', 5.6, -3.6, 2.2, 0, 0.05, 3),
      flower('first-poppy', 'poppy', -5.0, 3.0, 1.0, 0, -0.1, 5),
      flower('first-daisy', 'daisy', -6.2, 3.8, 0.9, 0, 0.12, 7),
      flower('first-lav', 'lavender', 3.4, 1.3, 0.95, 0, 0.04, 9),
    ],
  };
}

/** A reproducible, busy garden at different depths, for screenshots and the demo. */
export function showcaseDoc(): GardenDoc {
  return {
    version: DOC_VERSION,
    hive: DEFAULT_HIVE,
    flowers: [
      flower('sc-sun1', 'sunflower', 1.0, -3.9, 2.4, 0, 0.06, 11),
      flower('sc-sun2', 'sunflower', 3.6, -4.1, 2.0, 1, -0.08, 12),
      flower('sc-fox', 'foxglove', 5.8, -3.8, 1.9, 0, 0.03, 13),
      flower('sc-rose1', 'rose', 3.0, 1.0, 1.1, 0, 0.1, 14),
      flower('sc-rose2', 'rose', 4.4, 2.1, 0.95, 1, -0.12, 15),
      flower('sc-lav1', 'lavender', 6.2, 0.6, 0.95, 0, 0.04, 16),
      flower('sc-lav2', 'lavender', 6.8, 1.4, 0.85, 1, -0.05, 17),
      flower('sc-daisy1', 'daisy', -6.4, 2.8, 1.0, 0, 0.12, 18),
      flower('sc-daisy2', 'daisy', -4.6, 3.9, 0.85, 2, -0.1, 19),
      flower('sc-poppy1', 'poppy', -5.4, 3.4, 1.15, 0, 0.08, 20),
      flower('sc-poppy2', 'poppy', 7.6, 5.5, 1.0, 1, -0.06, 21),
      flower('sc-allium', 'allium', 1.8, 1.8, 1.5, 0, 0.03, 22),
    ],
  };
}
