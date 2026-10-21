// Point-mass skier sliding on the heightfield.
// Grounded: gravity + snow friction + air drag, velocity kept along the surface.
// Airborne: ballistic flight + drag. The skier leaves the ground on its own when the
// terrain falls away faster than gravity can follow (crests, kickers), or when he pops.
// Steering: the skis have a heading. Edge grip turns the velocity towards the heading
// (carving); the player rotates the heading. With no input the heading drifts back to
// the direction of travel, so an unpiloted skier simply follows the terrain.
//
// Tricks: hold crouch to load a jump, release to pop (a short grace window lets you pop
// just after leaving a lip). In the air, steer spins the skier (yaw) and pitch flips him.
// Landing is judged on impact, how far the skis point from the direction of travel and
// how far from upright he is: clean, sketchy (lose speed) or a wipeout (tumble, lose the
// combo, get back up and keep going).

export const PHYS = {
  g: 9.81,
  mu: 0.035, // ski/snow kinetic friction (fast, waxed, game-tuned)
  drag: 0.002, // 0.5·ρ·CdA / m  (1/m)
  dt: 1 / 240,
  liftoffGap: 0.004, // metres above the surface before we count as airborne
  sketchyImpact: 12.5, // m/s into the slope: sketchy landing
  crashImpact: 17.5, // m/s into the slope: wipeout
  absorb: 3, // extra m/s of tolerance when crouching into the landing
  minJumpAir: 0.25, // seconds of air to count as a jump
  stuckSpeed: 0.6,
  stuckTime: 2.5,
  maxTime: 420, // runs can be up to 4 km long
  edgeMargin: 3,
  turnRate: 3.0, // rad/s at low speed, eases off as speed rises
  followRate: 2.0, // rad/s the heading drifts back to the direction of travel (no input)
  grip: 3.6, // how fast velocity aligns with the skis
  carveGrip: 7, // grip while steering
  tuckDrag: 0.45, // drag multiplier while tucked
  brakeDrag: 1.5,
  brakeFriction: 4.5, // friction multiplier while braking (snowplough)
  brakeDecel: 4.5, // extra m/s² scrubbed by the snowplough
  // jumping
  popMin: 2.8, // m/s added along the slope normal by a quick tap
  popMax: 6.2, // ... by a fully loaded crouch (big tricks need a kicker)
  chargeTime: 0.45, // seconds of crouch for a full load
  coyote: 0.16, // seconds after leaving the ground you can still pop
  // tricks
  spinRate: 7.0, // rad/s yaw while steering in the air
  flipRate: 6.2, // rad/s pitch while flipping
  spinResponse: 14, // how quickly rotation speed follows the input
  // landing tolerances (radians)
  cleanYaw: 0.42,
  cleanPitch: 0.42,
  crashYaw: 1.15,
  crashPitch: 1.0,
  wipeoutTime: 1.6,
};

export class Skier {
  constructor(hf, start, params = PHYS) {
    this.hf = hf;
    this.P = params;
    const y = hf.heightAt(start.x, start.z);
    this.pos = [start.x, y, start.z];
    // a strong push down the fall line out of the gate
    const n = hf.normalAt(start.x, start.z);
    const push = [0, 0, 11];
    const vn = dot(push, n);
    this.vel = [push[0] - vn * n[0], push[1] - vn * n[1], push[2] - vn * n[2]];
    this.n = n;
    this.heading = normalize([...this.vel]);
    // steer -1..1 (right +), pitch -1..1 (up +: tuck / front flip, down -: brake / back flip),
    // crouch: hold to load a jump, release to pop. brake / tuck kept for direct control.
    this.input = { steer: 0, pitch: 0, crouch: false, brake: false, tuck: false };
    this._wasCrouching = false;
    this.crouchSpent = false; // crouch used to absorb a landing: releasing it doesn't pop
    this.crouchTime = 0;
    this.grounded = true;
    this.sinceGround = 0; // seconds since leaving the ground
    this.popped = false; // already popped during this airtime
    this.status = 'running'; // running | finished | stuck | timeout | aborted
    this.wipeout = 0; // seconds of tumble left
    this.time = 0;
    this.distance = 0;
    this.maxSpeed = 0;
    this.airTime = 0; // total
    this.curAir = 0;
    this.maxAir = 0;
    this.jumps = 0;
    this.wipeouts = 0;
    this.slowTime = 0;
    // airborne rotation
    this.spin = 0; // accumulated yaw this jump (rad, signed)
    this.spinVel = 0;
    this.pitch = 0; // body pitch (rad, + = backflip direction)
    this.pitchVel = 0;
    this.flipTotal = 0; // accumulated pitch this jump (signed)
    this.events = []; // { type: 'pop' | 'land' | 'wipeout' | 'recover', t, ... }
    this.path = [[...this.pos]];
    this._pathTimer = 0;
  }

