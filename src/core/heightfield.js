// Heightfield: the single source of truth for the mountain.
// Pure JS (no Three.js) so the physics and brushes can be tested in Node.
//
// World axes: x = across the slope, z = down the slope (start at -z, finish at +z), y = up.
// The piste is a long strip, 480 m wide. Its length comes from the run the player draws
// (see profile.js); these defaults are used by tests and before a run exists.

export const SIZE_X = 480; // metres across
export const SIZE_Z = 1200; // metres from top to bottom
export const CELL = 1.5; // metres between height samples
export const MIN_H = -400;
export const MAX_H = 6000;
export const START_MARGIN = 20; // start line this far below the top edge
export const FINISH_MARGIN = 18; // finish line this far above the bottom edge

export class Heightfield {
  constructor(sizeX = SIZE_X, sizeZ = SIZE_Z, cell = CELL) {
    this.resize(sizeX, sizeZ, cell);
  }

  // Change the grid size (contents are reset when the sample count changes)
  resize(sizeX, sizeZ, cell = this.cell) {
    this.cell = cell;
    this.nx = Math.round(sizeX / cell) + 1;
    this.nz = Math.round(sizeZ / cell) + 1;
    this.sizeX = (this.nx - 1) * cell;
    this.sizeZ = (this.nz - 1) * cell;
    this.halfX = this.sizeX / 2;
    this.halfZ = this.sizeZ / 2;
    if (!this.h || this.h.length !== this.nx * this.nz) this.h = new Float32Array(this.nx * this.nz);
    return this;
  }

  sameShape(o) {
    return o.nx === this.nx && o.nz === this.nz && o.cell === this.cell;
  }

  get startZ() {
    return -this.halfZ + START_MARGIN;
  }

  get finishZ() {
    return this.halfZ - FINISH_MARGIN;
  }

  idx(i, j) {
    return j * this.nx + i;
  }

  // grid coords (float) from world coords
  toGrid(x, z) {
    return [(x + this.halfX) / this.cell, (z + this.halfZ) / this.cell];
  }

  toWorld(i, j) {
    return [i * this.cell - this.halfX, j * this.cell - this.halfZ];
  }

  inside(x, z) {
    return x >= -this.halfX && x <= this.halfX && z >= -this.halfZ && z <= this.halfZ;
  }

  heightAtCell(i, j) {
    const rx = this.nx - 1;
    const rz = this.nz - 1;
    i = i < 0 ? 0 : i > rx ? rx : i;
    j = j < 0 ? 0 : j > rz ? rz : j;
    return this.h[j * this.nx + i];
  }

  // Bilinear height at world position
  heightAt(x, z) {
    const gx = (x + this.halfX) / this.cell;
    const gz = (z + this.halfZ) / this.cell;
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

  // Height of the drawn surface (the mesh's two triangles per cell, split from (i+1, j) to
  // (i, j+1)), for things laid on the snow such as ski tracks, so they never dip under it
  heightAtMesh(x, z) {
    const gx = (x + this.halfX) / this.cell;
    const gz = (z + this.halfZ) / this.cell;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = this.heightAtCell(i, j);
    const b = this.heightAtCell(i + 1, j);
    const c = this.heightAtCell(i, j + 1);
    const d = this.heightAtCell(i + 1, j + 1);
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
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

  // Exact normal of the interpolated surface at this point (no smoothing across
  // cells), used by the physics so a skier only bends over an edge once he reaches it
  normalExactAt(x, z, out = [0, 1, 0]) {
    const gx = (x + this.halfX) / this.cell;
    const gz = (z + this.halfZ) / this.cell;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = this.heightAtCell(i, j);
    const b = this.heightAtCell(i + 1, j);
    const c = this.heightAtCell(i, j + 1);
    const d = this.heightAtCell(i + 1, j + 1);
    const dx = ((b - a) * (1 - fz) + (d - c) * fz) / this.cell;
    const dz = ((c - a) * (1 - fx) + (d - b) * fx) / this.cell;
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

  // Fill from a function of world position
  fill(fn) {
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const [x, z] = this.toWorld(i, j);
        const v = fn(x, z);
        this.h[j * this.nx + i] = v < MIN_H ? MIN_H : v > MAX_H ? MAX_H : v;
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

// Autosave encoding for the player's sculpting (heights minus the generated piste):
// 1 cm steps in 16 bits (±327 m), then base64.
export function encodeHeights(arr) {
  const q = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    q[i] = Math.max(0, Math.min(65535, Math.round(arr[i] * 100) + 32768));
  }
  const bytes = new Uint8Array(q.buffer);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function decodeHeights(str, expectedLength) {
  const bin = atob(str);
  if (bin.length !== expectedLength * 2) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Uint16Array(bytes.buffer);
  const out = new Float32Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) out[i] = (q[i] - 32768) / 100;
  return out;
}
