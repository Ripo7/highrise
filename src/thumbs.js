import { Heightfield } from './core/heightfield.js';
import { buildTemplate } from './core/templates.js';

// Shaded-relief preview of a template, drawn on its side: start on the left,
// finish on the right, like a trail map strip.

const cache = new Map();

export function drawTemplateThumb(canvas, id) {
  let entry = cache.get(id);
  if (!entry) {
    const hf = new Heightfield();
    const start = buildTemplate(hf, id);
    entry = { hf, start };
    cache.set(id, entry);
  }
  const { hf, start } = entry;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  // light from the upper left of the strip
  const L = norm([-0.5, 0.75, -0.45]);
  const sx = hf.sizeZ / W; // metres per pixel along the run
  const sy = hf.sizeX / H; // metres per pixel across
  const e = Math.max(sx, sy);
  for (let py = 0; py < H; py++) {
    const x = (py + 0.5) * sy - hf.halfX;
    for (let px = 0; px < W; px++) {
      const z = (px + 0.5) * sx - hf.halfZ;
      const hx = (hf.heightAt(x + e, z) - hf.heightAt(x - e, z)) / (2 * e);
      const hz = (hf.heightAt(x, z + e) - hf.heightAt(x, z - e)) / (2 * e);
      // exaggerate relief so features read at this size; ignore the overall fall
      const n = norm([-hx * 2.2, 1, -(hz + 0.3) * 2.2]);
      const lit = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      const slope = 1 - 1 / Math.hypot(hx, 1, hz);
      let r = 0.62 + 0.4 * lit;
      let g = 0.68 + 0.36 * lit;
      let b = 0.76 + 0.26 * lit;
      // steep faces go rocky grey-blue
      const rock = Math.min(1, Math.max(0, (slope - 0.38) / 0.2));
      r = r * (1 - rock) + 0.42 * rock;
      g = g * (1 - rock) + 0.46 * rock;
      b = b * (1 - rock) + 0.54 * rock;
      // contour every 20 m
      const hh = hf.heightAt(x, z);
      const band = Math.abs(((hh / 20) % 1) - 0.5);
      const lineW = (Math.hypot(hx, hz) * Math.max(sx, sy)) / 20 + 0.02;
      if (band > 0.5 - lineW) {
        r *= 0.86;
        g *= 0.88;
        b *= 0.9;
      }
      const k = (py * W + px) * 4;
      d[k] = Math.min(255, r * 255);
      d[k + 1] = Math.min(255, g * 255);
      d[k + 2] = Math.min(255, b * 255);
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // finish line and start gate
  const fx = ((hf.finishZ + hf.halfZ) / hf.sizeZ) * W;
  ctx.fillStyle = '#ff5a1f';
  ctx.fillRect(fx - 1.5, H * 0.12, 3, H * 0.76);
  ctx.fillStyle = '#2f6fd6';
  ctx.beginPath();
  ctx.arc(((start.z + hf.halfZ) / hf.sizeZ) * W, ((start.x + hf.halfX) / hf.sizeX) * H, Math.max(3, H * 0.06), 0, Math.PI * 2);
  ctx.fill();
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
