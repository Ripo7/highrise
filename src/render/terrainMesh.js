import * as THREE from 'three';
import { THEME, SUN_DIR, CUT_SHADOW, CUT_LIT } from './theme.js';
import { lightUniforms, shadowVertPars, shadowVert, shadowFragPars } from './toon.js';

const toHalf = THREE.DataUtils.toHalfFloat;

// Terrain rendered as a diorama slab: the sculptable top surface plus four
// stratified side walls of constant thickness, so the long piste reads as an object
// you own (a tilted slab rather than a 500 m tall block).

export const THICKNESS = 34;

const vert = /* glsl */ `
  ${shadowVertPars}
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec3 nw = normalize(mat3(modelMatrix) * normal);
    vNormal = nw;
    ${shadowVert}
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const sideVert = /* glsl */ `
  attribute float aDepth;
  attribute float aTop;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vTop;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vDepth = aDepth;
    vTop = aTop;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  ${shadowFragPars}
  uniform vec3 uSunDir;
  uniform vec3 uSnowLit;
  uniform vec3 uSnowMid;
  uniform vec3 uSnowShadow;
  uniform vec3 uRockLit;
  uniform vec3 uRockMid;
  uniform vec3 uRockShadow;
  uniform vec3 uInk;
  uniform float uCutShadow;
  uniform float uCutLit;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uBrushPos;
  uniform float uBrushRadius;
  uniform float uBrushOn;
  uniform vec3 uBrushColor;
  uniform vec4 uFin[4]; // finish lines: x, z, direction of travel
  uniform float uFinW[4]; // ... and their width
  uniform float uFinN;
  uniform vec2 uStart;
  uniform float uContours;
  uniform float uRelief;
  uniform sampler2D uLocalMean;
  uniform vec2 uHalf;
  uniform vec2 uLocalSize;
  uniform sampler2D uSurf;
  uniform vec2 uSurfSize;
  uniform sampler2D uNormTex; // the snow's normals (x, z packed in r, g), filtered
  uniform float uNormOn;
  uniform float uCell;
  uniform vec3 uIceLit;
  uniform vec3 uIceShadow;
  // the build grid of hexagons (see core/hex.js), one texel per tile (see writeTiles in
  // main.js): R = the ghost (where the brush or a paste would go: 1) and the tutorial's goal
  // tiles (0.38; 0.88 under the ghost), G = changed, B = selected,
  // A = what changed (1 shape, 2 nature, 3 a feature) + 4 × (the way a jump faces + 1)
  uniform sampler2D uTiles;
  uniform vec4 uTileInfo; // x of the left edge, z of the start line, hexagon radius, rows
  uniform float uTileCols;
  uniform float uTileOn;
  uniform vec3 uGhost; // the selection's colour
  uniform vec3 uGoal; // the tutorial's goal tiles
  uniform float uTime;
  uniform vec3 uCatCol[6]; // tint of changed tiles, by what changed (A channel)

  // Manual bilinear lookup: iPhones can't filter float textures in hardware (they read
  // back as zero with linear filtering), so the texture uses nearest and we blend here.
  float localMeanAt(vec2 uv) {
    vec2 p = uv * uLocalSize - 0.5;
    vec2 f = fract(p);
    vec2 b = (floor(p) + 0.5) / uLocalSize;
    vec2 t = 1.0 / uLocalSize;
    float a = texture2D(uLocalMean, b).r;
    float c = texture2D(uLocalMean, b + vec2(t.x, 0.0)).r;
    float d = texture2D(uLocalMean, b + vec2(0.0, t.y)).r;
    float e = texture2D(uLocalMean, b + t).r;
    return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
  }
  varying vec3 vWorld;
  varying vec3 vNormal;

  // The hexagon under grid point p (metres from the left edge and the top line), radius R:
  // xy = its column and row, z = how far p is inside it from the nearest side (0 on a side)
  vec3 hexTile(vec2 p, float R) {
    float W = 1.7320508 * R;
    vec2 c = p - vec2(0.5 * W, R);
    float q = (0.57735027 * c.x - c.y / 3.0) / R;
    float r = (0.66666667 * c.y) / R;
    float s = -q - r;
    float rq = floor(q + 0.5);
    float rr = floor(r + 0.5);
    float rs = floor(s + 0.5);
    float dq = abs(rq - q);
    float dr = abs(rr - r);
    float ds = abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    float oddRow = mod(rr, 2.0);
    float col = rq + (rr - oddRow) * 0.5;
    vec2 centre = vec2(W * (col + 0.5 + 0.5 * oddRow), R + 1.5 * R * rr);
    vec2 l = p - centre;
    float side = max(abs(l.x), max(abs(0.5 * l.x + 0.8660254 * l.y), abs(0.5 * l.x - 0.8660254 * l.y)));
    return vec3(col, rr, 0.5 * W - side);
  }

  vec2 hexCentre(vec2 cr, float R) {
    float W = 1.7320508 * R;
    return vec2(W * (cr.x + 0.5 + 0.5 * mod(cr.y, 2.0)), R + 1.5 * R * cr.y);
  }

  // the tile across the side of tile hx nearest to grid point p
  vec2 hexNeighbour(vec2 p, vec3 hx, float R) {
    vec2 c = hexCentre(hx.xy, R);
    vec2 l = p - c;
    vec2 n0 = vec2(1.0, 0.0);
    vec2 n1 = vec2(0.5, 0.8660254);
    vec2 n2 = vec2(0.5, -0.8660254);
    float d0 = dot(l, n0);
    float d1 = dot(l, n1);
    float d2 = dot(l, n2);
    vec2 n = n0 * sign(d0);
    float m = abs(d0);
    if (abs(d1) > m) {
      n = n1 * sign(d1);
      m = abs(d1);
    }
    if (abs(d2) > m) n = n2 * sign(d2);
    return hexTile(c + n * 1.7320508 * R, R).xy;
  }

  // diverging ramp for local relief: hollows cool blue, flat pale, crests warm orange
  vec3 reliefRamp(float k) {
    vec3 deep = vec3(0.13, 0.33, 0.66);
    vec3 low = vec3(0.47, 0.70, 0.90);
    vec3 mid = vec3(0.93, 0.94, 0.90);
    vec3 high = vec3(0.98, 0.70, 0.38);
    vec3 peak = vec3(0.80, 0.30, 0.12);
    if (k < 0.0) return k < -0.5 ? mix(low, deep, (-k - 0.5) * 2.0) : mix(mid, low, -k * 2.0);
    return k > 0.5 ? mix(high, peak, (k - 0.5) * 2.0) : mix(mid, high, k * 2.0);
  }

  float hash2(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float aaLine(float v, float spacing, float width) {
    float f = abs(fract(v / spacing - 0.5) - 0.5) * spacing;
    float w = fwidth(v) * width;
    return 1.0 - smoothstep(0.0, w, f);
  }

  void main() {
    // the light's normal comes from a texture of the grid's normals, filtered square by
    // square: the mesh's triangles all split one way, so their own normals would draw every
    // sharp change of light (a terrace's edge, a kicker's lip) as a comb of tiny teeth
    vec3 n = normalize(vNormal);
    if (uNormOn > 0.5) {
      vec4 nt = texture2D(uNormTex, ((vWorld.xz + uHalf) / uCell + 0.5) / uSurfSize);
      vec2 nxz = nt.rg;
      n = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
    }
    float slope = 1.0 - n.y; // 0 flat .. 1 vertical

    // Cartoon light: three flat bands (0 shadow, 1 mid, 2 lit).
    // The broad band comes from the slope smoothed over ~40 m, so it only changes where the
    // run really gets steeper or flatter; small natural bumps can't flip it into blotches.
    // Features that stand out from that (a kicker, a berm, a roller) then step one band up
    // on their sunny side and one down on the other.
    vec3 L = normalize(uSunDir);
    vec2 uvc = clamp((vWorld.xz + uHalf) / (2.0 * uHalf), 0.0, 1.0);
    // differences a texel and a half apart: the bilinear samples then give a slope that
    // changes smoothly from texel to texel (closer, it would jump at each texel's edge and
    // the broad band would show the texture's squares as blocks of light)
    vec2 du = vec2(1.5 / uLocalSize.x, 0.0);
    vec2 dv = vec2(0.0, 1.5 / uLocalSize.y);
    float gx = (localMeanAt(uvc + du) - localMeanAt(uvc - du)) / (2.0 * du.x * 2.0 * uHalf.x);
    float gz = (localMeanAt(uvc + dv) - localMeanAt(uvc - dv)) / (2.0 * dv.y * 2.0 * uHalf.y);
    vec3 ns = normalize(vec3(-gx, 1.0, -gz));
    float ndlS = dot(ns, L);
    float ndl = dot(n, L);
    // the bands' edges: crisp, but a little soft, so where the slope bends hard they read as
    // a curve and never as the mesh's triangles
    float aaS = fwidth(ndlS) + 0.006;
    float aa = fwidth(ndl) + 0.012;
    float level = smoothstep(uCutShadow - aaS, uCutShadow + aaS, ndlS) + smoothstep(uCutLit - aaS, uCutLit + aaS, ndlS);
    float rel = ndl - ndlS;
    level += smoothstep(0.17 - aa, 0.17 + aa, rel) - smoothstep(0.17 - aa, 0.17 + aa, -rel);
    // faces turned right away from the sun are always in shadow
    level = min(level, 2.0 * smoothstep(0.02 - aa, 0.02 + aa, ndl));
    // shadows cast by trees, the rider and the terrain drop into the shadow band
    level = clamp(level, 0.0, 2.0) * smoothstep(0.35, 0.65, sunShadow());
    vec3 snow = level < 1.0 ? mix(uSnowShadow, uSnowMid, level) : mix(uSnowMid, uSnowLit, level - 1.0);
    vec3 rock = level < 1.0 ? mix(uRockShadow, uRockMid, level) : mix(uRockMid, uRockLit, level - 1.0);
    // what the snow is like: groomed piste, untouched powder, ice, or bare rock
    vec2 suv = ((vWorld.xz + uHalf) / uCell + 0.5) / uSurfSize;
    vec4 sf = texture2D(uSurf, suv);
    float groomed = sf.r;
    float ice = sf.g;
    // rock: cliffs and rock bands (where the snow can't hold: their flat tops stay white),
    // and any face steeper than about 71 degrees; a clean cut with a thin ink line
    float aas = fwidth(slope) + 0.002;
    float rockAmt = max(smoothstep(0.68 - aas, 0.68 + aas, slope), smoothstep(0.45, 0.6, sf.b * smoothstep(0.05, 0.16, slope)));
    float powder = sf.a;
    float camDist = length(cameraPosition - vWorld);
    if (uRelief < 0.5) {
      // fresh powder: soft pillows, their hollows a little cool and shaded, their tops
      // bright, so untracked snow reads apart from packed snow even in full sun
      float pil = vnoise(vWorld.xz * 0.28) * 0.65 + vnoise(vWorld.xz * 0.9 + 7.0) * 0.35;
      vec3 fluff = mix(snow, mix(uSnowMid, uSnowShadow, 0.25), smoothstep(0.55, 0.15, pil) * 0.55);
      fluff = mix(fluff, vec3(1.0), smoothstep(0.6, 0.9, pil) * 0.6);
      snow = mix(snow, fluff, powder);
      // groomer passes: wide bands across the piste, a hair lighter and darker
      float band = step(0.5, fract((vWorld.x + 0.8 * sin(vWorld.z * 0.013)) / 4.4));
      snow *= 1.0 + groomed * (band - 0.5) * 0.026 * (1.0 - smoothstep(250.0, 700.0, camDist));
      // corduroy: fine ridges along the run, only close up
      float cw = fwidth(vWorld.x) * 3.3;
      float cord = (0.5 + 0.5 * sin(vWorld.x * 20.94)) * (1.0 - smoothstep(0.25, 0.6, cw));
      snow *= 1.0 - groomed * cord * 0.06;
      // ice: pale blue, streaked, with a sharp glint of sun
      vec3 iceCol = level < 1.0 ? mix(uIceShadow, mix(uIceShadow, uIceLit, 0.5), level) : mix(mix(uIceShadow, uIceLit, 0.5), uIceLit, level - 1.0);
      // scraped streaks down the fall line, and a polished sheen of sky at grazing angles
      float streak = vnoise(vec2(vWorld.x * 0.45, vWorld.z * 0.08)) * 0.7 + vnoise(vec2(vWorld.x * 1.7, vWorld.z * 0.3)) * 0.3;
      iceCol *= 0.9 + 0.16 * streak;
      vec3 vd = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(0.0, dot(n, vd)), 3.0);
      iceCol = mix(iceCol, vec3(0.62, 0.72, 0.96), fres * 0.35);
      float glint = pow(max(0.0, dot(reflect(-L, n), vd)), 60.0) * smoothstep(0.35, 0.65, sunShadow());
      snow = mix(snow, iceCol + glint * 0.6, smoothstep(0.05, 0.6, ice));
    }
    // rock faces: layered strata, a little broken up, darker in the cracks
    float strata = vWorld.y / 2.4 + 0.6 * vnoise(vWorld.xz * 0.12) + 0.25 * vnoise(vWorld.xz * 0.5);
    float sb = fract(strata);
    float sw = fwidth(strata) + 0.02;
    rock *= mix(0.86, 1.0, smoothstep(0.45 - sw, 0.45 + sw, sb));
    rock = mix(rock, uInk, (1.0 - smoothstep(0.0, sw * 1.5, min(sb, 1.0 - sb))) * 0.35 * (1.0 - smoothstep(60.0, 220.0, camDist)));
    vec3 col = mix(snow, rock, rockAmt);
    col = mix(col, uInk, (1.0 - smoothstep(0.0, aas * 1.6, abs(slope - 0.68))) * 0.55);
    float rb = sf.b * smoothstep(0.05, 0.16, slope);
    float rbw = fwidth(rb) * 1.4 + 0.002;
    col = mix(col, uInk, (1.0 - smoothstep(0.0, rbw, abs(rb - 0.52))) * 0.45 * (1.0 - uRelief));
    // the edge of the piste, where the groomer stopped
    float ge = fwidth(groomed) * 1.5 + 0.002;
    col = mix(col, uSnowShadow, (1.0 - smoothstep(0.0, ge, abs(groomed - 0.5))) * 0.35 * (1.0 - uRelief));

    // ink along crests and lips seen edge-on: where the surface turns away from the camera
    // fast (a kicker lip, the top of a roller), not on broad slopes merely seen at an angle
    vec3 vdir = normalize(cameraPosition - vWorld);
    float nv = dot(n, vdir);
    float dnv = fwidth(nv);
    float crest = (1.0 - smoothstep(dnv * 1.2, dnv * 2.6, nv)) * smoothstep(0.01, 0.03, dnv);
    col = mix(col, uInk, crest * 0.85 * (1.0 - uRelief));

    if (uRelief > 0.5) {
      // Relief view: colour by height above/below the surrounding terrain (a ~50 m blur),
      // shade from two low suns so every bump casts a readable shadow
      vec2 uv = clamp((vWorld.xz + uHalf) / (2.0 * uHalf), 0.0, 1.0);
      float local = vWorld.y - localMeanAt(uv);
      float k = clamp(local / 8.0, -1.0, 1.0);
      k = sign(k) * pow(abs(k), 0.7);
      vec3 tint = reliefRamp(k);
      vec3 l1 = normalize(vec3(-0.75, 0.42, -0.5));
      vec3 l2 = normalize(vec3(0.6, 0.5, -0.62));
      float shade = 0.5 * clamp(dot(n, l1), 0.0, 1.0) + 0.35 * clamp(dot(n, l2), 0.0, 1.0) + 0.32;
      // steepness darkens, so cliffs and kicker lips pop
      shade *= 1.0 - 0.45 * smoothstep(0.08, 0.55, slope);
      col = tint * shade * 1.15;
      float fwr = fwidth(vWorld.y);
      float r1 = aaLine(vWorld.y, 2.0, 1.0) * (1.0 - smoothstep(0.5, 1.2, fwr));
      float r2 = aaLine(vWorld.y, 10.0, 1.4) * (1.0 - smoothstep(2.5, 6.0, fwr));
      col *= 1.0 - 0.18 * r1 - 0.38 * r2;
    }

    // topographic contours: fine every 5 m, bold every 25 m; fine lines fade out
    // when zoomed far back so the long piste doesn't turn grey
    float fw = fwidth(vWorld.y);
    float c1 = aaLine(vWorld.y, 5.0, 1.0) * (1.0 - smoothstep(0.6, 1.6, fw));
    float c2 = aaLine(vWorld.y, 25.0, 1.6) * (1.0 - smoothstep(4.0, 9.0, fw));
    float cw = uContours * (1.0 - uRelief);
    col = mix(col, uInk, c1 * 0.12 * cw);
    col = mix(col, uInk, c2 * 0.24 * cw);

    // finish lines: a chequered band across the end of each piste
    for (int f = 0; f < 4; f++) {
      if (float(f) >= uFinN) break;
      vec2 rel = vWorld.xz - uFin[f].xy;
      vec2 dir = uFin[f].zw;
      float along = dot(rel, dir);
      float across = dot(rel, vec2(-dir.y, dir.x));
      float band = (1.0 - smoothstep(1.2, 1.6, abs(along))) * (1.0 - smoothstep(uFinW[f] * 0.5 - 0.4, uFinW[f] * 0.5, abs(across)));
      float chk = mod(floor(across / 1.6) + floor((along + 1.6) / 1.6), 2.0);
      col = mix(col, mix(vec3(0.98, 0.97, 0.95), vec3(0.17, 0.16, 0.25), chk), band * 0.92);
    }

    // start marker ring
    float sd = length(vWorld.xz - uStart);
    col = mix(col, vec3(0.16, 0.42, 0.85), (1.0 - smoothstep(0.25, 0.6, abs(sd - 4.0))) * 0.9);

    // brush cursor: soft fill + crisp ring
    if (uBrushOn > 0.5) {
      float d = length(vWorld.xz - uBrushPos.xz);
      float r = uBrushRadius;
      float ring = 1.0 - smoothstep(0.0, fwidth(d) * 1.5 + 0.12, abs(d - r));
      float inner = 1.0 - smoothstep(0.0, r, d);
      col = mix(col, uBrushColor, inner * inner * 0.18);
      col = mix(col, uBrushColor, ring * 0.9);
      float dot0 = 1.0 - smoothstep(0.25, 0.45, d);
      col = mix(col, uBrushColor, dot0);
    }

    float dist = length(cameraPosition - vWorld);

    // building: the grid on the snow, the ghost of the piece under the finger
    if (uTileOn > 0.5) {
      vec3 hx = hexTile(vec2(vWorld.x - uTileInfo.x, vWorld.z - uTileInfo.y), uTileInfo.z);
      // the side distance in pixels: thin even lines at any distance, fading out where the
      // tiles get too small on screen to read (derivatives before any branch)
      float fw = max(fwidth(vWorld.x), fwidth(vWorld.z));
      float px = hx.z / max(fwidth(hx.z), 1e-4);
      if (hx.x >= 0.0 && hx.y >= 0.0 && hx.x < uTileCols && hx.y < uTileInfo.w) {
        vec4 tv = texture2D(uTiles, (hx.xy + 0.5) / vec2(uTileCols, uTileInfo.w));
        float line = 1.0 - smoothstep(0.5, 1.5, px);
        float gridFade = (1.0 - smoothstep(260.0, 620.0, dist)) * (1.0 - smoothstep(0.25, 0.6, fw / (1.7320508 * uTileInfo.z)));
        col = mix(col, uInk, line * 0.22 * gridFade);
        // close to this tile's own sides, for outlines
        float edge = 1.0 - smoothstep(1.5, 3.5, px);
        vec2 gp = vec2(vWorld.x - uTileInfo.x, vWorld.z - uTileInfo.y);
        // changed tiles: tinted by what changed, so you can see what is where
        int a = int(tv.a * 255.0 + 0.5);
        int cat = a - (a / 4) * 4;
        int turn = a / 4;
        vec3 cc = cat == 1 ? uCatCol[1] : cat == 2 ? uCatCol[2] : uCatCol[3];
        col = mix(col, cc, tv.g * (0.16 + 0.24 * edge) * gridFade);
        // a jump or a drop: a chevron the way it faces
        if (turn > 0 && tv.g > 0.5) {
          float ang = float(turn - 1) * 0.1308997;
          vec2 dv = vec2(sin(ang), cos(ang));
          vec2 l = gp - hexCentre(hx.xy, uTileInfo.z);
          float along = dot(l, dv);
          float across = dot(l, vec2(dv.y, -dv.x));
          float chev = abs(along - (2.0 - 0.85 * abs(across)));
          float cw = max(fwidth(along), 1e-3);
          float mark = (1.0 - smoothstep(0.32, 0.32 + 1.5 * cw, chev)) * (1.0 - smoothstep(2.8, 3.1, abs(across)));
          col = mix(col, uInk, mark * 0.75 * gridFade);
        }
        // the selection: filled, with an outline round its edge only
        if (tv.b > 0.5) {
          col = mix(col, uGhost, 0.3);
          vec2 nb = hexNeighbour(gp, hx, uTileInfo.z);
          bool nbIn = nb.x >= 0.0 && nb.y >= 0.0 && nb.x < uTileCols && nb.y < uTileInfo.w;
          float nbSel = nbIn ? texture2D(uTiles, (nb + 0.5) / vec2(uTileCols, uTileInfo.w)).b : 0.0;
          col = mix(col, uGhost * 0.82, edge * (nbSel > 0.5 ? 0.0 : 0.95));
        }
        // the tutorial's goal: a tint and a marching dashed outline round the group
        bool goal = (tv.r > 0.2 && tv.r < 0.5) || (tv.r > 0.8 && tv.r < 0.95);
        if (goal) {
          vec2 nb = hexNeighbour(gp, hx, uTileInfo.z);
          bool nbIn = nb.x >= 0.0 && nb.y >= 0.0 && nb.x < uTileCols && nb.y < uTileInfo.w;
          float nr = nbIn ? texture2D(uTiles, (nb + 0.5) / vec2(uTileCols, uTileInfo.w)).r : 0.0;
          bool nbGoal = (nr > 0.2 && nr < 0.5) || (nr > 0.8 && nr < 0.95);
          vec2 l = gp - hexCentre(hx.xy, uTileInfo.z);
          float dash = fract(atan(l.y, l.x) * 2.8647890 - uTime * 0.8); // 18 dashes a tile
          float on = smoothstep(0.2, 0.3, dash) * (1.0 - smoothstep(0.7, 0.8, dash));
          col = mix(col, uGoal, 0.14 + 0.06 * sin(uTime * 3.0));
          col = mix(col, uGoal, edge * (nbGoal ? 0.0 : 0.95) * (0.35 + 0.65 * on));
        }
        // the ghost: where the brush (or a paste) would go
        if (tv.r > 0.5) col = mix(col, uGhost, 0.12 + 0.55 * edge);
      }
    }

    // close-up snow texture: soft grain, wind ripples and sparkles; it's what makes
    // speed readable when the camera skims the surface
    float near = (1.0 - smoothstep(25.0, 140.0, dist)) * (1.0 - uRelief);
    if (near > 0.0) {
      // fine grain fades out before it gets small enough on screen to shimmer
      float fine = 1.0 - smoothstep(0.15, 0.5, length(fwidth(vWorld.xz * 5.3)));
      float grain = vnoise(vWorld.xz * 1.7) * 0.6 + (vnoise(vWorld.xz * 5.3) - 0.5) * 0.4 * fine + 0.2;
      float ripple = vnoise(vec2(vWorld.x * 0.35 + vWorld.z * 0.12, vWorld.z * 2.2));
      col *= 1.0 + near * ((grain - 0.5) * 0.05 + (ripple - 0.5) * 0.04);
      // tiny sparkles, only right by the camera (larger ones read as road markings)
      vec2 sc = vWorld.xz * 18.0;
      float spark = step(0.992, hash2(floor(sc))) * (1.0 - smoothstep(0.15, 0.45, length(fract(sc) - 0.5)));
      col += spark * max(0.0, ndl) * 0.3 * (1.0 - smoothstep(6.0, 30.0, dist));
    }

    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const sideFrag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uSnowLit;
  uniform vec3 uSnowMid;
  uniform vec3 uInk;
  uniform vec3 uStrata0;
  uniform vec3 uStrata1;
  uniform vec3 uStrata2;
  uniform vec3 uStrata3;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vTop;
  void main() {
    vec3 n = normalize(vNormal);
    float s = vWorld.x + vWorld.z;          // distance along the wall
    float below = vTop - vWorld.y;          // metres under the top edge
    // rock layers, gently tilted
    float b = fract((vWorld.y + 0.06 * s) / 22.0);
    vec3 col = b < 0.38 ? uStrata0 : b < 0.55 ? uStrata1 : b < 0.8 ? uStrata2 : uStrata3;
    // snow hanging over the rim like icing, with a drippy edge
    float drip = 2.4 + 0.9 * sin(s * 0.21) + 4.0 * pow(max(0.0, sin(s * 0.73 + 1.0)), 6.0);
    float ab = fwidth(below) + 0.01;
    float icing = 1.0 - smoothstep(drip - ab, drip + ab, below);
    float lit = step(0.15, dot(n, normalize(uSunDir)));
    col = mix(col, mix(uSnowMid, uSnowLit, lit), icing);
    // faces turned from the sun drop into a cool shadow band
    col *= mix(vec3(0.7, 0.68, 0.86), vec3(1.0), lit);
    // ink: under the icing and along the rim
    float line = 1.0 - smoothstep(ab * 1.0, ab * 2.2, abs(below - drip));
    line = max(line, 1.0 - smoothstep(ab * 1.5, ab * 3.0, below));
    col = mix(col, uInk, line);
    float dist = length(cameraPosition - vWorld);
    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class TerrainMesh {
  constructor(hf, { start, surface = null }) {
    this.hf = hf;
    this.surface = surface;
    const { nx, nz } = hf;
    this.group = new THREE.Group();

    // --- top surface ---
    const count = nx * nz;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const [x, z] = hf.toWorld(i, j);
        positions[k * 3] = x;
        positions[k * 3 + 2] = z;
      }
    }
    const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index[p++] = a;
        index[p++] = c;
        index[p++] = b;
        index[p++] = b;
        index[p++] = c;
        index[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const bound = new THREE.Sphere(new THREE.Vector3(0, 200, 0), Math.hypot(hf.halfX, hf.halfZ, 400));
    geo.boundingSphere = bound;
    this.geo = geo;

    const sunDir = new THREE.Vector3(...SUN_DIR).normalize();
    const T = THEME;
    const c = (hex) => new THREE.Color(hex);
    this.uniforms = {
      uSunDir: { value: sunDir },
      uSnowLit: { value: c(T.snow[0]) },
      uSnowMid: { value: c(T.snow[1]) },
      uSnowShadow: { value: c(T.snow[2]) },
      uRockLit: { value: c(T.rock[0]) },
      uRockMid: { value: c(T.rock[1]) },
      uRockShadow: { value: c(T.rock[2]) },
      uInk: { value: c(T.ink) },
      uCutShadow: { value: CUT_SHADOW },
      uCutLit: { value: CUT_LIT },
      uStrata0: { value: c(T.strata[0]) },
      uStrata1: { value: c(T.strata[1]) },
      uStrata2: { value: c(T.strata[2]) },
      uStrata3: { value: c(T.strata[3]) },
      uFog: { value: c(T.haze) },
      // fog scales with the run so long runs fade into the distance, not into a wall
      uFogNear: { value: Math.max(1400, hf.sizeZ * 1.2) },
      uFogFar: { value: Math.max(4200, hf.sizeZ * 3.5) },
      uBrushPos: { value: new THREE.Vector3() },
      uBrushRadius: { value: 12 },
      uBrushOn: { value: 0 },
      uBrushColor: { value: new THREE.Color('#ff5a1f') },
      uFin: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 1)) },
      uFinW: { value: [0, 0, 0, 0] },
      uFinN: { value: 0 },
      uStart: { value: new THREE.Vector2(start.x, start.z) },
      uContours: { value: 1 },
      uRelief: { value: 0 },
      uLocalMean: { value: null },
      uHalf: { value: new THREE.Vector2(hf.halfX, hf.halfZ) },
      uLocalSize: { value: new THREE.Vector2(1, 1) },
      uSurf: { value: null },
      uNormTex: { value: null },
      uNormOn: { value: 1 },
      uSurfSize: { value: new THREE.Vector2(hf.nx, hf.nz) },
      uCell: { value: hf.cell },
      uIceLit: { value: c('#d6ebff') },
      uIceShadow: { value: c('#86a8ea') },
      uTiles: { value: null },
      uTileInfo: { value: new THREE.Vector4(-240, hf.startZ, 6, 1) },
      uTileCols: { value: 1 },
      uTileOn: { value: 0 },
      uGhost: { value: c('#ffb020') },
      uGoal: { value: c('#e0338f') },
      uTime: { value: 0 },
      uCatCol: { value: ['#4f7be8', '#ff7a45', '#2f9e86', '#8a6fd8', '#b9855d', '#8a7aa3'].map(c) },
    };
    this.setTileGrid(1, 1, -240, 10);
    // the surface map (groomed in red, ice in green, rock in blue) as a texture
    const n = hf.nx * hf.nz;
    this.surfData = new Uint8Array(n * 4);
    this.surfTex = new THREE.DataTexture(this.surfData, hf.nx, hf.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.surfTex.magFilter = THREE.LinearFilter;
    this.surfTex.minFilter = THREE.LinearFilter;
    this.surfTex.generateMipmaps = false;
    this.uniforms.uSurf.value = this.surfTex;
    this.refreshSurface();
    // the normals as a filterable texture: x and z as half floats (8 bits would band the
    // light into fine stripes where it changes slowly)
    this.normData = new Uint16Array(n * 2);
    this.normTex = new THREE.DataTexture(this.normData, hf.nx, hf.nz, THREE.RGFormat, THREE.HalfFloatType);
    this.normTex.magFilter = THREE.LinearFilter;
    this.normTex.minFilter = THREE.LinearFilter;
    this.normTex.generateMipmaps = false;
    this.uniforms.uNormTex.value = this.normTex;
    // blurred copy of the terrain at 1/6 resolution: the "surroundings" the relief view
    // compares each point against
    this.ds = 6;
    this.lx = Math.ceil(hf.nx / this.ds);
    this.lz = Math.ceil(hf.nz / this.ds);
    this.low = new Float32Array(this.lx * this.lz);
    this.lowTmp = new Float32Array(this.lx * this.lz);
    this.localMean = new Float32Array(this.lx * this.lz);
    this.localTex = new THREE.DataTexture(this.localMean, this.lx, this.lz, THREE.RedFormat, THREE.FloatType);
    this.localTex.magFilter = THREE.NearestFilter;
    this.localTex.minFilter = THREE.NearestFilter;
    this.localTex.generateMipmaps = false;
    this.uniforms.uLocalSize.value.set(this.lx, this.lz);
    this.uniforms.uLocalMean.value = this.localTex;
    this.localDirty = true;
    Object.assign(this.uniforms, lightUniforms());
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      lights: true,
    });
    this.top = new THREE.Mesh(geo, this.material);
    this.top.receiveShadow = true;
    this.group.add(this.top);

    // --- side walls (4 strips: top edge vertex + base vertex) ---
    this.sides = [];
    const sideMat = new THREE.ShaderMaterial({
      vertexShader: sideVert,
      fragmentShader: sideFrag,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    });
    // 0: top end (z=-half), 1: bottom end (z=+half), 2: left edge, 3: right edge
    this.sideDefs = [
      { n: nx, cell: (t) => [t, 0], dir: [0, 0, -1] },
      { n: nx, cell: (t) => [t, nz - 1], dir: [0, 0, 1] },
      { n: nz, cell: (t) => [0, t], dir: [-1, 0, 0] },
      { n: nz, cell: (t) => [nx - 1, t], dir: [1, 0, 0] },
    ];
    for (const def of this.sideDefs) {
      const len = def.n;
      const pos = new Float32Array(len * 2 * 3);
      const nor = new Float32Array(len * 2 * 3);
      const depth = new Float32Array(len * 2);
      for (let t = 0; t < len; t++) depth[t * 2 + 1] = 1;
      const top = new Float32Array(len * 2);
      const idx = [];
      for (let i = 0; i < len - 1; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        idx.push(a, b, c, c, b, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
      g.setAttribute('aTop', new THREE.BufferAttribute(top, 1).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(idx);
      g.boundingSphere = bound;
      const m = new THREE.Mesh(g, sideMat);
      this.sides.push(m);
      this.group.add(m);
    }

    this.updateAll();
    this.refreshLocalMean();
  }

  // the build grid's texture: one texel per tile (see the shader)
  setTileGrid(cols, rows, x0, tile) {
    if (this.tileTex && this.tileCols === cols && this.tileRows === rows) return;
    this.tileTex?.dispose();
    this.tileCols = cols;
    this.tileRows = rows;
    this.tileData = new Uint8Array(cols * rows * 4);
    this.tileTex = new THREE.DataTexture(this.tileData, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tileTex.magFilter = THREE.NearestFilter;
    this.tileTex.minFilter = THREE.NearestFilter;
    this.tileTex.generateMipmaps = false;
    this.tileTex.needsUpdate = true;
    this.uniforms.uTiles.value = this.tileTex;
    this.uniforms.uTileCols.value = cols;
    this.uniforms.uTileInfo.value.set(x0, this.hf.startZ, tile, rows);
  }

  updateTiles() {
    this.tileTex.needsUpdate = true;
  }

  // copy the surface map into the texture (after a run is built)
  refreshSurface() {
    const sf = this.surface;
    const d = this.surfData;
    if (sf && sf.g.length * 4 === d.length) {
      for (let i = 0, n = sf.g.length; i < n; i++) {
        d[i * 4] = sf.g[i];
        d[i * 4 + 1] = sf.ice[i];
        d[i * 4 + 2] = sf.rock ? sf.rock[i] : 0;
        d[i * 4 + 3] = sf.pow ? sf.pow[i] : 0;
      }
    } else {
      for (let i = 0; i < d.length; i += 4) d[i] = 255; // no map: groomed everywhere
    }
    this.surfTex.needsUpdate = true;
  }

  setRelief(on) {
    this.uniforms.uRelief.value = on ? 1 : 0;
  }

  // Recompute the blurred surroundings (cheap: ~7k cells), at most once per frame
  refreshLocalMean() {
    if (!this.localDirty) return;
    const now = performance.now();
    if (this.lastLocal && now - this.lastLocal < 120) return;
    this.lastLocal = now;
    this.localDirty = false;
    const { hf, ds, lx, lz, low, lowTmp, localMean } = this;
    for (let j = 0; j < lz; j++) {
      for (let i = 0; i < lx; i++) low[j * lx + i] = hf.heightAtCell(i * ds + ds / 2, j * ds + ds / 2);
    }
    // separable box blur, radius ~4 cells (~36 m) x2 passes ≈ gaussian
    const R = 4;
    const pass = (src, dst, alongX) => {
      for (let j = 0; j < lz; j++) {
        for (let i = 0; i < lx; i++) {
          let sum = 0;
          let n = 0;
          for (let d = -R; d <= R; d++) {
            const ii = alongX ? i + d : i;
            const jj = alongX ? j : j + d;
            if (ii < 0 || jj < 0 || ii >= lx || jj >= lz) continue;
            sum += src[jj * lx + ii];
            n++;
          }
          dst[j * lx + i] = sum / n;
        }
      }
    };
    pass(low, lowTmp, true);
    pass(lowTmp, localMean, false);
    pass(localMean, lowTmp, true);
    pass(lowTmp, localMean, false);
    this.localTex.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.material.dispose();
    this.sides[0]?.material.dispose();
    this.localTex.dispose();
    this.surfTex.dispose();
    this.normTex?.dispose();
    this.tileTex?.dispose();
  }

  setStart(x, z) {
    this.uniforms.uStart.value.set(x, z);
  }

  // finish lines: [{ x, z, dir: [dx, dz], w }] (up to four are drawn)
  setFinishes(list) {
    const u = this.uniforms;
    const n = Math.min(4, list.length);
    for (let i = 0; i < n; i++) {
      u.uFin.value[i].set(list[i].x, list[i].z, list[i].dir[0], list[i].dir[1]);
      u.uFinW.value[i] = list[i].w;
    }
    u.uFinN.value = n;
  }

  setBrush(on, x = 0, y = 0, z = 0, radius = 10) {
    this.uniforms.uBrushOn.value = on ? 1 : 0;
    if (on) {
      this.uniforms.uBrushPos.value.set(x, y, z);
      this.uniforms.uBrushRadius.value = radius;
    }
  }

  updateAll() {
    this.update({ i0: 0, i1: this.hf.nx - 1, j0: 0, j1: this.hf.nz - 1 });
  }

  // Refresh heights + normals inside a dirty grid rectangle
  update(rect) {
    const { hf } = this;
    const res = hf.nx;
    const pos = this.geo.attributes.position.array;
    const nor = this.geo.attributes.normal.array;
    const nd = this.normData;
    const i0 = Math.max(0, rect.i0 - 1);
    const i1 = Math.min(hf.nx - 1, rect.i1 + 1);
    const j0 = Math.max(0, rect.j0 - 1);
    const j1 = Math.min(hf.nz - 1, rect.j1 + 1);
    const c2 = 2 * hf.cell;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * res + i;
        pos[k * 3 + 1] = hf.h[k];
        // Sobel gradient: the neighbours either side count too, so the light changes along
        // smooth curves across the triangles (a plain central difference lets the toon bands
        // follow the mesh in stair steps where the slope bends sharply)
        const a = (di, dj) => hf.heightAtCell(i + di, j + dj);
        const dx = (a(1, -1) - a(-1, -1) + 2 * (a(1, 0) - a(-1, 0)) + a(1, 1) - a(-1, 1)) / (4 * c2);
        const dz = (a(-1, 1) - a(-1, -1) + 2 * (a(0, 1) - a(0, -1)) + a(1, 1) - a(1, -1)) / (4 * c2);
        const len = Math.hypot(dx, 1, dz);
        nor[k * 3] = -dx / len;
        nor[k * 3 + 1] = 1 / len;
        nor[k * 3 + 2] = -dz / len;
        if (nd) {
          nd[k * 2] = toHalf(-dx / len);
          nd[k * 2 + 1] = toHalf(-dz / len);
        }
      }
    }
    if (nd) this.normTex.needsUpdate = true;
    this.localDirty = true;
    this.version = (this.version || 0) + 1;
    // upload only the touched rows: a full-mesh upload every frame stutters on phones. The
    // ranges pile up until the next frame uploads (and clears) them, so two updates between
    // frames both reach the GPU
    const start = j0 * res * 3;
    const count = (j1 - j0 + 1) * res * 3;
    for (const attr of [this.geo.attributes.position, this.geo.attributes.normal]) {
      attr.addUpdateRange(start, count);
      attr.needsUpdate = true;
    }
    if (i0 === 0 || j0 === 0 || i1 === hf.nx - 1 || j1 === hf.nz - 1) this.updateSides();
  }

  updateSides() {
    const { hf } = this;
    this.sideDefs.forEach((d, s) => {
      const g = this.sides[s].geometry;
      const pos = g.attributes.position.array;
      const nor = g.attributes.normal.array;
      const top = g.attributes.aTop.array;
      for (let t = 0; t < d.n; t++) {
        const [i, j] = d.cell(t);
        const [x, z] = hf.toWorld(i, j);
        const y = hf.h[j * hf.nx + i];
        // the slab's underside follows the long profile (smoothed via the centre column)
        const yBase = Math.min(y, hf.heightAt(0, z)) - THICKNESS;
        top[t * 2] = top[t * 2 + 1] = y;
        const a = t * 6;
        pos[a] = x;
        pos[a + 1] = y;
        pos[a + 2] = z;
        pos[a + 3] = x;
        pos[a + 4] = yBase;
        pos[a + 5] = z;
        nor[a] = nor[a + 3] = d.dir[0];
        nor[a + 1] = nor[a + 4] = d.dir[1];
        nor[a + 2] = nor[a + 5] = d.dir[2];
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
      g.attributes.aTop.needsUpdate = true;
    });
  }
}
