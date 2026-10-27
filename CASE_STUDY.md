# HIVE — case study

## The brief

MEADOW, a painted tile where a loop you draw becomes a woolly sheep, went viral on X. HIVE had to feel like the same artist made it — the same art style, the same interaction grammar, the same quality bar — but in a new world: you draw **flowers**, and a colony of **bees** brings the garden to life around what you planted. The short screen recording of MEADOW that inspired this version set the bar for the interface: a tile on warm paper, a thin blue selection box with a world-unit label, and a cream pill of contextual actions under whatever you picked.

## Starting from MEADOW

HIVE is a fork of MEADOW's engine, not a rewrite. Kept almost verbatim: the painted light ramp (`paintLight`: warm lit side, lavender shade), the contact-hardening sun shadows, the post pass, the perspective camera that solves its distance to fit the tile at any aspect (with a quarter turn on tall screens), the analytic-height raycast, puff fields meshed with surface nets in a Web Worker, the pointer state machine, the immutable document with undo/redo, and the recorder that composites the SVG pen line into the video. `docs/MEADOW_STUDY.md` maps each piece to where it went.

What MEADOW had already paid for, HIVE inherited as rules: colours from hex are already linear; headless Chromium needs `--use-angle=metal`; things mid-reveal must be pickable; shadows wait for the thing that casts them; canvas recording must composite the ink; saturated shade reads purple; benchmarks need a GPU sync and a note of the machine's load.

## The garden

`scene/garden.ts` is the single source of truth for the layout — four rounded, slightly rotated beds, a path running from the front edge to the hive's gravel apron, stepping stones, a hedge line, props — and for the rules built on it: `surfaceAt(x, z)` says *bed*, *lawn*, *path*, *stone*, *hedge*, *hive*, *prop* or *edge*, and only beds and lawn take flowers. The ground shader (`scene/groundGlsl.ts`) is **generated** from the same numbers, so what you see painted as a path is exactly where planting is refused.

The painting follows MEADOW's gouache recipe at a garden's scale: broad lawn washes with faint mowing stripes and cooler clover patches; beds in warm umber with wavering raked furrows, round crumbs and a darker spade-cut edge; gravel as warm and cool pebble cells; the ragged dry-brush edge where paint breaks onto paper. Props are painted with one shared material: a clipped hedge and leafy clumps from puff fields with a dry-brush silhouette, stepping stones, an apple tree, a sage watering can, a terracotta water dish, a ladybird that ambles round its leaf, and a snail on a stone.

The skep is a lathe of rolled straw coils whose shader paints fibres, grooves and binding stitches offset like brickwork, with a dark arched doorway over a landing board. Honey soaks up the straw from the base as amber, and a drip slowly forms under the board.

## Flowers: modelled, then opened by the GPU

The first decision was not to use cards. Each petal is a **parametric surface** (`flowers/petal.ts`): a width profile with a chosen widest point and a round or pointed tip, a cup across its width, a curl along its length, a ruffled edge, and a narrow claw at the base. Seven kinds are built from these and a few other primitives (domes for discs and pods, balls, flared foxglove bells) in `flowers/heads.ts` — 42 ray petals in two rings round a seeded sunflower disc, four papery poppy petals over a crown of dark stamens and a grey pod, five rings of cupped, reflexed rose petals, lavender whorls, a ball of 150 allium florets, a spire of freckled bells.

The trick that makes the bloom possible is in the **vertex attributes**. Every petal vertex carries its petal's azimuth, its opening order, its open and closed tilt and its hinge. The vertex shader tilts each petal about its own hinge, so a single uniform timeline opens the bud petal by petal with a back-out overshoot, and a second uniform folds the flower for *Close* or at golden hour. Florets and bells grow from nothing instead. The petal fragment shader paints the reveal MEADOW-style: brush strokes from the heart of each petal to its tip, green bud under-paint first, then flat colour, then light and shade, with the darker wet edge of gouache at the front.

Shade on petals is mixed toward a neutral grey-lavender (the rose read purple until it was). Specks — pollen, crumbs, foxglove freckles — are round, because square hash cells read as digital in close-ups.

## The stroke is the stem

The stem is **generated on the GPU**. Its geometry is just a grid of (s, angle) pairs; the vertex shader places each ring on a 24-point curve passed as a uniform, tapers it, and collapses everything above the growth front to a soft point. So the stem can grow along the drawn line, sway, dip under a bee and stretch when watered without rebuilding anything.

The curve comes from your stroke (`flowers/stem.ts`, `interaction/planting.ts`). The flower is planted where the stroke's lowest point meets the ground. Every stroke point is cast onto an upright plane through that point, square to the camera, giving (lateral, height) in metres. From the lowest point the code walks the stroke in whichever direction climbs highest, keeping only rising points: a straight line becomes a straight stem, a curve a curved one, and a loop's rising side a bowed stem with the bloom on top. It is resampled, lightly smoothed, kept to a graceful lean, normalised to unit height and saved with the flower, so undo, reload and watering regrow exactly what you drew. A unit test checks that the stem lies on the projected stroke within 2 cm.

