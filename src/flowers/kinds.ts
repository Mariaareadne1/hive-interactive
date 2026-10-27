/**
 * The flowers you can grow. Each kind has a stem height range (world metres,
 * the garden is a miniature so flowers are drawn larger than life), a few
 * cheerful-but-controlled palettes, and the leaf it carries. Colours are sRGB
 * hex; materials convert them.
 */

/** Blooms and leaves are drawn larger than life so they read at the default camera. */
export const BLOOM_SCALE = 1.65;

export type FlowerKind = 'sunflower' | 'foxglove' | 'rose' | 'daisy' | 'lavender' | 'allium' | 'poppy';

export const FLOWER_KINDS: readonly FlowerKind[] = ['sunflower', 'foxglove', 'rose', 'daisy', 'lavender', 'allium', 'poppy'];

/** What the toolbar's Plant control offers (foxglove and allium arrive through Auto). */
export type PlantChoice = 'auto' | 'sunflower' | 'rose' | 'daisy' | 'lavender' | 'poppy';
export const PLANT_CHOICES: readonly PlantChoice[] = ['auto', 'sunflower', 'rose', 'daisy', 'lavender', 'poppy'];

export type LeafShape = 'heart' | 'lance' | 'oval' | 'needle' | 'lobed' | 'strap';

export interface Palette {
  /** Petal colour near the centre, at the tip, and an accent (blotch, spots, eye). */
  readonly base: string;
  readonly tip: string;
  readonly accent: string;
}

export interface KindSpec {
  readonly label: string;
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Height of the bloom itself above the stem tip (for bounds and bee landing). */
  readonly headHeight: number;
  /** Rough bloom radius, for picking, spacing and selection boxes. */
  readonly headRadius: number;
  /** Fraction of the stem's top that is a flowering spike (lavender, foxglove). */
  readonly spike: number;
  readonly leaf: LeafShape;
  readonly leaves: number;
  readonly stemRadius: number;
  /** How far the bloom turns to face the viewer (radians). */
  readonly faceTilt: number;
  /** Extra flowering stems fanned out from the same root (lavender grows as a clump). */
  readonly clump?: number;
  readonly palettes: readonly Palette[];
}

export const KINDS: Record<FlowerKind, KindSpec> = {
  sunflower: {
    label: 'Sunflower', minHeight: 1.5, maxHeight: 3.2, headHeight: 0.18, headRadius: 0.62, spike: 0,
    leaf: 'heart', leaves: 5, stemRadius: 0.045, faceTilt: 0.55,
    palettes: [
      { base: '#e9a530', tip: '#f6d25a', accent: '#5a3a22' },
      { base: '#f0b83c', tip: '#f9e07c', accent: '#6b4426' },
      { base: '#e48e3a', tip: '#f3c457', accent: '#4e3220' },
    ],
  },
  foxglove: {
    label: 'Foxglove', minHeight: 1.3, maxHeight: 2.2, headHeight: 0.1, headRadius: 0.3, spike: 0.45,
    leaf: 'oval', leaves: 4, stemRadius: 0.03, faceTilt: 0.1,
    palettes: [
      { base: '#d886a6', tip: '#ecb6c9', accent: '#8c2f5c' },
      { base: '#f0e2d2', tip: '#fbf4ea', accent: '#a8506e' },
      { base: '#b4489a', tip: '#d77fbd', accent: '#5e1d4a' },
    ],
  },
  rose: {
    label: 'Rose', minHeight: 0.8, maxHeight: 1.5, headHeight: 0.26, headRadius: 0.36, spike: 0,
    leaf: 'oval', leaves: 4, stemRadius: 0.026, faceTilt: 0.35,
    palettes: [
      { base: '#d77f8c', tip: '#efb7b6', accent: '#a84e63' },
      { base: '#ee8e72', tip: '#f8c2a6', accent: '#c4604f' },
      { base: '#ecd7bd', tip: '#faf0e2', accent: '#d2a98a' },
      { base: '#a52a68', tip: '#cf5c8c', accent: '#701a46' },
    ],
  },
  daisy: {
    label: 'Daisy', minHeight: 0.7, maxHeight: 1.3, headHeight: 0.08, headRadius: 0.34, spike: 0,
    leaf: 'lance', leaves: 4, stemRadius: 0.02, faceTilt: 0.45,
    palettes: [
      { base: '#f3ece0', tip: '#fffaf1', accent: '#efb52e' },
      { base: '#a998d8', tip: '#cbbff0', accent: '#f0c03a' },
      { base: '#7192da', tip: '#a9bdf0', accent: '#f2c84a' },
      { base: '#ec9a86', tip: '#f8c6b4', accent: '#f0b52e' },
    ],
  },
  lavender: {
    label: 'Lavender', minHeight: 0.95, maxHeight: 1.5, headHeight: 0.04, headRadius: 0.16, spike: 0.42,
    leaf: 'needle', leaves: 8, stemRadius: 0.016, faceTilt: 0, clump: 6,
    palettes: [
      { base: '#8c78cc', tip: '#b2a1e6', accent: '#6a58ae' },
      { base: '#9d87d8', tip: '#c3b4ef', accent: '#7563b8' },
      { base: '#7f6fc2', tip: '#a597df', accent: '#5d4e9e' },
    ],
  },
  allium: {
    label: 'Allium', minHeight: 1.1, maxHeight: 1.8, headHeight: 0.42, headRadius: 0.24, spike: 0,
    leaf: 'strap', leaves: 3, stemRadius: 0.02, faceTilt: 0,
    palettes: [
      { base: '#a678cf', tip: '#c8a6e6', accent: '#7c4ea8' },
      { base: '#b26aa8', tip: '#d9a0cf', accent: '#843f7c' },
      { base: '#e9e2f2', tip: '#fbf8fe', accent: '#b8a8cf' },
    ],
  },
  poppy: {
    label: 'Poppy', minHeight: 0.8, maxHeight: 1.4, headHeight: 0.18, headRadius: 0.36, spike: 0,
    leaf: 'lobed', leaves: 3, stemRadius: 0.018, faceTilt: 0.4,
    palettes: [
      { base: '#e6624c', tip: '#f39577', accent: '#2a1d24' },
      { base: '#f08a6a', tip: '#f8b89a', accent: '#3a2228' },
      { base: '#f1e4d0', tip: '#fcf6ec', accent: '#3b2a3a' },
      { base: '#e3929e', tip: '#f4c0c4', accent: '#4a2434' },
    ],
  },
};

/** The kind a Plant choice forces, or null for Auto. */
export function forcedKind(choice: PlantChoice): FlowerKind | null {
  return choice === 'auto' ? null : choice;
}

export function clampHeight(kind: FlowerKind, h: number): number {
  const k = KINDS[kind];
  return Math.min(k.maxHeight, Math.max(k.minHeight, h));
}
