/// <reference lib="webworker" />
import { buildHead } from '../flowers/heads';
import { buildBee } from '../bees/beeGeometry';
import type { FlowerKind } from '../flowers/kinds';

/**
 * Bloom and bee meshing runs here so the garden keeps painting while new
 * shapes are built. Requests are keyed strings: "head:<kind>:<variant>" or "bee".
 */

export type GeometryArrays = Record<string, Float32Array | Uint32Array>;

function build(key: string): GeometryArrays {
  const [type, kind, variant] = key.split(':');
  if (type === 'head') return buildHead(kind as FlowerKind, Number(variant));
  if (type === 'bee') return buildBee();
  throw new Error(`Unknown geometry ${key}`);
}

self.onmessage = (event: MessageEvent<{ key: string }>) => {
  const { key } = event.data;
  try {
    const arrays = build(key);
    (self as unknown as Worker).postMessage({ key, arrays }, Object.values(arrays).map((a) => a.buffer) as Transferable[]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ key, error: String(error) });
  }
};
