// Style scoring: turns the skier's landing events into named tricks, points and combos.
//
// A trick is scored on landing: air time, spins (180, 360, 540...), flips (front/back,
// double...), a switch landing, and the landing quality. Tricks landed one after another
// (less than COMBO_WINDOW seconds on the snow between them) build a combo; the combo is
// banked with its multiplier when the window runs out or the run finishes, and lost on a
// wipeout.

export const COMBO_WINDOW = 2.6; // seconds on the snow before a combo is banked
const SPIN_POINTS = { 180: 250, 360: 600, 540: 1000, 720: 1500, 900: 2100, 1080: 2800 };
const FLIP_POINTS = { back: 1200, front: 1400 };
const FLIP_WORD = ['', '', 'Double ', 'Triple ', 'Quad '];
export const FINISH_BONUS = 1000;

export function spinPoints(deg) {
  if (!deg) return 0;
  return SPIN_POINTS[deg] ?? 2800 + ((deg - 1080) / 180) * 800;
}

// Name and score one landing. Returns null when there's nothing to score.
export function judgeLanding(ev) {
  const hasSpin = ev.spin >= 180;
  const hasFlip = ev.flips >= 1;
  const bigAir = ev.air >= 1.0;
  if (!hasSpin && !hasFlip && !bigAir) return null;
  if (ev.quality === 'wipeout') return null;

  const parts = [];
  let points = Math.round(ev.air * 120);
  if (hasFlip) {
    const word = ev.flipDir === 'back' ? 'Backflip' : 'Front Flip';
    parts.push((FLIP_WORD[ev.flips] ?? `${ev.flips}× `) + word);
    points += FLIP_POINTS[ev.flipDir] * ev.flips * (1 + 0.25 * (ev.flips - 1));
  }
  if (hasSpin) {
    parts.push(String(ev.spin));
    points += spinPoints(ev.spin);
  }
  if (hasSpin && hasFlip) points *= 1.3; // corked: flip and spin together
  if (ev.switch && (hasSpin || hasFlip)) {
    parts.unshift('Switch');
    points *= 1.2;
  }
  let name = parts.join(' ');
  if (!name) name = `Big Air ${ev.air.toFixed(1)} s`;
  let qualityNote = '';
  if (ev.quality === 'clean') {
    points += hasSpin || hasFlip ? 200 : 50;
    qualityNote = 'Clean';
  } else {
    points *= 0.5;
    qualityNote = SKETCHY_NOTE[ev.cause] ?? 'Sketchy';
  }
  return { name, points: Math.round(points / 10) * 10, quality: ev.quality, note: qualityNote, isTrick: hasSpin || hasFlip };
}

export class ScoreKeeper {
  constructor() {
    this.total = 0;
    this.combo = null; // { points, tricks: [names], timer }
    this.tricks = [];
    this.bestTrick = null;
    this.bestCombo = 0;
    this.feed = []; // messages for the HUD: { kind, text, sub, points }
    this._seen = 0;
  }

  get window() {
    return COMBO_WINDOW;
  }

  get multiplier() {
    return this.combo ? Math.min(5, 1 + 0.5 * (this.combo.tricks.length - 1)) : 1;
  }

  // points the current combo is worth if banked now
  get pending() {
    return this.combo ? Math.round(this.combo.points * this.multiplier) : 0;
  }

  // Read new events from the skier and run the combo timer
  update(skier, dt) {
    for (; this._seen < skier.events.length; this._seen++) this.onEvent(skier.events[this._seen]);
    if (this.combo && skier.grounded && skier.wipeout <= 0) {
      this.combo.timer -= dt;
      if (this.combo.timer <= 0) this.bank();
    }
  }

  onEvent(ev) {
    if (ev.type === 'land') {
      const trick = judgeLanding(ev);
      if (!trick) return;
      this.tricks.push(trick);
      if (!this.bestTrick || trick.points > this.bestTrick.points) this.bestTrick = trick;
      if (!this.combo) this.combo = { points: 0, tricks: [], timer: 0 };
      this.combo.points += trick.points;
      // only real tricks (spins, flips) raise the multiplier; big air just adds points
      if (trick.isTrick || !this.combo.tricks.length) this.combo.tricks.push(trick.name);
      this.combo.timer = COMBO_WINDOW;
      this.feed.push({
        kind: trick.quality,
        text: trick.name,
        sub: this.combo.tricks.length > 1 ? `${trick.note} · combo ×${this.multiplier}` : trick.note,
        points: trick.points,
      });
    } else if (ev.type === 'wipeout') {
      const lost = this.pending;
      this.combo = null;
      this.feed.push({
        kind: 'wipeout',
        text: 'Wipeout',
        sub: lost ? `Combo lost (${lost.toLocaleString('en-US')})` : WIPEOUT_HINT[ev.reason] ?? '',
        points: 0,
      });
    }
  }

  bank() {
    if (!this.combo) return;
    const pts = this.pending;
    this.total += pts;
    this.bestCombo = Math.max(this.bestCombo, pts);
    if (this.combo.tricks.length > 1) {
      this.feed.push({ kind: 'combo', text: `${this.combo.tricks.length}-trick combo`, sub: `×${this.multiplier}`, points: pts });
    }
    this.combo = null;
  }

  finish(skier) {
    this.update(skier, 0);
    this.bank();
    if (skier.status === 'finished') this.total += FINISH_BONUS;
  }
}

const SKETCHY_NOTE = {
  hard: 'Hard landing: hold Jump to absorb',
  crossed: 'Sketchy: skis not straight',
  balance: 'Sketchy: off balance',
};

const WIPEOUT_HINT = {
  impact: 'Landed too hard: aim for a downslope',
  sideways: 'Skis sideways: straighten before landing',
  flip: 'Not upright: finish the flip or let go sooner',
  edge: 'Off the side of the piste',
};
