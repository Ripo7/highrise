// What the snow is like, everywhere on the mountain: groomed piste, deep powder or ice.
// Stored per terrain cell (same grid as the heightfield), 0..255 per channel. The physics
// reads it every step (friction, drag, grip, how deep the skis sink), the renderer draws
// it (corduroy on the piste, soft pillows in the powder, blue ice on frozen lakes).

export class SurfaceMap {
  constructor(hf) {
    this.version = 0;
    if (hf) this.resize(hf);
  }

  resize(hf) {
    this.nx = hf.nx;
    this.nz = hf.nz;
    this.cell = hf.cell;
    this.halfX = hf.halfX;
    this.halfZ = hf.halfZ;
    const n = this.nx * this.nz;
    if (!this.g || this.g.length !== n) {
      this.g = new Uint8Array(n);
      this.ice = new Uint8Array(n);
    } else {
      this.g.fill(0);
      this.ice.fill(0);
    }
    this.version++;
    return this;
  }

  // Bilinear lookup at world (x, z). Fills out.g (groomed), out.ice and out.powder, 0..1.
  at(x, z, out = { g: 1, ice: 0, powder: 0 }) {
    const gx = (x + this.halfX) / this.cell;
    const gz = (z + this.halfZ) / this.cell;
    let i = Math.floor(gx);
    let j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const rx = this.nx - 1;
    const rz = this.nz - 1;
    const i0 = i < 0 ? 0 : i > rx ? rx : i;
    const j0 = j < 0 ? 0 : j > rz ? rz : j;
    const i1 = i + 1 > rx ? rx : i + 1 < 0 ? 0 : i + 1;
    const j1 = j + 1 > rz ? rz : j + 1 < 0 ? 0 : j + 1;
    const a = j0 * this.nx + i0;
    const b = j0 * this.nx + i1;
    const c = j1 * this.nx + i0;
    const d = j1 * this.nx + i1;
    const lerp2 = (arr) => ((arr[a] * (1 - fx) + arr[b] * fx) * (1 - fz) + (arr[c] * (1 - fx) + arr[d] * fx) * fz) / 255;
    out.g = lerp2(this.g);
    out.ice = lerp2(this.ice);
    out.powder = Math.max(0, 1 - out.g - out.ice);
    return out;
  }
}
