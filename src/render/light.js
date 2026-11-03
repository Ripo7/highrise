// The light on the mountain: one of three presets, golden hour (the game's look), morning
// and overcast. Every colour the shaders shade with, and the sun's direction, live here
// as uniform objects shared by all the materials, so a preset (or the crossfade between
// two) changes them all at once.
//
// A preset doesn't repaint the art: it takes the theme's colours and shifts them the way
// that light would (morning: cooler, cleaner whites; overcast: flatter bands, greyer,
// softer shadows), so the palette stays the one the art direction picked.

import * as THREE from 'three';
import { THEME, SUN_DIR } from './theme.js';

export const LIGHTS = ['golden', 'morning', 'overcast'];

const c = (h) => new THREE.Color(h);
const v3 = (a) => new THREE.Vector3(...a).normalize();

// the shared uniforms (each one object, used by every material that shades with it)
export const LIGHT = {
  uSunDir: { value: v3(SUN_DIR) },
  uFog: { value: c(THEME.haze) },
  uInk: { value: c(THEME.ink) },
  uSnowLit: { value: c(THEME.snow[0]) },
  uSnowMid: { value: c(THEME.snow[1]) },
  uSnowShadow: { value: c(THEME.snow[2]) },
  uRockLit: { value: c(THEME.rock[0]) },
  uRockMid: { value: c(THEME.rock[1]) },
  uRockShadow: { value: c(THEME.rock[2]) },
  uIceLit: { value: c('#d6ebff') },
  uIceShadow: { value: c('#86a8ea') },
  uStrata0: { value: c(THEME.strata[0]) },
  uStrata1: { value: c(THEME.strata[1]) },
  uStrata2: { value: c(THEME.strata[2]) },
  uStrata3: { value: c(THEME.strata[3]) },
  // trees and rocks: snow, needles, bark, rock (lit, mid, shadow each)
  uLit: { value: [THEME.snow, THEME.needles, THEME.bark, THEME.rock].map((b) => c(b[0])) },
  uMid: { value: [THEME.snow, THEME.needles, THEME.bark, THEME.rock].map((b) => c(b[1])) },
  uShadow: { value: [THEME.snow, THEME.needles, THEME.bark, THEME.rock].map((b) => c(b[2])) },
  uShadowAmt: { value: 1 }, // how much a cast shadow darkens (soft light: less)
  // the snow's own light (terrainMesh.js, tracks.js, spray.js)
  uSunCol: { value: c(THEME.sun.color) },
  uSkyTop: { value: c(THEME.sky.top) }, // what ice mirrors
  uSkyHorizon: { value: c(THEME.sky.horizon) },
  uGlint: { value: 1 }, // glitter in the sun (0: none, overcast)
  uSnowGlow: { value: c('#c2e0ff') }, // the cool glow inside a shadow's edge
  uGlowAmt: { value: 0.5 },
};

// colour shifts, on THREE.Color (linear)
const desat = (col, k) => {
  const l = col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722;
  return col.clone().lerp(new THREE.Color(l, l, l), k);
};
const toward = (col, hex, k) => col.clone().lerp(c(hex), k);

// [lit, mid, shadow] hex -> [lit, mid, shadow] Colors, the way each light shifts them
const SHIFT = {
  golden: (b) => b.map(c),
  // cleaner, cooler whites; shadows a touch bluer
  morning: (b) => {
    const [l, m, s] = b.map(c);
    return [desat(l, 0.45).lerp(c('#f7f9ff'), 0.15), toward(m, '#e3e9ff', 0.12), toward(s, '#a9bdf7', 0.12)];
  },
  // flat light: the bands close up towards the middle one, greyer, a little darker
  overcast: (b) => {
    const [l, m, s] = b.map(c);
    const mid = desat(m, 0.22);
    return [desat(l.clone().lerp(m, 0.62), 0.22), mid, desat(s.clone().lerp(m, 0.42), 0.22)].map((x) => x.multiplyScalar(0.97));
  },
};

/**
 * Everything a preset sets: plain values (Colors, Vector3, numbers), for main.js to apply
 * and to crossfade between.
 */