## Reading a doodle

`interaction/classify.ts` measures a few forgiving features — aspect, net winding in turns, sharp corners (turn accumulated over a short window, so a rounded hairpin counts once), left-right reversals while climbing, how far apart successive loops are centred, roundness — and scores each kind 0..1. Two lessons came from real browser strokes rather than fixtures: the pointer reports few points on fast strokes, so the line is **resampled at even spacing** before measuring; and the stroke must be classified **before** smoothing, because smoothing rounds a star's corners into a poppy. When the call is close, the runner-up is offered as *Make it a … instead* for three seconds; accepting it regrows the flower in the same undo step.

## The colony

`bees/colony.ts` is pure TypeScript with a seeded RNG and a fixed 1/60 s step, so a run is reproducible and testable. The hive keeps about one bee out per 1.5 blooming flowers (up to 14); with none, one bee peeks out of the doorway now and then and goes back in. A bee emerges, wanders on its own smooth noise lane, chooses a flower weighted by nectar, distance, crowding and novelty, hovers above the bloom and descends onto the flower's actual landing point (which moves as the flower sways), forages — the flower dips under its weight and gold collects on its legs — takes off, and after a few flowers flies home. If the flower was rich it does a figure-eight waggle dance on the landing board before squeezing back through the doorway, delivering its load as honey.

Flight is arrival steering plus the noise lane plus loose separation, and then a **hard projection** out of every stem capsule, bloom sphere and the hive's cylinder (except the one the bee is landing on or entering), so a bee cannot pass through anything; a test checks every flying bee's clearance for 90 s of simulation. The renderer (`bees/BeeRenderer.ts`) is one instanced draw for bodies and one for wings: bobbing flight, a lean into turns, legs that tuck in flight and reach down to land, a wiggle in the petals, a waggle on the board, a squeeze through the door, crisp veined wings at rest and a shimmering blur in flight.

The bee itself is MEADOW's sheep recipe at a tiny scale: a puff-field body (head, thorax, plump abdomen) with soft charcoal bands painted by position, big dark eyes with a strong catchlight so they read when the bee is 20 px across, bobbing antennae, six legs.

## Life you can ask for

Flowers: *Water* (a watering can floats in and tips, sparkles and drops fall, the flower bounces, grows ~10% taller and its nectar refills), *Bloom/Close*, *Sway* (a gust that nudges neighbours), *Seed* (two or three seedlings that grow into smaller copies, one undo step), *Recolour* (a cross-fade through the kind's palette), *Call a bee*. Bees: *Follow* (a dotted trail), *Visit…* then tap a flower, *Dance*, *Rest* on a leaf grooming, *Home*; dragging a bee herds it. The hive: *Wake/Sleep*, *Swarm* (a loop-de-loop cloud over the skep), *Calm* (a puff of smoke, ten lazy seconds), and a honey jar readout. The garden: *Breeze* (stems lean and petals drift across), *Rain* (streaks, darker beds, glossy petals; bees shelter and come back after), and a *Day ↔ golden hour* slider that lowers and warms the sun, lengthens shadows and half-closes the flowers. Butterflies drift in once six or more flowers are in bloom and steer clear of whatever is selected.

## Verification

- **Unit (45 tests):** classification fixtures for every kind and an ambiguous case; planting surfaces and messages; the stem following the stroke; document validation, repair and versioning; undo/redo including 500 random edits; the reveal timeline (monotonic, shadows never early, reduced motion); the colony (deterministic per seed, landing exactly on the landing point, never inside an obstacle, every state reachable and exited, nectar and honey bookkeeping, sleep and wake, calling a bee, 3 000 fuzzed requests without NaNs or runaway bees).
- **Browser (22 Playwright tests, Chromium with WebGL via Metal), against both the dev server and the production build:** the canvas paints garden and paper; each of the seven strokes plants its kind; the picker overrides; invalid places give feedback; bees land on a planted flower; every flower, bee and hive action changes real state; honey rises; rain, breeze and golden hour; dragging a flower to the far side shrinks it on screen; undo, redo, clear and reload persistence; PNG download; keyboard; a 30-flower, 14-bee stress run; reduced motion; mobile portrait with real touch events.
- **Visual QA:** close-ups of each kind and of the bee and skep, the reveal frame by frame for every stroke, selections and actions, golden hour, mobile portrait, and a contact sheet of the demo.
- **Performance:** with 30 flowers and 14 bees at 2880×1800 (device pixel ratio 2), back-to-back frames with a pixel readback after each: median 15.3 ms, p90 16.7 ms, p99 18.6 ms, while the 12-core machine had a load average of 6.3.
- **Media:** the demo, recorded through the app's own recorder, verified with ffprobe: H.264, 1600×900, 25.7 s.

## What I'd do next

See [PROGRESS.md](PROGRESS.md) for the honest list.
