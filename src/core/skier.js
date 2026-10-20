// Point-mass skier sliding on the heightfield.
// Grounded: gravity + snow friction + air drag, velocity kept along the surface.
// Airborne: ballistic flight + drag. The skier leaves the ground on its own when the
// terrain falls away faster than gravity can follow (crests, kickers).

export const PHYS = {
  g: 9.81,
  mu: 0.055, // ski/snow kinetic friction
  drag: 0.0032, // 0.5·ρ·CdA / m  (1/m)
  dt: 1 / 240,
  liftoffGap: 0.004, // metres above the surface before we count as airborne
  roughLanding: 9, // m/s into the slope: lose speed
  crashLanding: 15, // m/s into the slope: crash
  minJumpAir: 0.25, // seconds of air to count as a jump
  stuckSpeed: 0.6,
  stuckTime: 1.5,
  maxTime: 120,
  finishZ: 108,
  edgeMargin: 2,
};

export class Skier {
  constructor(hf, start, params = PHYS) {
    this.hf = hf;
    this.P = params;
    const y = hf.heightAt(start.x, start.z);
    this.pos = [start.x, y, start.z];
    // a small push down the fall line
    const n = hf.normalAt(start.x, start.z);
    const push = [0, 0, 3];
    const vn = dot(push, n);
    this.vel = [push[0] - vn * n[0], push[1] - vn * n[1], push[2] - vn * n[2]];
    this.n = n;
    this.grounded = true;
    this.status = 'running'; // running | finished | crashed | stuck | out | timeout
    this.time = 0;
    this.distance = 0;
    this.maxSpeed = 0;
    this.airTime = 0; // total
    this.curAir = 0;
    this.maxAir = 0;
    this.jumps = 0;
    this.slowTime = 0;
    this.events = []; // {type:'jump'|'rough'|'crash', t, value}
    this.path = [[...this.pos]];
    this._pathTimer = 0;
  }

  get speed() {
    return Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
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

    // forces
    vel[1] -= P.g * dt;
    const dragK = P.drag * speed0 * dt;
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
        const dv = Math.min(vtl, P.mu * P.g * Math.max(0, n[1]) * dt);
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
    const n = hf.normalAt(pos[0], pos[2], this.n);

    if (this.grounded) {
      if (gap > P.liftoffGap) {
        // terrain dropped away: we fly
        this.grounded = false;
        this.curAir = 0;
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
      }
    } else {
      this.curAir += dt;
      if (gap <= 0) {
        // landing
        pos[1] = ground;
        const impact = -dot(vel, n);
        const vn = dot(vel, n);
        vel[0] -= vn * n[0];
        vel[1] -= vn * n[1];
        vel[2] -= vn * n[2];
        if (this.curAir >= P.minJumpAir) {
          this.jumps++;
          this.airTime += this.curAir;
          this.maxAir = Math.max(this.maxAir, this.curAir);
          this.events.push({ type: 'jump', t: this.time, value: this.curAir });
        }
        if (impact > P.crashLanding) {
          this.events.push({ type: 'crash', t: this.time, value: impact });
          this.status = 'crashed';
        } else if (impact > P.roughLanding) {
          const k = 0.7;
          vel[0] *= k;
          vel[1] *= k;
          vel[2] *= k;
          this.events.push({ type: 'rough', t: this.time, value: impact });
        }
        this.grounded = true;
        this.curAir = 0;
      }
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
    if (pos[2] >= P.finishZ) {
      this.status = 'finished';
    } else if (Math.abs(pos[0]) > hf.half - P.edgeMargin || pos[2] < -hf.half + 0.5) {
      this.status = 'out';
    } else if (this.time > P.maxTime) {
      this.status = 'timeout';
    } else if (this.grounded && speed < P.stuckSpeed) {
      this.slowTime += dt;
      if (this.slowTime > P.stuckTime) this.status = 'stuck';
    } else {
      this.slowTime = 0;
    }
    if (this.status !== 'running') this.path.push([pos[0], pos[1], pos[2]]);
  }

  // Simulate a whole run without rendering (for tests / previews)
  simulate(maxTime = this.P.maxTime) {
    while (this.status === 'running' && this.time < maxTime) this.step(this.P.dt);
    return this;
  }
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Simple score for Phase 0: finishing time with a bonus for air.
export function scoreRun(s) {
  if (s.status !== 'finished') return null;
  return { time: s.time, air: s.airTime, jumps: s.jumps, maxSpeed: s.maxSpeed };
}
