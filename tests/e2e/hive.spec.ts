import { expect, test } from '@playwright/test';
import { bloomAt, captureStats, drawStroke, flowers, groundToScreen, openGarden, screenSize, shape } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/?empty');
  await page.evaluate(() => localStorage.clear());
});

test('the canvas paints the garden on paper', async ({ page }) => {
  await openGarden(page);
  await page.waitForTimeout(800);
  const s = await captureStats(page);
  expect(s.width).toBeGreaterThan(1000);
  expect(s.paper).toBeGreaterThan(0.08); // the sheet around the tile
  expect(s.green).toBeGreaterThan(0.25); // lawn and hedge
  expect(s.soil).toBeGreaterThan(0.03); // the beds
});

const DRAWINGS = [
  ['line', 'sunflower', 1000, 470],
  ['spiral', 'rose', 960, 470],
  ['star', 'daisy', 420, 540],
  ['loops', 'lavender', 960, 440],
  ['clump', 'allium', 960, 470],
  ['circle', 'poppy', 420, 540],
  ['zigzag', 'foxglove', 960, 470],
] as const;

for (const [stroke, kind, x, y] of DRAWINGS) {
  test(`drawing a ${stroke} plants a ${kind}`, async ({ page }) => {
    await openGarden(page);
    await drawStroke(page, shape(stroke, x, y));
    const list = await flowers(page);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe(kind);
    await page.waitForFunction((id) => window.__hive!.app.living.flowers.isGrown(id), list[0].id, { timeout: 10_000 });
  });
}

test('the Plant picker overrides the guess', async ({ page }) => {
  await openGarden(page);
  await page.getByRole('radio', { name: 'Rose' }).click();
  await drawStroke(page, shape('line', 1000, 470));
  expect((await flowers(page))[0].kind).toBe('rose');
});

test('invalid places give feedback and plant nothing', async ({ page }) => {
  await openGarden(page);
  // on the gravel path
  const [px, py] = await groundToScreen(page, -3.75 + 0.54 * 2 + 0.5 * Math.sin(2 * 0.55 + 0.6), 2);
  await drawStroke(page, shape('circle', px, py - 40));
  await expect(page.locator('.toast')).toContainText(/path/i);
  // off the tile, on the paper
  await drawStroke(page, shape('circle', 200, 120));
  await expect(page.locator('.toast')).toContainText(/inside the garden/i);
  // a tiny scribble
  await drawStroke(page, [[900, 500], [906, 503], [909, 500]]);
  expect(await flowers(page)).toHaveLength(0);
});

test('bees leave the hive and land on a planted flower', async ({ page }) => {
  await openGarden(page);
  await drawStroke(page, shape('circle', 960, 470));
  const [{ id }] = await flowers(page);
  await page.waitForFunction((fid) => window.__hive!.app.living.colony.colony.bees.some((b) => b.state === 'forage' && b.flower === fid), id, { timeout: 45_000 });
});

test('flower actions change real state', async ({ page }) => {
  await openGarden(page, 'showcase');
  const id = 'sc-rose1';
  const before = (await flowers(page)).find((f) => f.id === id)!;
  const [x, y] = await bloomAt(page, id);
  await page.mouse.click(x, y);
  await expect(page.getByRole('toolbar', { name: 'Selected flower' })).toBeVisible();
  // water: taller, nectar refilled
  await page.evaluate((fid) => window.__hive!.app.living.colony.colony.nectar.set(fid, 0.1), id);
  await page.getByRole('button', { name: 'Water' }).click();
  await page.waitForFunction(([fid, h]) => window.__hive!.store.doc.flowers.find((f) => f.id === fid)!.height > (h as number) * 1.05, [id, before.height] as const, { timeout: 5_000 });
  expect(await page.evaluate((fid) => window.__hive!.app.living.colony.colony.nectar.get(fid), id)).toBeGreaterThan(0.9);
  // close and bloom: petals fold
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate((fid) => window.__hive!.app.living.flowers.get(fid)!.uniforms.uOpen.value, id)).toBeLessThan(0.2);
  await page.getByRole('button', { name: 'Bloom' }).click();
  // recolour
  await page.getByRole('button', { name: 'Recolour' }).click();
  expect((await flowers(page)).find((f) => f.id === id)!.palette).not.toBe(before.palette);
  // seed: 2-3 seedlings, one undo step
  const n = (await flowers(page)).length;
  await page.getByRole('button', { name: 'Seed' }).click();
  const after = (await flowers(page)).length;
  expect(after - n).toBeGreaterThanOrEqual(2);
  expect(after - n).toBeLessThanOrEqual(3);
  await page.keyboard.press('Meta+z');
  expect((await flowers(page)).length).toBe(n);
  // call a bee: one is sent to it
  await page.getByRole('button', { name: 'Call a bee' }).click();
  await page.waitForFunction((fid) => window.__hive!.app.living.colony.colony.bees.some((b) => b.flower === fid), id, { timeout: 5_000 });
});

