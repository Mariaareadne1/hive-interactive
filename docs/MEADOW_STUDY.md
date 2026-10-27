# Notes from studying MEADOW

What HIVE takes from `~/Development/meadow` (MIT, same author) and how it changes it.

| MEADOW | HIVE |
|---|---|
| `scene/shaderChunks.ts` — `paintLight`, `castLight` | copied; adds `uWet`, `uGolden` |
| `scene/terrain.ts` — parcels, hedgerows, path, `paintEdge` | `scene/groundGlsl.ts` generated from `scene/garden.ts` data: lawn, beds, gravel, apron |
| `scene/details.ts` — instanced tufts and flowers | tufts, clover, lawn daisies, fallen petals |
| `sheep/sdf.ts`, `wool.ts` — puff fields + surface nets | `scene/sdf.ts`, `scene/wool.ts`, used for hedge, ferns, snail, the bee |
| `sheep/geometry.worker.ts` + cache | `engine/geometry.worker.ts` builds blooms and the bee |
| `sheep/materials.ts` — brush-stroke `revealClip`, `shadeIn`, wet edge | per-petal brush reveal in `flowers/flowerMaterial.ts` |
| `sheep/behaviors.ts`, `controller.ts` — pure time functions, cross-fades | `flowers/growth.ts` (pure reveal timeline), `bees/colony.ts` (fixed-step state machine) |
| `engine/shadows.ts` — overrideMaterial depth pass | per-mesh depth twins so swaying stems and opening petals cast moving shadows |
| `interaction/*`, `state/*`, `app/ui/*`, `capture/recorder.ts` | adapted: stroke → flower classifier, stem from stroke, undo/redo, versioned doc, ink-composited recording |

Traps MEADOW already paid for: `new THREE.Color('#hex')` is already linear; headless Chromium needs `--use-angle=metal`; things mid-reveal must be pickable; shadows gated on reveal; canvas recording must composite the SVG ink; oversaturated shade reads purple; benchmark with GPU sync and report machine load.
