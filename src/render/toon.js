import * as THREE from 'three';
import { LIGHT } from './light.js';
import { WIND_U, swayPars } from './wind.js';

// Shared pieces of the cartoon look: sun shadows sampled inside our own shaders, ink
// outlines drawn as an inverted hull, and a 3-step ramp for three's toon material.

// --- sun shadows in a ShaderMaterial (needs `lights: true` and lightUniforms()) ---

export const lightUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.lights);

export const shadowVertPars = /* glsl */ `
  #include <common>
  #include <shadowmap_pars_vertex>
`;

// call after computing world position `w` (vec4) and world normal `nw` (vec3)
export const shadowVert = /* glsl */ `
  {
    vec4 worldPosition = w;
    vec3 transformedNormal = (viewMatrix * vec4(nw, 0.0)).xyz;
    #include <shadowmap_vertex>
  }
`;

export const shadowFragPars = /* glsl */ `
  #include <common>
  #include <packing>
  #include <shadowmap_pars_fragment>
  // 1 in sunlight, 0 in the shadow of something else
  float sunShadow() {
    float s = 1.0;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow d = directionalLightShadows[ 0 ];
      s = getShadow( directionalShadowMap[ 0 ], d.shadowMapSize, d.shadowIntensity, d.shadowBias, d.shadowRadius, vDirectionalShadowCoord[ 0 ] );
      // the shadow map covers a square of ground round the rider (or the view): fade the
      // shadows out towards its edge rather than have them stop on a line
      vec3 sc = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
      float edge = min(min(sc.x, 1.0 - sc.x), min(sc.y, 1.0 - sc.y));
      s = mix(1.0, s, smoothstep(0.0, 0.07, edge));
    #endif
    return s;
  }
`;

// --- ink outlines: the mesh again, back faces only, pushed out along the normals ---
// Width is in pixels-ish: the push grows with distance so the line stays about as thick.

const outlineVert = (instanced, skinned, sway) => /* glsl */ `
  #include <common>
  ${skinned ? '#include <skinning_pars_vertex>' : ''}
  ${sway ? swayPars : ''}
  uniform float uWidth;
  varying float vDist;
  void main() {
    ${instanced ? 'mat4 m = modelMatrix * instanceMatrix;' : 'mat4 m = modelMatrix;'}
    #include <beginnormal_vertex>
    #include <begin_vertex>
    ${skinned ? '#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <skinning_vertex>' : ''}
    vec4 w = m * vec4(transformed, 1.0);
    ${sway ? 'w.xyz += sway(transformed, m);' : ''}
    vec3 nw = normalize(mat3(m) * objectNormal);
    vec4 mv = viewMatrix * w;
    float d = -mv.z;
    vDist = length(w.xyz - cameraPosition);
    // about uWidth pixels at the reference resolution, never thicker than 0.6 m
    w.xyz += nw * min(0.6, uWidth * d * 0.0012);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const outlineFrag = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFade;
  varying float vDist;
  void main() {
    // lines thin out into the haze, and fade away far off so forests don't turn to ink
    float f = smoothstep(uFogNear, uFogFar, vDist);
    float far = smoothstep(uFade * 0.5, uFade, vDist);
    if (far > 0.99) discard;
    gl_FragColor = vec4(mix(mix(uInk, uFog, f), uFog, far), 1.0);
    #include <colorspace_fragment>
  }
`;

// sway: the instances move in the wind like the trees they outline (wind.js)
export function outlineMaterial({ instanced = false, skinned = false, width = 1.6, fade = 1600, sway = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: outlineVert(instanced, skinned, sway),
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
    uniforms: {
      uWidth: { value: width },
      uInk: LIGHT.uInk,
      uFog: LIGHT.uFog,
      uFogNear: { value: 1400 },
      uFogFar: { value: 4200 },
      uFade: { value: fade },
      ...(sway ? WIND_U : {}),
    },
  });
}

// --- three's MeshToonMaterial with three flat steps ---
let ramp = null;
export function toonRamp() {
  if (ramp) return ramp;
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}
