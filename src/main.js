import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { Heightfield, encodeHeights, decodeHeights } from './core/heightfield.js';
import { strokeTo, TOOLS } from './core/brushes.js';
import { History } from './core/history.js';
import { Skier } from './core/skier.js';
import { ScoreKeeper } from './core/score.js';
import { STAMPS, applyStamp, restoreRect } from './core/stamps.js';
import { buildFromProfile, addDelta, defaultProfile, profileStats } from './core/profile.js';
import { TerrainMesh } from './render/terrainMesh.js';
import { SkierMesh, Trail } from './render/skierMesh.js';
import { Spray } from './render/spray.js';
import { LinePreview } from './render/preview.js';
import { GhostRider, packPath } from './render/ghost.js';
import { Sound } from './audio.js';
import { RideControls } from './rideControls.js';
import { createUI } from './ui.js';
import { ProfileEditor } from './profileEditor.js';

// ---------- state ----------
const isBrush = (t) => t in TOOLS;
const COARSE = window.matchMedia('(pointer: coarse)').matches;
let altHeld = false; // Alt/Option held: left button orbits
const SAVE_KEY = 'highrise.ski.v3'; // v3: drawn run profile + sculpting stored as a delta
const INTRO_KEY = 'highrise.intro.v3';

const hf = new Heightfield();
const history = new History(25);
const state = {
  tool: 'raise',
  buildKind: 'kicker',
  radius: COARSE ? 28 : 22, // a 480 m wide mountain; fingers are less precise on phones
  strength: 0.5,
  start: null,
  profile: null, // the drawn run: elevations every 4 m
  rideCam: 'chase', // chase | helmet
  contours: true,
  relief: false,
  line: true,
  muted: false,
  best: null, // { score, time }
  bestPath: null, // packed path of the best run, for the ghost
};
let baseH = null; // the generated piste before any sculpting
const hadSave = loadSave();
if (!hadSave) {
  // nothing drawn yet: a plain slope sits behind the run designer
  state.profile = defaultProfile();
  state.start = buildFromProfile(hf, state.profile);
  baseH = hf.copy();
}

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
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

scene.add(new THREE.HemisphereLight('#cfe0ef', '#e7d8c6', 1.6));
const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
sun.position.set(-0.55, 0.75, 0.35).multiplyScalar(200);
scene.add(sun);

let terrain = null;
function rebuildTerrain() {
  if (terrain) {
    scene.remove(terrain.group);
    terrain.dispose();
  }
  terrain = new TerrainMesh(hf, { finishZ: hf.finishZ, start: state.start });
  terrain.setRelief(state.relief);
  terrain.uniforms.uContours.value = state.contours ? 1 : 0;
  scene.add(terrain.group);
}
rebuildTerrain();

const skierMesh = new SkierMesh();
skierMesh.addTo(scene);
skierMesh.visible = false;
const ghostRider = new GhostRider(hf);
ghostRider.addTo(scene);

const trail = new Trail({ color: '#ff5a1f' });
scene.add(trail.line);
const spray = new Spray();
scene.add(spray.points);
const linePreview = new LinePreview(hf);
scene.add(linePreview.group);

const sound = new Sound();
sound.muted = state.muted;

// start gate: two little poles with a banner
const gate = makeGate();
scene.add(gate);
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
  stamps: STAMPS,
  initial: state,
  onTool: setTool,
  onKind: (k) => {
    state.buildKind = k;
    ui.setKind(k);
    if (state.tool !== 'build') setTool('build');
    ui.toast(STAMPS[k].hint);
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
  onRelief: (on) => {
    state.relief = on;
    terrain.setRelief(on);
    scheduleSave();
  },
  onLine: (on) => {
    state.line = on;
    if (on) schedulePreview(0);
    else ui.setPreview(null);
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
    // first visit: go straight on to drawing a run
    if (!hadSave && !pickedOnce) {
      pickedOnce = true;
      openDesigner('first');
    }
  },
});
let pickedOnce = false;
let seenIntro = false;
try {
  seenIntro = localStorage.getItem(INTRO_KEY) === '1';
} catch {
  /* ignore */
}
if (!hadSave) document.getElementById('intro-go').textContent = 'Draw my run';
if (!seenIntro) ui.openIntro();
else if (!hadSave) setTimeout(() => openDesigner('first'), 0);
ui.setBest(state.best);
ui.setKind(state.buildKind);
setTool(state.tool);
refreshHistoryButtons();

const rideControls = new RideControls({ onPress: () => sound.unlock() });

