// Picture quality: Low, Medium or High, or Auto, which picks one from the device and steps
// down by itself when frames come too slowly. Plain data and pure functions (no three.js),
// so the choices can be tested in node; main.js applies them.
//
//   Low     the scene straight to the screen, as before the post-processing: no grading,
//           at most 1 pixel per CSS pixel, small shadow map
//   Medium  + the post-processing (grading, vignette, dithering, its own 4x anti-aliasing),
//           up to 1.5 pixels per CSS pixel
//   High    up to 2 pixels per CSS pixel, bloom on light brighter than white (the sun),
//           a bigger, sharper shadow map that reaches further while riding
//
// Auto also scales the resolution (down to 60 % of the tier's) to hold the frame rate, and
// drops a tier when even that isn't enough; a tier it dropped to is remembered for next time.

// rideShadow: half the side of the ground the sun's shadows cover while riding (m);
// snow: flakes in the air round the camera; glow: the snow's glow inside a shadow's edge
// (a second, wider look at the shadow map in shadowed pixels: not on Low)
export const TIERS = {
  low: { post: false, bloom: false, maxRatio: 1, shadow: 1024, rideShadow: 80, snow: 250, glow: false },
  medium: { post: true, bloom: false, maxRatio: 1.5, shadow: 2048, rideShadow: 110, snow: 700, glow: true },
  high: { post: true, bloom: true, maxRatio: 2, shadow: 4096, rideShadow: 150, snow: 1400, glow: true },
};
export const TIER_ORDER = ['low', 'medium', 'high'];
export const SETTINGS = ['auto', 'low', 'medium', 'high'];

/**
 * The tier Auto starts on.
 * dev: { coarse (touch screen), dpr, memory (GB, navigator.deviceMemory, may be undefined),
 *        floatTargets (can render to half-float targets: the post-processing needs it),
 *        remembered (a tier Auto dropped to before) }
 */
export function autoTier(dev) {
  if (!dev.floatTargets) return 'low';
  let t;
  if (!dev.coarse) t = 'high';
  // (the core count isn't a guide: Safari doesn't report the real one)
  else if (dev.memory !== undefined && dev.memory < 4) t = 'low';
  else t = 'medium';
  if (dev.remembered && TIER_ORDER.includes(dev.remembered) && TIER_ORDER.indexOf(dev.remembered) < TIER_ORDER.indexOf(t)) t = dev.remembered;
  return t;
}

// The setting as stored (Auto by default); a stored value that isn't one is Auto.
export const readSetting = (v) => (SETTINGS.includes(v) ? v : 'auto');

// The tier a setting runs at: a manual choice as such (Low without float targets, since
// Medium and High need them), Auto as autoTier picks
export function tierFor(setting, dev) {
  if (setting === 'auto') return autoTier(dev);
  if (setting !== 'low' && !dev.floatTargets) return 'low';
  return setting;
}

// pixels per CSS pixel for a tier, the device's ratio and Auto's scale
export const pixelRatio = (tier, dpr, scale = 1) => Math.max(0.5, Math.min(dpr, TIERS[tier].maxRatio) * scale);

/**
 * Auto's frame governor. Feed it every frame's time (ms, from requestAnimationFrame);
 * it judges the median of each window of frames (so one slow frame, a rebuild, doesn't
 * count) and answers what to do:
 *   null                    nothing
 *   { scale }               draw at this fraction of the tier's resolution
 *   { drop: true }          even the smallest scale is too slow: the next tier down
 * It tries a bigger scale again after a while at full speed, and if that's too slow, it
 * stays below it for a good while (no flicker between two sizes).
 * A step down that doesn't make frames quicker means the frame rate isn't the GPU's doing
 * but a cap (an iPhone in Low Power Mode draws at 30 fps whatever it draws, a 30 Hz
 * screen) or the processor: it puts the resolution back and leaves that rate alone.
 */
export function createGovernor({ min = 0.6, slow = 22, fast = 17.8, window = 40, grace = 1 } = {}) {
  let scale = 1;
  let times = [];
  let calm = 0; // windows in a row at full speed
  let skip = grace; // windows to ignore after a change
  let ceiling = 1; // don't go back above this ...
  let ceilingFor = 0; // ... for this many more windows
  let sinceUp = Infinity; // windows since the last step up
  let lastDown = null; // the last step down, to see if it helped: { from, to (scales), m: median before }
  let cap = 0; // a frame time that smaller pictures don't change (ms), or 0
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const judge = (m) => {
    if (skip > 0) {
      skip--;
      return null;
    }
    if (ceilingFor > 0 && --ceilingFor === 0) ceiling = 1;
    sinceUp++;
    if (m > slow) {
      calm = 0;
      if (cap && m <= cap * 1.15) return null;
      // drawing (to/from)^2 fewer pixels should make a GPU-bound frame about that much
      // quicker: if it got less than 40 % of that, smaller didn't help
      const expected = lastDown ? 1 - (lastDown.to / lastDown.from) ** 2 : 0;
      if (lastDown && m > lastDown.m * (1 - 0.4 * expected)) {
        // a cap, not the GPU: back to where it was, and leave that frame rate alone
        cap = lastDown.m;
        scale = lastDown.from;
        lastDown = null;
        skip = grace;
        return { scale };
      }
      if (sinceUp <= 8) {
        // slow soon after a step up: that size is too much, stay below it for a good while
        ceiling = scale / 1.12;
        ceilingFor = 40;
      }
      sinceUp = Infinity;
      if (scale <= min + 1e-6) {
        lastDown = null;
        return { drop: true };
      }
      const from = scale;
      scale = Math.max(min, scale * 0.85);
      lastDown = { from, to: scale, m };
      skip = grace;
      return { scale };
    }
    lastDown = null;
    if (m < fast && scale < 1) {
      calm++;
      const next = Math.min(1, scale * 1.12, ceiling);
      if (calm >= 4 && next > scale + 1e-6) {
        calm = 0;
        scale = next;
        sinceUp = 0;
        skip = grace;
        return { scale };
      }
    } else calm = 0;
    return null;
  };
  return {
    get scale() {
      return scale;
    },
    // one frame's time in ms; returns what to do (see above)
    frame(ms) {
      // a hidden tab, a debugger pause, a long build: not a measure of the frame rate
      if (!(ms > 0) || ms > 250) {
        times = [];
        return null;
      }
      times.push(ms);
      if (times.length < window) return null;
      const m = median(times);
      times = [];
      return judge(m);
    },
    // a new tier: start again from full scale
    reset() {
      scale = 1;
      times = [];
      calm = 0;
      skip = grace;
      ceiling = 1;
      ceilingFor = 0;
      sinceUp = Infinity;
      lastDown = null;
      cap = 0;
    },
  };
}
