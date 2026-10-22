import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { THEME } from './theme.js';
import { toonRamp, outlineMaterial } from './toon.js';

// Run decor from Blender (art/export_decor.py -> public/models/decor.glb): the wooden start
// gate and the inflatable finish arch. No piste markers: it's free mountain, not a marked path.
// Nothing here collides; it's scenery that tells you where the run starts and ends.

const ARCH_SCALE = 1.7;

const partColors = () => ({
  wood: THEME.bark[0],
  banner: THEME.flag,
  stripe: THEME.hat,
  snow: THEME.snow[0],
  ink: THEME.ink,
  cream: '#fff1d6',
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
    this.ink = outlineMaterial({ width: 1.8, fade: 2500 });
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
    this.refresh();
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
    for (const m of [this.ink]) {
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
  }
}
