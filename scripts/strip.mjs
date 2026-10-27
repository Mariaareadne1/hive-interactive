// A bee's landing and forage as a filmstrip, from the app camera zoomed onto the flower.
// node scripts/strip.mjs [name]  ->  artifacts/<name>-strip.png
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';

const name = process.argv[2] ?? 'landing';
mkdirSync('artifacts/frames', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5376/?showcase');
await page.waitForFunction(() => window.__hive && !window.__hive.store.get().loading, null, { timeout: 90000 });
await page.evaluate(() => window.__hive.store.set({ uiHidden: true }));
await page.waitForTimeout(5000);
// call a bee to the near rose and frame it
const beeId = await page.evaluate(() => window.__hive.app.flower.callBee('sc-rose1'));
await page.waitForFunction((id) => {
  const b = window.__hive.app.living.colony.colony.get(id);
  return b && b.state === 'approach' && b.pos.distanceTo(window.__hive.app.living.colony.current.flowers.find((f) => f.id === 'sc-rose1').landing) < 1.6;
}, beeId, { timeout: 30000 });
await page.evaluate(() => {
  const h = window.__hive, f = h.app.living.flowers.get('sc-rose1'), c = f.headCentre(f.head.position.clone());
  h.engine.adaptive = false;
  h.engine.debugView({ x: c.x + 0.4, y: c.y + 1.1, z: c.z + 2.2 }, c, 30);
});
const files = [];
for (let i = 0; i < 10; i++) {
  const f = `artifacts/frames/${name}-${i}.png`;
  await page.screenshot({ path: f, clip: { x: 420, y: 150, width: 600, height: 600 } });
  files.push(f);
  console.log(i, await page.evaluate((id) => window.__hive.app.living.colony.colony.get(id)?.state, beeId));
  await page.waitForTimeout(260);
}
const layout = files.map((_, i) => `${i % 5 === 0 ? '0' : Array.from({ length: i % 5 }, () => 'w0').join('+')}_${i < 5 ? '0' : 'h0'}`).join('|');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}:v]scale=300:300[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}`, `artifacts/${name}-strip.png`]);
console.log(`artifacts/${name}-strip.png`);
await browser.close();