// ---------- sculpting input ----------
const pointers = new Map();
const hover = { valid: false, x: 0, y: 0, z: 0 };
let stroke = null; // brush stroke in progress
let build = null; // Build drag in progress: { pointerId, ax, az, base, rect }
const baseField = new Heightfield(); // shares nothing: its .h points at the build snapshot
let saveTimer = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// browsers only start audio from a gesture
document.addEventListener('pointerdown', () => sound.unlock());

canvas.addEventListener('pointerdown', (e) => {
  // a fresh first finger means any touch we still track is stale (a lost pointerup
  // would otherwise make every new touch look like a second finger and block sculpting)
  if (e.pointerType === 'touch' && e.isPrimary) pointers.clear();
  if (riding) return;
  pointers.set(e.pointerId, e);
  updateHover(e);

  // a second finger turns the gesture into camera control: cancel the edit
  if (pointers.size > 1) {
    if (stroke) cancelStroke();
    if (build) cancelBuild();
    return;
  }
  if (e.button !== 0 || altHeld || e.altKey) return;

  if (state.tool === 'start' && hover.valid) {
    if (hover.z < hf.finishZ - 60) {
      state.start = { x: hover.x, z: hover.z };
      terrain.setStart(hover.x, hover.z);
      placeGate();
      scheduleSave();
      schedulePreview(0);
      ui.toast('Start gate moved');
    } else {
      ui.toast('Put the start higher up the slope');
    }
    return;
  }

  if (state.tool === 'build' && hover.valid) {
    const base = hf.copy();
    history.push(base);
    baseField.h = base;
    build = { pointerId: e.pointerId, ax: hover.x, az: hover.z, bx: hover.x, bz: hover.z, base, rect: null, moved: false };
    applyBuild();
    canvas.setPointerCapture(e.pointerId);
    refreshHistoryButtons();
    return;
  }

  if (isBrush(state.tool) && hover.valid) {
    history.push(hf.copy());
    stroke = { pointerId: e.pointerId, targetHeight: hover.y, last: null, carry: 0 };
    canvas.setPointerCapture(e.pointerId);
    refreshHistoryButtons();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
  if (e.pointerType === 'mouse' || pointers.size === 1) {
    // while building, aim at the ground as it was, not at the feature being drawn
    updateHover(e, build ? baseField : hf);
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
  if (stroke && stroke.pointerId === e.pointerId) {
    stroke = null;
    scheduleSave();
    schedulePreview(0);
  }
  if (build && build.pointerId === e.pointerId) {
    if (build.dirty) applyBuild();
    build = null;
    sound.stamp();
    scheduleSave();
    schedulePreview(0);
  }
  if (e.pointerType !== 'mouse') hover.valid = false;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', (e) => {
  const mine = (stroke && stroke.pointerId === e.pointerId) || (build && build.pointerId === e.pointerId);
  if (mine && !pointers.has(e.pointerId)) endPointer(e);
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !stroke && !build) hover.valid = false;
});

function cancelStroke() {
  const snap = history.discardLast();
  if (snap) {
    hf.set(snap);
    terrain.updateAll();
  }
  stroke = null;
  refreshHistoryButtons();
}

function cancelBuild() {
  restoreRect(hf, build.base, build.rect);
  terrain.update(build.rect);
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
  if (r) terrain.update(r);
  placeGate();
  schedulePreview(300);
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

// ---------- line preview ----------
let previewDue = 0; // timestamp when the next preview should run (0 = none pending)
function schedulePreview(delay = 120) {
  if (!state.line) return;
  const due = performance.now() + delay;
  previewDue = previewDue ? Math.min(previewDue, due) : due;
}

// ---------- history / save ----------
function undo() {
  if (stroke || build) return;
  const prev = history.undo(hf.copy());
  if (!prev) return;
  hf.set(prev);
  terrain.updateAll();
  placeGate();
  refreshHistoryButtons();
  scheduleSave();
  schedulePreview(0);
}

function redo() {
  if (stroke || build) return;
  const next = history.redo(hf.copy());
  if (!next) return;
  hf.set(next);
  terrain.updateAll();
  placeGate();
  refreshHistoryButtons();
  scheduleSave();
  schedulePreview(0);
}

// ---------- run designer ----------
let designerMode = null;
function openDesigner(mode) {
  if (riding) exitRide(true);
  if (stroke || build) return;
  designerMode = mode;
  hover.valid = false;
  editor.open(mode === 'edit' ? state.profile : null, { canCancel: mode !== 'first' });
}

/**
 * Generate the piste for a drawn profile. keepSculpt carries the player's sculpting over
 * (it moves with the run: same distance from the start, same offset across).
 */
function applyProfile(e, keepSculpt) {
  if (riding) exitRide(true);
  const delta = keepSculpt && baseH ? hf.h.map((v, i) => v - baseH[i]) : null;
  const oldDims = { sizeX: hf.sizeX, sizeZ: hf.sizeZ, cell: hf.cell };
  // keep a moved start gate at the same distance down the run
  const startU = state.start ? state.start.z - hf.startZ : 0;
  const startX = state.start ? state.start.x : 0;
  state.profile = e;
  buildFromProfile(hf, e);
  baseH = hf.copy();
  if (delta) addDelta(hf, delta, oldDims);
  const st = profileStats(e);
  state.start = keepSculpt && startU < st.length - 60 ? { x: startX, z: hf.startZ + startU } : { x: 0, z: hf.startZ };
  state.best = null;
  state.bestPath = null;
  history.clear();
  rebuildTerrain();
  linePreview.invalidate();
  placeGate();
  skier = null;
  skierMesh.visible = false;
  trail.clear();
  ui.setBest(null);
  ui.setStatus('idle');
  ui.clearStats();
  ui.setPreview(null);
  refreshHistoryButtons();
  scheduleSave();
  schedulePreview(0);
  computeHome();
  camera.position.copy(HOME_CAM);
  controls.target.copy(HOME_TARGET);
  viewAnim = null;
  const km = st.length >= 1000 ? `${(st.length / 1000).toFixed(2)} km` : `${Math.round(st.length)} m`;
  ui.toast(`${km} run built, ${Math.round(st.drop)} m of drop.${delta ? ' Your sculpting moved with it.' : ''}`);
}

const editor = new ProfileEditor({
  onBuild: (e) => {
    editor.close();
    applyProfile(e, designerMode === 'edit');
    designerMode = null;
  },
  onCancel: () => {
    editor.close();
    designerMode = null;
  },
});

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
          profile: state.profile.map((v) => Math.round(v * 10) / 10),
          sculpt: encodeHeights(hf.h.map((v, i) => v - baseH[i])),
          start: state.start,
          best: state.best,
          bestPath: state.bestPath,
          rideCam: state.rideCam,
          relief: state.relief,
          line: state.line,
          muted: state.muted,
          buildKind: state.buildKind,
        })
      );
    } catch {
      /* storage unavailable: fine, the session still works */
    }
  }, 400);
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.profile) || data.profile.length < 2 || !data.start) return false;
    buildFromProfile(hf, data.profile);
    const delta = data.sculpt && decodeHeights(data.sculpt, hf.nx * hf.nz);
    if (!delta) return false;
    baseH = hf.copy();
    for (let i = 0; i < delta.length; i++) hf.h[i] += delta[i];
    state.profile = data.profile;
    state.start = data.start;
    state.relief = !!data.relief;
    state.line = data.line !== false;
    state.muted = !!data.muted;
    if (data.buildKind in STAMPS) state.buildKind = data.buildKind;
    // best runs are scored on style now (older saves stored a time)
    if (data.best && typeof data.best.score === 'number') {
      state.best = data.best;
      state.bestPath = Array.isArray(data.bestPath) ? data.bestPath : null;
    }
    if (data.rideCam === 'helmet' || data.rideCam === 'chase') state.rideCam = data.rideCam;
    return true;
  } catch {
    return false;
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
  skier = new Skier(hf, state.start);
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
  linePreview.visible = false;
  ui.setPreview(null);
  rideControls.reset();
  ui.setRiding(true);
  ui.setRideCam(state.rideCam);
  skierMesh.setFirstPerson(state.rideCam === 'helmet');
}

