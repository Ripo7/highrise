import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// rounded cartoon fonts, bundled (no third-party request; latin subset only)
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './style.css';
import { Heightfield, encodeHeights, decodeHeights } from './core/heightfield.js';
import { strokeTo, TOOLS } from './core/brushes.js';
import { History } from './core/history.js';
import { Skier, PHYS } from './core/skier.js';
import { ScoreKeeper, SPEED_BONUS_KMH, speedRate } from './core/score.js';
import { STAMPS, applyStamp, restoreRect } from './core/stamps.js';
import { addDelta, profileStats } from './core/profile.js';
import { PropSet, PROP_TOOLS, TREE, ROCK, packProps, unpackProps, rng } from './core/props.js';
import { buildRun } from './core/build.js';
import { SurfaceMap } from './core/surface.js';
import { StructureSet } from './core/structures.js';
import { templateRun, packRun, unpackRun, profileToRun, runProfile, runGeometry, sampleAt, sectionAt, CELL_M, GRID_COLS, GRID_HALF } from './core/run.js';
import { PropMeshes } from './render/propMeshes.js';
import { StructureMeshes } from './render/structureMeshes.js';
import { Tracks } from './render/tracks.js';
import { Decor } from './render/decor.js';
import { TerrainMesh } from './render/terrainMesh.js';
import { SkierMesh, Trail } from './render/skierMesh.js';
import { Spray } from './render/spray.js';
import { GhostRider, packPath } from './render/ghost.js';
import { Sound } from './audio.js';
import { RideControls } from './rideControls.js';
import { createUI } from './ui.js';
import { THEME, SUN_DIR } from './render/theme.js';
import { RunEditor } from './runEditor.js';
import { createDebugOverlay } from './debugOverlay.js';

// ---------- state ----------
const isBrush = (t) => t in TOOLS;
const COARSE = window.matchMedia('(pointer: coarse)').matches;
let altHeld = false; // Alt/Option held: left button orbits
const SAVE_KEY = 'highrise.ski.v3'; // v3+: the run (v5: sections) + sculpting stored as a delta
const INTRO_KEY = 'highrise.intro.v4';
const TRACKS_KEY = 'highrise.tracks.v1';
const BACKUP_KEY = 'highrise.ski.backup';
let loadNote = null; // told to the player once the UI is up
let saveFailed = false;

const hf = new Heightfield();
const props = new PropSet(hf); // trees and rocks
const surf = new SurfaceMap(hf); // groomed / powder / ice
const structs = new StructureSet(hf); // rails, chalets, pylons, nets...
const history = new History(25);
const BUILD_KINDS = { ...STAMPS, ...PROP_TOOLS };
const isPropTool = (k) => k in PROP_TOOLS;
const random = rng(Date.now() % 100000);
const state = {
  tool: 'raise',
  buildKind: 'kicker',
  radius: COARSE ? 28 : 22, // a 480 m wide mountain; fingers are less precise on phones
  strength: 0.5,
  start: null,
  run: null, // the designed run: sections (see core/run.js)
  geo: null, // its shape: piste centre and width every 4 m
  advanced: false, // hand sculpting tools shown
  rideCam: 'chase', // chase | helmet
  contours: true,
  relief: false,
  muted: false,
  best: null, // { score, time }
  bestPath: null, // packed path of the best run, for the ghost
};
let baseH = null; // the generated piste before any sculpting
const hadSave = loadSave();
if (!hadSave) {
  // nothing designed yet: the starter run sits behind the editor
  state.run = templateRun('starter');
  const built = generate(state.run);
  state.start = built.start;
  props.set(built.props);
  structs.set(built.structs);
}

// Build the mountain for a run: snow, surface, trees and structures (not yet in the scene)
function generate(run) {
  const built = buildRun(hf, surf, run);
  baseH = hf.copy();
  state.geo = built.geo;
  state.finishX = built.finishX;
  return built;
}

// piste centre at u metres down the run
const laneX = (u) => (state.geo ? sampleAt(state.geo.xc, Math.max(0, Math.min(state.geo.L, u))) : 0);

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (err) {
  // three.js needs WebGL 2: say so instead of leaving the UI over a blank canvas
  showFatal('Highrise needs WebGL 2, which this browser or device doesn’t provide. Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.');
  throw err;
}
// the GPU can drop the context (driver reset, phone under memory pressure); three.js
// restores it by itself, the player just needs to know why the screen flickered
canvas.addEventListener('webglcontextlost', () => window.__highriseToast?.('Graphics were reset by the browser, restoring…', 'bad'));
canvas.addEventListener('webglcontextrestored', () => window.__highriseToast?.('Graphics restored.'));

