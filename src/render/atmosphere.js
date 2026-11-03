// The weather everything shares: clouds on one layer high above the mountain, drifting on
// the wind. The sky draws them (sky.js), and the snow and the trees take their shadows
// from the same layer, along the sun's direction, so a cloud's shadow on the slope is the
// cloud overhead. The uniforms are single objects shared by every material that uses them:
// moving the wind or changing the cover here changes them all.

import * as THREE from 'three';
import { TOP } from '../core/slopes.js';
import { THEME } from './theme.js';
import { LIGHT } from './light.js';

export const ATMO = {
  uCloudOff: { value: new THREE.Vector2(0, 0) }, // how far the wind has carried the layer (m)
  uCloudCover: { value: 0.36 }, // 0 clear .. 1 overcast
  uCloudAlt: { value: TOP + 1700 }, // the layer's height (m)
  uCloudShade: { value: 0.85 }, // how much a cloud's shadow takes from the sunlight
  uAtmoSun: LIGHT.uSunDir, // the same object: the light moves the sun
};

// wind in m/s across the layer (and the air round the rider: render/windStreaks.js)
export const WIND = new THREE.Vector2(7.5, 3.0);

export function tickAtmosphere(dt) {
  ATMO.uCloudOff.value.addScaledVector(WIND, dt);
}

// the GLSL, for any shader with the ATMO uniforms
export const cloudPars = /* glsl */ `
  uniform vec2 uCloudOff;
  uniform float uCloudCover;
  uniform float uCloudAlt;
  uniform float uCloudShade;
  uniform vec3 uAtmoSun;
  float cHash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // how cloudy the layer is above world xz (0 clear .. 1 thick); octaves: detail
  float cloudAt(vec2 xz, int octaves) {
    // big soft puffs: the first octave carries most of the shape
    vec2 p = (xz + uCloudOff) / 750.0;
    float f = 0.0;
    float a = 0.62;
    float t = 0.0;
    for (int k = 0; k < 4; k++) {
      if (k >= octaves) break;
      f += a * cNoise(p);
      t += a;
      p = p * 2.07 + vec2(13.1, 7.7);
      a *= 0.42;
    }
    f /= t;
    float c = 1.0 - uCloudCover;
    return smoothstep(c - 0.1, c + 0.16, f);
  }
  // under a cloud's shadow at world point w: 0 in the sun .. 1 in the shadow
  float cloudShadow(vec3 w) {
    vec2 xz = w.xz + uAtmoSun.xz / max(uAtmoSun.y, 0.15) * (uCloudAlt - w.y);
    return cloudAt(xz, 3) * uCloudShade;
  }
`;

// the colours the sky and the clouds use (from the theme)
export const SKY = {
  top: new THREE.Color(THEME.sky.top),
  horizon: new THREE.Color(THEME.sky.horizon),
  haze: new THREE.Color(THEME.haze),
  sun: new THREE.Color(THEME.sun.color),
  cloudLit: new THREE.Color(THEME.cloud?.lit || '#fff7ee'),
  cloudShade: new THREE.Color(THEME.cloud?.shade || '#cdc6ee'),
};
