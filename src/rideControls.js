// Ride input: a floating thumb stick on the left (steer / brake / spin / flip), a hold-and-
// release Jump button on the right, and the keyboard. All three merge into one input:
//   steer -1..1 (right +), pitch -1..1 (up +), crouch (bool)

const STICK_RADIUS = 56; // px of thumb travel for full input
const DEAD = 0.12;

export class RideControls {
  constructor({ onPress } = {}) {
    this.onPress = onPress; // called on any control touch (to unlock audio)
    this.zone = document.getElementById('stick-zone');
    this.stick = document.getElementById('stick');
    this.knob = document.getElementById('stick-knob');
    this.jumpBtn = document.getElementById('jump-btn');
    this.touch = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.stickVal = { x: 0, y: 0 };
    this.jumpHeld = false;
    this.keys = new Set();
    this.kbSteer = 0;
    this.input = { steer: 0, pitch: 0, crouch: false };
    this.attach();
  }

  attach() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.touch.id !== null) return;
      e.preventDefault();
      z.setPointerCapture(e.pointerId);
      const r = z.getBoundingClientRect();
      this.touch = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, x: 0, y: 0 };
      this.stick.classList.add('active');
      this.stick.style.left = `${this.touch.ox}px`;
      this.stick.style.top = `${this.touch.oy}px`;
      this.moveKnob(0, 0);
      this.onPress?.();
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.touch.id) return;
      const r = z.getBoundingClientRect();
      let dx = e.clientX - r.left - this.touch.ox;
      let dy = e.clientY - r.top - this.touch.oy;
      const d = Math.hypot(dx, dy);
      // past the rim, the stick follows the thumb (no dead edge)
      if (d > STICK_RADIUS * 1.25) {
        const pull = (d - STICK_RADIUS * 1.25) / d;
        this.touch.ox += dx * pull;
        this.touch.oy += dy * pull;
        dx -= dx * pull;
        dy -= dy * pull;
        this.stick.style.left = `${this.touch.ox}px`;
        this.stick.style.top = `${this.touch.oy}px`;
      }
      this.moveKnob(dx, dy);
    });
    const end = (e) => {
      if (e.pointerId !== this.touch.id) return;
      this.touch.id = null;
      this.stickVal.x = 0;
      this.stickVal.y = 0;
      this.stick.classList.remove('active');
      this.stick.style.left = '';
      this.stick.style.top = '';
      this.knob.style.transform = '';
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);

    const b = this.jumpBtn;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      this.jumpHeld = true;
      b.classList.add('held');
      this.onPress?.();
    });
    const release = () => {
      this.jumpHeld = false;
      b.classList.remove('held');
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  moveKnob(dx, dy) {
    const d = Math.hypot(dx, dy);
    const k = d > STICK_RADIUS ? STICK_RADIUS / d : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const shape = (v) => {
      const a = Math.abs(v);
      return a < DEAD ? 0 : Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
    };
    this.stickVal.x = shape(dx / STICK_RADIUS);
    this.stickVal.y = shape(-dy / STICK_RADIUS); // up is +
  }

  // keyboard (called from the page's key handlers); returns true when used
  key(code, down) {
    if (!RIDE_KEYS.has(code)) return false;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    return true;
  }

  // Merge everything into skier input. dt for the keyboard's analog ramp.
  update(dt) {
    const k = this.keys;
    const kbTarget = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    // keys ease in over ~0.12 s so small taps make small corrections
    const rate = kbTarget === 0 ? 14 : 8;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, kbTarget - this.kbSteer));
    const kbPitch = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    const steer = this.touch.id !== null ? this.stickVal.x : this.kbSteer;
    const pitch = this.touch.id !== null ? this.stickVal.y : kbPitch;
    this.input.steer = Math.max(-1, Math.min(1, steer));
    this.input.pitch = Math.max(-1, Math.min(1, pitch));
    this.input.crouch = this.jumpHeld || k.has('Space');
    return this.input;
  }

  setCharge(c, airborne) {
    this.jumpBtn.style.setProperty('--charge', c.toFixed(3));
    this.jumpBtn.classList.toggle('air', airborne);
  }

  reset() {
    this.keys.clear();
    this.kbSteer = 0;
    this.jumpHeld = false;
    this.jumpBtn.classList.remove('held');
    this.touch.id = null;
    this.stickVal.x = this.stickVal.y = 0;
    this.stick.classList.remove('active');
    this.knob.style.transform = '';
  }
}

const RIDE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space']);