function showFatal(msg) {
  const el = document.createElement('div');
  el.className = 'fatal panel';
  el.setAttribute('role', 'alert');
  el.textContent = msg;
  document.body.append(el);
}
// phones: cap resolution a little to keep sculpting smooth
renderer.setPixelRatio(Math.min(window.devicePixelRatio, COARSE ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 1, 40000);
const HOME_CAM = new THREE.Vector3();
const HOME_TARGET = new THREE.Vector3();
// Frame the whole run (3/4 side-on on wide screens, straight up the fall line on phones)
function computeHome() {
  const aspect = Math.max(0.3, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  const portrait = aspect < 1;
  camera.fov = portrait ? 58 : 40;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  // frame the run from gate to finish, drop included, so steep runs fit too
  const zs = hf.startZ;
  const zf = hf.finishZ;
  const ys = hf.heightAt(0, zs);
  const yf = hf.heightAt(0, zf);
  const span = Math.hypot(zf - zs, ys - yf);
  HOME_TARGET.set(0, (ys + yf) / 2, (zs + zf) / 2);
  if (portrait) {
    // phones: looking up the fall line, the run stretches away up the screen
    HOME_CAM.copy(HOME_TARGET).addScaledVector(new THREE.Vector3(0.08, 0.62, 0.78).normalize(), Math.max(650, span * 1.05));
  } else {
    // wide screens: side-on 3/4 view, start on the left and finish on the right
    const hTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    const d = THREE.MathUtils.clamp((span * 0.58) / hTan, 600, 12000);
    HOME_CAM.copy(HOME_TARGET).addScaledVector(new THREE.Vector3(-0.72, 0.64, 0.26).normalize(), d);
  }
}
computeHome();
camera.position.copy(HOME_CAM);

// the sky behind the canvas comes from the theme
document.documentElement.style.setProperty('--sky-top', THEME.sky.top);
document.documentElement.style.setProperty('--sky-low', THEME.sky.horizon);
scene.add(new THREE.HemisphereLight(THEME.sky.top, THEME.sky.horizon, 1.4));
const sun = new THREE.DirectionalLight(THEME.sun.color, 2.4);
sun.position.set(...SUN_DIR).multiplyScalar(200);
scene.add(sun, sun.target);
// Long sun shadows are half the look. One shadow map follows what you're looking at
// (the rider, or the orbit target) and covers more ground the further back the camera is.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
sun.castShadow = true;
sun.shadow.mapSize.setScalar(COARSE ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
const SUN_V = new THREE.Vector3(...SUN_DIR).normalize();
const sunRot = new THREE.Matrix4().lookAt(SUN_V, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
const sunRotInv = sunRot.clone().invert();
const _sunC = new THREE.Vector3();
function updateSun() {
  const riding_ = riding && skier;
  if (riding_) _sunC.set(skier.pos[0], skier.pos[1], skier.pos[2]);
  else _sunC.copy(controls.target);
  const dist = camera.position.distanceTo(_sunC);
  const half = riding_ ? 120 : THREE.MathUtils.clamp(dist * 0.7, 60, 1400);
  // snap to whole shadow-map texels in the light's frame so shadows don't shimmer as we move
  const texel = (2 * half) / sun.shadow.mapSize.x;
  _sunC.applyMatrix4(sunRotInv);
  _sunC.x = Math.round(_sunC.x / texel) * texel;
  _sunC.y = Math.round(_sunC.y / texel) * texel;
  _sunC.applyMatrix4(sunRot);
  const cam = sun.shadow.camera;
  if (cam.right !== half) {
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 6000;
    cam.updateProjectionMatrix();
  }
  sun.target.position.copy(_sunC);
  sun.position.copy(_sunC).addScaledVector(SUN_V, 3000);
}

const propMeshes = new PropMeshes(props);
scene.add(propMeshes.group);
// rails, chalets, lifts, nets, cannons...
const structMeshes = new StructureMeshes(structs);
scene.add(structMeshes.group);
// ski tracks, kept from run to run
const tracks = new Tracks(hf);
scene.add(tracks.mesh);
try {
  const saved = localStorage.getItem(TRACKS_KEY);
  if (saved) tracks.unpack(saved);
} catch {
  /* no tracks yet */
}
// start gate and finish arch
const decor = new Decor(hf, props);
scene.add(decor.group);
let decorSeen = -1;
let decorAt = 0;
let seatSeen = -1;

let terrain = null;
function rebuildTerrain() {
  if (terrain) {
    scene.remove(terrain.group);
    terrain.dispose();
  }
  terrain = new TerrainMesh(hf, { finishZ: hf.finishZ, start: state.start, surface: surf });
  terrain.setRelief(state.relief);
  // the terrain shading its own hollows is costly on phones: there only props and the rider cast
  terrain.top.castShadow = !COARSE;
  terrain.uniforms.uContours.value = state.contours ? 1 : 0;
  scene.add(terrain.group);
  // trees, rocks and the skier fade into the same haze as the snow
  scene.fog = new THREE.Fog(THEME.haze, terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  propMeshes.setFog(terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  decor.setFog(terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  structMeshes.setFog(terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  tracks.setFog(terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  decor.setFinishX(state.finishX || 0);
  decorSeen = -1;
  seatSeen = terrain.version;
}
rebuildTerrain();

propMeshes.rebuild();
structMeshes.rebuild();

const skierMesh = new SkierMesh();
skierMesh.addTo(scene);
skierMesh.visible = false;
const ghostRider = new GhostRider(hf);
ghostRider.addTo(scene);

// room for the longest possible run at 30 samples a second
const trail = new Trail({ color: '#ff5a1f', max: Math.ceil(PHYS.maxTime * 30) + 16 });
scene.add(trail.line);
const spray = new Spray();
scene.add(spray.points);

const sound = new Sound();
sound.muted = state.muted;

placeGate();

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 20;
controls.maxDistance = 14000;
controls.zoomToCursor = true; // scroll / pinch zooms towards what you point at
controls.screenSpacePanning = false; // panning slides along the ground, up and down the piste
controls.update();

// ---------- UI ----------
const ui = createUI({
  tools: TOOLS,
  stamps: BUILD_KINDS,
  speedBonusKmh: SPEED_BONUS_KMH,
  speedRate,
  initial: state,
  onTool: setTool,
  onKind: (k) => {
    state.buildKind = k;
    ui.setKind(k);
    if (state.tool !== 'build') setTool('build');
    ui.toast(BUILD_KINDS[k].hint);
  },
  onRadius: (v) => (state.radius = v),
  onStrength: (v) => (state.strength = v),
  onSend: sendSkier,
  onUndo: undo,
  onRedo: redo,
  onResetView: resetView,
  onRideExit: () => exitRide(true),
  onRideCam: () => toggleRideCam(),
  onEditRun: () => openDesigner('edit'),
  onNewRun: () => openDesigner('new'),
  onAdvanced: (on) => setAdvanced(on),
  onFreshSnow: () => {
    if (tracks.freshSnow()) {
      ui.toast('Fresh snow: your tracks are covered.');
      try {
        localStorage.removeItem(TRACKS_KEY);
      } catch {
        /* ignore */
      }
    } else ui.toast('No tracks yet: ride the run first.');
  },
  onRelief: (on) => {
    state.relief = on;
    terrain.setRelief(on);
    scheduleSave();
  },
  onMute: (m) => {
    state.muted = m;
    sound.setMuted(m);
    scheduleSave();
  },
  onContours: (v) => {
    state.contours = v;
    terrain.uniforms.uContours.value = v ? 1 : 0;
  },
  onIntroClosed: () => {
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* ignore */
    }
    // first visit: go straight on to designing a run
    if (!hadSave && !pickedOnce) {
      pickedOnce = true;
      openDesigner('first');
    }
  },
});
window.__highriseToast = (msg, kind) => ui.toast(msg, kind);
let pickedOnce = false;
let seenIntro = false;
try {
  seenIntro = localStorage.getItem(INTRO_KEY) === '1';
} catch {
  /* ignore */
}
if (!hadSave) document.getElementById('intro-go').textContent = 'Design my run';
if (!seenIntro) ui.openIntro();
else if (!hadSave) setTimeout(() => openDesigner('first'), 0);
ui.setBest(state.best);
if (loadNote) ui.toast(loadNote, 'bad');
ui.setKind(state.buildKind);
if (!state.advanced) state.tool = 'view';
setAdvanced(state.advanced, true);
setTool(state.tool);
refreshHistoryButtons();

const rideControls = new RideControls({ onPress: () => sound.unlock() });

// undo snapshots hold the terrain and the trees/rocks together
const snapshot = (h = hf.copy()) => ({ h, p: props.clone() });
function restore(snap) {
  hf.set(snap.h);
  props.set(snap.p);
  terrain.updateAll();
  propMeshes.rebuild();
  placeGate();
}

// Advanced: the hand sculpting brushes and the Build tool, for fine touches
function setAdvanced(on, quiet = false) {
  state.advanced = on;
  ui.setAdvanced(on);
  if (!on && state.tool !== 'view' && state.tool !== 'start') setTool('view');
  if (on && !quiet) ui.toast('Advanced: sculpt the snow by hand. Your sculpting stays when you edit the run.');
  if (!quiet) scheduleSave();
}

// ---------- sculpting input ----------
const pointers = new Map();
const hover = { valid: false, x: 0, y: 0, z: 0 };
let stroke = null; // brush stroke in progress
let build = null; // Build drag in progress: { pointerId, ax, az, base, rect }
let propStroke = null; // planting / clearing trees and rocks
const baseField = new Heightfield(); // shares nothing: its .h points at the build snapshot
let saveTimer = 0;
let tapCand = null; // a possible tap on the snow: { id, x, y, t }

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// browsers only start audio from a gesture
document.addEventListener('pointerdown', () => sound.unlock());
// no sound from a background tab or a locked phone
document.addEventListener('visibilitychange', () => {
  sound.setHidden(document.hidden);
  if (document.hidden) rideControls.reset();
});

canvas.addEventListener('pointerdown', (e) => {
  // a fresh first finger means any touch we still track is stale (a lost pointerup
  // would otherwise make every new touch look like a second finger and block sculpting)
  if (e.pointerType === 'touch' && e.isPrimary) pointers.clear();
  if (riding) return;
  pointers.set(e.pointerId, e);
  updateHover(e);
  // Orbit tool: a tap (no drag) on the snow opens the editor at that spot
  tapCand = pointers.size === 1 && state.tool === 'view' && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;

  // a second finger turns the gesture into camera control: cancel the edit
  if (pointers.size > 1) {
    if (stroke) cancelStroke();
    if (build) cancelBuild();
    if (propStroke) cancelPropStroke();
    return;
  }
  if (e.button !== 0 || altHeld || e.altKey) return;

  if (state.tool === 'start' && hover.valid) {
    if (hover.z < hf.finishZ - 60) {
      state.start = { x: hover.x, z: hover.z };
      terrain.setStart(hover.x, hover.z);
      placeGate();
      scheduleSave();
      ui.toast('Start gate moved');
    } else {
      ui.toast('Put the start higher up the slope');
    }
    return;
  }

  if (state.tool === 'build' && hover.valid && isPropTool(state.buildKind)) {
    history.push(snapshot());
    propStroke = { pointerId: e.pointerId, lastX: Infinity, lastZ: Infinity, changed: false };
    applyPropStroke();
    canvas.setPointerCapture(e.pointerId);
    refreshHistoryButtons();
    return;
  }

  if (state.tool === 'build' && hover.valid) {
    const base = hf.copy();
    history.push(snapshot(base));
    baseField.h = base;
    build = { pointerId: e.pointerId, ax: hover.x, az: hover.z, bx: hover.x, bz: hover.z, base, rect: null, moved: false };
    applyBuild();
    canvas.setPointerCapture(e.pointerId);
    refreshHistoryButtons();
    return;
  }

  if (isBrush(state.tool) && hover.valid) {
    history.push(snapshot());
    stroke = { pointerId: e.pointerId, targetHeight: hover.y, last: null, carry: 0 };
    canvas.setPointerCapture(e.pointerId);
    refreshHistoryButtons();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
  if (tapCand && (tapCand.id !== e.pointerId || Math.hypot(e.clientX - tapCand.x, e.clientY - tapCand.y) > 9)) tapCand = null;
  if (e.pointerType === 'mouse' || pointers.size === 1) {
    // while building, aim at the ground as it was, not at the feature being drawn
    updateHover(e, build ? baseField : hf);
    if (propStroke && hover.valid) applyPropStroke();
    if (build && hover.valid) {
      build.bx = hover.x;
      build.bz = hover.z;
      if (Math.hypot(build.bx - build.ax, build.bz - build.az) > 4) build.moved = true;
      build.dirty = true;
    }
  }
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (tapCand && tapCand.id === e.pointerId) {
    const quick = performance.now() - tapCand.t < 450 && e.type === 'pointerup';
    tapCand = null;
    if (quick && !riding && !pointers.size) {
      updateHover(e);
      const at = hover.valid ? cellAtWorld(hover.x, hover.z) : null;
      if (at) openDesigner('edit', at);
    }
  }
  if (stroke && stroke.pointerId === e.pointerId) {
    stroke = null;
    scheduleSave();
  }
  if (propStroke && propStroke.pointerId === e.pointerId) {
    // nothing changed (e.g. clearing empty snow): drop the undo step
    if (!propStroke.changed) history.discardLast();
    propStroke = null;
    refreshHistoryButtons();
    scheduleSave();
  }
  if (build && build.pointerId === e.pointerId) {
    if (build.dirty) applyBuild();
    build = null;
    sound.stamp();
    scheduleSave();
  }
  if (e.pointerType !== 'mouse') hover.valid = false;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', (e) => {
  const mine =
    (stroke && stroke.pointerId === e.pointerId) ||
    (build && build.pointerId === e.pointerId) ||
    (propStroke && propStroke.pointerId === e.pointerId);
  if (mine && !pointers.has(e.pointerId)) endPointer(e);
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !stroke && !build) hover.valid = false;
});

function cancelStroke() {
  const snap = history.discardLast();
  if (snap) restore(snap);
  stroke = null;
  refreshHistoryButtons();
}

function cancelPropStroke() {
  const snap = history.discardLast();
  if (snap) restore(snap);
  propStroke = null;
  refreshHistoryButtons();
}

// Plant or clear trees and rocks under the pointer
function applyPropStroke() {
  const ps = propStroke;
  const kind = state.buildKind;
  const x = hover.x;
  const z = hover.z;
  const u = z - hf.startZ;
  const moved = Math.hypot(x - ps.lastX, z - ps.lastZ);
  if (kind === 'tree' || kind === 'rock') {
    // one per tap; dragging plants a row, spaced out
    const gap = kind === 'tree' ? 7 : 6;
    if (moved < gap) return;
    if (props.near(x, z, kind === 'tree' ? 2.5 : 2).length) return;
    const s = kind === 'tree' ? 0.8 + random() * 0.5 : 0.6 + state.strength * 2.6;
    props.add({ k: kind === 'tree' ? TREE : ROCK, u, x, s, r: random() * 6.283, m: 1 });
  } else if (kind === 'forest') {
    const R = Math.max(4, state.radius);
    if (moved < R * 0.4) return;
    const tries = Math.ceil((Math.PI * R * R) / 90);
    for (let i = 0; i < tries; i++) {
      const a = random() * 6.283;
      const d = R * Math.sqrt(random());
      const tx = x + Math.cos(a) * d;
      const tz = z + Math.sin(a) * d;
      if (!hf.inside(tx, tz) || Math.abs(tx) > hf.halfX - 5) continue;
      if (props.near(tx, tz, 5).length) continue;
      props.add({ k: TREE, u: tz - hf.startZ, x: tx, s: 0.7 + random() * 0.7, r: random() * 6.283, m: 1 });
    }
  } else if (kind === 'clear') {
    if (moved < 2) return;
    if (!props.removeWithin(x, z, Math.max(3, state.radius))) {
      ps.lastX = x;
      ps.lastZ = z;
      return;
    }
  }
  ps.lastX = x;
  ps.lastZ = z;
  ps.changed = true;
  propMeshes.rebuild();
}

function cancelBuild() {
  restoreRect(hf, build.base, build.rect);
  terrain.update(build.rect);
  propMeshes.refreshRect(build.rect);
  history.discardLast();
  build = null;
  refreshHistoryButtons();
}

// Redraw the feature being dragged out: put back the ground it covered, draw it again
function applyBuild() {
  const b = build;
  restoreRect(hf, b.base, b.rect);
  const old = b.rect;
  b.rect = applyStamp(hf, b.base, state.buildKind, b.ax, b.az, b.bx, b.bz, state.radius, state.strength);
  b.dirty = false;
  const r = old && b.rect ? unionRect(old, b.rect) : b.rect || old;
  if (r) {
    terrain.update(r);
    propMeshes.refreshRect(r);
  }
  placeGate();
}

function unionRect(a, b) {
  return { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) };
}

// Ray-march the heightfield (much cheaper than raycasting the mesh)
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function updateHover(e, field = hf) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  let prevT = 0;
  hover.valid = false;
  // step grows with distance: fine near the camera, quick across the far piste
  for (let t = 0, step = 0.75; t < 30000; t += step, step = Math.max(0.75, t * 0.003)) {
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    const z = o.z + d.z * t;
    if (!field.inside(x, z)) {
      prevT = t;
      continue;
    }
    if (y <= field.heightAt(x, z)) {
      let a = prevT;
      let b = t;
      for (let k = 0; k < 12; k++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m <= field.heightAt(o.x + d.x * m, o.z + d.z * m)) b = m;
        else a = m;
      }
      hover.x = o.x + d.x * b;
      hover.z = o.z + d.z * b;
      hover.y = hf.heightAt(hover.x, hover.z);
      hover.valid = true;
      return;
    }
    prevT = t;
  }
}

// ---------- history / save ----------
function undo() {
  if (stroke || build || propStroke) return;
  const prev = history.undo(snapshot());
  if (!prev) return;
  restore(prev);
  refreshHistoryButtons();
  scheduleSave();
}

function redo() {
  if (stroke || build || propStroke) return;
  const next = history.redo(snapshot());
  if (!next) return;
  restore(next);
  refreshHistoryButtons();
  scheduleSave();
}

// ---------- run editor ----------
let designerMode = null;
// mode: 'first' (no run yet), 'new' (start over) or 'edit'. focus: { si, r, c } to open a cell.
function openDesigner(mode, focus = null) {
  if (riding) exitRide(true);
  if (stroke || build || propStroke) return;
  designerMode = mode;
  hover.valid = false;
  // the 3D loop pauses while the editor is open: settle the sound layers first
  sound.update({ skier: null, sculpt: 0 });
  editor.open(mode === 'edit' ? state.run : null, { canCancel: mode !== 'first', focus });
}

/**
 * Generate the mountain for a designed run. keepSculpt carries the player's hand sculpting
 * and hand-placed trees over (they move with the run: same distance from the start, same
 * offset across).
 */
function applyRun(run, keepSculpt) {
  if (riding) exitRide(true);
  const delta = keepSculpt && baseH ? hf.h.map((v, i) => v - baseH[i]) : null;
  const oldDims = { sizeX: hf.sizeX, sizeZ: hf.sizeZ, cell: hf.cell };
  // a moved start gate stays at the same distance down the run, the same offset from the piste
  const startU = state.start ? state.start.z - hf.startZ : 0;
  const startOff = state.start ? state.start.x - laneX(startU) : 0;
  const manual = keepSculpt ? props.list.filter((p) => p.m) : [];
  state.run = run;
  const built = generate(run);
  if (delta) addDelta(hf, delta, oldDims);
  const st = profileStats(runProfile(run, state.geo));
  props.set(built.props.concat(manual));
  props.trim(st.length);
  structs.set(built.structs);
  state.start = keepSculpt && startU < st.length - 60 ? { x: laneX(startU) + startOff, z: hf.startZ + startU } : built.start;
  state.best = null;
  state.bestPath = null;
  history.clear();
  rebuildTerrain();
  propMeshes.rebuild();
  structMeshes.rebuild();
  // a brand new run starts on fresh snow; an edited one keeps its tracks
  if (keepSculpt) tracks.redrape();
  else {
    tracks.clear();
    saveTracks();
  }
  placeGate();
  skier = null;
  skierMesh.visible = false;
  trail.clear();
  ui.setBest(null);
  ui.setStatus('idle');
  ui.clearStats();
  refreshHistoryButtons();
  scheduleSave();
  computeHome();
  camera.position.copy(HOME_CAM);
  controls.target.copy(HOME_TARGET);
  viewAnim = null;
  const km = st.length >= 1000 ? `${(st.length / 1000).toFixed(2)} km` : `${Math.round(st.length)} m`;
  ui.toast(`${km} run built, ${Math.round(st.drop)} m of drop.${delta && delta.some((v) => Math.abs(v) > 0.05) ? ' Your hand sculpting moved with it.' : ''}`);
}

const editor = new RunEditor({
  onBuild: (run) => {
    editor.close();
    applyRun(run, designerMode === 'edit');
    designerMode = null;
  },
  onCancel: () => {
    editor.close();
    designerMode = null;
  },
});

// Which section and grid cell is under this point of the snow (for tap-to-edit)
function cellAtWorld(x, z) {
  if (!state.run || !state.geo) return null;
  const u = z - hf.startZ;
  if (u < 0 || u > state.geo.L) return null;
  const si = sectionAt(state.run, u);
  const r = Math.floor((u - state.geo.starts[si]) / CELL_M);
  const off = x - laneX(u);
  if (Math.abs(off) > GRID_HALF) return { si };
  const c = Math.max(0, Math.min(GRID_COLS - 1, Math.round(off / CELL_M + (GRID_COLS - 1) / 2)));
  return { si, r, c };
}

function refreshHistoryButtons() {
  ui.setHistory(history.canUndo, history.canRedo);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          v: 5,
          dims: { nx: hf.nx, nz: hf.nz, cell: hf.cell, sizeX: hf.sizeX, sizeZ: hf.sizeZ },
          run: packRun(state.run),
          sculpt: encodeHeights(hf.h.map((v, i) => v - baseH[i])),
          // hand-placed trees and rocks are stored as kinds 2 and 3
          props: packProps(props.list.map((p) => (p.m ? { ...p, k: p.k + 2 } : p))),
          start: state.start,
          best: state.best,
          bestPath: state.bestPath,
          rideCam: state.rideCam,
          relief: state.relief,
          muted: state.muted,
          buildKind: state.buildKind,
          advanced: state.advanced,
        })
      );
      saveFailed = false;
    } catch {
      // storage full or blocked: the session still works, but say so once
      if (!saveFailed) ui.toast('Could not save your run: browser storage is full or blocked.', 'bad');
      saveFailed = true;
    }
  }, 400);
}

