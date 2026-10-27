// A small top-down picture of a wild mountain for the chooser: shaded relief, rock, and
// the forest, drawn straight from the generator (no 3D, a few tens of milliseconds).

import { makeWild, wildDims } from './core/wild.js';
import { START_MARGIN } from './core/heightfield.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function drawPreview(canvas, m, theme) {
  const gen = makeWild(m);
  const { sizeX, sizeZ } = wildDims(m);
  const W = canvas.width;
  const H = Math.round(Math.min(300, (W * sizeZ) / sizeX));
  canvas.height = H;
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  const mx = sizeX / W;
  const mz = sizeZ / H;
  const hs = new Float32Array((W + 2) * (H + 2));
  const at = (i, j) => hs[(j + 1) * (W + 2) + (i + 1)];
  for (let j = -1; j <= H; j++) {
    for (let i = -1; i <= W; i++) {
      hs[(j + 1) * (W + 2) + (i + 1)] = gen.height((i + 0.5) * mx - sizeX / 2, (j + 0.5) * mz - START_MARGIN);
    }
  }
  const lit = hex(theme.snow[0]);
  const mid = hex(theme.snow[1]);
  const sh = hex(theme.snow[2]);
  const rock = hex(theme.rock[1]);
  const tree = hex(theme.needles[2]);
  const L = [-0.55, 0.62, -0.56];
  const ll = Math.hypot(...L);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * mx);
      const gz = (at(i, j + 1) - at(i, j - 1)) / (2 * mz);
      const nl = Math.hypot(gx, 1, gz);
      const d = (-gx * L[0] + L[1] - gz * L[2]) / (nl * ll);
      const t = Math.max(0, Math.min(1, (d - 0.15) / 0.75));
      let c = t < 0.5 ? mix(sh, mid, t * 2) : mix(mid, lit, (t - 0.5) * 2);
      const x = (i + 0.5) * mx - sizeX / 2;
      const u = (j + 0.5) * mz - START_MARGIN;
      const slope = 1 - 1 / nl;
      const rk = Math.max(gen.rock(x, u), slope > 0.3 ? 1 : 0);
      if (rk > 0.4) c = mix(c, rock, 0.85);
      else {
        const tr = gen.trees(x, u, slope);
        if (tr > 0.2) c = mix(c, tree, Math.min(0.75, (tr - 0.2) * 1.2) * (0.75 + 0.25 * t));
      }
      const o = (j * W + i) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