function exitRide(abort) {
  if (!riding) return;
  if (abort && skier && skier.status === 'running') {
    skier.status = 'aborted';
    lastStatus = 'aborted';
    ui.setStatus('idle');
  }
  riding = false;
  rideControls.reset();
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
  if (state.line) {
    linePreview.visible = true;
    if (linePreview.stats) ui.setPreview(linePreview.stats);
  }
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
function updateRideCamera(dt) {
  const [x, y, z] = skier.pos;
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
  if (state.rideCam === 'helmet') {
    _want.copy(_p).addScaledVector(_flat, 0.4);
    _want.y += 3.2;
    _look.copy(_want).addScaledVector(_flat, 24);
    _look.y -= 3;
    posRate = 30;
    lookRate = 12;
    camera.fov = 72 + 22 * kick;
  } else {
    const portrait = camera.aspect < 1;
    const back = (portrait ? 10 : 7.5) + 2.5 * kick + 5 * rig.air;
    _want.copy(_p).addScaledVector(_flat, -back);
    _want.y += (portrait ? 4.2 : 3.2) + 2.5 * rig.air;
    _look.copy(_p).addScaledVector(_flat, 10 - 4 * rig.air);
    _look.y += 1;
    posRate = 7;
    lookRate = 10;
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
  if (state.rideCam === 'chase') {
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
  } else if (ev.type === 'wipeout') {
    sound.wipeout();
    spray.burst(skier, 2);
    rig.shake = Math.max(rig.shake, 1.2);
  }
}

function onRunEnd(s) {
  score.finish(s);
  drainFeed();
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

// ---------- loop ----------
const clock = new THREE.Clock();

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
      hover.y = hf.heightAt(hover.x, hover.z);
      if (Math.hypot(hover.x - state.start.x, hover.z - state.start.z) < state.radius + 4) placeGate();
      schedulePreview(300);
    }
  }
  if (!riding && build && build.dirty) applyBuild();

  // live line preview
  if (!riding && state.line && previewDue && performance.now() >= previewDue) {
    previewDue = 0;
    linePreview.visible = true;
    linePreview.request(state.start, (stats) => {
      if (!riding && state.line) ui.setPreview(stats);
    });
  }
  if (!state.line) linePreview.visible = false;

  terrain.refreshLocalMean();
  const showRing = !riding && hover.valid && (isBrush(state.tool) || (state.tool === 'build' && !build));
  const ringR = state.tool === 'build' ? Math.max(3, Math.min(state.radius, 90) / 2) : state.radius;
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
    ui.setRush(riding && skier.status === 'running' ? (skier.speed - 16) / 22 : 0);
    ghostRider.update(skier.time, dt, riding && skier.status === 'running');
    if (riding) updateRideCamera(dt);
  }

  spray.update(dt);
  const sculpting = !riding && (stroke || (build && build.moved)) ? 0.6 + 0.4 * state.strength : 0;
  sound.update({ skier: riding ? skier : null, sculpt: sculpting });

  if (viewAnim) {
    viewAnim.t = Math.min(1, viewAnim.t + dt * 1.6);
    const e = 1 - Math.pow(1 - viewAnim.t, 3);
    camera.position.lerpVectors(viewAnim.fromPos, viewAnim.toPos, e);
    controls.target.lerpVectors(viewAnim.fromTarget, viewAnim.toTarget, e);
    if (viewAnim.t >= 1) viewAnim = null;
  }

  if (!riding) controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