// Saves record the grid they were made on, so a save survives any later change to the
// grid sizing: the sculpting is resampled onto the new grid (same distance down the run,
// same offset across). A save that still can't be read is kept under BACKUP_KEY, never
// silently overwritten. Older saves hold a drawn profile instead of sections: it is
// turned into sections that follow the same descent.
function loadSave() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    let run = data.v >= 5 ? unpackRun(data.run) : null;
    const legacy = !run;
    if (legacy) {
      if (!Array.isArray(data.profile) || data.profile.length < 2) throw new Error('no run in save');
      run = profileToRun(data.profile);
    }
    if (!data.start) throw new Error('no start in save');
    state.run = run;
    const built = generate(run);
    const d = data.dims;
    const sameGrid = !d || (d.nx === hf.nx && d.nz === hf.nz && d.cell === hf.cell);
    const delta = data.sculpt && decodeHeights(data.sculpt, d ? d.nx * d.nz : hf.nx * hf.nz);
    if (delta && sameGrid) {
      for (let i = 0; i < delta.length; i++) hf.h[i] += delta[i];
    } else if (delta) {
      addDelta(hf, delta, d);
    } else if (data.sculpt) {
      // sculpting from a grid we can't place any more: keep the run, back up the old save
      backupSave(raw);
      loadNote = 'Your sculpting could not be restored (a copy of the old save was kept).';
    }
    if (legacy) {
      // drawn runs had trees everywhere, the new piste is groomed: grow the forest afresh
      props.set(built.props);
      backupSave(raw);
      loadNote = 'Your drawn run is now made of sections: open Edit run to change it.';
    } else {
      const saved = Array.isArray(data.props) ? unpackProps(data.props) : null;
      props.set(saved ? saved.map((p) => (p.k >= 2 ? { ...p, k: p.k - 2, m: 1 } : p)) : built.props);
    }
    structs.set(built.structs);
    state.start = legacy ? built.start : data.start;
    state.relief = !!data.relief;
    state.muted = !!data.muted;
    state.advanced = !!data.advanced;
    if (data.buildKind in STAMPS || data.buildKind in PROP_TOOLS) state.buildKind = data.buildKind;
    // best runs are scored on style now (older saves stored a time)
    if (!legacy && data.best && typeof data.best.score === 'number') {
      state.best = data.best;
      state.bestPath = Array.isArray(data.bestPath) ? data.bestPath : null;
    }
    if (data.rideCam === 'helmet' || data.rideCam === 'chase') state.rideCam = data.rideCam;
    return true;
  } catch {
    if (raw) {
      backupSave(raw);
      loadNote = 'Your saved run could not be read (a copy was kept).';
    }
    return false;
  }
}

