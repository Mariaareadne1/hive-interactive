// Draw a stroke and film the reveal: node scripts/draw.mjs <name> <shape> [cx] [cy] [frames]
// shapes: line, spiral, star, circle, loops, clump, zigzag
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { shapePoints } from './shapes.mjs';

const [name = 'draw', shape = 'line', cxA = '1000', cyA = '480', framesA = '10'] = process.argv.slice(2);
const cx = Number(cxA), cy = Number(cyA), frames = Number(framesA);
mkdirSync('artifacts/frames', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5376/?empty');
await page.evaluate(() => localStorage.clear());
await page.waitForFunction(() => window.__hive && !window.__hive.store.get().loading, null, { timeout: 60000 });
await page.waitForTimeout(1500);


const pts = shapePoints(shape, cx, cy);
await page.mouse.move(...pts[0]);
await page.mouse.down();
for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 2 });
await page.mouse.up();
const files = [];
for (let i = 0; i < frames; i++) {
  const f = `artifacts/frames/${name}-${i}.png`;
  await page.screenshot({ path: f, clip: { x: cx - 200, y: cy - 260, width: 400, height: 420 } });
  files.push(f);
  await page.waitForTimeout(170);
}
const info = await page.evaluate(() => {
  const h = window.__hive;
  const f = h.store.doc.flowers.at(-1);
  return f ? { kind: f.kind, height: f.height.toFixed(2), sug: h.store.get().suggestion?.alternative ?? null } : { toast: h.store.get().toast?.text };
});
console.log(name, JSON.stringify(info));
const args = files.flatMap((f) => ['-i', f]);
const layout = files.map((_, i) => `${i % 5 === 0 ? '0' : Array.from({ length: i % 5 }, () => 'w0').join('+')}_${Math.floor(i / 5) === 0 ? '0' : 'h0'}`).join('|');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args, '-filter_complex', `${files.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${files.length}:layout=${layout}`, `artifacts/${name}-strip.png`]);
await browser.close();