schedulePreview(400);

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

const KIND_ORDER = Object.keys(STAMPS);

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
    if (key === 'r') sendSkier();
    else if (e.key === 'Escape') exitRide(true);
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
  if (byKey) setTool(byKey[0]);
  else if (key === 'b') {
    // B again cycles what to build
    if (state.tool === 'build') {
      const next = KIND_ORDER[(KIND_ORDER.indexOf(state.buildKind) + 1) % KIND_ORDER.length];
      state.buildKind = next;
      ui.setKind(next);
      ui.toast(`Build: ${STAMPS[next].label}`);
    } else setTool('build');
  } else if (e.key === '5' || key === 'g') setTool('start');
  else if (key === 'v') setTool('view');
  else if (e.key === '[') ui.nudgeRadius(-2);
  else if (e.key === ']') ui.nudgeRadius(2);
  else if (key === 'c') ui.toggleContours();
  else if (key === 't') ui.toggleRelief();
  else if (key === 'l') ui.toggleLine();
  else if (key === 'p') openDesigner('edit');
  else if (key === 'm') ui.toggleMute();
  else if (key === 'r') resetView();
});

// ---------- helpers ----------
function makeGate() {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: '#1d2733' });
  const bannerMat = new THREE.MeshLambertMaterial({ color: '#2f6fd6', side: THREE.DoubleSide });
  for (const sx of [-4, 4]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), poleMat);
    pole.position.set(sx, 3, 0);
    g.add(pole);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), bannerMat);
  banner.position.set(0, 5.3, 0);
  g.add(banner);
  return g;
}

function placeGate() {
  const { x, z } = state.start;
  gate.position.set(x, hf.heightAt(x, z), z);
}

// Nothing on this page scrolls. iOS Safari still rubber-bands the page and ignores
// user-scalable=no, so block page panning/zooming everywhere except dialog text.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    const card = e.target.closest?.('.intro-card, .results-card');
    if (card && card.scrollHeight > card.clientHeight && e.touches.length === 1) return;
    e.preventDefault();
  },
  { passive: false }
);

// read-only handle for debugging in the browser console
window.__highrise = {
  get skier() {
    return skier;
  },
  get score() {
    return score;
  },
  camera,
  hf,
};
