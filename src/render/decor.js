import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { THEME } from './theme.js';
import { toonRamp, outlineMaterial } from './toon.js';

// Run decor from Blender (art/export_decor.py -> public/models/decor.glb): the wooden start
// gate wherever the run starts, facing down the fall line, and the inflatable finish arch at
// the bottom. Nothing here collides; it's scenery that tells you where the run starts and
// ends.

const ARCH_SCALE = 1.7;
// the start gate at the size of a real one (about 7.5 m across and 5 m up) next to the skier
const GATE_SCALE = 0.62;

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
    this.gateFade = 1;
    this.start = null; // { x, z, dir }
    this.finish = null;
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
      gate.scale.multiplyScalar(GATE_SCALE);
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
    this.gate.visible = a > 0.02 && !!this.start;
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

  // start: { x, z, dir: [dx, dz] } or null; finish likewise (the arch spans the piste)
  setEnds(start, finish) {
    this.start = start;
    this.finish = finish;
    this.refresh();
  }

  setFog(near, far) {
    for (const m of [this.ink]) {
      m.uniforms.uFogNear.value = near;
      m.uniforms.uFogFar.value = far;
    }
  }

  // sit everything back on the snow (after an edit or a new mountain)
  refresh() {
    const hf = this.hf;
    const s = this.start;
    this.gate.visible = !!s && this.gateFade > 0.02;
    if (s) {
      this.gate.position.set(s.x, hf.heightAt(s.x, s.z) - 0.2, s.z);
      this.gate.rotation.y = Math.atan2(s.dir[0], s.dir[1]);
    }
    const f = this.finish;
    this.arch.visible = !!f;
    if (f) {
      const ax = -f.dir[1] * 12 * ARCH_SCALE;
      const az = f.dir[0] * 12 * ARCH_SCALE;
      this.arch.position.set(f.x, Math.min(hf.heightAt(f.x - ax, f.z - az), hf.heightAt(f.x + ax, f.z + az)) - 0.4, f.z);
      this.arch.rotation.y = Math.atan2(f.dir[0], f.dir[1]);
    }
  }
}
