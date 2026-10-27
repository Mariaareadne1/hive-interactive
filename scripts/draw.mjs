// Draw a stroke and film the reveal: node scripts/draw.mjs <name> <shape> [cx] [cy] [frames]
// shapes: line, spiral, star, circle, loops, clump, zigzag
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

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

export function shapePoints(shape, cx, cy) {
  const pts = [];
  const add = (x, y) => pts.push([x, y]);
  if (shape === 'line') for (let i = 0; i <= 40; i++) add(cx + Math.sin(i / 40 * 3) * 14, cy + 110 - i * 5.5);
  if (shape === 'circle') for (let i = 0; i <= 50; i++) { const a = Math.PI / 2 + (i / 50) * Math.PI * 2; add(cx + Math.cos(a) * 40, cy + Math.sin(a) * 38); }
  if (shape === 'spiral') for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * 2.6 * Math.PI * 2; add(cx + Math.cos(a) * 55 * (1 - 0.8 * t), cy + Math.sin(a) * 55 * (1 - 0.8 * t)); }
  if (shape === 'star') for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 22 : 60; add(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  if (shape === 'loops') for (let i = 0; i <= 180; i++) { const t = i / 30, a = t * Math.PI * 2; add(cx + Math.cos(a) * 14, cy + 90 - t * 30 + Math.sin(a) * 14); }
  if (shape === 'clump') for (let i = 0; i <= 180; i++) { const t = i / 30, a = t * Math.PI * 2, b = (t / 6) * Math.PI * 2; add(cx + Math.cos(b) * 22 + Math.cos(a) * 14, cy + Math.sin(b) * 22 + Math.sin(a) * 14); }
  if (shape === 'zigzag') for (let i = 0; i <= 70; i++) { const t = i / 70; add(cx + Math.sin(t * 7 * Math.PI) * 16, cy + 120 - t * 260); }
  return pts;
}

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
