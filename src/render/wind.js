// The wind in the trees: every tree sways a little, more at the top, in gusts that roll
// across the forest the way the wind blows; and a tree the skier brushes past quivers for
// a moment (main.js puts the shakes in, and drops a little snow from its branches). The
// same function moves the trees and their ink outlines, so the two never part.

import * as THREE from 'three';
import { WIND } from './atmosphere.js';

const SHAKES = 4; // trees quivering at once (the oldest gives way)

export const WIND_U = {
  uWindT: { value: 0 }, // seconds
  uWindDir: { value: WIND.clone().normalize() },
  uWindAmt: { value: 0.34 }, // metres at the top of a 10 m tree
  uShake: { value: Array.from({ length: SHAKES }, () => new THREE.Vector4(0, 0, -99, 0)) }, // x, z, start, strength
};

// GLSL: the offset (world metres) for a point of an instance; objPos in the model's own
// space (its foot at 0), m its model matrix
export const swayPars = /* glsl */ `
  uniform float uWindT;
  uniform vec2 uWindDir;
  uniform float uWindAmt;
  uniform vec4 uShake[${SHAKES}];
  vec3 sway(vec3 objPos, mat4 m) {
    vec3 base = m[3].xyz;
    // only up the tree: nothing at the foot, the most at the top
    float k = max(0.0, objPos.y) * length(m[1].xyz) / 10.0;
    k *= k;
    // far off it wouldn't show: skip the work (most of a forest is far off)
    k *= 1.0 - smoothstep(220.0, 320.0, length(base - cameraPosition));
    if (k < 1e-4) return vec3(0.0);
    vec2 across = vec2(-uWindDir.y, uWindDir.x);
    // gusts: bands of stronger wind rolling downwind over the forest
    float gust = 0.5 + 0.5 * sin(dot(base.xz, uWindDir) * 0.03 - uWindT * 1.1) * sin(dot(base.xz, across) * 0.017 + uWindT * 0.37);
    float ph = base.x * 0.31 + base.z * 0.17;
    float osc = sin(uWindT * 1.6 + ph) * 0.6 + sin(uWindT * 2.7 + ph * 1.9) * 0.3;
    vec2 off = uWindDir * uWindAmt * (0.45 + 0.55 * gust) * (0.6 + 0.5 * osc);
    off += across * uWindAmt * 0.25 * sin(uWindT * 2.1 + ph * 1.3) * gust;
    // brushed past: a quick quiver that dies away
    for (int i = 0; i < ${SHAKES}; i++) {
      vec4 s = uShake[i];
      float age = uWindT - s.z;
      if (s.w > 0.0 && age >= 0.0 && age < 2.5) {
        float a = s.w * exp(-age * 2.2) * (1.0 - smoothstep(1.0, 3.5, length(base.xz - s.xy)));
        off += vec2(sin(age * 21.0 + ph), cos(age * 17.0 + ph * 1.7)) * a * 0.5;
      }
    }
    return vec3(off.x, 0.0, off.y) * k;
  }
`;

let next = 0;
// a tree at (x, z) quivers now, strength 0 .. 1
export function shakeAt(x, z, strength) {
  const s = WIND_U.uShake.value[next];
  next = (next + 1) % SHAKES;
  s.set(x, z, WIND_U.uWindT.value, Math.max(0, Math.min(1, strength)));
}

export function tickWind(dt) {
  WIND_U.uWindT.value += dt;
}