function backupSave(raw) {
  try {
    if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw);
  } catch {
    /* no room for a backup: nothing more we can do */
  }
}

// ---------- tools ----------
// Desktop: left = tool, right = orbit, middle = pan, scroll = zoom; holding Alt/Option turns
// the left button into orbit (for trackpads). Touch: one finger = tool, two fingers = pan +
// pinch. With the Orbit tool, one finger orbits.
function applyControlScheme() {
  const t = state.tool;
  const camOnly = t === 'view' || altHeld;
  controls.mouseButtons = {
    LEFT: camOnly ? THREE.MOUSE.ROTATE : null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: t === 'view' ? THREE.TOUCH.ROTATE : null,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  document.body.classList.toggle('alt-orbit', altHeld);
}

function setTool(t) {
  state.tool = t;
  ui.setTool(t);
  applyControlScheme();
}

// ---------- runs ----------
let skier = null;
let score = null;
let lastStatus = null;
let lastEventCount = 0;
let lastFeedCount = 0;

// ---------- ride mode: camera behind the skier, player rides ----------
let riding = false;
const editView = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
const rig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), snap: true, shake: 0, air: 0 };

function sendSkier() {
  if (ui.blocking || editor.isOpen) return;
  sound.unlock();
  if (stroke) {
    stroke = null;
    scheduleSave();
  }
  if (build) {
    build = null;
    scheduleSave();
  }
  if (propStroke) {
    if (!propStroke.changed) history.discardLast();
    propStroke = null;
    scheduleSave();
  }
  skier = new Skier(hf, state.start);
  skier.props = props;
  skier.structures = structs;
  skier.surface = surf;
  tracks.startRun();
  score = new ScoreKeeper();
  lastEventCount = 0;
  lastFeedCount = 0;
  spray.clear();
  skierMesh.reset();
  skierMesh.visible = true;
  trail.clear();
  ghostRider.setPath(state.bestPath);
  lastStatus = 'running';
  ui.setStatus('running');
  ui.hideResults();
  ui.clearStats();
  ui.clearTricks();
  if (!riding) enterRide();
  rig.snap = true;
  rig.shake = 0;
  trail.line.visible = false; // behind the chase cam the trail climbs past the lens
}

