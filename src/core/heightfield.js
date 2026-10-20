// Heightfield: the single source of truth for the mountain.
// Pure JS (no Three.js) so the physics and brushes can be tested in Node.
//
// World axes: x = across the slope, z = down the slope (start at -z, finish at +z), y = up.

export const WORLD_SIZE = 240; // metres, square
export const RES = 257; // vertices per side (256 cells)
export const CELL = WORLD_SIZE / (RES - 1);
export const HALF = WORLD_SIZE / 2;
export const MIN_H = -25;
export const MAX_H = 220;

export class Heightfield {
  constructor(res = RES, size = WORLD_SIZE) {
    this.res = res;
    this.size = size;
    this.half = size / 2;
    this.cell = size / (res - 1);
    this.h = new Float32Array(res * res);
  }

  idx(i, j) {
    return j * this.res + i;
  }

  // grid coords (float) from world coords
  toGrid(x, z) {
    return [(x + this.half) / this.cell, (z + this.half) / this.cell];
  }

  toWorld(i, j) {
    return [i * this.cell - this.half, j * this.cell - this.half];
  }

  inside(x, z) {
    return x >= -this.half && x <= this.half && z >= -this.half && z <= this.half;
  }

  heightAtCell(i, j) {
    const r = this.res - 1;
    i = i < 0 ? 0 : i > r ? r : i;
    j = j < 0 ? 0 : j > r ? r : j;
    return this.h[j * this.res + i];
  }

  // Bilinear height at world position
  heightAt(x, z) {
    const gx = (x + this.half) / this.cell;
    const gz = (z + this.half) / this.cell;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = this.heightAtCell(i, j);
    const b = this.heightAtCell(i + 1, j);
    const c = this.heightAtCell(i, j + 1);
    const d = this.heightAtCell(i + 1, j + 1);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  // Surface normal at world position (central differences), written into out[3]
  normalAt(x, z, out = [0, 1, 0]) {
    const e = this.cell;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const len = Math.hypot(dx, 1, dz);
    out[0] = -dx / len;
    out[1] = 1 / len;
    out[2] = -dz / len;
    return out;
  }

  copy() {
    return new Float32Array(this.h);
  }

  set(data) {
    this.h.set(data);
  }

  // The default mountain: a concave run (steep at the top, easing out at the bottom),
  // channelled between two valley walls, with a little natural undulation.
  generateDefault(seed = 7) {
    const noise = makeValueNoise(seed);
    const { res, half } = this;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const [x, z] = this.toWorld(i, j);
        const t = (half - z) / (2 * half); // 1 at top, 0 at bottom
        let h = 95 * Math.pow(t, 1.35);
        // valley walls
        const ax = Math.abs(x);
        h += 28 * smoothstep(55, 118, ax) + 6 * smoothstep(30, 90, ax);
        // undulation
        h += 2.2 * noise(x * 0.025, z * 0.025) + 0.8 * noise(x * 0.07 + 31, z * 0.07 - 12);
        // gentle start plateau at the height of the start line (no ledge to drop off)
        const plateau = 88.5 + 28 * smoothstep(55, 118, ax) + 6 * smoothstep(30, 90, ax) + 2.2 * noise(x * 0.025, z * 0.025);
        h = mix(h, plateau, smoothstep(-98, -114, z));
        this.h[this.idx(i, j)] = h;
      }
    }
  }
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

// Small deterministic 2D value noise in roughly [-1, 1]
export function makeValueNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [p[i], p[k]] = [p[k], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (i, j) => perm[(perm[i & 255] + j) & 511] / 127.5 - 1;
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = val(i, j);
    const b = val(i + 1, j);
    const c = val(i, j + 1);
    const d = val(i + 1, j + 1);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  };
}

// Encode/decode for autosave (Float32 -> base64)
export function encodeHeights(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function decodeHeights(str, expectedLength) {
  const bin = atob(str);
  if (bin.length !== expectedLength * 4) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
