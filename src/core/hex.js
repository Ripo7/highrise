// The build grid: hexagons laid in rows across the slope, every other row shifted by half a
// tile. Pointy-top hexes, "odd-r" offset coordinates: column i from the left edge, row j
// from the top line. A tile is about the size of the old 10 m squares (94 m² against 100).
//
// Grid space: x from the left edge of the mountain, u from the top line, in metres.
// Axial coordinates (q, r) are used for the maths (neighbours, rings, lines).

export const HEX_R = 6; // centre to corner
export const HEX_W = Math.sqrt(3) * HEX_R; // across the flats, side to side (10.4 m)
export const HEX_H = 1.5 * HEX_R; // from one row to the next (9 m)

const odd = (j) => j & 1; // 0 or 1, also for negative rows

export const toAxial = (i, j) => [i - (j - odd(j)) / 2, j];
export const fromAxial = (q, r) => [q + (r - odd(r)) / 2, r];

// the centre of tile (i, j) in grid space: [x, u]
export const hexCenter = (i, j) => [HEX_W * (i + 0.5 + 0.5 * odd(j)), HEX_R + HEX_H * j];

// round fractional axial coordinates to the tile they fall in
function axialRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

// the tile at grid point (x, u): { i, j }
export function hexAt(x, u) {
  const px = x - HEX_W * 0.5;
  const py = u - HEX_R;
  const q = ((Math.sqrt(3) / 3) * px - py / 3) / HEX_R;
  const r = ((2 / 3) * py) / HEX_R;
  const [aq, ar] = axialRound(q, r);
  const [i, j] = fromAxial(aq, ar);
  return { i, j };
}

// how many tiles fit: every row whole inside the width, every tile inside the length
export const hexCols = (width) => Math.max(1, Math.floor(width / HEX_W - 0.5));
export const hexRows = (length) => Math.max(1, Math.floor((length - 2 * HEX_R) / HEX_H) + 1);

// the tiles within `radius` steps of (i, j) (0: the tile itself, 1: and its 6 neighbours, ...)
export function hexDisk(i, j, radius) {
  const [q, r] = toAxial(i, j);
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) out.push(fromAxial(q + dq, r + dr));
  }
  return out;
}

// steps between two tiles
export function hexDistance(a, b) {
  const [aq, ar] = toAxial(a.i, a.j);
  const [bq, br] = toAxial(b.i, b.j);
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// the tiles on a straight line from a to b (both included), each next to the one before
export function hexLine(a, b) {
  const n = hexDistance(a, b);
  const [aq, ar] = toAxial(a.i, a.j);
  const [bq, br] = toAxial(b.i, b.j);
  const out = [];
  for (let t = 0; t <= n; t++) {
    const f = n ? t / n : 0;
    // a nudge off the exact edges so ties always round the same way
    const [q, r] = axialRound(aq + (bq - aq) * f + 1e-6, ar + (br - ar) * f + 2e-6);
    out.push(fromAxial(q, r));
  }
  return out;
}

// the six corners of tile (i, j) in grid space, clockwise from the top: [[x, u], ...]
export function hexCorners(i, j) {
  const [cx, cu] = hexCenter(i, j);
  const out = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    out.push([cx + HEX_R * Math.cos(a), cu + HEX_R * Math.sin(a)]);
  }
  return out;
}
