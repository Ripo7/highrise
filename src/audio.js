// Synthesised sound: no audio files, everything is built from filtered noise and tones.
// Browsers only allow audio after a user gesture, so call unlock() from a click/tap/key.
//
// Continuous layers (wind, ski hiss, carving, sculpting rumble) follow the game state each
// frame; one-shots mark events (pop, landing, trick, combo, wipeout).

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.layers = null;
  }

  unlock() {
    if (this.ctx) {
      // 'interrupted' is iOS after a call or switching apps
      if (!this.hidden && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    // gentle limiter so stacked one-shots never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    // 2 s of white noise, looped, feeds every noisy layer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    const layer = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.layers = {
      wind: layer('lowpass', 400, 0.7),
      hiss: layer('highpass', 3500, 0.5),
      carve: layer('bandpass', 2200, 1.4),
      rumble: layer('lowpass', 160, 1.0),
    };
  }

  // Page hidden (other tab, phone locked): the frame loop stops, so the continuous layers
  // would hold their last volume forever. Stop the whole audio graph instead.
  setHidden(hidden) {
    this.hidden = hidden;
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend();
    else if (this.ctx.state !== 'running') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // Per-frame continuous layers. riding: skier or null; sculpt: 0..1 sculpting effort
  update({ skier = null, sculpt = 0 }) {
    if (!this.layers) return;
    const t = this.ctx.currentTime;
    const L = this.layers;
    const set = (param, v, tc = 0.06) => param.setTargetAtTime(v, t, tc);
    if (skier && skier.status === 'running') {
      const sp = skier.speed;
      const k = Math.min(1, sp / 45);
      const air = !skier.grounded;
      set(L.wind.g.gain, 0.05 + 0.5 * k * k + (air ? 0.12 : 0));
      set(L.wind.f.frequency, 250 + sp * 22 + (air ? 500 : 0));
      const ground = skier.grounded && skier.wipeout <= 0 ? 1 : 0;
      // powder is a soft, low whoosh; packed snow a bright hiss
      const pw = skier.powder || 0;
      set(L.hiss.g.gain, ground * (0.1 + 0.08 * pw) * k);
      set(L.hiss.f.frequency, 3500 - 2700 * pw);
      // the edges biting (a carve hisses), the skis scraping sideways (a skid roars)
      const carve = Math.min(1, Math.abs(skier.latAcc || 0) / 15) * 0.7 + (skier.skid || 0) * 1.3;
      if (skier.grind) {
        // metal (or plastic) scraping under the skis
        set(L.carve.g.gain, 0.22 * Math.min(1, sp / 8), 0.03);
        set(L.carve.f.frequency, skier.grind.rail.box ? 1200 : 4200);
      } else {
        set(L.carve.g.gain, ground * Math.min(1, sp / 15) * 0.32 * Math.min(1.3, carve) * (1 - 0.6 * pw), 0.04);
        set(L.carve.f.frequency, 1500 + sp * 30);
      }
    } else {
      set(L.wind.g.gain, 0.03, 0.3);
      set(L.wind.f.frequency, 300, 0.3);
      set(L.hiss.g.gain, 0, 0.1);
      set(L.carve.g.gain, 0, 0.1);
    }
    set(L.rumble.g.gain, sculpt * 0.55, 0.05);
  }

  // ---------- one-shots ----------
  burst({ type = 'lowpass', freq = 800, q = 0.8, dur = 0.25, gain = 0.5, sweepTo = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, to = null, dur = 0.2, gain = 0.25, type = 'sine', delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pop(charge) {
    this.burst({ type: 'bandpass', freq: 600, sweepTo: 2400, q: 1.2, dur: 0.18, gain: 0.35 + 0.3 * charge });
    this.tone({ freq: 140, to: 260, dur: 0.12, gain: 0.18 });
  }

  land(impact, quality) {
    const k = Math.min(1, impact / 16);
    this.burst({ type: 'lowpass', freq: 900 + 1200 * k, dur: 0.22 + 0.2 * k, gain: 0.35 + 0.55 * k });
    this.tone({ freq: 95, to: 45, dur: 0.25, gain: 0.25 + 0.35 * k });
    if (quality === 'sketchy') this.burst({ type: 'bandpass', freq: 2600, q: 2, dur: 0.35, gain: 0.25 });
  }

  trick(points) {
    // brighter, longer chime for bigger tricks
    const steps = points > 3000 ? [0, 4, 7, 12] : points > 1200 ? [0, 4, 7] : [0, 7];
    steps.forEach((st, i) =>
      this.tone({ freq: 660 * Math.pow(2, st / 12), dur: 0.22, gain: 0.12, type: 'triangle', delay: i * 0.07 })
    );
  }

  combo() {
    [0, 4, 7, 12, 16].forEach((st, i) =>
      this.tone({ freq: 523 * Math.pow(2, st / 12), dur: 0.3, gain: 0.11, type: 'triangle', delay: i * 0.06 })
    );
  }

  wipeout() {
    this.burst({ type: 'lowpass', freq: 1400, sweepTo: 200, dur: 0.7, gain: 0.8 });
    this.tone({ freq: 110, to: 40, dur: 0.45, gain: 0.4 });
    this.tone({ freq: 330, to: 160, dur: 0.35, gain: 0.08, type: 'sawtooth', delay: 0.05 });
  }

  finish() {
    [0, 4, 7, 12].forEach((st, i) =>
      this.tone({ freq: 392 * Math.pow(2, st / 12), dur: 0.45, gain: 0.13, type: 'triangle', delay: i * 0.1 })
    );
  }

  stamp() {
    this.tone({ freq: 70, to: 45, dur: 0.25, gain: 0.35 });
    this.burst({ type: 'lowpass', freq: 500, dur: 0.25, gain: 0.3 });
  }

  click() {
    this.tone({ freq: 1200, dur: 0.04, gain: 0.05, type: 'square' });
  }
}
