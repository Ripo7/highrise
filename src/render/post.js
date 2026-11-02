// The post-processing (Medium and High, see quality.js): the scene is drawn into a
// half-float target with its own 4x anti-aliasing, then
//   bloom          a soft glow around what is brighter than white (off for now: nothing is
//                  yet; the sun, sparkles and ice will be)
//   grade          one pass to the screen: linear to sRGB, a gentle contrast curve, a touch
//                  of saturation, cool shadows and warm highlights, a light vignette,
//                  dithering (no banding in the sky)
// Low skips all of it and draws straight to the screen, as the game always did.
//
// The sky is in the scene too (skyTexture), so the grade reaches it; the CSS gradient
// behind the canvas only shows before the first frame.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// The look. Kept small on purpose: the palette is the art direction, this only pulls it
// together (and stays the same on every screen).
export const GRADE = {
  contrast: 0.14, // 0: none, 1: a full smoothstep curve
  saturation: 1.06,
  shadows: [-0.012, -0.008, 0.022], // added where it's dark: towards the cool violet of the ink
  highlights: [0.014, 0.006, -0.012], // added where it's bright: towards the warm sun
  vignette: 0.07, // how much darker the corners get (more muddies the sky)
};
// only what is brighter than white: lit snow is nearly white, and blooming it turns the
// whole slope milky
export const BLOOM = { strength: 0.32, radius: 0.55, threshold: 1.0 };

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: GRADE.contrast },
    uSaturation: { value: GRADE.saturation },
    uShadows: { value: new THREE.Vector3(...GRADE.shadows) },
    uHighlights: { value: new THREE.Vector3(...GRADE.highlights) },
    uVignette: { value: GRADE.vignette },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3 uShadows;
    uniform vec3 uHighlights;
    uniform float uVignette;
    uniform float uAspect;
    varying vec2 vUv;
    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec3 c = toSRGB(clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 1.0));
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c += uShadows * (1.0 - l) * (1.0 - l) + uHighlights * l * l;
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(d) / length(vec2(uAspect, 1.0) * 0.5);
      c *= 1.0 - uVignette * smoothstep(0.55, 1.15, r);
      c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// can this GPU draw into half-float targets (the post-processing needs it)
export function floatTargets(renderer) {
  const ext = renderer.extensions;
  return !!(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
}

// The sky behind everything: the same gradient as the CSS one (top, horizon from 70 % down)
export function skyTexture(top, horizon) {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, top);
  grad.addColorStop(0.7, horizon);
  grad.addColorStop(1, horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function createPost(renderer, scene, camera) {
  let composer = null;
  let bloom = null;
  let grade = null;
  let on = false;
  let withBloom = false;
  const size = new THREE.Vector2();
  const build = () => {
    renderer.getSize(size);
    const ratio = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * ratio), Math.max(1, size.y * ratio), { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(ratio);
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
  };
  const addBloom = () => {
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.insertPass(bloom, 1);
  };
  return {
    get on() {
      return on;
    },
    // tier: { post, bloom } (quality.js)
    set(tier) {
      on = tier.post;
      withBloom = tier.bloom;
      if (on && !composer) build();
      if (on && withBloom && !bloom) addBloom();
      if (bloom) bloom.enabled = withBloom;
      if (on) this.resize();
    },
    // after renderer.setSize / setPixelRatio
    resize() {
      if (!composer) return;
      renderer.getSize(size);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(size.x, size.y);
      grade.uniforms.uAspect.value = size.x / Math.max(1, size.y);
    },
    render() {
      if (on) composer.render();
      else renderer.render(scene, camera);
    },
  };
}