  get speed() {
    return Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
  }

  // 0..1 how loaded the jump is
  get charge() {
    return this.input.crouch && this.wipeout <= 0 ? Math.min(1, this.crouchTime / this.P.chargeTime) : 0;
  }

  get crouching() {
    return this.input.crouch && this.wipeout <= 0;
  }

  // Advance by frameDt seconds using fixed substeps.
  update(frameDt) {
    if (this.status !== 'running') return;
    let remaining = Math.min(frameDt, 0.1);
    while (remaining > 1e-6 && this.status === 'running') {
      const dt = Math.min(this.P.dt, remaining);
      this.step(dt);
      remaining -= dt;
    }
  }

  step(dt) {
    const { P, hf, pos, vel } = this;
    const speed0 = Math.hypot(vel[0], vel[1], vel[2]);
    const out = this.wipeout > 0;
    const inp = out ? NO_INPUT : this.input;

    // derived controls
    const tuck = inp.tuck || inp.crouch || (this.grounded && inp.pitch > 0.4);
    const brakeAmt = inp.brake ? 1 : this.grounded ? Math.max(0, (-inp.pitch - 0.3) / 0.7) : 0;
    const braking = brakeAmt > 0.05;

    // jump: load while crouched, pop on release
    if (inp.crouch) this.crouchTime += dt;
    if (this._wasCrouching && !inp.crouch && !out) {
      const canPop = this.grounded || (!this.popped && this.sinceGround < P.coyote);
      if (canPop && !this.crouchSpent) this.pop(Math.min(1, this.crouchTime / P.chargeTime));
      this.crouchSpent = false;
    }
    if (!inp.crouch) this.crouchTime = 0;
    this._wasCrouching = inp.crouch;

    // forces
    vel[1] -= P.g * dt;
    const dragMul = braking ? 1 + (P.brakeDrag - 1) * brakeAmt : tuck ? P.tuckDrag : 1;
    const dragK = P.drag * dragMul * speed0 * dt;
    vel[0] -= vel[0] * dragK;
    vel[1] -= vel[1] * dragK;
    vel[2] -= vel[2] * dragK;

    if (this.grounded) {
      // friction opposes motion along the surface, scaled by the normal load
      const n = this.n;
      const vt = [vel[0], vel[1], vel[2]];
      const vnn = dot(vt, n);
      vt[0] -= vnn * n[0];
      vt[1] -= vnn * n[1];
      vt[2] -= vnn * n[2];
      const vtl = Math.hypot(vt[0], vt[1], vt[2]);
      if (vtl > 1e-6) {
        const mu = out ? 0.45 : P.mu * (1 + (P.brakeFriction - 1) * brakeAmt);
        const dv = Math.min(vtl, mu * P.g * Math.max(0, n[1]) * dt);
        vel[0] -= (vt[0] / vtl) * dv;
        vel[1] -= (vt[1] / vtl) * dv;
        vel[2] -= (vt[2] / vtl) * dv;
      }
    }

    const ox = pos[0];
    const oz = pos[2];
    const oy = pos[1];
    pos[0] += vel[0] * dt;
    pos[1] += vel[1] * dt;
    pos[2] += vel[2] * dt;

    const ground = hf.heightAt(pos[0], pos[2]);
    const gap = pos[1] - ground;
    const n = hf.normalExactAt(pos[0], pos[2], this.n);

    if (this.grounded) {
      if (gap > P.liftoffGap) {
        // terrain dropped away: we fly
        this.takeOff();
      } else {
        // stay on the surface, redirect velocity along it without losing speed
        const speed = Math.hypot(vel[0], vel[1], vel[2]);
        pos[1] = ground;
        const vn = dot(vel, n);
        vel[0] -= vn * n[0];
        vel[1] -= vn * n[1];
        vel[2] -= vn * n[2];
        const s2 = Math.hypot(vel[0], vel[1], vel[2]);
        if (s2 > 1e-6 && vn < 0) {
          const k = speed / s2;
          vel[0] *= k;
          vel[1] *= k;
          vel[2] *= k;
        }
        if (!out) this.carve(dt, n, inp, brakeAmt);
      }
    } else {
      this.curAir += dt;
      this.sinceGround += dt;
      this.rotateInAir(dt, inp);
      if (gap <= 0) this.land(ground, n);
    }

    // tumbling: count down, then get back up facing down the hill
    if (this.wipeout > 0) {
      this.wipeout -= dt;
      if (this.wipeout <= 0) this.recover();
    }

    this.time += dt;
    this.distance += Math.hypot(pos[0] - ox, pos[1] - oy, pos[2] - oz);
    const speed = this.speed;
    this.maxSpeed = Math.max(this.maxSpeed, speed);

    this._pathTimer += dt;
    if (this._pathTimer >= 1 / 30) {
      this._pathTimer = 0;
      this.path.push([pos[0], pos[1], pos[2]]);
    }

    if (this.status !== 'running') return;
    // edges: a stray skier wipes out and is set back on the piste
    const lim = hf.halfX - P.edgeMargin;
    if (Math.abs(pos[0]) > lim) {
      pos[0] = Math.sign(pos[0]) * (lim - 8);
      pos[1] = hf.heightAt(pos[0], pos[2]);
      vel[0] = -Math.sign(pos[0]) * 2;
      this.grounded = true;
      this.startWipeout('edge', 0);
    }
    if (pos[2] < -hf.halfZ + 0.5) {
      pos[2] = -hf.halfZ + 2;
      vel[2] = Math.abs(vel[2]);
    }
    if (pos[2] >= hf.finishZ) {
      this.status = 'finished';
    } else if (this.time > P.maxTime) {
      this.status = 'timeout';
    } else if (this.grounded && speed < P.stuckSpeed && !braking && this.wipeout <= 0 && !inp.crouch) {
      this.slowTime += dt;
      if (this.slowTime > P.stuckTime) this.status = 'stuck';
    } else {
      this.slowTime = 0;
    }
    if (this.status !== 'running') this.path.push([pos[0], pos[1], pos[2]]);
  }