function enterRide() {
  riding = true;
  viewAnim = null;
  editView.pos.copy(camera.position);
  editView.target.copy(controls.target);
  controls.enabled = false;
  camera.near = 0.2;
  hover.valid = false;
  rideControls.reset();
  // contour lines are a building aid; on the ride they read as seams in the snow
  terrain.uniforms.uContours.value = 0;
  ui.setRiding(true);
  ui.setRideCam(state.rideCam);
  skierMesh.setFirstPerson(state.rideCam === 'helmet');
}

function exitRide(abort) {
  if (!riding) return;
  tracks.lift();
  saveTracks();
  if (abort && skier && skier.status === 'running') {
    skier.status = 'aborted';
    lastStatus = 'aborted';
    ui.setStatus('idle');
  }
  riding = false;
  rideControls.reset();
  terrain.uniforms.uContours.value = state.contours ? 1 : 0;
  setGateFade(1);
  ui.setRiding(false);
  ui.clearTricks();
  ui.setRush(0);
  skierMesh.setFirstPerson(false);
  ghostRider.update(0, 0, false);
  camera.near = 1;
  camera.fov = camera.aspect < 1 ? 58 : 40;
  camera.updateProjectionMatrix();
  controls.enabled = true;
  trail.line.visible = true;
  viewAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: rig.look.clone(),
    toPos: editView.pos.clone(),
    toTarget: editView.target.clone(),
  };
}

