import { MIN_H, MAX_H } from './heightfield.js';

// Sculpting brushes. Each one edits the heightfield inside a circle with a soft
// cosine falloff and returns the dirty rectangle in grid coords (or null).

export const TOOLS = {
  raise: { label: 'Raise', key: '1' },
  lower: { label: 'Lower', key: '2' },
  smooth: { label: 'Smooth', key: '3' },
  flatten: { label: 'Flatten', key: '4' },
};

const RAISE_RATE = 16; // metres per second at full strength, brush centre

function falloff(d, r) {
  if (d >= r) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * (d / r)));
}

/**
 * @param {import('./heightfield.js').Heightfield} hf
 * @param {object} p  { tool, x, z, radius, strength (0..1), dt, targetHeight }
 */
export function applyBrush(hf, p) {
  const { tool, x, z, radius, strength, dt } = p;
  const { nx: res, nz, cell, h } = hf;
  const [gx, gz] = hf.toGrid(x, z);
  const gr = radius / cell;
  const i0 = Math.max(0, Math.floor(gx - gr));
  const i1 = Math.min(res - 1, Math.ceil(gx + gr));
  const j0 = Math.max(0, Math.floor(gz - gr));
  const j1 = Math.min(nz - 1, Math.ceil(gz + gr));
  if (i0 > i1 || j0 > j1) return null;

  if (tool === 'raise' || tool === 'lower') {
    const sign = tool === 'raise' ? 1 : -1;
    // larger brushes move more earth so they don't feel weak
    const amount = sign * RAISE_RATE * strength * dt * (0.6 + radius / 40);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = falloff(Math.hypot(i - gx, j - gz), gr);
        if (w <= 0) continue;
        const k = j * res + i;
        h[k] = clamp(h[k] + amount * w);
      }
    }
  } else if (tool === 'smooth') {
    // relax towards the local average; read from a snapshot of the region
    const w0 = i1 - i0 + 3;
    const src = new Float32Array(w0 * (j1 - j0 + 3));
    for (let j = j0 - 1; j <= j1 + 1; j++) {
      for (let i = i0 - 1; i <= i1 + 1; i++) {
        src[(j - j0 + 1) * w0 + (i - i0 + 1)] = hf.heightAtCell(i, j);
      }
    }
    const k = Math.min(1, 10 * strength * dt);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = falloff(Math.hypot(i - gx, j - gz), gr);
        if (w <= 0) continue;
        const si = i - i0 + 1;
        const sj = j - j0 + 1;
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) sum += src[(sj + dj) * w0 + (si + di)];
        }
        const avg = sum / 9;
        const idx = j * res + i;
        h[idx] += (avg - h[idx]) * k * w;
      }
    }
  } else if (tool === 'flatten') {
    const target = p.targetHeight;
    const k = Math.min(1, 6 * strength * dt);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = falloff(Math.hypot(i - gx, j - gz), gr);
        if (w <= 0) continue;
        const idx = j * res + i;
        h[idx] += (target - h[idx]) * k * w;
      }
    }
  } else {
    return null;
  }

  return { i0, i1, j0, j1 };
}

function clamp(v) {
  return v < MIN_H ? MIN_H : v > MAX_H ? MAX_H : v;
}

// ---------- strokes ----------
// A stroke deposits "dabs" along the path the pointer travelled, so a quick swipe
// builds a continuous ridge/trench instead of almost nothing, plus a time-based
// contribution while the pointer holds still.

const DAB_DT = 0.1; // each dab acts like 100 ms of holding the brush still

export function unionRect(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    i0: Math.min(a.i0, b.i0),
    i1: Math.max(a.i1, b.i1),
    j0: Math.min(a.j0, b.j0),
    j1: Math.max(a.j1, b.j1),
  };
}

/**
 * Advance a stroke to the pointer's current position.
 * @param {object} stroke  mutable: { last: {x,z} | null, carry: number }
 * @param {object} p       { tool, x, z, radius, strength, dt, targetHeight }
 * @returns dirty rect or null
 */
export function strokeTo(hf, stroke, p) {
  const spacing = Math.max(0.5, p.radius * 0.12);
  let rect = null;
  let moved = 0;
  if (!stroke.last) {
    rect = applyBrush(hf, { ...p, dt: DAB_DT });
    stroke.last = { x: p.x, z: p.z };
    stroke.carry = 0;
  } else {
    const dx = p.x - stroke.last.x;
    const dz = p.z - stroke.last.z;
    const dist = Math.hypot(dx, dz);
    moved = dist;
    if (dist > 1e-6) {
      // walk the segment, dropping a dab every `spacing` metres
      let travelled = spacing - stroke.carry;
      while (travelled <= dist) {
        const t = travelled / dist;
        rect = unionRect(rect, applyBrush(hf, { ...p, x: stroke.last.x + dx * t, z: stroke.last.z + dz * t, dt: DAB_DT }));
        travelled += spacing;
      }
      stroke.carry = dist - (travelled - spacing);
      stroke.last = { x: p.x, z: p.z };
    }
  }
  // holding (nearly) still keeps working the spot; skipped while moving so a
  // swipe stays an even ridge instead of a string of lumps
  if (moved < spacing * 0.5) rect = unionRect(rect, applyBrush(hf, p));
  return rect;
}
