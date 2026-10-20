import { smoothstep, makeValueNoise } from './heightfield.js';

// Starting mountains. Each one is described by:
//  - slope(u): steepness (rise/run) at u metres below the top edge, integrated into a
//    smooth longitudinal profile, so features are easy to place along the run;
//  - shape(x, z, u, base): the cross-section and extra features on top of that profile;
//  - start(hf): where the start gate goes.

export const TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank slope',
    level: 'Build it yourself',
    blurb: 'An even 18° face, nothing on it. Every turn, kicker and berm is yours to make.',
    slope: (u) => 0.33 * smoothstep(4, 30, u) * (1 - 0.75 * smoothstep(1130, 1185, u)),
    shape: (x, z, u, base, hf) => base + edgeLips(x, hf, 10),
    startX: () => 0,
  },
  {
    id: 'valley',
    name: 'Meander Valley',
    level: 'Easy',
    blurb: 'A long rolling valley with banked bends. Let the walls carry you, or cut the corners.',
    slope: (u) =>
      (0.26 + 0.04 * Math.sin(u / 85)) * smoothstep(4, 40, u) * (1 - 0.75 * smoothstep(1130, 1185, u)),
    shape: (x, z, u, base, hf, n) => {
      const d = Math.abs(x - valleyLine(z));
      const banks = 30 * smoothstep(50, 120, d) + 16 * smoothstep(110, 200, d);
      const texture = 1.4 * n(x * 0.02, z * 0.02) + 0.5 * n(x * 0.07 + 9, z * 0.07);
      return base + banks + texture + edgeLips(x, hf, 18);
    },
    startX: (hf) => valleyLine(hf.startZ),
  },
  {
    id: 'kickers',
    name: 'Kicker Line',
    level: 'Jumps',
    blurb: 'A straight jump line with five kickers and long landing hills. Tuck for distance, land with the skis straight.',
    slope: (u) => {
      let s = 0.3;
      // a longer, steeper landing hill after every kicker (tuned so hands-off jumps land clean)
      for (const k of KICKERS) s += 0.15 * smoothstep(k + 18, k + 30, u) * (1 - smoothstep(k + 120, k + 150, u));
      return s * smoothstep(4, 40, u) * (1 - 0.75 * smoothstep(1130, 1185, u));
    },
    shape: (x, z, u, base, hf, n) => {
      const ax = Math.abs(x);
      // a wide freestyle face: kicker line in the middle, a roller lane on the left
      const shoulders = 18 * smoothstep(150, 225, ax);
      let kick = 0;
      const across = 1 - smoothstep(20, 34, ax); // kickers span the middle lane
      for (const k of KICKERS) kick += kicker(u - k) * across;
      const rollerLane = smoothstep(-160, -130, x) * (1 - smoothstep(-80, -50, x));
      const rollers = 1.1 * rollerLane * Math.sin(u / 5.5) ** 2 * smoothstep(120, 160, u) * (1 - smoothstep(1050, 1100, u));
      return base + shoulders + kick + rollers + 0.6 * n(x * 0.03, z * 0.03) + edgeLips(x, hf, 14);
    },
    startX: () => 0,
  },
  {
    id: 'couloir',
    name: 'Couloir',
    level: 'Expert',
    blurb: 'A steep open bowl funnels into a narrow couloir, then a mogul field and a fast finish.',
    slope: (u) => {
      const bowl = 0.4 * smoothstep(4, 50, u);
      const couloir = 0.08 * smoothstep(250, 320, u) * (1 - smoothstep(540, 580, u));
      const exit = -0.32 * smoothstep(560, 600, u) * (1 - smoothstep(640, 680, u));
      const moguls = -0.12 * smoothstep(640, 680, u);
      const finish = 0.02 * smoothstep(880, 920, u);
      const s = bowl + couloir + exit + moguls + finish;
      return s * (1 - 0.75 * smoothstep(1130, 1185, u));
    },
    shape: (x, z, u, base, hf, n) => {
      // walls close in from the bowl (u < 250) to the couloir (250..580), then open again
      const squeeze = smoothstep(200, 300, u) * (1 - smoothstep(580, 660, u));
      const halfW = 175 - 153 * squeeze; // 350 m wide bowl -> 44 m couloir
      const dx = Math.abs(x - 12 * Math.sin(u / 70) * squeeze);
      const walls = (18 + 34 * squeeze) * smoothstep(halfW, halfW + 26 + 20 * (1 - squeeze), dx);
      const rock = 2.5 * squeeze * n(x * 0.08, z * 0.08) * smoothstep(halfW, halfW + 6, dx);
      // staggered mogul field
      const field = smoothstep(690, 720, u) * (1 - smoothstep(860, 890, u));
      const mog = 0.45 * field * Math.sin(u / 2.4) * Math.sin(x / 2.6 + (Math.floor(u / 15) % 2) * 1.6);
      return base + walls + rock + mog + 1.2 * n(x * 0.02, z * 0.02) + edgeLips(x, hf, 16);
    },
    startX: () => 0,
  },
];

const KICKERS = [260, 430, 600, 770, 940];

// A take-off ramp ending in a lip at du = 0, falling away just after it
function kicker(du) {
  if (du < -30 || du > 3) return 0;
  if (du <= 0) {
    const t = (du + 30) / 30;
    return 2.5 * t * t;
  }
  return 2.5 * (1 - smoothstep(0, 3, du));
}

// Centre line of the meander valley (metres across, as a function of z)
function valleyLine(z) {
  return 95 * Math.sin((z + 600) / 140 + 0.4) * smoothstep(-590, -460, z) + 14 * Math.sin((z + 600) / 47);
}

// Raised lips along the long edges so a stray skier is nudged back on
function edgeLips(x, hf, height) {
  return height * smoothstep(hf.halfX - 30, hf.halfX - 2, Math.abs(x));
}

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[1];
}

// Build a template into the heightfield; returns the start position
export function buildTemplate(hf, id) {
  const tpl = getTemplate(id);
  const noise = makeValueNoise(tpl.id.length * 7919 + 13);
  // integrate the slope from the bottom up so the finish sits near height 0
  const prof = new Float64Array(hf.nz);
  for (let j = hf.nz - 2; j >= 0; j--) {
    const u = (j + 0.5) * hf.cell;
    prof[j] = prof[j + 1] + tpl.slope(u) * hf.cell;
  }
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell;
    const z = u - hf.halfZ;
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell - hf.halfX;
      hf.h[j * hf.nx + i] = tpl.shape(x, z, u, prof[j], hf, noise);
    }
  }
  return { x: tpl.startX(hf), z: hf.startZ };
}