export function lightPreset(name, theme = THEME) {
  const shift = SHIFT[name] || SHIFT.golden;
  const bands = [theme.snow, theme.needles, theme.bark, theme.rock];
  const shifted = bands.map(shift);
  const one = (hex) => shift([hex, hex, hex])[1];
  const P = {
    golden: {
      sunDir: SUN_DIR,
      sunColor: theme.sun.color,
      sunIntensity: 2.4,
      hemi: 1.4,
      skyTop: theme.sky.top,
      skyHorizon: theme.sky.horizon,
      haze: theme.haze,
      cloudCover: 0.36,
      cloudShade: 0.85,
      cloudLit: theme.cloud?.lit || '#fff7ee',
      cloudDark: theme.cloud?.shade || '#cdc6ee',
      sunPower: 5,
      shadowAmt: 1,
      snow: 1,
      flake: 0.08,
      hazeNear: 1,
      glint: 1,
      glow: '#c2e0ff',
      glowAmt: 0.5,
      grade: { contrast: 0.14, saturation: 1.06, shadows: [-0.012, -0.008, 0.022], highlights: [0.014, 0.006, -0.012] },
    },
    morning: {
      // higher, from the other side: shorter shadows that fall the other way
      sunDir: [0.55, 0.52, 0.62],
      sunColor: '#fffaf0',
      sunIntensity: 2.6,
      hemi: 1.5,
      skyTop: '#82a6f6',
      skyHorizon: '#fff3dc',
      haze: '#e6ebfa',
      cloudCover: 0.26,
      cloudShade: 0.8,
      cloudLit: '#ffffff',
      cloudDark: '#d3d9f2',
      sunPower: 5,
      shadowAmt: 1,
      snow: 0,
      flake: 0.08,
      hazeNear: 1.2,
      glint: 1,
      glow: '#c8e4ff',
      glowAmt: 0.45,
      grade: { contrast: 0.12, saturation: 1.05, shadows: [-0.014, -0.004, 0.026], highlights: [0.004, 0.004, 0.002] },
    },
    overcast: {
      // the sun is somewhere high behind the clouds: soft, faint shadows
      sunDir: [-0.3, 0.78, 0.55],
      sunColor: '#f3f1f8',
      sunIntensity: 1.1,
      hemi: 2.2,
      skyTop: '#a9aec8',
      skyHorizon: '#dcd8e0',
      haze: '#dedbe5',
      cloudCover: 0.9,
      cloudShade: 0,
      cloudLit: '#ebe9f1',
      cloudDark: '#b7b4c7',
      sunPower: 0,
      shadowAmt: 0.3,
      snow: 3,
      flake: 0.14,
      hazeNear: 0.55,
      glint: 0.12,
      glow: '#bcc5e6',
      glowAmt: 0.12,
      grade: { contrast: 0.06, saturation: 0.92, shadows: [-0.006, -0.004, 0.012], highlights: [0, 0, 0] },
    },
  }[name] || null;
  const p = P || lightPreset('golden', theme);
  if (!P) return p;
  return {
    name,
    sunDir: v3(p.sunDir),
    sunColor: c(p.sunColor),
    sunIntensity: p.sunIntensity,
    hemi: p.hemi,
    skyTop: c(p.skyTop),
    skyHorizon: c(p.skyHorizon),
    haze: c(p.haze),
    ink: c(theme.ink),
    snow: shifted[0],
    needles: shifted[1],
    bark: shifted[2],
    rock: shifted[3],
    ice: [one('#d6ebff'), one('#86a8ea')],
    strata: theme.strata.map(one),
    cloudCover: p.cloudCover,
    cloudShade: p.cloudShade,
    cloudLit: c(p.cloudLit),
    cloudDark: c(p.cloudDark),
    sunPower: p.sunPower,
    shadowAmt: p.shadowAmt,
    snow1: p.snow,
    flake: p.flake,
    glint: p.glint,
    glow: c(p.glow),
    glowAmt: p.glowAmt,
    hazeNear: p.hazeNear,
    grade: p.grade,
  };
}

// a crossfade between two presets' values, t 0..1 (same shape as lightPreset's)
export function mixLight(a, b, t) {
  const mix = (x, y) => {
    if (typeof x === 'number') return x * (1 - t) + y * t;
    if (x?.isColor) return x.clone().lerp(y, t);
    if (x?.isVector3) return x.clone().lerp(y, t).normalize();
    if (Array.isArray(x)) return x.map((e, k) => mix(e, y[k]));
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).map((k) => [k, mix(x[k], y[k])]));
    return t < 0.5 ? x : y;
  };
  return mix(a, b);
}

// write a preset's values into the shared uniforms
export function setLightUniforms(p) {
  const U = LIGHT;
  U.uSunDir.value.copy(p.sunDir);
  U.uFog.value.copy(p.haze);
  U.uInk.value.copy(p.ink);
  U.uSnowLit.value.copy(p.snow[0]);
  U.uSnowMid.value.copy(p.snow[1]);
  U.uSnowShadow.value.copy(p.snow[2]);
  U.uRockLit.value.copy(p.rock[0]);
  U.uRockMid.value.copy(p.rock[1]);
  U.uRockShadow.value.copy(p.rock[2]);
  U.uIceLit.value.copy(p.ice[0]);
  U.uIceShadow.value.copy(p.ice[1]);
  for (let k = 0; k < 4; k++) U[`uStrata${k}`].value.copy(p.strata[k]);
  const bands = [p.snow, p.needles, p.bark, p.rock];
  for (let k = 0; k < 4; k++) {
    U.uLit.value[k].copy(bands[k][0]);
    U.uMid.value[k].copy(bands[k][1]);
    U.uShadow.value[k].copy(bands[k][2]);
  }
  U.uShadowAmt.value = p.shadowAmt;
  U.uSunCol.value.copy(p.sunColor);
  U.uSkyTop.value.copy(p.skyTop);
  U.uSkyHorizon.value.copy(p.skyHorizon);
  U.uGlint.value = p.glint;
  U.uSnowGlow.value.copy(p.glow);
  U.uGlowAmt.value = p.glowAmt;
}
