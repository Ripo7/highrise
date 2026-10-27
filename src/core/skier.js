import { propRadius, propHeight, TREE } from './props.js';

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
//
// Snow: the surface map says where the piste is groomed (fast, grippy), where it's deep
// powder (slower, the skis sink and plough, softer landings) and where it's ice (slick,
// little grip). Rails and boxes: ride onto one lined up with it and he locks on and grinds
// to the end (steer to turn the skis across it for a slide, release Jump to pop off).

export const PHYS = {
  g: 9.81,
  mu: 0.035, // ski/snow kinetic friction (fast, waxed, game-tuned)
  drag: 0.002, // 0.5·ρ·CdA / m  (1/m)
  dt: 1 / 240,
  liftoffGap: 0.004, // metres above the surface before we count as airborne
  sketchyImpact: 15, // m/s into the slope: sketchy landing
  crashImpact: 23, // m/s into the slope: wipeout
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
  airGrace: 0.2, // s: input held over a lip starts rotating only after this long in the air
  // landing tolerances (radians)
  cleanYaw: 0.55,
  cleanPitch: 0.6,
  crashYaw: 1.4,
  crashPitch: 1.35,
  // landing assist: hands off the controls in the air and a nearly-straight, nearly-
  // upright skier eases himself back (rad/s, within these angles)
  assistRate: 3.2,
  assistYaw: 1.0,
  assistPitch: 1.5,
  wipeoutTime: 1.6,
  hitWipeout: 11, // m/s straight into a tree or rock that knocks you down; less is a glancing bump
  // snow
  muPowder: 0.06, // friction in deep powder
  muIce: 0.016,
  powderDrag: 0.0042, // extra drag from ploughing through powder (1/m)
  powderGrip: 0.65, // grip multiplier in powder (softer turns)
  iceGrip: 0.35, // ... and on ice (skids)
  powderSoak: 4, // m/s of extra landing tolerance in powder
  // rails and boxes
  railMu: 0.05,
  boxMu: 0.07,
  railSpin: 4.5, // rad/s the skis turn on a rail while steering
  grindCooldown: 0.3, // s before he can lock onto a rail again after leaving one
};