  pop(charge) {
    const { P, vel, n } = this;
    const v = P.popMin + (P.popMax - P.popMin) * charge;
    // pop off the snow (use the surface normal, but never less than straight up-ish)
    vel[0] += n[0] * v;
    vel[1] += Math.max(n[1], 0.7) * v;
    vel[2] += n[2] * v;
    // at a crawl, the pop doubles as a skating push
    if (this.speed < 6) {
      vel[0] += this.heading[0] * 3;
      vel[2] += this.heading[2] * 3;
    }
    if (this.grounded) this.takeOff();
    this.popped = true;
    this.events.push({ type: 'pop', t: this.time, value: charge });
  }

  takeOff() {
    this.grounded = false;
    this.curAir = 0;
    this.sinceGround = 0;
    this.popped = false;
    this.spin = 0;
    this.spinVel = 0;
    this.pitchVel = 0;
    this.flipTotal = 0;
  }

  rotateInAir(dt, inp) {
    const { P } = this;
    const k = Math.min(1, P.spinResponse * dt);
    // spin: steer right turns the skier clockwise seen from above
    this.spinVel += (-inp.steer * P.spinRate - this.spinVel) * k;
    if (this.spinVel) {
      rotateAround(this.heading, UP, this.spinVel * dt);
      this.spin += this.spinVel * dt;
    }
    // flip: pull back (pitch -1) for a backflip, push forward (+1) for a front flip
    this.pitchVel += (-inp.pitch * P.flipRate - this.pitchVel) * k;
    this.pitch += this.pitchVel * dt;
    this.flipTotal += this.pitchVel * dt;
  }

