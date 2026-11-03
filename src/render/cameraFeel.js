// How the ride camera moves, apart from following the skier (main.js, updateRideCamera):
// a camera operator's hand, not a rigid mount.
//
//   shake    "trauma" that impacts add and time takes away; the camera moves by trauma²
//            (small knocks barely show, big ones really do), along smooth noise rather than
//            a new random jolt every frame, so it reads as a hit, not as a glitch
//   spring   a damped spring, for the landing dip, the lens (field of view) and the like:
//            pushed by a kick, it overshoots a little and settles
//
// Everything here is plain numbers, so it is tested without a browser.

// smooth 1-D noise in -1..1: a few incommensurate sines per channel, so it never repeats
// visibly and has no sudden steps
function wave(t, seed) {
  return (
    Math.sin(t * 1.0 + seed * 1.7) * 0.5 +
    Math.sin(t * 2.31 + seed * 4.1) * 0.3 +
    Math.sin(t * 4.79 + seed * 9.3) * 0.2
  );
}

/**
 * Shake by trauma. add(k) puts trauma in (0..1, kept at most 1), update(dt) takes it away
 * and moves the noise on; then x, y, z (metres) and roll, pitch (radians) are the offsets.
 * opts: { decay: trauma lost per second, move: metres at full trauma, turn: radians at full
 * trauma, freq: how fast it shakes (noise cycles per second) }
 */
export function createShake({ decay = 1.5, move = 0.45, turn = 0.05, freq = 13 } = {}) {
  const s = { trauma: 0, t: 0, x: 0, y: 0, z: 0, roll: 0, pitch: 0 };
  s.add = (k) => {
    s.trauma = Math.min(1, s.trauma + Math.max(0, k));
  };
  s.reset = () => {
    s.trauma = 0;
    s.x = s.y = s.z = s.roll = s.pitch = 0;
  };
  s.update = (dt) => {
    s.trauma = Math.max(0, s.trauma - decay * dt);
    s.t += dt * freq;
    const a = s.trauma * s.trauma;
    s.x = wave(s.t, 1) * move * a;
    s.y = wave(s.t, 2) * move * a;
    s.z = wave(s.t, 3) * move * a * 0.5;
    s.roll = wave(s.t, 4) * turn * a;
    s.pitch = wave(s.t, 5) * turn * a * 0.6;
    return s;
  };
  return s;
}

/**
 * A damped spring on one value. step(target, dt) moves it; kick(v) adds velocity.
 * k: stiffness (1/s²), d: damping ratio (1 critical, below 1 overshoots)
 */
export function createSpring(value = 0, { k = 60, d = 0.55 } = {}) {
  const s = { value, vel: 0 };
  const c = 2 * d * Math.sqrt(k);
  s.kick = (v) => {
    s.vel += v;
  };
  s.snap = (v) => {
    s.value = v;
    s.vel = 0;
  };
  s.step = (target, dt) => {
    // small fixed sub-steps: stable at any frame time
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      const acc = k * (target - s.value) - c * s.vel;
      s.vel += acc * h;
      s.value += s.vel * h;
      left -= h;
    }
    return s.value;
  };
  return s;
}