export class Skier {
  constructor(hf, start, params = PHYS) {
    this.hf = hf;
    this.P = params;
    const y = hf.heightAt(start.x, start.z);
    this.pos = [start.x, y, start.z];
    // a strong push out of the gate, down the piste (or straight down the fall line)
    const n = hf.normalAt(start.x, start.z);
    const dir = start.dir || [0, 1];
    const push = [dir[0] * 11, 0, dir[1] * 11];
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
    this.props = null; // PropSet of trees and rocks to collide with
    this.structures = null; // StructureSet: rails, buildings, nets, gates...
    this.surface = null; // SurfaceMap: groomed / powder / ice (null: groomed everywhere)
    this.finishes = null; // finish lines [{ x, z, dir, w }]: crossing one ends the run (so does the bottom edge)
    this._surf = { g: 1, ice: 0, powder: 0 };
    this.powder = 0; // 0..1 under the skis right now
    this.ice = 0;
    this.sink = 0; // metres the skis sink into powder (for drawing)
    this.grind = null; // { rail, s, va, time, dist, slideTime, entry }
    this.grindCooldown = 0;
    this.grinds = 0;
    this.gatesPassed = 0;
    this._gates = new Set();
    this._crossed = [];
    this.events = []; // { type: 'pop' | 'land' | 'wipeout' | 'recover', t, ... }
    this.path = [[...this.pos]];
    this._pathTimer = 0;
    this.prevPos = [...this.pos];
    this.acc = 0; // unspent frame time (seconds) below one physics step
    this.alpha = 0;
    // air control is armed only once the stick/keys are let go after take-off (or after a
    // short grace), so a tuck or a carve held over a lip doesn't start a flip or a spin
    this.airSteerArmed = true;
    this.airPitchArmed = true;
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

  // Advance by frameDt seconds in fixed steps of P.dt, whatever the frame rate, so a run
  // plays out the same at 60 Hz and 165 Hz. Leftover time carries to the next frame;
  // `alpha` says how far we are between the last two steps, for drawing (drawPos).
  update(frameDt) {
    if (this.status !== 'running') return;
    this.acc += Math.min(frameDt, 0.1);
    const h = this.P.dt;
    while (this.acc >= h - 1e-9 && this.status === 'running') {
      this.step(h);
      this.acc -= h;
    }
    if (this.status !== 'running') this.acc = 0;
    this.alpha = Math.min(1, Math.max(0, this.acc / h));
  }

  // Position to draw this frame: between the last two physics steps
  drawPos(out = [0, 0, 0]) {
    const a = this.status === 'running' ? this.alpha : 1;
    const p = this.pos;
    const q = this.prevPos;
    out[0] = q[0] + (p[0] - q[0]) * a;
    out[1] = q[1] + (p[1] - q[1]) * a;
    out[2] = q[2] + (p[2] - q[2]) * a;
    return out;
  }

  step(dt) {
    const { P, hf, pos, vel } = this;
    this.prevPos[0] = pos[0];
    this.prevPos[1] = pos[1];
    this.prevPos[2] = pos[2];
    const speed0 = Math.hypot(vel[0], vel[1], vel[2]);
    const out = this.wipeout > 0;
    const inp = out ? NO_INPUT : this.input;
    if (this.surface) {
      const sf = this.surface.at(pos[0], pos[2], this._surf);
      this.powder = sf.powder;
      this.ice = sf.ice;
    }
    if (this.grindCooldown > 0) this.grindCooldown -= dt;
    if (this.grind) {
      const gx = pos[0];
      const gy = pos[1];
      const gz = pos[2];
      this.stepGrind(dt, inp);
      this.after(dt, gx, gy, gz, false, inp);
      return;
    }

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
    const plough = this.grounded ? P.powderDrag * this.powder : 0;
    const dragK = (P.drag * dragMul + plough) * speed0 * dt;
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
        let base = P.mu + (P.muPowder - P.mu) * this.powder;
        base += (P.muIce - base) * this.ice;
        const mu = out ? 0.45 : base * (1 + (P.brakeFriction - 1) * brakeAmt);
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

    if (this.props && this.wipeout <= 0) this.collide();
    if (this.structures && this.wipeout <= 0) {
      if (this.grindCooldown <= 0) {
        const hit = this.structures.findRail(this);
        if (hit) this.startGrind(hit);
      }
      if (!this.grind) this.structures.collide(this);
    }

    // how deep the skis ride in powder: deeper when slow
    const sinkTo = this.grounded ? this.powder * (0.42 - 0.24 * Math.min(1, this.speed / 25)) : 0;
    this.sink += (sinkTo - this.sink) * Math.min(1, dt * 6);

    this.after(dt, ox, oy, oz, braking, inp);
  }

  // Bookkeeping shared by snow and rail steps: wipeout timer, gates, time, path, edges, end
  after(dt, ox, oy, oz, braking, inp = this.input) {
    const { P, hf, pos, vel } = this;
    if (this.structures) {
      this._crossed.length = 0;
      for (const g of this.structures.gatesCrossed(this, this._crossed)) {
        if (this._gates.has(g)) continue;
        this._gates.add(g);
        this.gatesPassed++;
        this.events.push({ type: 'gate', t: this.time, order: g.order, total: this.structures.gates.length, count: this.gatesPassed });
      }
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

    // 30 samples a second, exactly: carry the overshoot so the ghost replays in time
    this._pathTimer += dt;
    if (this._pathTimer >= 1 / 30 - 1e-9) {
      this._pathTimer -= 1 / 30;
      this.path.push([pos[0], pos[1], pos[2]]);
    }

    if (this.status !== 'running') return;
    // edges: bump a stray skier back onto the piste (no fall), losing some speed
    const lim = hf.halfX - P.edgeMargin;
    if (Math.abs(pos[0]) > lim) {
      const side = Math.sign(pos[0]);
      pos[0] = side * (lim - 1);
      if (pos[1] < hf.heightAt(pos[0], pos[2])) pos[1] = hf.heightAt(pos[0], pos[2]);
      vel[0] = -side * Math.max(2, Math.abs(vel[0]) * 0.4);
      vel[1] *= 0.7;
      vel[2] *= 0.7;
      if (this.heading[0] * side > 0) this.heading[0] = -this.heading[0];
      this.events.push({ type: 'bump', t: this.time });
    }
    if (pos[2] < -hf.halfZ + 0.5) {
      pos[2] = -hf.halfZ + 2;
      vel[2] = Math.abs(vel[2]);
    }
    if (pos[2] >= hf.finishZ || this.crossedFinish(ox, oz)) {
      this.status = 'finished';
    } else if (this.time > P.maxTime) {
      this.status = 'timeout';
    } else if (this.grounded && !this.grind && speed < P.stuckSpeed && !braking && this.wipeout <= 0 && !inp.crouch) {
      this.slowTime += dt;
      if (this.slowTime > P.stuckTime) this.status = 'stuck';
    } else {
      this.slowTime = 0;
    }
    if (this.status !== 'running') this.path.push([pos[0], pos[1], pos[2]]);
  }

  // did the last step cross one of the finish lines (going the right way)?
  crossedFinish(ox, oz) {
    if (!this.finishes) return false;
    const [x, , z] = this.pos;
    for (const f of this.finishes) {
      const a0 = (ox - f.x) * f.dir[0] + (oz - f.z) * f.dir[1];
      const a1 = (x - f.x) * f.dir[0] + (z - f.z) * f.dir[1];
      if (a0 < 0 && a1 >= 0 && Math.abs((x - f.x) * -f.dir[1] + (z - f.z) * f.dir[0]) < f.w / 2 + 2) return true;
    }
    return false;
  }

  // Trees and rocks: slide around them on a glancing hit, wipe out on a direct one.
  // You can fly over rocks (and the tops of small trees).
  collide() {
    const { pos, vel, hf, P } = this;
    const near = this.props.near(pos[0], pos[2], 6);
    if (!near.length) return;
    const above = pos[1] - hf.heightAt(pos[0], pos[2]);
    for (const p of near) {
      if (above > propHeight(p)) continue;
      const px = p.x;
      const pz = this.props.worldZ(p);
      const r = propRadius(p) + 0.45;
      let dx = pos[0] - px;
      let dz = pos[2] - pz;
      let d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d < 1e-4) {
        dx = -vel[0];
        dz = -vel[2];
        d = Math.hypot(dx, dz) || 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      pos[0] = px + nx * r;
      pos[2] = pz + nz * r;
      const g = hf.heightAt(pos[0], pos[2]);
      if (this.grounded || pos[1] < g) pos[1] = g;
      const approach = -(vel[0] * nx + vel[2] * nz);
      if (approach <= 0) continue;
      vel[0] += approach * nx;
      vel[2] += approach * nz;
      const what = p.k === TREE ? 'tree' : 'rock';
      if (approach > P.hitWipeout) {
        vel[0] *= 0.3;
        vel[1] *= 0.3;
        vel[2] *= 0.3;
        this.startWipeout(what, approach);
        return;
      }
      const k = 1 - Math.min(0.35, approach * 0.03);
      vel[0] *= k;
      vel[1] *= k;
      vel[2] *= k;
      if (approach > 2) this.events.push({ type: 'bump', t: this.time, value: approach, what });
    }
  }

  // ---------- rails and boxes ----------

  startGrind({ rail: r, s }) {
    const { vel } = this;
    const va = vel[0] * r.tx + vel[1] * r.ty + vel[2] * r.tz;
    this.grind = { rail: r, s, va, time: 0, dist: 0, slideTime: 0, air: !this.grounded };
    this.grounded = false;
    this.curAir = 0;
    this.sinceGround = 0;
    this.spinVel = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.placeOnRail();
    this.events.push({ type: 'grindStart', t: this.time, box: r.box });
  }

  placeOnRail() {
    const g = this.grind;
    const r = g.rail;
    this.pos[0] = r.x0 + r.tx * g.s;
    this.pos[1] = r.y0 + r.ty * g.s;
    this.pos[2] = r.z0 + r.tz * g.s;
    this.vel[0] = r.tx * g.va;
    this.vel[1] = r.ty * g.va;
    this.vel[2] = r.tz * g.va;
  }

  // Skis across the rail: 0 lined up .. π/2 square across it (switch counts as lined up)
  railAngle() {
    const r = this.grind.rail;
    const h = this.heading;
    const hl = Math.hypot(h[0], h[2]) || 1;
    const tl = Math.hypot(r.tx, r.tz) || 1;
    const c = Math.abs((h[0] * r.tx + h[2] * r.tz) / (hl * tl));
    return Math.acos(Math.min(1, c));
  }

  stepGrind(dt, inp) {
    const { P } = this;
    const g = this.grind;
    const r = g.rail;
    if (inp.crouch) this.crouchTime += dt;
    const release = this._wasCrouching && !inp.crouch;
    this._wasCrouching = inp.crouch;
    // gravity along the rail, a little metal friction, air drag
    g.va += -P.g * r.ty * dt;
    const fr = (r.box ? P.boxMu : P.railMu) * P.g * Math.sqrt(Math.max(0, 1 - r.ty * r.ty)) * dt;
    g.va = g.va > 0 ? Math.max(0, g.va - fr) : Math.min(0, g.va + fr);
    g.va -= g.va * Math.abs(g.va) * P.drag * dt;
    g.s += g.va * dt;
    g.time += dt;
    g.dist += Math.abs(g.va) * dt;
    // steering turns the skis on the rail: across it is a slide
    if (Math.abs(inp.steer) > 0.05) rotateAround(this.heading, UP, -inp.steer * P.railSpin * dt);
    this.heading[1] = 0;
    normalizeInPlace(this.heading);
    if (this.railAngle() > 0.9) g.slideTime += dt;
    this.n[0] = 0;
    this.n[1] = 1;
    this.n[2] = 0;
    this.placeOnRail();
    if (release && !this.crouchSpent && this.wipeout <= 0) {
      const charge = Math.min(1, this.crouchTime / P.chargeTime);
      this.leaveGrind();
      this.pop(charge);
    } else if (g.s >= r.len || g.s <= 0 || Math.abs(g.va) < 0.4) {
      this.leaveGrind();
    }
    if (!inp.crouch) {
      this.crouchTime = 0;
      this.crouchSpent = false;
    }
  }

  leaveGrind() {
    const g = this.grind;
    if (!g) return;
    this.grind = null;
    this.grindCooldown = this.P.grindCooldown;
    this.takeOff();
    if (g.dist < 1.5) return;
    this.grinds++;
    const r = g.rail;
    const sw = this.heading[0] * r.tx + this.heading[2] * r.tz < 0;
    this.events.push({ type: 'grind', t: this.time, dist: g.dist, time: g.time, slide: g.slideTime > g.time * 0.5, box: r.box, switch: sw });
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
    // a deliberate pop with the stick to one side means "spin": no wait for that
    this.airSteerArmed = true;
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
    // a steer or tuck/brake held through the lip must be let go before it rotates the rider
    this.airSteerArmed = Math.abs(this.input.steer) < 0.1;
    this.airPitchArmed = Math.abs(this.input.pitch) < 0.1;
  }

  rotateInAir(dt, inp) {
    const { P } = this;
    const k = Math.min(1, P.spinResponse * dt);
    // arm air control once the input is released, or after a short grace in the air
    if (!this.airSteerArmed && (Math.abs(inp.steer) < 0.1 || this.sinceGround > P.airGrace)) this.airSteerArmed = true;
    if (!this.airPitchArmed && (Math.abs(inp.pitch) < 0.1 || this.sinceGround > P.airGrace)) this.airPitchArmed = true;
    const steer = this.airSteerArmed ? inp.steer : 0;
    const pitch = this.airPitchArmed ? inp.pitch : 0;
    inp = { steer, pitch };
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

    // landing assist
    const step = P.assistRate * dt;
    if (Math.abs(inp.pitch) < 0.1 && Math.abs(this.pitchVel) < 1) {
      const target = Math.round(this.pitch / (2 * Math.PI)) * 2 * Math.PI;
      const err = target - this.pitch;
      if (Math.abs(err) < P.assistPitch) {
        const d = Math.sign(err) * Math.min(Math.abs(err), step);
        this.pitch += d;
        this.flipTotal += d;
      }
    }
    if (Math.abs(inp.steer) < 0.1 && Math.abs(this.spinVel) < 1) {
      const v = this.vel;
      const h = this.heading;
      const vl = Math.hypot(v[0], v[2]);
      const hl = Math.hypot(h[0], h[2]);
      if (vl > 2 && hl > 0.2) {
        // signed angle from the skis to the direction of travel; forwards or switch
        let a = Math.atan2(h[0] * v[2] - h[2] * v[0], h[0] * v[0] + h[2] * v[2]);
        if (a > Math.PI / 2) a -= Math.PI;
        else if (a < -Math.PI / 2) a += Math.PI;
        if (Math.abs(a) < P.assistYaw) {
          const d = -Math.sign(a) * Math.min(Math.abs(a), step);
          rotateAround(h, UP, d);
          this.spin += d;
        }
      }
    }
  }

  land(ground, n) {
    const { P, pos, vel } = this;
    pos[1] = ground;
    const impact = -dot(vel, n);
    // bending the knees into the landing soaks up some of the hit
    const soak = (this.input.crouch && this.wipeout <= 0 ? P.absorb : 0) + P.powderSoak * this.powder;
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

    // a 180 needs ~150° of rotation, a 360 ~330°; a flip needs ~300°
    const spinHalves = Math.floor((Math.abs(this.spin) + 0.55) / Math.PI);
    const flips = Math.floor((Math.abs(this.flipTotal) + 1.05) / (2 * Math.PI));
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
    let grip = brakeAmt > 0.05 ? 1.5 : P.grip + (P.carveGrip - P.grip) * Math.min(1, Math.abs(steer) * 1.5);
    grip *= 1 + (P.powderGrip - 1) * this.powder + (P.iceGrip - 1) * this.ice;
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