  land(ground, n) {
    const { P, pos, vel } = this;
    pos[1] = ground;
    const impact = -dot(vel, n);
    // bending the knees into the landing soaks up some of the hit
    const soak = this.input.crouch && this.wipeout <= 0 ? P.absorb : 0;
    const vn = dot(vel, n);
    vel[0] -= vn * n[0];
    vel[1] -= vn * n[1];
    vel[2] -= vn * n[2];
    const air = this.curAir;
    const isJump = air >= P.minJumpAir;
    if (isJump) {
      this.jumps++;
      this.airTime += air;
      this.maxAir = Math.max(this.maxAir, air);
    }
    // judge the landing
    const yawErr = this.landingAngle(n);
    const pitchErr = Math.abs(wrapAngle(this.pitch));
    let quality = 'clean';
    let reason = null;
    let cause = null;
    if (impact > P.crashImpact + soak) reason = 'impact';
    else if (yawErr > P.crashYaw && this.speed > 6) reason = 'sideways';
    else if (pitchErr > P.crashPitch) reason = 'flip';
    if (reason) quality = 'wipeout';
    else if (impact > P.sketchyImpact + soak) cause = 'hard';
    else if (yawErr > P.cleanYaw) cause = 'crossed';
    else if (pitchErr > P.cleanPitch) cause = 'balance';
    if (cause && !reason) quality = 'sketchy';

    const spinHalves = Math.round(Math.abs(this.spin) / Math.PI);
    const flips = Math.round(Math.abs(this.flipTotal) / (2 * Math.PI));
    if (isJump || spinHalves || flips) {
      this.events.push({
        type: 'land',
        t: this.time,
        air,
        spin: spinHalves * 180,
        spinDir: Math.sign(this.spin),
        flips,
        flipDir: this.flipTotal > 0 ? 'back' : 'front',
        quality,
        cause,
        impact,
        yawErr,
        pitchErr,
        // landed backwards?
        switch: dot(this.heading, vel) < 0,
      });
    }
    this.grounded = true;
    this.curAir = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.spinVel = 0;
    if (this.input.crouch) this.crouchSpent = true;
    if (quality === 'wipeout') {
      this.startWipeout(reason, impact);
    } else if (quality === 'sketchy') {
      vel[0] *= 0.82;
      vel[1] *= 0.82;
      vel[2] *= 0.82;
    }
  }

  startWipeout(reason, value) {
    if (this.wipeout > 0) return;
    this.wipeout = this.P.wipeoutTime;
    this.wipeouts++;
    this.pitch = 0;
    this.events.push({ type: 'wipeout', t: this.time, reason, value });
  }

  recover() {
    this.wipeout = 0;
    // face down the hill and push off again
    const { hf, pos, vel } = this;
    const n = hf.normalAt(pos[0], pos[2]);
    const down = [n[0], 0, n[2]];
    if (Math.hypot(down[0], down[2]) < 0.05) {
      down[0] = 0;
      down[2] = 1;
    }
    normalizeInPlace(down);
    const v = [down[0], -(n[0] * down[0] + n[2] * down[2]) / Math.max(0.2, n[1]), down[2]];
    normalizeInPlace(v);
    const sp = Math.max(5, Math.hypot(vel[0], vel[2]));
    vel[0] = v[0] * sp;
    vel[1] = v[1] * sp;
    vel[2] = v[2] * sp;
    this.heading = [...v];
    this.grounded = true;
    this.events.push({ type: 'recover', t: this.time });
  }