test('bee and hive actions change real state', async ({ page }) => {
  await openGarden(page, 'showcase');
  await page.waitForFunction(() => window.__hive!.app.living.colony.renderer.drawn.size > 2, null, { timeout: 30_000 });
  const beeId = await page.evaluate(() => window.__hive!.app.living.colony.colony.bees.find((b) => ['wander', 'approach'].includes(b.state))!.id);
  await page.evaluate((id) => window.__hive!.store.set({ selection: { kind: 'bee', id } }), beeId);
  await page.getByRole('button', { name: 'Visit…' }).click();
  const [x, y] = await bloomAt(page, 'sc-poppy2');
  await page.mouse.click(x, y);
  // a bee standing on a flower takes off first, with the visit queued
  expect(await page.evaluate((id) => {
    const b = window.__hive!.app.living.colony.colony.get(id)!;
    return b.order?.kind === 'visit' ? b.order.flower : b.flower;
  }, beeId)).toBe('sc-poppy2');
  await page.evaluate((id) => window.__hive!.store.set({ selection: { kind: 'bee', id } }), beeId);
  await page.getByRole('button', { name: 'Follow' }).click();
  expect(await page.evaluate(() => window.__hive!.app.living.following)).toBe(beeId);
  await page.getByRole('button', { name: 'Home' }).click();
  expect(await page.evaluate((id) => window.__hive!.app.living.colony.colony.get(id)!.order?.kind, beeId)).toBe('home');

  await page.evaluate(() => window.__hive!.store.set({ selection: { kind: 'hive' } }));
  await page.getByRole('button', { name: 'Swarm' }).click();
  await page.waitForFunction(() => window.__hive!.app.living.colony.colony.bees.filter((b) => b.state === 'swarm').length >= 3, null, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Calm' }).click();
  expect(await page.evaluate(() => window.__hive!.app.living.colony.colony.calmTime)).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Sleep' }).click();
  await page.waitForFunction(() => window.__hive!.app.living.colony.colony.bees.every((b) => b.state === 'inside'), null, { timeout: 30_000 });
  await page.evaluate(() => window.__hive!.store.set({ selection: { kind: 'hive' } }));
  await page.getByRole('button', { name: 'Wake' }).click();
  await page.waitForFunction(() => window.__hive!.app.living.colony.colony.bees.some((b) => b.state !== 'inside'), null, { timeout: 10_000 });
});

test('honey rises as bees bring nectar home', async ({ page }) => {
  await openGarden(page, 'showcase');
  await page.evaluate(() => { const h = window.__hive!; h.engine.fixedStep = 1 / 30; });
  await page.waitForFunction(() => window.__hive!.app.living.colony.colony.honey > 0, null, { timeout: 90_000 });
  await page.evaluate(() => window.__hive!.store.set({ selection: { kind: 'hive' } }));
  await expect(page.locator('.honey b')).not.toHaveText('0 g');
});

test('garden-wide weather and golden hour', async ({ page }) => {
  await openGarden(page, 'showcase');
  await page.getByRole('button', { name: 'Rain shower' }).click();
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => window.__hive!.engine.world.uWet.value)).toBeGreaterThan(0.3);
  expect(await page.evaluate(() => window.__hive!.app.living.colony.colony.sheltering)).toBe(true);
  await page.getByRole('button', { name: 'Breeze' }).click();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__hive!.engine.world.uWind.value)).toBeGreaterThan(1.5);
  await page.getByRole('slider', { name: /golden hour/ }).fill('1');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__hive!.engine.world.uGolden.value)).toBeGreaterThan(0.8);
  expect(await page.evaluate(() => window.__hive!.engine.world.uSunDir.value.y)).toBeLessThan(0.5);
});

test('dragging a flower to the far side shrinks it', async ({ page }) => {
  await openGarden(page, 'showcase');
  const id = 'sc-poppy2';
  await page.waitForFunction((i) => window.__hive!.app.living.flowers.isGrown(i), id);
  const near = await screenSize(page, id);
  const [x, y] = await bloomAt(page, id);
  const [tx, ty] = await groundToScreen(page, 2.2, -3.8);
  const stem = await page.evaluate((i) => {
    const h = window.__hive!;
    const p = h.app.living.flowers.get(i)!.stemPoints()[4].clone().project(h.engine.camera);
    return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
  }, id);
  void x; void y;
  await page.mouse.move(stem[0], stem[1]);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(stem[0] + ((tx - stem[0]) * i) / 20, stem[1] + ((ty + 30 - stem[1]) * i) / 20);
  await page.mouse.up();
  const moved = (await flowers(page)).find((f) => f.id === id)!;
  expect(moved.z).toBeLessThan(-2);
  await page.waitForTimeout(300);
  expect(await screenSize(page, id)).toBeLessThan(near * 0.85);
});