function toggleRideCam() {
  state.rideCam = state.rideCam === 'chase' ? 'helmet' : 'chase';
  ui.setRideCam(state.rideCam);
  skierMesh.setFirstPerson(riding && state.rideCam === 'helmet');
  rig.snap = true;
  scheduleSave();
}

// Is the skier (chest height) visible from the camera, or does the snow get in the way?
function lineOfSight(from, to) {
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const y = from.y + (to.y + 2 - from.y) * t;
    if (y < hf.heightAt(x, z) + 0.3) return false;
  }
  return true;
}

const _h = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _p = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dp = [0, 0, 0];
const _gateC = new THREE.Vector3();
function updateRideCamera(dt) {
  const [x, y, z] = skier.drawPos(_dp);
  _p.set(x, y, z);
  // follow the direction of travel (not the skis), so spins don't whip the camera around
  _vel.set(skier.vel[0], 0, skier.vel[2]);
  if (_vel.lengthSq() > 4) _flat.copy(_vel).normalize();
  else {
    _flat.set(skier.heading[0], 0, skier.heading[2]);
    if (_flat.lengthSq() < 1e-4) _flat.set(0, 0, 1);
    _flat.normalize();
  }
  _h.set(skier.heading[0], skier.heading[1], skier.heading[2]).normalize();
  const speed = skier.speed;
  // airborne: ease the camera back and up to show the trick
  const airTarget = !skier.grounded && skier.curAir > 0.2 ? 1 : 0;
  rig.air += (airTarget - rig.air) * Math.min(1, dt * 3);
  let posRate;
  let lookRate;
  const kick = Math.min(1, Math.max(0, (speed - 8) / 32));
  // read the slope ahead: where the snow actually is 8-35 m down the line, so the camera
  // aims at the run (not over a crest into the sky) and rises to see down steep faces
  const groundHere = hf.heightAt(x, z);
  const aheadAt = (d) => hf.heightAt(x + _flat.x * d, z + _flat.z * d);
  const lookDist = 12 + Math.min(18, speed * 0.35);
  const gLook = aheadAt(lookDist);
  // how far the snow falls away ahead (steep faces, drops behind a crest)
  const drop = Math.max(0, groundHere - Math.min(aheadAt(15), aheadAt(28) + 3, aheadAt(42) + 7));
  if (state.rideCam === 'helmet') {
    // just behind the (hidden) head and tipped down a little, so the ski tips and pole
    // baskets sit at the bottom of the frame: they show speed, lean and where you point
    _want.copy(_p).addScaledVector(_flat, -0.9);
    _want.y = Math.max(y, groundHere) + 2.7;
    _look.copy(_p).addScaledVector(_flat, lookDist + 8);
    _look.y = Math.min(_want.y - 3.2, aheadAt(lookDist + 8) + 0.6);
    posRate = 30;
    lookRate = 12;
    camera.fov = 72 + 22 * kick;
  } else {
    const portrait = camera.aspect < 1;
    const back = (portrait ? 10 : 7.5) + 2.5 * kick + 5 * rig.air;
    _want.copy(_p).addScaledVector(_flat, -back);
    // higher on steep or dropping ground so you see down the slope over the skier
    const lift = Math.min(16, drop * 0.5);
    _want.y = y + (portrait ? 4.2 : 3.2) + lift + 2.5 * rig.air;
    // never below the snow behind (uphill of the skier on steep runs)
    const behind = hf.heightAt(_want.x, _want.z);
    const clear = (portrait ? 5 : 4) + Math.min(4, Math.max(0, behind - y) * 0.25);
    if (_want.y < behind + clear) _want.y = behind + clear;
    // aim between the skier and the snow ahead; in the air, favour the skier
    const toSkier = 0.45 + 0.4 * rig.air;
    _look.copy(_p).addScaledVector(_flat, lookDist * (1 - toSkier));
    _look.y = (y + 1.2) * toSkier + (gLook + 1) * (1 - toSkier);
    posRate = 7;
    lookRate = 9;
    camera.fov = (portrait ? 66 : 58) + 24 * kick;
  }
  // a little rumble over the snow at speed
  if (skier.grounded && speed > 18) {
    const amp = Math.min(0.12, (speed - 18) * 0.004);
    const t = performance.now() * 0.001;
    _look.x += Math.sin(t * 37.1) * amp;
    _look.y += Math.sin(t * 43.7 + 1.3) * amp;
  }
  const ground = hf.heightAt(_want.x, _want.z);
  if (_want.y < ground + 1.5) _want.y = ground + 1.5;
  // in (or just before) a snow tunnel: stay low enough to see through it
  const tun = structs.tunnels.length ? structs.tunnelAt(x, z, 14) : null;
  if (tun) {
    _want.y = Math.min(_want.y, ground + tun.ht * 0.62);
    _look.y = Math.min(_look.y, hf.heightAt(_look.x, _look.z) + tun.ht * 0.45);
  } else if (state.rideCam === 'chase') {
    for (let tries = 0; tries < 8 && !lineOfSight(_want, _p); tries++) _want.y += 2;
  }
  if (rig.snap) {
    rig.pos.copy(_want);
    rig.look.copy(_look);
    rig.snap = false;
  } else {
    rig.pos.lerp(_want, 1 - Math.exp(-dt * posRate));
    rig.look.lerp(_look, 1 - Math.exp(-dt * lookRate));
  }
  camera.position.copy(rig.pos);
  // landing / wipeout shake
  if (rig.shake > 0.001) {
    const s = rig.shake;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    rig.shake *= Math.exp(-dt * 7);
  }
  camera.lookAt(rig.look);
  camera.updateProjectionMatrix();
}

