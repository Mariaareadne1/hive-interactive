# HIVE — progress

## Milestones

| | Milestone | State |
|---|---|---|
| 0 | Repo, MEADOW study notes (`docs/MEADOW_STUDY.md`), art direction (`docs/ART_DIRECTION.md`) | done |
| 1 | Painted garden tile: lawn, raked beds, gravel path and apron, stones, hedge, apple tree, props, straw skep, paper edge, camera, light, shadows | done |
| 2 | Seven flower kinds modelled and painted; the bee | done |
| 3 | Planting: classifier, Plant picker, "make it a … instead", stem along the stroke, petal-by-petal bloom | done |
| 4 | Colony: spawn, wander, choose, land, forage, return, waggle dance; peek, rest, swarm, herd | done |
| 5 | Flower, bee, hive and garden-wide actions; butterflies | done |
| 6 | Interface, undo/redo, persistence, keyboard, PNG capture, recording, mobile | done |
| 7 | Scripted demo, gallery, README, case study | done |

## Verified

- Deployed 2026-10-27 to https://hive-interactive.vercel.app (Vercel CLI); the live page renders and a drawn spiral plants a rose with no page errors.

- `npm run typecheck`, `npm run lint`, `npm test` (45 unit tests), `npm run build`.
- `npm run test:e2e` and `E2E_PROD=1 npm run test:e2e` (22 browser tests each).
- Demo recorded through the app's recorder and checked with ffprobe; contact sheet inspected.
- Frame timing measured with GPU sync (see the case study for numbers and machine load).

## Not done, or only partly

- **Flower geometry variety** is two variants per kind plus per-flower colour, size, seed rotation and stem shape; more variants would help large gardens look less repetitive.
- **Foxglove** reads well up close but is slender at the default camera; the spike could carry more, larger bells.
- **Bees avoid obstacles by projection**, which is reliable but can look like a small sideways nudge when a bee's path grazes a bloom; a look-ahead planner would make detours smoother.
- **Rain** is a light shower of streaks and a darkening of the beds; there are no puddles or drips from petals.
- **Butterflies** are deliberately simple (painted wing pairs, no bodies).
- **Honey** is not saved with the garden: it belongs to the colony, which is recreated on load.
- On phones the tile turns a quarter turn and fills top to bottom, so its far corners run off the sides (as in MEADOW); the toolbar scrolls sideways to reach every Plant choice.
- Tested in Chromium only (desktop and a mobile-emulated portrait context with real touch events). Safari and Firefox have not been checked.
