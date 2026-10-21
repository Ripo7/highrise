import { Skier } from '../core/skier.js';

// The hands-off run behind the line preview. Shared by the background worker and the
// main-thread fallback. Returns plain data: ribbon points and landing markers.
export function simulateLine(hf, start) {
  const s = new Skier(hf, start);
  const pts = []; // x, y, z, air
  const marks = []; // { kind, x, z }
  let lastX = Infinity;
  let lastZ = Infinity;
  let seen = 0;
  while (s.status === 'running' && s.time < 420) {
    s.step(s.P.dt);
    const [x, y, z] = s.pos;
    if (Math.hypot(x - lastX, z - lastZ) >= 1.6) {
      pts.push(x, y, z, s.grounded ? 0 : 1);
      lastX = x;
      lastZ = z;
    }
    for (; seen < s.events.length; seen++) {
      const ev = s.events[seen];
      if (ev.type === 'land' && ev.air >= 0.25 && ev.quality !== 'wipeout') marks.push({ kind: ev.quality, x, z });
      if (ev.type === 'wipeout') marks.push({ kind: 'wipeout', x, z });
    }
  }
  pts.push(s.pos[0], s.pos[1], s.pos[2], 0);
  const lands = s.events.filter((e) => e.type === 'land');
  return {
    pts: new Float32Array(pts),
    marks,
    stats: {
      status: s.status,
      time: s.time,
      jumps: s.jumps,
      wipeouts: s.wipeouts,
      sketchy: lands.filter((e) => e.quality === 'sketchy').length,
      topSpeed: s.maxSpeed,
    },
  };
}