// sound, spray and shake for what just happened
function onSkierEvent(ev) {
  if (ev.type === 'pop') {
    sound.pop(ev.value);
  } else if (ev.type === 'land') {
    const k = Math.min(1, ev.impact / 16);
    if (ev.air > 0.2) {
      sound.land(ev.impact, ev.quality);
      spray.burst(skier, 0.4 + k);
      rig.shake = Math.max(rig.shake, 0.15 + 0.7 * k * k);
    }
  } else if (ev.type === 'bump') {
    // brushed a tree or rock, or the edge of the piste
    sound.land(Math.min(16, 6 + (ev.value || 3)), 'sketchy');
    spray.burst(skier, 0.5);
    rig.shake = Math.max(rig.shake, 0.35);
  } else if (ev.type === 'grindStart') {
    sound.land(6, 'clean');
    spray.burst(skier, 0.25);
  } else if (ev.type === 'gate') {
    sound.trick(150);
  } else if (ev.type === 'wipeout') {
    sound.wipeout();
    spray.burst(skier, 2);
    rig.shake = Math.max(rig.shake, 1.2);
  }
}

function onRunEnd(s) {
  score.finish(s);
  drainFeed();
  tracks.lift();
  saveTracks();
  const finished = s.status === 'finished';
  const isBest = finished && (!state.best || score.total > state.best.score);
  if (isBest) {
    state.best = { score: score.total, time: s.time };
    state.bestPath = packPath(s.path);
    ui.setBest(state.best);
    scheduleSave();
  }
  if (finished) sound.finish();
  ui.showResults({
    eyebrow: finished ? 'Run complete' : s.status === 'stuck' ? 'Stopped: not enough slope' : 'Out of time',
    score: score.total,
    isBest,
    time: s.time,
    top: s.maxSpeed * 3.6,
    tricks: score.tricks.length,
    wipeouts: s.wipeouts,
    bestTrick: score.bestTrick,
    bestCombo: score.bestCombo,
    speedPoints: score.speedPoints,
  });
}

function drainFeed() {
  for (; lastFeedCount < score.feed.length; lastFeedCount++) {
    const item = score.feed[lastFeedCount];
    ui.trick(item);
    if (item.kind === 'combo') sound.combo();
    else if (item.kind !== 'wipeout') sound.trick(item.points);
  }
}

function resetView() {
  if (riding) return;
  computeHome();
  viewAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: HOME_CAM.clone(),
    toTarget: HOME_TARGET.clone(),
  };
}
let viewAnim = null;

// The skis write into the snow: carves on the piste, trenches in powder, smears when
// skidding. Nothing while flying, grinding or tumbling.
function recordTrack(sk) {
  if (sk.status !== 'running' || !sk.grounded || sk.grind || sk.wipeout > 0) {
    tracks.lift();
    return;
  }
  if (sk.speed < 1) return;
  let kind = 0;
  if (sk.powder > 0.5) kind = 1;
  else {
    // skidding: the skis are well off the direction of travel, or braking
    const v = sk.vel;
    const h = sk.heading;
    const c = Math.abs((v[0] * h[0] + v[2] * h[2]) / (Math.hypot(v[0], v[2]) * Math.hypot(h[0], h[2]) || 1));
    if (c < 0.94 || sk.input.pitch < -0.35) kind = 2;
  }
  tracks.add(sk.pos[0], sk.pos[2], kind);
}

