import { describe, expect, test } from 'vitest';
import { DOC_VERSION, MAX_FLOWERS, addFlowers, defaultDoc, emptyDoc, parseDoc, removeFlower, showcaseDoc, updateFlower, updateHive } from '../../src/state/document';
import { commit, amend, createHistory, redo, undo, canUndo, canRedo } from '../../src/state/history';
import { Store } from '../../src/state/store';
import { isPlantable, surfaceAt } from '../../src/scene/garden';
import { KINDS } from '../../src/flowers/kinds';

describe('the garden document', () => {
  test('round-trips through JSON', () => {
    const doc = showcaseDoc();
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  test('is versioned: other versions and shapes are rejected', () => {
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc({ version: 2, flowers: [] })).toBeNull();
    expect(parseDoc({ version: DOC_VERSION })).toBeNull();
    expect(parseDoc('garden')).toBeNull();
  });

  test('repairs or drops bad flowers from untrusted input', () => {
    const doc = parseDoc({
      version: 1,
      hive: { x: 999, z: -999, heading: 'north' },
      flowers: [
        { kind: 'cactus', x: 0, z: 0 },
        { kind: 'rose', x: 'a', z: 0 },
        { kind: 'rose', id: '<script>', x: 4.5, z: 1.4, height: 99, palette: -7, scale: 50, stem: [[0, 0], [5, 1]] },
        { kind: 'daisy', id: 'dup', x: 4.5, z: 1.4 },
        { kind: 'daisy', id: 'dup', x: -2.0, z: 3.0 },
      ],
    })!;
    expect(doc.flowers).toHaveLength(3);
    const rose = doc.flowers[0];
    expect(rose.id).not.toBe('<script>');
    expect(rose.height).toBe(KINDS.rose.maxHeight);
    expect(rose.palette).toBeLessThan(KINDS.rose.palettes.length);
    expect(rose.scale).toBeLessThanOrEqual(1.25);
    expect(rose.stem.at(-1)![0]).toBeLessThanOrEqual(0.45);
    expect(new Set(doc.flowers.map((f) => f.id)).size).toBe(3);
    // flowers saved on the path are moved onto plantable ground
    for (const f of doc.flowers) expect(isPlantable(surfaceAt(f.x, f.z, doc.hive))).toBe(true);
    expect(Math.abs(doc.hive.x)).toBeLessThan(10);
    expect(Number.isFinite(doc.hive.heading)).toBe(true);
  });

  test('caps the number of flowers', () => {
    const many = { version: 1, flowers: Array.from({ length: 80 }, (_, i) => ({ kind: 'daisy', x: 4 + (i % 5) * 0.1, z: 1 })) };
    expect(parseDoc(many)!.flowers.length).toBe(MAX_FLOWERS);
  });

  test('edits are immutable', () => {
    const a = defaultDoc();
    const b = updateFlower(a, a.flowers[0].id, { height: 2 });
    expect(a.flowers[0].height).not.toBe(2);
    expect(b.flowers[0].height).toBe(2);
    expect(removeFlower(b, b.flowers[0].id).flowers).toHaveLength(a.flowers.length - 1);
    expect(updateHive(a, { x: 1 }).hive.x).toBe(1);
    expect(a.hive.x).not.toBe(1);
    expect(addFlowers(emptyDoc(), ...a.flowers).flowers).toHaveLength(a.flowers.length);
  });
});

describe('undo and redo', () => {
  test('one step per commit, amend adds none', () => {
    let h = createHistory(emptyDoc());
    const d1 = addFlowers(h.present, defaultDoc().flowers[0]);
    h = commit(h, d1);
    h = amend(h, updateFlower(d1, d1.flowers[0].id, { height: 2 }));
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present.flowers).toHaveLength(0);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present.flowers[0].height).toBe(2);
    expect(undo(undo(undo(h))).present.flowers).toHaveLength(0);
  });

  test('a new commit clears the redo future', () => {
    let h = commit(createHistory(emptyDoc()), defaultDoc());
    h = undo(h);
    h = commit(h, showcaseDoc());
    expect(canRedo(h)).toBe(false);
  });

  test('undo drops a selection that no longer exists', () => {
    const store = new Store(emptyDoc());
    const f = defaultDoc().flowers[0];
    store.commit(addFlowers(store.doc, f), { selection: { kind: 'flower', id: f.id } });
    store.undo();
    expect(store.get().selection).toBeNull();
  });

  test('rapid random edits keep history consistent', () => {
    const store = new Store(emptyDoc());
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pool = showcaseDoc().flowers;
    for (let i = 0; i < 500; i++) {
      const k = r();
      if (k < 0.35) store.commit(addFlowers(store.doc, { ...pool[Math.floor(r() * pool.length)], id: `x${i}` }));
      else if (k < 0.5 && store.doc.flowers.length) store.commit(removeFlower(store.doc, store.doc.flowers[0].id));
      else if (k < 0.75) store.undo();
      else store.redo();
      expect(store.doc.flowers.length).toBeLessThanOrEqual(MAX_FLOWERS);
      expect(new Set(store.doc.flowers.map((f) => f.id)).size).toBe(store.doc.flowers.length);
    }
  });
});
