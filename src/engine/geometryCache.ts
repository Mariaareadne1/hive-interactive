import * as THREE from 'three';
import type { GeometryArrays } from './geometry.worker';

/**
 * Shapes built off the main thread on demand and shared by every flower or
 * bee that uses them (per-instance variety comes from size, colour and
 * shading seeds). Each request is built once.
 */

const cache = new Map<string, Promise<THREE.BufferGeometry>>();
const ready = new Map<string, THREE.BufferGeometry>();
const pending = new Map<string, { resolve: (g: THREE.BufferGeometry) => void; reject: (e: Error) => void }>();
let worker: Worker | null = null;

const ITEM_SIZE: Record<string, number> = { position: 3, normal: 3, aUv: 2, aPetal: 4, aHinge: 4, aAO: 1, aPart: 1 };

export function toGeometry(arrays: GeometryArrays): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(arrays)) {
    if (name === 'index') geo.setIndex(new THREE.BufferAttribute(array, 1));
    else geo.setAttribute(name, new THREE.BufferAttribute(array, ITEM_SIZE[name] ?? 1));
  }
  geo.computeBoundingSphere();
  return geo;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ key: string; arrays?: GeometryArrays; error?: string }>) => {
    const { key, arrays, error } = event.data;
    const job = pending.get(key);
    if (!job) return;
    pending.delete(key);
    if (arrays) job.resolve(toGeometry(arrays));
    else job.reject(new Error(error ?? `Could not build ${key}`));
  };
  worker.onerror = (event) => {
    for (const job of pending.values()) job.reject(new Error(event.message || 'The geometry worker crashed'));
    pending.clear();
  };
  return worker;
}

export function loadGeometry(key: string): Promise<THREE.BufferGeometry> {
  let p = cache.get(key);
  if (!p) {
    p = new Promise<THREE.BufferGeometry>((resolve, reject) => {
      pending.set(key, { resolve, reject });
      getWorker().postMessage({ key });
    });
    cache.set(key, p);
    p.then((g) => ready.set(key, g)).catch(() => cache.delete(key));
  }
  return p;
}

/** The geometry if it has already been built (lets new flowers appear without a frame's delay). */
export function readyGeometry(key: string): THREE.BufferGeometry | undefined {
  return ready.get(key);
}
