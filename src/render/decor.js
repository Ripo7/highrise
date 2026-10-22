import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { difficulty } from '../core/profile.js';
import { THEME } from './theme.js';
import { toonRamp, outlineMaterial } from './toon.js';

// Run decor from Blender (art/export_decor.py -> public/models/decor.glb): the wooden start
// gate, the inflatable finish arch, and piste markers down both sides of the run, their top
// band coloured like the piste there (green / blue / red / black by the local slope).
// Nothing here collides; it's scenery that tells you where the run starts, ends and how steep it is.

const MARKER_STEP = 32; // metres between markers along the run
const LANE = 50; // markers sit just outside the tree-free lane
const ARCH_SCALE = 1.7;
const DIFF_COLORS = { green: '#3fbf6a', blue: '#3d7be0', red: '#e84a3c', black: '#2a2140', up: '#8a6fd8' };

const partColors = () => ({
  wood: THEME.bark[0],
  banner: THEME.flag,
  stripe: THEME.hat,
  snow: THEME.snow[0],
  ink: THEME.ink,
  cream: '#fff1d6',
  pole: '#f4f2fa',
  band: '#ffffff', // tinted per marker
});

function toonize(root, ink) {
  const colors = partColors();
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  for (const o of meshes) {
    o.material = new THREE.MeshToonMaterial({ color: colors[o.material?.name] || '#ffffff', gradientMap: toonRamp() });
    o.castShadow = true;
    if (ink) o.add(new THREE.Mesh(o.geometry, ink));
  }
  return root;
}

export class Decor {
  constructor(hf, props) {
    this.hf = hf;
    this.props = props;
    this.group = new THREE.Group();
    this.gate = new THREE.Group();
    this.arch = new THREE.Group();
    this.group.add(this.gate, this.arch);
    this.markers = null;
    this.ink = outlineMaterial({ width: 1.8, fade: 2500 });
    this.inkMarkers = outlineMaterial({ instanced: true, width: 1.4, fade: 700 });
    this.start = { x: 0, z: 0 };
    new GLTFLoader().load(
      `${import.meta.env.BASE_URL}models/decor.glb`,
      (gltf) => this.use(gltf),
      undefined,
      (err) => console.warn('decor.glb failed to load', err),
    );
  }

  use(gltf) {
    const byName = (n) => gltf.scene.getObjectByName(n);
    const gate = byName('gate');
    const arch = byName('arch');
    const marker = byName('marker');
    if (gate) {
      gate.position.set(0, 0, 0);
      this.gate.add(toonize(gate, outlineMaterial({ width: 1.8, fade: 2500 })));
      this.gateFade = undefined;
      this.setGateFade(1);
    }
    if (arch) {
      arch.position.set(0, 0, 0);
      arch.scale.setScalar(ARCH_SCALE);
      this.arch.add(toonize(arch, this.ink));
    }
    if (marker) this.makeMarkers(marker);
    this.refresh();
  }

  // one instanced mesh per marker part; the band takes a colour per marker
  makeMarkers(marker) {
    const colors = partColors();
    const max = Math.ceil(4200 / MARKER_STEP) * 2 + 4;
    this.markerParts = [];
    const meshes = [];
    marker.traverse((o) => o.isMesh && meshes.push(o));
    for (const o of meshes) {
      const name = o.material?.name;
      const mat = new THREE.MeshToonMaterial({ color: colors[name] || '#ffffff', gradientMap: toonRamp() });
      const im = new THREE.InstancedMesh(o.geometry, mat, max);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      const line = new THREE.InstancedMesh(o.geometry, this.inkMarkers, max);
      line.instanceMatrix = im.instanceMatrix;
      line.count = 0;
      line.frustumCulled = false;
      if (name === 'band') im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      this.group.add(im, line);
      this.markerParts.push({ im, line, band: name === 'band' });
    }
  }

  // fade the gate (and its ink) out, e.g. when the chase cam sits right behind it
  setGateFade(a) {
    if (a === this.gateFade) return;
    this.gateFade = a;
    this.gate.visible = a > 0.02;
    this.gate.traverse((o) => {
      if (!o.isMesh) return;
      // ink lines can't fade (they're opaque), so they drop out as soon as the gate does
      if (o.material.isShaderMaterial) {
        o.visible = a > 0.98;
        return;
      }
      o.material.transparent = a < 0.98;
      o.material.opacity = a;
      o.material.depthWrite = a > 0.98;
    });
  }

  setStart(x, z) {
    this.start = { x, z };
    this.placeGate();
  }

  setFog(near, far) {
    for (const m of [this.ink, this.inkMarkers]) {
      m.uniforms.uFogNear.value = near;
      m.uniforms.uFogFar.value = far;
    }
  }

  placeGate() {
    const { x, z } = this.start;
    this.gate.position.set(x, this.hf.heightAt(x, z) - 0.2, z);
  }

  // sit everything back on the snow (after sculpting or a new run)
  refresh() {
    const hf = this.hf;
    this.placeGate();
    const fz = hf.finishZ;
    this.arch.position.set(0, Math.min(hf.heightAt(-12 * ARCH_SCALE, fz), hf.heightAt(12 * ARCH_SCALE, fz)) - 0.4, fz);
    if (!this.markerParts) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    const cap = this.markerParts[0].im.instanceMatrix.count;
    for (let z = hf.startZ + MARKER_STEP / 2; z < fz - 6 && n < cap - 2; z += MARKER_STEP) {
      // how steep the run is here, measured down the middle over 16 m
      const drop = hf.heightAt(0, z - 8) - hf.heightAt(0, z + 8);
      const deg = (Math.atan2(drop, 16) * 180) / Math.PI;
      c.set(DIFF_COLORS[difficulty(deg)]);
      for (const sx of [-1, 1]) {
        const x = sx * LANE;
        m.makeTranslation(x, hf.heightAt(x, z), z);
        for (const p of this.markerParts) {
          p.im.setMatrixAt(n, m);
          if (p.band) p.im.setColorAt(n, c);
        }
        n++;
      }
    }
    for (const p of this.markerParts) {
      p.im.count = p.line.count = n;
      p.im.instanceMatrix.needsUpdate = true;
      if (p.im.instanceColor) p.im.instanceColor.needsUpdate = true;
    }
  }
}