  // Steering + edge grip while on the snow
  carve(dt, n, input, brakeAmt) {
    const { P, vel } = this;
    const h = this.heading;
    // keep the skis in the slope plane
    const hn = dot(h, n);
    h[0] -= hn * n[0];
    h[1] -= hn * n[1];
    h[2] -= hn * n[2];
    const speed = Math.hypot(vel[0], vel[1], vel[2]);
    if (normalizeInPlace(h) < 1e-6) {
      if (speed < 1e-6) return;
      h[0] = vel[0] / speed;
      h[1] = vel[1] / speed;
      h[2] = vel[2] / speed;
    }
    const steer = input.steer;
    if (steer) {
      rotateAround(h, n, -steer * (P.turnRate / (1 + speed / 40)) * dt);
    }
    if (speed < 0.3) return;
    const vd = [vel[0] / speed, vel[1] / speed, vel[2] / speed];
    if (Math.abs(steer) < 0.05) {
      // relax the skis back towards the direction of travel
      const k = Math.min(1, P.followRate * dt);
      h[0] += (vd[0] - h[0]) * k;
      h[1] += (vd[1] - h[1]) * k;
      h[2] += (vd[2] - h[2]) * k;
      normalizeInPlace(h);
    }
    // grip: swing the velocity towards the skis (either tip can lead)
    let c = dot(vd, h);
    const sgn = c < 0 ? -1 : 1;
    c = Math.abs(c);
    const sinA = Math.sqrt(Math.max(0, 1 - c * c));
    const grip = brakeAmt > 0.05 ? 1.5 : P.grip + (P.carveGrip - P.grip) * Math.min(1, Math.abs(steer) * 1.5);
    const f = Math.min(1, grip * dt);
    const nd = [vd[0] + (sgn * h[0] - vd[0]) * f, vd[1] + (sgn * h[1] - vd[1]) * f, vd[2] + (sgn * h[2] - vd[2]) * f];
    normalizeInPlace(nd);
    // skidding scrubs speed; braking skids on purpose
    const loss = (0.35 + 1.25 * brakeAmt) * sinA * dt;
    const ns = Math.max(0, speed * (1 - loss) - P.brakeDecel * brakeAmt * dt);
    vel[0] = nd[0] * ns;
    vel[1] = nd[1] * ns;
    vel[2] = nd[2] * ns;
  }

  // Angle between the skis and the direction of travel on touchdown (0..π/2, switch is fine)
  landingAngle(n) {
    const h = [...this.heading];
    const hn = dot(h, n);
    h[0] -= hn * n[0];
    h[1] -= hn * n[1];
    h[2] -= hn * n[2];
    const v = this.vel;
    const s = Math.hypot(v[0], v[1], v[2]);
    if (normalizeInPlace(h) < 1e-6 || s < 1e-6) return 0;
    const c = Math.abs(dot(h, v) / s);
    return Math.acos(Math.min(1, c));
  }

  // Simulate a whole run without rendering (for tests / previews)
  simulate(maxTime = this.P.maxTime, dt = this.P.dt) {
    while (this.status === 'running' && this.time < maxTime) this.step(dt);
    return this;
  }
}

const UP = [0, 1, 0];
const NO_INPUT = { steer: 0, pitch: 0, crouch: false, brake: false, tuck: false };

function wrapAngle(a) {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeInPlace(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l > 1e-9) {
    v[0] /= l;
    v[1] /= l;
    v[2] /= l;
  }
  return l;
}

function normalize(v) {
  normalizeInPlace(v);
  return v;
}

// Rotate v (in place) around unit axis n by angle a (Rodrigues)
function rotateAround(v, n, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = dot(n, v) * (1 - c);
  const x = v[0] * c + (n[1] * v[2] - n[2] * v[1]) * s + n[0] * d;
  const y = v[1] * c + (n[2] * v[0] - n[0] * v[2]) * s + n[1] * d;
  const z = v[2] * c + (n[0] * v[1] - n[1] * v[0]) * s + n[2] * d;
  v[0] = x;
  v[1] = y;
  v[2] = z;
  return v;
}
