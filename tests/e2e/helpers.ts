import type { Page } from '@playwright/test';

export async function openGarden(page: Page, query = 'empty'): Promise<void> {
  await page.goto(query ? `/?${query}` : '/');
  await page.waitForFunction(() => window.__hive && !window.__hive.store.get().loading, null, { timeout: 90_000 });
}

/** Screen-space stroke shapes (CSS px), the same families the classifier knows. */
export function shape(kind: 'line' | 'circle' | 'spiral' | 'star' | 'loops' | 'clump' | 'zigzag', cx: number, cy: number): [number, number][] {
  const pts: [number, number][] = [];
  const add = (x: number, y: number) => pts.push([x, y]);
  if (kind === 'line') for (let i = 0; i <= 40; i++) add(cx + Math.sin((i / 40) * 3) * 14, cy + 110 - i * 5.5);
  if (kind === 'circle') for (let i = 0; i <= 50; i++) { const a = Math.PI / 2 + (i / 50) * Math.PI * 2; add(cx + Math.cos(a) * 40, cy + Math.sin(a) * 38); }
  if (kind === 'spiral') for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * 2.6 * Math.PI * 2; add(cx + Math.cos(a) * 55 * (1 - 0.8 * t), cy + Math.sin(a) * 55 * (1 - 0.8 * t)); }
  if (kind === 'star') for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 22 : 60; add(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  if (kind === 'loops') for (let i = 0; i <= 180; i++) { const t = i / 30, a = t * Math.PI * 2; add(cx + Math.cos(a) * 14, cy + 90 - t * 30 + Math.sin(a) * 14); }
  if (kind === 'clump') for (let i = 0; i <= 180; i++) { const t = i / 30, a = t * Math.PI * 2, b = (t / 6) * Math.PI * 2; add(cx + Math.cos(b) * 22 + Math.cos(a) * 14, cy + Math.sin(b) * 22 + Math.sin(a) * 14); }
  if (kind === 'zigzag') for (let i = 0; i <= 70; i++) { const t = i / 70; add(cx + Math.sin(t * 7 * Math.PI) * 16, cy + 120 - t * 260); }
  return pts;
}

export async function drawStroke(page: Page, pts: [number, number][]): Promise<void> {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
}

export async function flowers(page: Page) {
  return page.evaluate(() => window.__hive!.store.doc.flowers.map((f) => ({ id: f.id, kind: f.kind, x: f.x, z: f.z, height: f.height, open: f.open, palette: f.palette })));
}

/** A flower's bloom centre in client pixels. */
export async function bloomAt(page: Page, id: string): Promise<[number, number]> {
  return page.evaluate((i) => {
    const h = window.__hive!;
    const f = h.app.living.flowers.get(i)!;
    const c = f.headCentre(f.head.position.clone()).project(h.engine.camera);
    const r = h.engine.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height] as [number, number];
  }, id);
}

/** Screen-space size of a flower's bounds (CSS px). */
export async function screenSize(page: Page, id: string): Promise<number> {
  return page.evaluate((i) => {
    const h = window.__hive!;
    const b = h.app.living.flowers.get(i)!.bounds();
    const cam = h.engine.camera;
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < 8; k++) {
      const v = b.min.clone();
      if (k & 1) v.x = b.max.x;
      if (k & 2) v.y = b.max.y;
      if (k & 4) v.z = b.max.z;
      v.project(cam);
      const sy = ((1 - v.y) / 2) * innerHeight;
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    return maxY - minY;
  }, id);
}

/** Project a world point on the ground to client pixels. */
export async function groundToScreen(page: Page, x: number, z: number): Promise<[number, number]> {
  return page.evaluate(([x, z]) => {
    const h = window.__hive!;
    const p = h.engine.camera.position.clone().set(x, 0.05, z).project(h.engine.camera);
    return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight] as [number, number];
  }, [x, z]);
}

/** Render a PNG through the app's capture path and measure its pixels in the page. */
export async function captureStats(page: Page) {
  return page.evaluate(async () => {
    const blob = await window.__hive!.engine.capturePNG(1);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let paper = 0, green = 0, soil = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      n++;
      if (r > 215 && g > 210 && Math.max(r, g, b) - Math.min(r, g, b) < 30) paper++;
      if (g > r + 10 && g > b + 10) green++;
      if (r > g + 15 && g > b && r < 170) soil++;
    }
    return { width: bmp.width, height: bmp.height, size: blob.size, paper: paper / n, green: green / n, soil: soil / n };
  });
}
