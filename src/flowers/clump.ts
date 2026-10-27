import * as THREE from 'three';
import { STEM_SAMPLES, createFlowerMaterials, stemGeometry, type FlowerMaterials, type FlowerUniforms } from './flowerMaterial';
import { SHADOW_LAYER, setDepthMaterial } from '../engine/shadows';
import type { WorldUniforms } from '../scene/world';

/**
 * A sibling stem in a clump (lavender): it shares the flower's colours and
 * bloom timeline, but has its own curve — the drawn stem turned round the
 * root and leaning outward — and its own flowering spike.
 */

const UP = new THREE.Vector3(0, 1, 0);

export class ClumpStem {
  readonly stem: THREE.Mesh;
  readonly head = new THREE.Group();
  private headMesh: THREE.Mesh | null = null;
  private readonly curve: THREE.Vector3[];
  private readonly materials: FlowerMaterials;
  private readonly tip = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();

  constructor(world: WorldUniforms, uniforms: FlowerUniforms, readonly angle: number, readonly lean: number, readonly heightK: number, root: THREE.Object3D) {
    this.curve = Array.from({ length: STEM_SAMPLES }, () => new THREE.Vector3());
    this.materials = createFlowerMaterials(world, uniforms, { uCurve: { value: this.curve } });
    this.stem = new THREE.Mesh(stemGeometry(), this.materials.stem);
    this.stem.frustumCulled = false;
    setDepthMaterial(this.stem, this.materials.stemDepth);
    root.add(this.stem, this.head);
  }

  setHeadGeometry(geo: THREE.BufferGeometry, scale: number): void {
    if (this.headMesh) return;
    this.headMesh = new THREE.Mesh(geo, this.materials.head);
    this.headMesh.frustumCulled = false;
    setDepthMaterial(this.headMesh, this.materials.headDepth);
    this.head.add(this.headMesh);
    this.head.scale.setScalar(scale);
  }

  /** Follow the main stem, turned about the root, leaning out and a little shorter. */
  layout(main: readonly THREE.Vector3[], grow: number, height: number, headSpin: number, visible: boolean): void {
    const base = main[0];
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const n = main.length;
    for (let i = 0; i < n; i++) {
      const p = main[i];
      const ox = p.x - base.x, oz = p.z - base.z, oy = (p.y - base.y) * this.heightK;
      const t = i / (n - 1);
      const out = this.lean * height * Math.pow(t, 1.3);
      this.curve[i].set(base.x + c * ox - s * oz + Math.cos(this.angle) * out, base.y + oy, base.z + s * ox + c * oz + Math.sin(this.angle) * out);
    }
    const g = Math.max(0.02, grow) * (n - 1);
    const i0 = Math.min(n - 2, Math.floor(g));
    this.tip.copy(this.curve[i0]).lerp(this.curve[i0 + 1], g - i0);
    this.tangent.copy(this.curve[i0 + 1]).sub(this.curve[Math.max(0, i0 - 1)]).normalize();
    this.head.position.copy(this.tip);
    this.head.quaternion.setFromUnitVectors(UP, this.tangent);
    this.head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, headSpin + this.angle));
    this.head.visible = visible;
  }

  setShadows(stem: boolean, head: boolean): void {
    if (stem) this.stem.layers.enable(SHADOW_LAYER);
    else this.stem.layers.disable(SHADOW_LAYER);
    if (this.headMesh) {
      if (head) this.headMesh.layers.enable(SHADOW_LAYER);
      else this.headMesh.layers.disable(SHADOW_LAYER);
    }
  }

  points(): readonly THREE.Vector3[] {
    return this.curve;
  }

  dispose(): void {
    this.stem.geometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
  }
}