function saveTracks() {
  try {
    localStorage.setItem(TRACKS_KEY, tracks.pack());
  } catch {
    /* no room: tracks just won't survive a reload */
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
const debug = createDebugOverlay(renderer);

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    const wasPortrait = camera.aspect < 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (!riding) camera.fov = w / h < 1 ? 58 : 40;
    camera.updateProjectionMatrix();
    if (wasPortrait !== camera.aspect < 1 && w > 0 && h > 0) resetView();
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  // the run designer covers the screen: don't spend the GPU on the hidden 3D scene
  if (editor.isOpen) {
    requestAnimationFrame(frame);
    return;
  }
  resize();
  spray.setScale(renderer.domElement.height / 3);
  structMeshes.setScale(renderer.domElement.height / 3);

  // sculpt continuously while held, so holding still keeps building
  if (!riding && stroke && hover.valid && isBrush(state.tool)) {
    const rect = strokeTo(hf, stroke, {
      tool: state.tool,
      x: hover.x,
      z: hover.z,
      radius: state.radius,
      strength: state.strength,
      dt,
      targetHeight: stroke.targetHeight,
    });
    if (rect) {
      terrain.update(rect);
      propMeshes.refreshRect(rect);
      hover.y = hf.heightAt(hover.x, hover.z);
      if (Math.hypot(hover.x - state.start.x, hover.z - state.start.z) < state.radius + 4) placeGate();
    }
  }
  if (!riding && build && build.dirty) applyBuild();

  terrain.refreshLocalMean();
  const showRing = !riding && hover.valid && (isBrush(state.tool) || (state.tool === 'build' && !build));
  const kind = state.buildKind;
  const ringR =
    state.tool !== 'build'
      ? state.radius
      : kind === 'forest' || kind === 'clear'
        ? Math.max(4, state.radius)
        : kind === 'tree' || kind === 'rock'
          ? 3
          : Math.max(3, Math.min(state.radius, 90) / 2);
  terrain.setBrush(showRing, hover.x, hover.y, hover.z, ringR);

  if (skier) {
    if (riding && skier.status === 'running') {
      const inp = rideControls.update(dt);
      skier.input.steer = inp.steer;
      skier.input.pitch = inp.pitch;
      skier.input.crouch = inp.crouch;
    }
    skier.update(dt);
    if (score) score.update(skier, skier.status === 'running' ? dt : 0);
    for (; lastEventCount < skier.events.length; lastEventCount++) onSkierEvent(skier.events[lastEventCount]);
    if (score) drainFeed();
    skierMesh.sync(skier, hf, dt);
    trail.setPath(skier.path);
    if (score) ui.setStats(skier, (skier.pos[2] - state.start.z) / (hf.finishZ - state.start.z), score);
    rideControls.setCharge(skier.charge, !skier.grounded);
    if (skier.status !== lastStatus) {
      lastStatus = skier.status;
      ui.setStatus(skier.status);
      if (skier.status !== 'running' && skier.status !== 'aborted') onRunEnd(skier);
    }
    spray.fromSkier(skier, dt);
    recordTrack(skier);
    ui.setRush(riding && skier.status === 'running' ? (skier.speed - 16) / 22 : 0);
    ghostRider.update(skier.time, dt, riding && skier.status === 'running');
    if (riding) {
      updateRideCamera(dt);
      const d = camera.position.distanceTo(_gateC.copy(decor.gate.position).setY(decor.gate.position.y + 3));
      setGateFade(Math.round(THREE.MathUtils.smoothstep(d, 9, 20) * 50) / 50);
    }
  }

  spray.update(dt);
  structMeshes.update(dt, camera);
  tracks.update(dt);
  const sculpting = !riding && (stroke || (build && build.moved)) ? 0.6 + 0.4 * state.strength : 0;
  sound.update({ skier: riding ? skier : null, sculpt: sculpting });

  if (viewAnim) {
    viewAnim.t = Math.min(1, viewAnim.t + dt * 1.6);
    const e = 1 - Math.pow(1 - viewAnim.t, 3);
    camera.position.lerpVectors(viewAnim.fromPos, viewAnim.toPos, e);
    controls.target.lerpVectors(viewAnim.fromTarget, viewAnim.toTarget, e);
    if (viewAnim.t >= 1) viewAnim = null;
  }

  if (!riding) {
    controls.update();
    // never let the orbit camera sink into a steep slope
    if (!viewAnim) {
      const g = hf.inside(camera.position.x, camera.position.z) ? hf.heightAt(camera.position.x, camera.position.z) : -Infinity;
      if (camera.position.y < g + 6) camera.position.y = g + 6;
    }
  }
  // the decor follows the snow: re-seat it a couple of times a second while the terrain changes
  if (terrain.version !== decorSeen && performance.now() - decorAt > 400) {
    decorSeen = terrain.version;
    decorAt = performance.now();
    decor.refresh();
  }
  // after hand sculpting, sit the structures and tracks back on the snow
  if (terrain.version !== seatSeen && !stroke && !build && !riding && performance.now() - decorAt > 300) {
    seatSeen = terrain.version;
    if (structs.count) {
      structs.seat();
      structMeshes.rebuild();
    }
    tracks.redrape();
  }
  updateSun();
  renderer.render(scene, camera);
  debug?.tick();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- keyboard ----------
const setAlt = (v) => {
  if (altHeld === v) return;
  altHeld = v;
  applyControlScheme();
};
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') setAlt(false);
  if (rideControls.key(e.code, false)) e.preventDefault();
});
window.addEventListener('blur', () => {
  setAlt(false);
  rideControls.reset();
});

const KIND_ORDER = Object.keys(BUILD_KINDS);

window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.key === 'Alt') {
    e.preventDefault();
    setAlt(true);
    return;
  }
  if (ui.blocking || editor.isOpen) return;
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (riding && !mod) {
    if (ui.resultsOpen) {
      if (key === 'r' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) sendSkier();
      } else if (e.key === 'Escape') exitRide(false);
      else if (key === 'c') toggleRideCam();
      else if (key === 'm') ui.toggleMute();
      return;
    }
    if (rideControls.key(e.code, true)) {
      e.preventDefault();
      return;
    }
    if (key === 'r') {
      if (!e.repeat) sendSkier(); // holding R must not restart over and over
    } else if (e.key === 'Escape') exitRide(true);
    else if (key === 'c') toggleRideCam();
    else if (key === 'm') ui.toggleMute();
    return;
  }
  if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return;
  if (mod && key === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && key === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) sendSkier();
    return;
  }
  const byKey = Object.entries(TOOLS).find(([, v]) => v.key === e.key);
  if ((byKey || key === 'b') && !state.advanced) setAdvanced(true);
  if (byKey) setTool(byKey[0]);
  else if (key === 'b') {
    // B again cycles what to build
    if (state.tool === 'build') {
      const next = KIND_ORDER[(KIND_ORDER.indexOf(state.buildKind) + 1) % KIND_ORDER.length];
      state.buildKind = next;
      ui.setKind(next);
      ui.toast(`Build: ${BUILD_KINDS[next].label}`);
    } else setTool('build');
  } else if (e.key === '5' || key === 'g') setTool('start');
  else if (key === 'v') setTool('view');
  else if (e.key === '[') ui.nudgeRadius(-2);
  else if (e.key === ']') ui.nudgeRadius(2);
  else if (key === 'c') ui.toggleContours();
  else if (key === 't') ui.toggleRelief();
  else if (key === 'p') openDesigner('edit');
  else if (key === 'a') ui.toggleAdvanced();
  else if (key === 'm') ui.toggleMute();
  else if (key === 'r') resetView();
});

// ---------- helpers ----------
// The chase cam starts right behind the gate: fade it out when the camera is close so
// the banner doesn't cover the screen at the start of every run.
function setGateFade(a) {
  decor.setGateFade(a);
}

function placeGate() {
  decor.setStart(state.start.x, state.start.z);
}

// Nothing on this page scrolls. iOS Safari still rubber-bands the page and ignores
// user-scalable=no, so block page panning/zooming everywhere except dialog text.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    const card = e.target.closest?.('.intro-card, .results-card, .runed-scroll, .runed-templates, .sheet-card');
    if (card && (card.scrollHeight > card.clientHeight || card.scrollWidth > card.clientWidth) && e.touches.length === 1) return;
    e.preventDefault();
  },
  { passive: false }
);

// read-only handle for debugging in the browser console
window.__highrise = {
  renderer,
  // false while the camera is still gliding to a new view (tests wait for it before aiming)
  get cameraSettled() {
    return !viewAnim;
  },
  decor,
  scene,
  get skier() {
    return skier;
  },
  get score() {
    return score;
  },
  camera,
  hf,
  props,
  structs,
  surf,
  tracks,
  editor,
  controls,
  get run() {
    return state.run;
  },
  get riding() {
    return riding;
  },
  snapCamera: () => (rig.snap = true),
};
