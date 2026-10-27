// Structures from the run editor: rails and boxes to grind, chalets, lift pylons, bridges,
// tunnels, safety nets, piste poles, slalom gates and snow cannons. This file is their
// physics: what the skier bumps into, what catches him, what he can grind and which gates
// he rides through. Pure JS (tested in Node); the meshes are in render/structureMeshes.js.
//
// Structures are stored in world coordinates ({ type, x, z, dir, ... }); `seat()` reads the
// snow height under each one and rebuilds the colliders.

const CELL = 32; // spatial index cell (m)
const BODY = 0.45; // skier radius
const HEAD = 1.8; // skier height

export class StructureSet {
  constructor(hf) {
    this.hf = hf;
    this.list = [];
    this.version = 0;
    this.seat();
  }

  set(list) {
    this.list = list.map((o) => ({ ...o }));
    this.seat();
  }

  // gather colliders from the structures, on the snow as it is now
  seat() {
    const hf = this.hf;
    const gy = (x, z) => hf.heightAt(x, z);
    this.circles = [];
    this.boxes = [];
    this.segs = [];
    this.rails = [];
    this.gates = [];
    this.tunnels = [];
    this.decks = [];
    for (const s of this.list) {
      switch (s.type) {
        case 'rail': {
          const dx = s.x1 - s.x0;
          const dy = s.y1 - s.y0;
          const dz = s.z1 - s.z0;
          const len = Math.hypot(dx, dy, dz) || 1;
          const r = { s, x0: s.x0, y0: s.y0, z0: s.z0, tx: dx / len, ty: dy / len, tz: dz / len, len, box: !!s.box, hr: s.hr };
          this.rails.push(r);
          // knocking into it from the side (not lined up to grind) is a bump
          this.segs.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, h: s.hr, r: s.box ? 0.28 : 0.08, kind: 'rail', soft: true, rail: r });
          break;
        }
        case 'chalet':
          this.boxes.push({ x: s.x, z: s.z, dx: s.dir[0], dz: s.dir[1], hb: s.w / 2, ha: s.d / 2, h: 12, kind: 'wall' });
          break;
        case 'pylon':
          this.circles.push({ x: s.x, z: s.z, r: 0.9, h: s.h, kind: 'pylon' });
          break;
        case 'bridge': {
          const [dx, dz] = s.dir;
          for (const side of [-1, 1]) {
            const x = s.x + dz * side * (s.span / 2);
            const z = s.z - dx * side * (s.span / 2);
            this.boxes.push({ x, z, dx, dz, hb: 1.4, ha: 2, h: s.deckY - gy(x, z) + 1, kind: 'wall' });
          }
          this.decks.push({ x: s.x, z: s.z, dx, dz, hb: s.span / 2, ha: 2.2, yb: s.deckY - 0.45, yt: s.deckY + 0.55 });
          break;
        }
        case 'tunnel':
          this.tunnels.push({ x: s.x, z: s.z, dx: s.dir[0], dz: s.dir[1], L: s.L, hw: s.hw, ht: s.ht });
          break;
        case 'net': {
          const x1 = s.x + s.dir[0] * s.L;
          const z1 = s.z + s.dir[1] * s.L;
          this.segs.push({ x0: s.x, z0: s.z, x1, z1, h: s.h, r: 0.15, kind: 'net', soft: true });
          break;
        }
        case 'pole':
          this.circles.push({ x: s.x, z: s.z, r: 0.12, h: 2, kind: 'pole', soft: true });
          break;
        case 'gate': {
          const [dx, dz] = s.dir;
          for (const side of [-1, 1]) {
            this.circles.push({ x: s.x + dz * side * (s.gw / 2), z: s.z - dx * side * (s.gw / 2), r: 0.12, h: 2, kind: 'pole', soft: true });
          }
          this.gates.push({ x: s.x, z: s.z, dx, dz, hw: s.gw / 2, order: s.order ?? 0, s });
          break;
        }
        case 'cannon': {
          const r = [1.0, 0.6, 0.8][s.size] ?? 0.8;
          this.circles.push({ x: s.x, z: s.z, r, h: [2.6, 7, 11][s.size] ?? 7, kind: 'cannon' });
          break;
        }
        default:
          break;
      }
    }
    // spatial index of everything the skier can hit, by bounding circle
    this.grid = new Map();
    const add = (o, x, z, rad) => {
      const i0 = Math.floor((x - rad + hf.halfX) / CELL);
      const i1 = Math.floor((x + rad + hf.halfX) / CELL);
      const j0 = Math.floor((z - rad + hf.halfZ) / CELL);
      const j1 = Math.floor((z + rad + hf.halfZ) / CELL);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * 1024 + i;
          let cell = this.grid.get(k);
          if (!cell) this.grid.set(k, (cell = []));
          cell.push(o);
        }
      }
    };
    for (const c of this.circles) add({ t: 'c', o: c }, c.x, c.z, c.r + 1);
    for (const b of this.boxes) add({ t: 'b', o: b }, b.x, b.z, Math.hypot(b.ha, b.hb) + 1);
    for (const s of this.segs) add({ t: 's', o: s }, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, Math.hypot(s.x1 - s.x0, s.z1 - s.z0) / 2 + 1);
    for (const t of this.tunnels) add({ t: 't', o: t }, t.x + (t.dx * t.L) / 2, t.z + (t.dz * t.L) / 2, t.L / 2 + t.hw + 2);
    for (const d of this.decks) add({ t: 'd', o: d }, d.x, d.z, Math.hypot(d.ha, d.hb) + 1);
    for (const r of this.rails) add({ t: 'r', o: r }, r.x0 + (r.tx * r.len) / 2, r.z0 + (r.tz * r.len) / 2, r.len / 2 + 1.5);
    for (const g of this.gates) add({ t: 'g', o: g }, g.x, g.z, g.hw + 2);
    this.version++;
  }

  near(x, z) {
    const i = Math.floor((x + this.hf.halfX) / CELL);
    const j = Math.floor((z + this.hf.halfZ) / CELL);
    const cell = this.grid.get(j * 1024 + i);
    return cell || EMPTY;
  }

  get count() {
    return this.list.length;
  }

  /**
   * Push the skier out of anything solid. Soft things (poles, nets, the side of a rail)
   * only bump or slow him; hard things (walls, pylons, cannons) knock him down when he
   * hits them straight on, fast.
   */
  collide(sk) {
    const items = this.near(sk.pos[0], sk.pos[2]);
    if (!items.length) return;
    const hf = this.hf;
    const pos = sk.pos;
    const ground = hf.heightAt(pos[0], pos[2]);
    const above = pos[1] - ground;
    for (const it of items) {
      const o = it.o;
      if (it.t === 'c') {
        if (above > o.h) continue;
        let dx = pos[0] - o.x;
        let dz = pos[2] - o.z;
        const r = o.r + BODY;
        let d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-4) {
          dx = -sk.vel[0];
          dz = -sk.vel[2];
          d = Math.hypot(dx, dz) || 1;
        }
        if (this.respond(sk, dx / d, dz / d, o.x + (dx / d) * r, o.z + (dz / d) * r, o)) return;
      } else if (it.t === 'b') {
        if (above > o.h) continue;
        const rx = pos[0] - o.x;
        const rz = pos[2] - o.z;
        const la = rx * o.dx + rz * o.dz;
        const lb = rx * o.dz - rz * o.dx;
        const ea = o.ha + BODY;
        const eb = o.hb + BODY;
        if (Math.abs(la) >= ea || Math.abs(lb) >= eb) continue;
        // out through the nearest face
        let nx;
        let nz;
        let px;
        let pz;
        if (ea - Math.abs(la) < eb - Math.abs(lb)) {
          const sg = Math.sign(la) || 1;
          nx = o.dx * sg;
          nz = o.dz * sg;
          px = o.x + o.dx * sg * ea + o.dz * lb;
          pz = o.z + o.dz * sg * ea - o.dx * lb;
        } else {
          const sg = Math.sign(lb) || 1;
          nx = o.dz * sg;
          nz = -o.dx * sg;
          px = o.x + o.dx * la + o.dz * sg * eb;
          pz = o.z + o.dz * la - o.dx * sg * eb;
        }
        if (this.respond(sk, nx, nz, px, pz, o)) return;
      } else if (it.t === 's') {
        if (above > o.h + 0.1) continue;
        if (o.rail && sk.grind) continue;
        const sx = o.x1 - o.x0;
        const sz = o.z1 - o.z0;
        const l2 = sx * sx + sz * sz || 1;
        const t0 = ((pos[0] - o.x0) * sx + (pos[2] - o.z0) * sz) / l2;
        // a rail is only something to knock into from the side; its ends are where you get on
        if (o.rail && (t0 <= 0.02 || t0 >= 0.98)) continue;
        const t = Math.max(0, Math.min(1, t0));
        const cx = o.x0 + sx * t;
        const cz = o.z0 + sz * t;
        let dx = pos[0] - cx;
        let dz = pos[2] - cz;
        const r = o.r + BODY;
        let d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-4) {
          // dead on the line: back out the way he came
          dx = sk.prevPos[0] - cx;
          dz = sk.prevPos[2] - cz;
          d = Math.hypot(dx, dz);
          if (d < 1e-4) {
            dx = sz;
            dz = -sx;
            d = Math.hypot(dx, dz);
          }
        }
        if (this.respond(sk, dx / d, dz / d, cx + (dx / d) * r, cz + (dz / d) * r, o)) return;
      } else if (it.t === 't') {
        if (this.tunnel(sk, o, ground)) return;
      } else if (it.t === 'd') {
        const rx = pos[0] - o.x;
        const rz = pos[2] - o.z;
        if (Math.abs(rx * o.dx + rz * o.dz) > o.ha || Math.abs(rx * o.dz - rz * o.dx) > o.hb) continue;
        // a bridge deck overhead: bump your head on it
        if (pos[1] + HEAD > o.yb && pos[1] < o.yt) {
          pos[1] = Math.max(ground, o.yb - HEAD);
          if (sk.vel[1] > 0) {
            const v = sk.vel[1];
            sk.vel[1] = -0.2 * v;
            if (v > 2) sk.events.push({ type: 'bump', t: sk.time, value: v, what: 'bridge' });
          }
        }
      }
    }
  }

  // Shared response: put the skier at (px, pz), take out the speed into the surface along
  // (nx, nz), then decide between a glancing bump and a wipeout. Returns true on a wipeout.
  respond(sk, nx, nz, px, pz, o) {
    const { pos, vel, P, hf } = sk;
    pos[0] = px;
    pos[2] = pz;
    const g = hf.heightAt(px, pz);
    if (sk.grounded || pos[1] < g) pos[1] = g;
    const approach = -(vel[0] * nx + vel[2] * nz);
    if (approach <= 0) return false;
    vel[0] += approach * nx;
    vel[2] += approach * nz;
    if (o.kind === 'net') {
      // the netting catches you: most of the speed goes
      const k = approach > 2 ? 0.35 : 0.8;
      vel[0] *= k;
      vel[1] *= k;
      vel[2] *= k;
      if (approach > 1.5) sk.events.push({ type: 'bump', t: sk.time, value: approach, what: 'net' });
      return false;
    }
    if (!o.soft && approach > P.hitWipeout) {
      vel[0] *= 0.3;
      vel[1] *= 0.3;
      vel[2] *= 0.3;
      sk.startWipeout(o.kind, approach);
      return true;
    }
    const k = 1 - Math.min(o.soft ? 0.15 : 0.35, approach * 0.03);
    vel[0] *= k;
    vel[1] *= k;
    vel[2] *= k;
    if (approach > 2) sk.events.push({ type: 'bump', t: sk.time, value: approach, what: o.kind });
    return false;
  }

  // Ride through a snow tunnel: its walls keep you in, the roof keeps you down; from
  // outside, its shell is something to go around (or over, if you fly high enough).
  tunnel(sk, t, ground) {
    const pos = sk.pos;
    const prev = sk.prevPos;
    const rx = pos[0] - t.x;
    const rz = pos[2] - t.z;
    const la = rx * t.dx + rz * t.dz;
    const lb = rx * t.dz - rz * t.dx;
    const shell = t.hw + 1.3;
    if (la < -0.3 || la > t.L + 0.3 || Math.abs(lb) > shell + BODY) return false;
    const above = pos[1] - ground;
    if (above > t.ht + 1.4) return false;
    const pa = (prev[0] - t.x) * t.dx + (prev[2] - t.z) * t.dz;
    const pb = (prev[0] - t.x) * t.dz - (prev[2] - t.z) * t.dx;
    const wasInside = Math.abs(pb) < t.hw && pa > -0.6;
    const put = (b) => {
      pos[0] = t.x + t.dx * la + t.dz * b;
      pos[2] = t.z + t.dz * la - t.dx * b;
      const g = sk.hf.heightAt(pos[0], pos[2]);
      if (sk.grounded || pos[1] < g) pos[1] = g;
    };
    const o = { kind: 'tunnel', soft: true };
    if (wasInside) {
      const lim = t.hw - 0.6;
      if (Math.abs(lb) > lim) {
        const sg = Math.sign(lb);
        const nx = -t.dz * sg;
        const nz = t.dx * sg;
        put(sg * lim);
        if (this.respond(sk, nx, nz, pos[0], pos[2], o)) return true;
      }
      // the roof: an arch over the middle
      const q = Math.max(0, 1 - (lb / t.hw) * (lb / t.hw));
      const roof = t.ht * Math.sqrt(q);
      if (above + HEAD > roof) {
        pos[1] = ground + Math.max(0, roof - HEAD);
        if (sk.vel[1] > 0) {
          const v = sk.vel[1];
          sk.vel[1] = -0.2 * v;
          if (v > 2) sk.events.push({ type: 'bump', t: sk.time, value: v, what: 'tunnel' });
        }
      }
      return false;
    }
    // outside: the shell (and the portal frames) push you away
    if (Math.abs(lb) < shell + BODY) {
      const sg = Math.sign(lb) || 1;
      put(sg * (shell + BODY));
      return this.respond(sk, t.dz * sg, -t.dx * sg, pos[0], pos[2], { kind: 'tunnel' });
    }
    return false;
  }

  /**
   * A rail or box the skier can lock onto right now: lined up over it (within reach),
   * at its height, moving along it. Returns { rail, s } (s = metres along) or null.
   */
  findRail(sk) {
    const items = this.near(sk.pos[0], sk.pos[2]);
    const { pos, vel } = sk;
    for (const it of items) {
      if (it.t !== 'r') continue;
      const r = it.o;
      const s = (pos[0] - r.x0) * r.tx + (pos[1] - r.y0) * r.ty + (pos[2] - r.z0) * r.tz;
      if (s < -0.8 || s > r.len - 0.5) continue;
      const qx = r.x0 + r.tx * s;
      const qy = r.y0 + r.ty * s;
      const qz = r.z0 + r.tz * s;
      const lat = Math.hypot(pos[0] - qx, pos[2] - qz);
      const tol = r.box ? 0.62 : 0.42;
      if (lat > tol) continue;
      const dy = pos[1] - qy;
      if (dy < -0.38 || dy > 0.75) continue;
      const va = vel[0] * r.tx + vel[1] * r.ty + vel[2] * r.tz;
      if (va < 1.5) continue;
      // not shooting up past it
      if (vel[1] - va * r.ty > 2.5) continue;
      return { rail: r, s: Math.max(0, s) };
    }
    return null;
  }

  // the tunnel the point (x, z) is in, or about to enter (for the ride camera)
  tunnelAt(x, z, ahead = 0) {
    for (const t of this.tunnels) {
      const la = (x - t.x) * t.dx + (z - t.z) * t.dz;
      const lb = (x - t.x) * t.dz - (z - t.z) * t.dx;
      if (la > -ahead && la < t.L + 2 && Math.abs(lb) < t.hw + 0.5) return t;
    }
    return null;
  }

  /** Slalom gates passed between the previous position and this one. */
  gatesCrossed(sk, out = []) {
    const items = this.near(sk.pos[0], sk.pos[2]);
    for (const it of items) {
      if (it.t !== 'g') continue;
      const g = it.o;
      const a0 = (sk.prevPos[0] - g.x) * g.dx + (sk.prevPos[2] - g.z) * g.dz;
      const a1 = (sk.pos[0] - g.x) * g.dx + (sk.pos[2] - g.z) * g.dz;
      if (!(a0 < 0 && a1 >= 0)) continue;
      const b = (sk.pos[0] - g.x) * g.dz - (sk.pos[2] - g.z) * g.dx;
      if (Math.abs(b) < g.hw) out.push(g);
    }
    return out;
  }
}

const EMPTY = [];
