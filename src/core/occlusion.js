// Contact shadows: how much of the sky each point of the snow can't see, roughly. Not a
// shadow from the sun but the soft darkening where things meet the snow:
//   - hollows and the feet of things that stand up (a kicker, a terrace's wall, a drop's
//     landing): the snow there sits below its surroundings (a few metres' blur of the heights)
//   - under trees and rocks: a soft dark disc round the base
// One value per height sample, 0 open sky .. 1 closed in. Pure JS (no three.js).

const BLUR = 3; // cells each side (x2 passes: about the 4-6 m round each point)
const DEEP = 1.1; // metres below the surroundings that count as fully closed in
const HOLLOW = 0.85; // the most a hollow darkens

// a running-sum box blur of a (nx * nz) along x then z, radius r, into out (tmp: scratch).
// Past the edges the values carry on in a straight line (mirrored about the edge), so a
// plain slope blurs to itself right up to the border.
function boxBlur(a, nx, nz, r, out, tmp) {
  const ext = (get, n, i) => (i < 0 ? 2 * get(0) - get(Math.min(n - 1, -i)) : i > n - 1 ? 2 * get(n - 1) - get(Math.max(0, 2 * (n - 1) - i)) : get(i));
  for (let j = 0; j < nz; j++) {
    const o = j * nx;
    const get = (i) => a[o + i];
    let s = 0;
    for (let i = -r; i <= r; i++) s += ext(get, nx, i);
    for (let i = 0; i < nx; i++) {
      tmp[o + i] = s / (2 * r + 1);
      s += ext(get, nx, i + r + 1) - ext(get, nx, i - r);
    }
  }
  for (let i = 0; i < nx; i++) {
    const get = (j) => tmp[j * nx + i];
    let s = 0;
    for (let j = -r; j <= r; j++) s += ext(get, nz, j);
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = s / (2 * r + 1);
      s += ext(get, nz, j + r + 1) - ext(get, nz, j - r);
    }
  }
}

/**
 * hf: the Heightfield (h, nx, nz, cell, halfX, halfZ)
 * blobs: [{ x, z, r, a }] soft dark discs in world metres (radius r, strength a 0..1)
 * out: Uint8Array(nx * nz), 0..255
 * scratch: { a, b } Float32Arrays of nx * nz (reused between calls)
 */
export function occlusion(hf, blobs, out, scratch = {}) {
  const { nx, nz, h, cell } = hf;
  const n = nx * nz;
  if (!scratch.a || scratch.a.length !== n) {
    scratch.a = new Float32Array(n);
    scratch.b = new Float32Array(n);
  }
  const { a, b } = scratch;
  boxBlur(h, nx, nz, BLUR, a, b);
  boxBlur(a, nx, nz, BLUR, a, b);
  const ao = b; // reuse: the result, 0..1
  for (let k = 0; k < n; k++) ao[k] = Math.min(1, Math.max(0, (a[k] - h[k]) / DEEP)) * HOLLOW;
  for (const o of blobs) {
    const ci = (o.x + hf.halfX) / cell;
    const cj = (o.z + hf.halfZ) / cell;
    const rc = o.r / cell;
    const i0 = Math.max(0, Math.floor(ci - rc));
    const i1 = Math.min(nx - 1, Math.ceil(ci + rc));
    const j0 = Math.max(0, Math.floor(cj - rc));
    const j1 = Math.min(nz - 1, Math.ceil(cj + rc));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - ci, j - cj) / rc;
        if (d >= 1) continue;
        const v = o.a * (1 - d) * (1 - d);
        const k = j * nx + i;
        ao[k] = 1 - (1 - ao[k]) * (1 - v);
      }
    }
  }
  for (let k = 0; k < n; k++) out[k] = Math.round(ao[k] * 255);
  return out;
}
