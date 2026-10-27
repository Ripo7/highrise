import { smoothstep, MIN_H, MAX_H } from './heightfield.js';

// Terrain features placed with the Build tool. Each one is drawn along a line from where
// the drag started (a) to where it ended (b): `along` runs from the start towards the end,
// `across` is the signed distance sideways. Shapes are added on top of the existing slope,
// so a kicker built on a 20° face still points down that face.

export const STAMPS = {
  kicker: { label: 'Kicker', hint: 'Drag in the direction of travel: the lip is where you let go.' },
  table: { label: 'Table', hint: 'A jump with a flat top and a landing: drag along the run.' },
  berm: { label: 'Berm', hint: 'A banked wall to carve against: drag along where it should run.' },
  rollers: { label: 'Rollers', hint: 'A line of whoops to pump or pop: drag along the run.' },
};

export const DEFAULT_LENGTH = { kicker: 22, table: 46, berm: 60, rollers: 70 };

// Height profile of each stamp at (along, across). L = length, W = width, H = height.
// Shared with the run editor's elements (elements.js).
export function stampShape(kind, along, across, L, W, H) {
  const ax = Math.abs(across);
  switch (kind) {
    case 'kicker': {
      if (along < -2 || along > L + 3) return 0;
      // taper the sides so the ramp blends into the slope
      const side = 1 - smoothstep(W / 2 - Math.min(4, W * 0.25), W / 2 + 1.5, ax);
      if (side <= 0) return 0;
      // concave ramp up to the lip, then a steep drop so the skier launches
      const t = Math.max(0, along) / L;
      const ramp = along <= L ? t * t : 1 - smoothstep(0, 3, along - L);
      return H * ramp * side;
    }
    case 'table': {
      if (along < -2 || along > L + 2) return 0;
      const side = 1 - smoothstep(W / 2 - Math.min(5, W * 0.25), W / 2 + 2, ax);
      if (side <= 0) return 0;
      const up = smoothstep(0, 0.3 * L, along);
      const down = 1 - smoothstep(0.62 * L, L, along);
      // the take-off edge sharpens into a lip at 30 %
      return H * Math.min(up, down) * side;
    }
    case 'berm': {
      const half = W / 2;
      if (ax > half || along < -8 || along > L + 8) return 0;
      const ends = smoothstep(-8, 4, along) * (1 - smoothstep(L - 4, L + 8, along));
      const cross = 0.5 * (1 + Math.cos(Math.PI * (ax / half)));
      return H * cross * ends;
    }
    case 'rollers': {
      if (along < -2 || along > L + 2) return 0;
      const side = 1 - smoothstep(W / 2 - Math.min(5, W * 0.25), W / 2 + 2, ax);
      if (side <= 0) return 0;
      const spacing = 14;
      const ends = smoothstep(-2, 6, along) * (1 - smoothstep(L - 6, L + 2, along));
      const s = Math.sin((Math.PI * along) / spacing);
      return H * s * s * ends * side;
    }
    default:
      return 0;
  }
}

// Size of each feature from the drag length (L), brush size (W) and strength (0..1)
export function stampSize(kind, L, size, strength) {
  const hm = 0.4 + 1.2 * strength; // strength sets the height
  switch (kind) {
    case 'kicker':
      return { L, W: Math.max(6, Math.min(size, 60)), H: Math.min(10, Math.max(1, L * 0.13)) * hm };
    case 'table':
      return { L, W: Math.max(8, Math.min(size, 80)), H: Math.min(9, Math.max(1, L * 0.07)) * hm };
    case 'berm':
      return { L, W: Math.max(8, Math.min(size, 90)), H: Math.min(16, Math.max(2, size * 0.32)) * hm };
    case 'rollers':
      return { L, W: Math.max(8, Math.min(size, 80)), H: 1.4 * hm };
    default:
      return { L, W: size, H: 1 };
  }
}

/**
 * Write a stamp into hf.h as base + feature, over its footprint only.
 * @param base  heights to build on (a snapshot taken when the drag started)
 * @returns dirty rect in grid coords
 */
export function applyStamp(hf, base, kind, ax, az, bx, bz, size, strength) {
  let dx = bx - ax;
  let dz = bz - az;
  let len = Math.hypot(dx, dz);
  if (len < 4) {
    // a tap: default length, straight down the hill
    len = DEFAULT_LENGTH[kind] ?? 30;
    dx = 0;
    dz = 1;
  } else {
    dx /= len;
    dz /= len;
  }
  len = Math.min(len, 400);
  const { L, W, H } = stampSize(kind, len, size, strength);
  const px = -dz; // sideways unit vector
  const pz = dx;
  // footprint bounding box
  const pad = W / 2 + 10;
  const xs = [ax - dx * 10, ax + dx * (L + 10)];
  const zs = [az - dz * 10, az + dz * (L + 10)];
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minZ = Math.min(...zs) - pad;
  const maxZ = Math.max(...zs) + pad;
  const [gx0, gz0] = hf.toGrid(minX, minZ);
  const [gx1, gz1] = hf.toGrid(maxX, maxZ);
  const i0 = Math.max(0, Math.floor(gx0));
  const i1 = Math.min(hf.nx - 1, Math.ceil(gx1));
  const j0 = Math.max(0, Math.floor(gz0));
  const j1 = Math.min(hf.nz - 1, Math.ceil(gz1));
  if (i0 > i1 || j0 > j1) return null;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [x, z] = hf.toWorld(i, j);
      const rx = x - ax;
      const rz = z - az;
      const along = rx * dx + rz * dz;
      const across = rx * px + rz * pz;
      const k = j * hf.nx + i;
      const v = base[k] + stampShape(kind, along, across, L, W, H);
      hf.h[k] = v < MIN_H ? MIN_H : v > MAX_H ? MAX_H : v;
    }
  }
  return { i0, i1, j0, j1 };
}

// Copy a rect of heights back from a snapshot
export function restoreRect(hf, base, r) {
  if (!r) return;
  for (let j = r.j0; j <= r.j1; j++) {
    const o = j * hf.nx;
    hf.h.set(base.subarray(o + r.i0, o + r.i1 + 1), o + r.i0);
  }
}
