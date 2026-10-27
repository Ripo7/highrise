// What the snow is like, everywhere on the mountain. Packed natural snow unless a channel
// says otherwise: groomed corduroy, deep powder, ice, or bare rock. Stored per terrain cell
// (same grid as the heightfield), 0..255 per channel. The physics reads it every step
// (friction, drag, grip, how deep the skis sink), the renderer draws it (corduroy, soft
// pillows in the powder, blue ice, rock faces). Rock rides like hard snow.

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
      this.rock = new Uint8Array(n);
      this.pow = new Uint8Array(n);
    } else {
      this.g.fill(0);
      this.ice.fill(0);
      this.rock.fill(0);
      this.pow.fill(0);
    }
    this.version++;
    return this;
  }

  // Bilinear lookup at world (x, z). Fills out.groomed, out.ice, out.powder, out.rock, 0..1
  // (all 0: packed snow).
  at(x, z, out = { groomed: 0, ice: 0, powder: 0, rock: 0 }) {
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
    out.rock = lerp2(this.rock);
    out.groomed = lerp2(this.g);
    out.ice = lerp2(this.ice);
    out.powder = Math.min(lerp2(this.pow), Math.max(0, 1 - out.groomed - out.ice - out.rock));
    return out;
  }
}