test('undo, redo, clear and reload persistence', async ({ page }) => {
  await openGarden(page);
  await drawStroke(page, shape('circle', 960, 470));
  await drawStroke(page, shape('star', 420, 540));
  expect(await flowers(page)).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await flowers(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await flowers(page)).toHaveLength(2);
  await page.waitForTimeout(600); // autosave
  await page.goto('/');
  await page.waitForFunction(() => window.__hive && !window.__hive.store.get().loading);
  expect(await flowers(page)).toHaveLength(2);
  await page.getByRole('button', { name: 'Garden menu' }).click();
  await page.getByRole('button', { name: 'Clear the garden' }).click();
  expect(await flowers(page)).toHaveLength(0);
  await page.keyboard.press('Meta+z');
  expect(await flowers(page)).toHaveLength(2);
});

test('saves a PNG of the garden', async ({ page }) => {
  await openGarden(page, 'showcase');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save image' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^hive-.*\.png$/);
});

test('keyboard: tools, plant choice, tab selection, escape, hide', async ({ page }) => {
  await openGarden(page, 'showcase');
  await page.keyboard.press('v');
  expect(await page.evaluate(() => window.__hive!.store.get().tool)).toBe('move');
  await page.keyboard.press('d');
  await page.keyboard.press('3');
  expect(await page.evaluate(() => window.__hive!.store.get().plant)).toBe('daisy');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__hive!.store.get().selection?.kind)).toBe('flower');
  await page.keyboard.press('c');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__hive!.store.get().selection)).toBeNull();
  await page.keyboard.press('h');
  await expect(page.locator('.stage')).toHaveClass(/ui-hidden/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.stage')).not.toHaveClass(/ui-hidden/);
});

test('stress: 30 flowers and 14 bees stay smooth and stable', async ({ page }) => {
  await openGarden(page, 'empty');
  await page.evaluate(() => {
    const h = window.__hive!;
    const kinds = ['sunflower', 'rose', 'daisy', 'lavender', 'poppy', 'allium', 'foxglove'] as const;
    const beds = [[-5.5, 3.3, 2.0, 1.4], [4.5, 1.4, 2.8, 1.6], [2.6, -3.9, 3.0, 0.7]];
    const list = Array.from({ length: 30 }, (_, i) => {
      const b = beds[i % 3];
      return { id: `s${i}`, kind: kinds[i % 7], x: b[0] + ((i * 0.37) % 1 - 0.5) * b[2] * 1.8, z: b[1] + ((i * 0.61) % 1 - 0.5) * b[3] * 1.8, heading: 0, height: 1.2, stem: [[0, 0], [0.05, 0.5], [0, 1]], palette: i, seed: i, scale: 1, open: true };
    });
    h.app.loadDoc({ version: 1, flowers: list, hive: h.store.doc.hive } as never);
  });
  await page.waitForFunction(() => window.__hive!.app.living.colony.colony.bees.filter((b) => b.state !== 'inside').length >= 12, null, { timeout: 60_000 });
  await page.waitForTimeout(4000);
  const fps = await page.evaluate(() => window.__hive!.engine.fps);
  test.info().annotations.push({ type: 'fps', description: fps.toFixed(1) });
  expect(fps).toBeGreaterThan(20); // a loose floor: the machine is shared; the measured number is reported
  const ok = await page.evaluate(() => window.__hive!.app.living.colony.colony.bees.every((b) => Number.isFinite(b.pos.x + b.pos.y + b.pos.z)));
  expect(ok).toBe(true);
});

test('reduced motion: quicker blooms', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openGarden(page);
  expect(await page.evaluate(() => window.__hive!.engine.reducedMotion)).toBe(true);
  expect(await page.evaluate(() => window.__hive!.app.growDuration)).toBeCloseTo(0.8, 2);
  await drawStroke(page, shape('circle', 960, 470));
  const [{ id }] = await flowers(page);
  await page.waitForFunction((i) => window.__hive!.app.living.flowers.isGrown(i), id, { timeout: 5_000 });
  await ctx.close();
});

test('mobile: portrait layout and touch planting', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await openGarden(page);
  expect(await page.evaluate(() => window.__hive!.engine.camera.rotation.y)).toBeCloseTo(-Math.PI / 2, 2);
  // a touch stroke through the CDP touch API, drawn on a bed
  const [cx, cy] = await groundToScreen(page, 4.5, 1.4);
  const cdp = await ctx.newCDPSession(page);
  const pts = shape('circle', cx, cy).map(([x, y]) => [cx + (x - cx) * 0.6, cy + (y - cy) * 0.6]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await flowers(page)).length).toBe(1);
  await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
  await ctx.close();
});
