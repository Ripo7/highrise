// Art direction: cartoon low-poly, low golden sun, three flat colour bands, ink outlines.
// Every colour the renderer uses lives here, sampled from the Blender style test
// (art/style_explore.py, styles "cartoon" and "cartoon_ink").
//
// Each banded colour is [lit, mid, shadow]. Switch theme with ?theme=ink in the URL.

export const THEMES = {
  warm: {
    sky: { top: '#99adf9', horizon: '#ffddb3' },
    haze: '#e9e3f6', // distant snow fades towards this
    sun: { color: '#fff1da' },
    ink: '#4f3b6b',
    snow: ['#fffaf1', '#e6e9ff', '#b5c4fd'],
    rock: ['#cbb5d7', '#b6a2c1', '#8e7e96'],
    needles: ['#50c4ad', '#3fa592', '#2f7a6c'],
    bark: ['#ce9569', '#b9855d', '#906747'],
    strata: ['#edad90', '#fed499', '#da9599', '#fcbf95'],
    jacket: '#ff7a45',
    pants: '#5269c4',
    hat: '#4fd3e0',
    flag: '#ff6464',
  },
  ink: {
    sky: { top: '#fa95aa', horizon: '#ffe2a2' },
    haze: '#f1e0ee',
    sun: { color: '#fff9f1' },
    ink: '#2c2c5e',
    snow: ['#fffaef', '#e1e3fb', '#aab5f6'],
    rock: ['#958bbc', '#857da8', '#676082'],
    needles: ['#597cb8', '#4f6ea5', '#3c5580'],
    bark: ['#597cb8', '#4f6ea5', '#3c5580'],
    strata: ['#867cad', '#fd9ea6', '#867cad', '#ffce95'],
    jacket: '#ffe23d',
    pants: '#3f5c94',
    hat: '#fd8396',
    flag: '#fd8396',
  },
};

function pick() {
  try {
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q && THEMES[q]) return q;
  } catch {
    /* not in a browser (tests) */
  }
  return 'warm';
}

export const THEME_NAME = typeof window === 'undefined' ? 'warm' : pick();
export const THEME = THEMES[THEME_NAME];

// Towards the sun: low (about 21 degrees), ahead of the rider and to the left, so shadows
// stretch back up the slope towards the camera and slopes facing down the run catch the light.
export const SUN_DIR = [-0.62, 0.34, 0.64];

// Lighting cut points on n·l: below CUT_SHADOW is the shadow band, above CUT_LIT the lit band.
// A flat run sits in the mid band, slopes facing down the run light up, faces turned back
// up the hill (a kicker's ramp) drop into shadow, so the colour bands draw the terrain.
export const CUT_SHADOW = 0.16;
export const CUT_LIT = 0.55;
