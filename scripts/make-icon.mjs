// Renders the GameForge logo (amber hexagon + anvil on graphite) to PNG icons.
// Usage: node scripts/make-icon.mjs  (requires `pnpm build:packages` first)
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePng } from '../packages/godot/dist/assets.js';

function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function render(size) {
  const s = size / 32; // logo is designed on a 32x32 grid
  const hexOuter = [
    [4, 9.5],
    [16, 3],
    [28, 9.5],
    [28, 22.5],
    [16, 29],
    [4, 22.5],
  ].map(([x, y]) => [x * s, y * s]);
  const shrink = (pts, f) =>
    pts.map(([x, y]) => [16 * s + (x - 16 * s) * f, 16 * s + (y - 16 * s) * f]);
  const hexInner = shrink(hexOuter, 0.86);
  const anvil = [
    [10, 13],
    [22, 13],
    [19.5, 17],
    [16, 17],
    [16, 23],
    [12.5, 23],
    [12.5, 17],
    [10, 17],
  ].map(([x, y]) => [x * s, y * s]);
  const bg = [20, 22, 27];
  const amber = [232, 163, 58];
  const pixels = new Uint8Array(size * size * 3);
  const radius = size * 0.18;
  const samples = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          // rounded-square background, transparent corners become dark too (PNG RGB)
          const cx = Math.min(Math.max(px, radius), size - radius);
          const cy = Math.min(Math.max(py, radius), size - radius);
          const inBg = (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
          let color = inBg ? bg : [14, 16, 19];
          if ((inside(hexOuter, px, py) && !inside(hexInner, px, py)) || inside(anvil, px, py))
            color = amber;
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      const n = samples * samples;
      const i = (y * size + x) * 3;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
    }
  }
  return encodePng(size, size, pixels);
}

mkdirSync('apps/desktop/build', { recursive: true });
writeFileSync('apps/desktop/build/icon.png', render(512));
mkdirSync('docs/assets', { recursive: true });
writeFileSync('docs/assets/logo.png', render(256));
console.log('icons written');
