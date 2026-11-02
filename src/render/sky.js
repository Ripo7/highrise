// The sky: a dome around the camera, drawn behind everything. The colours run down the
// screen as they always did (the top colour at the top, the horizon colour from 70 % down:
// the look of the game, whichever way the camera points), and on that, placed in the world:
// the sun, a disc brighter than white (High's bloom gives it a glow) in a warm halo, and
// the cloud layer of atmosphere.js, soft puffs in two tones, rims lit where the sun is behind
// them, fading out towards the horizon (a flat layer seen that low would turn to streaks).

import * as THREE from 'three';
import { ATMO, SKY, cloudPars } from './atmosphere.js';

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vDir = w.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_Position.z = gl_Position.w; // on the far plane, behind everything
  }
`;

const frag = /* glsl */ `
  ${cloudPars}
  uniform vec3 uTopS; // the gradient's colours in sRGB (blended as the CSS one is)
  uniform vec3 uHorizonS;
  uniform float uViewH; // the height of what's drawn into, in pixels
  uniform vec3 uSunCol;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudDark;
  uniform float uSunPower; // how far beyond white the disc goes
  uniform float uClouds; // 0: no clouds drawn (overcast tints instead)
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float el = d.y;
    // the gradient, down the screen
    float y = 1.0 - gl_FragCoord.y / uViewH;
    vec3 g = mix(uTopS, uHorizonS, clamp(y / 0.7, 0.0, 1.0));
    vec3 col = mix(g * 0.0773993808, pow((g + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), g));
    // the sun: halo, then the disc
    float cs = dot(d, normalize(uAtmoSun));
    vec3 halo = uSunCol * (pow(max(cs, 0.0), 12.0) * 0.18 + pow(max(cs, 0.0), 180.0) * 0.45);
    float disc = smoothstep(0.99955, 0.99972, cs);
    // the clouds, where the view meets the layer
    float c = 0.0;
    vec3 cc = uCloudLit;
    if (el > 0.03 && uClouds > 0.5) {
      vec2 xz = cameraPosition.xz + d.xz / el * (uCloudAlt - cameraPosition.y);
      c = cloudAt(xz, 3);
      // the thick middle of a puff is its shaded underside; thin edges stay bright
      float core = cloudAt(xz * 0.985 + 40.0, 2);
      cc = mix(uCloudLit, uCloudDark, smoothstep(0.55, 1.0, core) * 0.7);
      // rims catch the light where the sun is behind them
      cc += uSunCol * pow(max(cs, 0.0), 16.0) * (1.0 - smoothstep(0.2, 0.8, c)) * 0.5;
      // thin out towards the horizon
      c *= smoothstep(0.06, 0.3, el);
    }
    col += halo * (1.0 - c * 0.7);
    col = mix(col, cc, c);
    col += uSunCol * disc * uSunPower * (1.0 - c);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor() {
    this.uniforms = {
      ...ATMO,
      uTopS: { value: SKY.top.clone().convertLinearToSRGB() },
      uHorizonS: { value: SKY.horizon.clone().convertLinearToSRGB() },
      uViewH: { value: 1 },
      uSunCol: { value: SKY.sun.clone() },
      uCloudLit: { value: SKY.cloudLit.clone() },
      uCloudDark: { value: SKY.cloudShade.clone() },
      uSunPower: { value: 5 },
      uClouds: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    // always centred on the camera
    const size = new THREE.Vector2();
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      this.mesh.position.copy(camera.position);
      this.mesh.updateMatrixWorld();
      const rt = renderer.getRenderTarget();
      this.uniforms.uViewH.value = rt ? rt.height : renderer.getDrawingBufferSize(size).y;
    };
  }
}
