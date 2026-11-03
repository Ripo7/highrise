// The light presets: golden hour is the theme as it is; morning and overcast shift it

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LIGHTS, lightPreset, mixLight } from '../src/render/light.js';
import { THEMES, SUN_DIR } from '../src/render/theme.js';

const T = THEMES.warm;
const hex = (c) => `#${c.getHexString()}`;
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

test('golden hour is the game\'s look, unchanged', () => {
  const g = lightPreset('golden', T);
  assert.deepEqual(g.snow.map(hex), T.snow);
  assert.deepEqual(g.needles.map(hex), T.needles);
  assert.equal(hex(g.skyTop), T.sky.top);
  assert.equal(hex(g.haze), T.haze);
  assert.ok(g.sunDir.distanceTo(new THREE.Vector3(...SUN_DIR).normalize()) < 1e-9);
  assert.equal(g.shadowAmt, 1);
});

test('every preset is complete, with colours in range and a sun above the horizon', () => {
  for (const name of LIGHTS) {
    const p = lightPreset(name, T);
    assert.equal(p.name, name);
    for (const band of [p.snow, p.needles, p.bark, p.rock]) {
      assert.equal(band.length, 3);
      for (const c of band) for (const v of [c.r, c.g, c.b]) assert.ok(v >= 0 && v <= 1, `${name}: ${v}`);
      assert.ok(lum(band[0]) >= lum(band[1]) - 1e-6 && lum(band[1]) >= lum(band[2]) - 1e-6, `${name}: lit >= mid >= shadow`);
    }
    assert.ok(p.sunDir.y > 0.2 && Math.abs(p.sunDir.length() - 1) < 1e-9, `${name}: the sun is up`);
  }
  // an unknown name: golden hour
  assert.equal(lightPreset('nonsense', T).name, 'golden');
});

test('overcast flattens the light; morning cools the whites', () => {
  const g = lightPreset('golden', T);
  const o = lightPreset('overcast', T);
  const spread = (p) => lum(p.snow[0]) - lum(p.snow[2]);
  assert.ok(spread(o) < spread(g) * 0.7, 'the bands close up');
  assert.ok(o.shadowAmt < 0.5 && o.sunPower === 0 && o.cloudCover > 0.8, 'soft shadows, no sun disc, cloud everywhere');
  const m = lightPreset('morning', T);
  const warmth = (c) => c.r - c.b;
  assert.ok(warmth(m.snow[0]) < warmth(g.snow[0]), 'whiter whites in the morning');
});

test('a crossfade starts on one light and ends on the other', () => {
  const a = lightPreset('golden', T);
  const b = lightPreset('overcast', T);
  const at0 = mixLight(a, b, 0);
  const at1 = mixLight(a, b, 1);
  assert.equal(hex(at0.snow[0]), hex(a.snow[0]));
  assert.equal(hex(at1.snow[0]), hex(b.snow[0]));
  assert.equal(at1.shadowAmt, b.shadowAmt);
  const mid = mixLight(a, b, 0.5);
  assert.ok(mid.shadowAmt > b.shadowAmt && mid.shadowAmt < a.shadowAmt);
  assert.ok(Math.abs(mid.sunDir.length() - 1) < 1e-9, 'the sun stays a direction');
  assert.equal(mid.grade.contrast, (a.grade.contrast + b.grade.contrast) / 2);
});
