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
import { Heightfield } from './core/heightfield.js';
import { History } from './core/history.js';
import { Skier, PHYS } from './core/skier.js';
import { ScoreKeeper, SPEED_BONUS_KMH, speedRate } from './core/score.js';
import { PropSet, TREE, propHeight } from './core/props.js';
import { SurfaceMap } from './core/surface.js';
import { buildSlope, templateDesign, normalizeDesign, designFromWild, designStats, widthOf, cloneDesign } from './core/slopes.js';
import { hexCols } from './core/hex.js';
import { buildWorld, fallLine, defaultStart } from './core/world.js';
import { HEX_R, gridCols, gridRows, tileOf, tileCenter, brushTiles, lineTiles, squaresToHexes } from './core/terrain.js';
import { applyAction, describe, copyTiles, rotateCopy, pasteCells, pasteTiles, trimTiles, packTiles, unpackTiles, unpackPieces, fromPieces, tileKey } from './core/tiles.js';
import { PropMeshes } from './render/propMeshes.js';
import { Tracks } from './render/tracks.js';
import { Decor } from './render/decor.js';
import { TerrainMesh } from './render/terrainMesh.js';
import { SkierMesh, Trail } from './render/skierMesh.js';
import { Spray } from './render/spray.js';
import { GhostRider, packPath } from './render/ghost.js';
import { Sound } from './audio.js';
import { t as tx, num, applyDom, onLang } from './i18n.js';
import { createTutorial } from './tutorial.js';
import { CourseRun, courseKey } from './core/course.js';
import { GateMeshes } from './render/gates.js';
import { RideControls } from './rideControls.js';
import { createUI } from './ui.js';
import { createBuildBar } from './buildBar.js';
import { createSlopeEditor, fmtLen } from './slopeEditor.js';
import { CATEGORY_COLORS } from './pieceIcons.js';
import { THEME, SUN_DIR } from './render/theme.js';
import { createDebugOverlay } from './debugOverlay.js';

// ---------- state ----------
const COARSE = window.matchMedia('(pointer: coarse)').matches;
let altHeld = false; // Alt/Option held: left button orbits
const SAVE_KEY = 'highrise.ski.v3'; // v11: the slope you designed, the tiles and their actions (gates too), the start gate, the records
const INTRO_KEY = 'highrise.intro.v8'; // v8: gates
const TRACKS_KEY = 'highrise.tracks.v1';
const BACKUP_KEY = 'highrise.ski.backup';
let loadNote = null; // told to the player once the UI is up
// the tutorial: its levels replace your slope for a while, nothing is saved meanwhile
let tutOn = false;
let tutSaved = null; // your slope, put back when you leave it
let goalTiles = []; // the tutorial step's goal tiles, marked on the snow
const WILD_WIDTH = { small: 600, medium: 720, large: 840 }; // how wide the old wild mountains were
let saveFailed = false;

const hf = new Heightfield();
const props = new PropSet(hf); // trees and rocks
const surf = new SurfaceMap(hf); // groomed / powder / ice / rock
const history = new History(40);
const state = {
  tool: 'select', // view | select | start | paste
  brush: 2, // selection brush: 1 tile, 7 (with its neighbours) or 19 (see brushTiles)
  design: null, // the slope: { width, sections: [{ slope, length }] } (see core/slopes.js)
  tiles: [], // the tiles you changed, with what's on them (see core/tiles.js)
  start: null, // the start gate: { x, z }
  rideCam: 'chase', // chase | helmet
  contours: false,
  relief: false,
  muted: false,
  best: null, // the best score of a valid run: { score, time }
  bestPath: null, // packed path of the best-score run, for the ghost
  bestTime: null, // the fastest valid run: { time, score, splits: [time at each gate] }
  bestTimePath: null, // its path: the ghost when there are gates to race through
  course: '', // the course the records were set on (courseKey of its gates)
};
let gates = []; // the course: the gates on the tiles (core/course.js)
let booted = false; // the UI is up (a course change can say so)
let base = null; // the bare slope before any tile
// the selected tiles (keys "i,j"; not saved, not undone) and the copied ones
const selection = new Set();
let clip = null;
const selList = () => [...selection].map((k) => k.split(',').map(Number));
// the run: the skier, his score, whether he's waiting while you build, the ride camera on
let skier = null;
let score = null;
let paused = false;
let riding = false;
let lastStatus = null;
let lastEventCount = 0;
let lastFeedCount = 0;
let viewAnim = null; // the edit camera gliding to a new view

function makeSlope(design) {
  base = buildSlope(hf, surf, design);
  state.design = base.design;
}

// Build the tiles on the base (the whole mountain, a few milliseconds)
function generate(tiles = state.tiles) {
  const w = buildWorld(hf, surf, base, { tiles, start: state.start });
  props.set(w.props);
  gates = w.gates;
  const key = courseKey(gates);
  if (key !== state.course) {
    // another course (gates added, moved or taken away): its records start again
    const had = state.best || state.bestTime;
    state.course = key;
    state.best = null;
    state.bestPath = null;
    state.bestTime = null;
    state.bestTimePath = null;
    if (had && booted) {
      ui.setBest(null, null);
      ui.toast(tx('toast.courseChanged'));
    }
  }
}
// the ghost to race: the fastest run when there are gates, else the best score
const ghostPath = () => (courseTotal() && state.bestTimePath ? state.bestTimePath : state.bestPath);
const courseTotal = () => gates.filter((g) => !g.behind).length;

const cols = () => gridCols(hf);
const rows = () => gridRows(hf);
// the start gate: on the mountain, not right at the bottom
function clampStart(p) {
  return {
    x: Math.max(-hf.halfX + 10, Math.min(hf.halfX - 10, p.x)),
    z: Math.max(hf.startZ - 12, Math.min(hf.finishZ - 40, p.z)),
  };
}
const startOf = () => ({ ...state.start, dir: fallLine(hf, state.start.x, state.start.z) });

const hadSave = loadSave();
if (!hadSave) {
  // first visit: a slope sits behind the welcome card (you design your own next)
  makeSlope(templateDesign());
  state.start = defaultStart(hf, base);
  generate();
}

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (err) {
  // three.js needs WebGL 2: say so instead of leaving the UI over a blank canvas
  showFatal(tx('toast.noWebgl'));
  throw err;
}
// the GPU can drop the context (driver reset, phone under memory pressure); three.js
// restores it by itself, the player just needs to know why the screen flickered
canvas.addEventListener('webglcontextlost', () => window.__highriseToast?.(tx('toast.gfxLost'), 'bad'));
canvas.addEventListener('webglcontextrestored', () => window.__highriseToast?.(tx('toast.gfxBack')));

function showFatal(msg) {
  const el = document.createElement('div');
  el.className = 'fatal panel';
  el.setAttribute('role', 'alert');
  el.textContent = msg;
  document.body.append(el);
}
// phones: cap resolution a little to keep editing smooth
renderer.setPixelRatio(Math.min(window.devicePixelRatio, COARSE ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 1, 40000);
const HOME_CAM = new THREE.Vector3();
const HOME_TARGET = new THREE.Vector3();
// Frame the whole mountain like a drone would: 3/4 from the side on wide screens, from
// below looking up the fall line on phones
function computeHome() {
  const aspect = Math.max(0.3, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  const portrait = aspect < 1;
  camera.fov = portrait ? 58 : 40;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const zs = hf.startZ;
  const zf = hf.finishZ;
  const ys = hf.heightAt(0, zs);
  const yf = hf.heightAt(0, zf);
  const span = Math.hypot(zf - zs, ys - yf);
  HOME_TARGET.set(0, (ys + yf) / 2, (zs + zf) / 2);
  if (portrait) {
    HOME_CAM.copy(HOME_TARGET).addScaledVector(new THREE.Vector3(0.08, 0.7, 0.71).normalize(), Math.max(700, span * 1.1));
  } else {
    const hTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    const d = THREE.MathUtils.clamp((span * 0.6) / hTan, 650, 12000);
    HOME_CAM.copy(HOME_TARGET).addScaledVector(new THREE.Vector3(-0.66, 0.7, 0.27).normalize(), d);
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
  const half = riding_ ? 80 : THREE.MathUtils.clamp(dist * 0.7, 40, 1400);
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

// ---------- input state ----------
const pointers = new Map();
const hover = { valid: false, x: 0, y: 0, z: 0 };
let paint = null; // a selection stroke: { pointerId, mode: add | remove, tile }; or placing a paste: { pointerId, paste: true, tile }
let moving = null; // dragging the start gate: { pointerId, snap }
let aimField = null; // the snow as it was when a drag began (aim at it, not at the preview)
let shownH = null; // the heights the terrain mesh shows (to upload only what changed)
let saveTimer = 0;

// ---------- the build grid on the snow ----------
let ghost = []; // tiles under the brush, or where a paste would land

// One texel per tile. G: changed; A: what changed most (1 shape, 2 nature, 3 a feature)
// plus, for a jump or drop, the way it faces (in 7.5° steps, +1, times 4); B: selected;
// R: the ghost (255) and the tutorial's goal tiles (96; 224 with the ghost on them)
function writeTiles() {
  const d = terrain?.tileData;
  if (!d) return;
  const nc = terrain.tileCols;
  const nr = terrain.tileRows;
  d.fill(0);
  const inside = (i, j) => i >= 0 && j >= 0 && i < nc && j < nr;
  for (const t of state.tiles) {
    if (!inside(t.i, t.j)) continue;
    const o = (t.j * nc + t.i) * 4;
    const cat = t.feat || t.gate ? 3 : t.lift || t.pitch || t.flat || t.smooth ? 1 : 2;
    const turn = t.feat === 'jump' || t.feat === 'drop' ? (Math.round(t.dir / 7.5) % 48) + 1 : 0;
    d[o + 1] = 255;
    d[o + 3] = cat + 4 * turn;
  }
  for (const k of selection) {
    const [i, j] = k.split(',').map(Number);
    if (inside(i, j)) d[(j * nc + i) * 4 + 2] = 255;
  }
  for (const [i, j] of goalTiles) if (inside(i, j)) d[(j * nc + i) * 4] = 96;
  for (const [i, j] of ghost) if (inside(i, j)) d[(j * nc + i) * 4] = d[(j * nc + i) * 4] === 96 ? 224 : 255;
  terrain.updateTiles();
}

function setGhost(tiles = []) {
  ghost = tiles;
  writeTiles();
}

const propMeshes = new PropMeshes(props);
scene.add(propMeshes.group);
const gateMeshes = new GateMeshes(hf);
scene.add(gateMeshes.group);
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

let terrain = null;
function rebuildTerrain() {
  if (terrain) {
    scene.remove(terrain.group);
    terrain.dispose();
  }
  terrain = new TerrainMesh(hf, { start: state.start, surface: surf });
  terrain.setRelief(state.relief);
  // the terrain shading its own hollows is costly on phones: there only props and the rider cast
  terrain.top.castShadow = !COARSE;
  terrain.uniforms.uContours.value = state.contours ? 1 : 0;
  terrain.setTileGrid(cols(), rows(), -hf.halfX, HEX_R);
  terrain.uniforms.uCatCol.value[1].set(CATEGORY_COLORS.shape);
  terrain.uniforms.uCatCol.value[2].set(CATEGORY_COLORS.nature);
  terrain.uniforms.uCatCol.value[3].set(CATEGORY_COLORS.features);
  terrain.uniforms.uGhost.value.set(CATEGORY_COLORS.select);
  terrain.uniforms.uTileOn.value = gridShown() ? 1 : 0;
  scene.add(terrain.group);
  // trees, rocks and the skier fade into the same haze as the snow
  scene.fog = new THREE.Fog(THEME.haze, terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  propMeshes.setFog(terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  decor.setFog(terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  tracks.setFog(terrain.uniforms.uFogNear.value, terrain.uniforms.uFogFar.value);
  shownH = null;
  decorSeen = -1;
  showEnds();
  writeTiles();
}

// the start ring on the snow (only while building), the gate, the finish across the bottom
function showEnds() {
  const s = startOf();
  terrain.setStart(riding ? 1e6 : s.x, riding ? 1e6 : s.z);
  terrain.setFinishes([{ x: 0, z: hf.finishZ, dir: [0, 1], w: hf.sizeX - 4 }]);
  const fx = Math.max(-hf.halfX + 50, Math.min(hf.halfX - 50, s.x));
  decor.setEnds(s, { x: fx, z: hf.finishZ, dir: [0, 1] });
}

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

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 8;
controls.maxDistance = 14000;
controls.zoomToCursor = true; // scroll / pinch zooms towards what you point at
controls.screenSpacePanning = false; // panning slides along the ground, up and down the mountain
controls.update();

rebuildTerrain();
propMeshes.rebuild();

// ---------- UI ----------
const ui = createUI({
  speedBonusKmh: SPEED_BONUS_KMH,
  speedRate,
  initial: state,
  onSend: ride,
  onRestart: () => startRun(),
  onUndo: undo,
  onRedo: redo,
  onResetView: resetView,
  onRideExit: () => pauseRide(),
  onRideCam: () => toggleRideCam(),
  onEditSlope: () => editSlope(),
  onTutorial: () => startTutorial(),
  onFreshSnow: () => {
    if (tracks.freshSnow()) {
      ui.toast(tx('toast.freshSnow'));
      // (the tutorial's tracks are on its own slopes: yours stay saved)
      if (!tutOn) try {
        localStorage.removeItem(TRACKS_KEY);
      } catch {
        /* ignore */
      }
    } else ui.toast(tx('toast.noTracks'));
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
    scheduleSave();
  },
  onIntroClosed: () => {
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* ignore */
    }
    // first visit: design your slope
    if (!hadSave && !pickedOnce && !tutOn) {
      pickedOnce = true;
      slopeEd.open(null, { cancel: false });
    }
  },
});
window.__highriseToast = (msg, kind) => ui.toast(msg, kind);
booted = true;

const bar = createBuildBar({
  onTool: (t) => {
    setTool(t);
    if (t === 'start') ui.toast(tx('toast.startTool'));
    if (t === 'select' && !selection.size) ui.toast(tx(COARSE ? 'toast.selectTool.touch' : 'toast.selectTool.desktop'));
  },
  onAction: (a) => act(a),
  onDeselect: () => clearSelection(),
  onSize: (n) => {
    state.brush = n;
    scheduleSave();
  },
});
bar.setSize(state.brush);

let pickedOnce = false;
let seenIntro = false;
try {
  seenIntro = localStorage.getItem(INTRO_KEY) === '1';
} catch {
  /* ignore */
}

const rideControls = new RideControls({ onPress: () => sound.unlock() });

// Undo snapshots: the tiles and the start gate (the snow is rebuilt from them)
const snapshot = () => ({ tiles: state.tiles, start: { ...state.start } });
function restore(snap) {
  state.tiles = snap.tiles;
  state.start = { ...snap.start };
  generate();
  refreshScene();
}

// the gates on screen and in the HUD: how many there are, and during a run (or while it
// waits) which you've been through and which you missed
let gateShown = '';
function showGates() {
  // the run on the course as it is (one that finished stays on show until you change it)
  const run = skier && skier.course && courseKey(skier.course.gates) === state.course ? skier.course : null;
  const total = run ? run.total : courseTotal();
  const sig = run ? `${run.passed.join()}|${run.missed.join()}` : `-${total}`;
  if (sig === gateShown) return;
  gateShown = sig;
  const missed = !!run && run.missed.some((m, k) => m && !run.passed[k]);
  ui.setGates(total ? { count: run ? run.count : 0, total, missed, running: !!run } : null);
  gateMeshes.show(run ? run.gates.map((g, k) => (run.passed[k] ? 'passed' : run.missed[k] ? 'missed' : null)) : null);
}

// what's on screen follows the model: the snow (only the cells that changed), the snow
// texture, trees, start and finish
function refreshScene({ redrape = true } = {}) {
  const rect = changedRect();
  if (rect) terrain.update(rect);
  terrain.refreshSurface();
  propMeshes.rebuild();
  gateMeshes.set(gates);
  gateShown = '';
  showGates();
  showEnds();
  if (redrape && rect) tracks.redrape();
  writeTiles();
  refreshBar();
  // a paused run: the skier stays on the (new) snow
  if (paused && skier) {
    skier.resume();
    skierMesh.sync(skier, hf, 0);
  }
}

function changedRect() {
  const h = hf.h;
  if (!shownH || shownH.length !== h.length) {
    shownH = h.slice();
    return { i0: 0, i1: hf.nx - 1, j0: 0, j1: hf.nz - 1 };
  }
  let i0 = hf.nx;
  let i1 = -1;
  let j0 = hf.nz;
  let j1 = -1;
  for (let j = 0; j < hf.nz; j++) {
    const row = j * hf.nx;
    for (let i = 0; i < hf.nx; i++) {
      if (h[row + i] !== shownH[row + i]) {
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
      }
    }
  }
  if (i1 < 0) return null;
  shownH.set(h);
  return { i0, i1, j0, j1 };
}

function rebuild() {
  generate();
  refreshScene();
  refreshHistoryButtons();
  scheduleSave();
}

// ---------- the slope ----------
const slopeEd = createSlopeEditor({ onBuild: (d, o) => newWorld(d, o) });
function editSlope() {
  if (tutOn) return ui.toast(tx('tut.noEdit'));
  if (riding) pauseRide();
  ui.closeMenu();
  slopeEd.open(state.design, { cancel: true, tiles: state.tiles.length });
}

// Build a (new) slope. keep: what you built stays where it was (tiles are counted from the
// top line, and stay centred if the width changes), and so does the start gate.
function newWorld(design, { keep = false, changed = true, quiet = false } = {}) {
  if (keep && !changed) return;
  if (riding) exitRide();
  endRun();
  const oldCols = cols();
  const oldStart = state.start;
  makeSlope(design);
  selection.clear();
  if (keep) {
    const di = Math.round((cols() - oldCols) / 2);
    state.tiles = trimTiles(
      state.tiles.map((t) => ({ ...t, i: t.i + di })),
      cols(),
      rows()
    );
    state.start = oldStart ? clampStart(oldStart) : defaultStart(hf, base);
  } else {
    state.tiles = [];
    state.start = defaultStart(hf, base);
  }
  generate();
  // a different slope: a different run (the old best and its ghost don't fit any more)
  state.best = null;
  state.bestPath = null;
  state.bestTime = null;
  state.bestTimePath = null;
  history.clear();
  rebuildTerrain();
  propMeshes.rebuild();
  tracks.clear();
  saveTracks();
  trail.clear();
  ui.setBest(null, null);
  ui.setStatus('idle');
  ui.clearStats();
  refreshHistoryButtons();
  refreshScene();
  scheduleSave();
  computeHome();
  frameTop();
  viewAnim = null;
  setTool('select');
  const st = designStats(state.design);
  if (!quiet) ui.toast(`${tx('toast.built', { len: fmtLen(st.length), drop: Math.round(st.drop), w: widthOf(state.design) })} ${tx(keep ? 'toast.builtKeep' : 'toast.builtNew')}`);
}

// Put a whole world in place at once: a slope, its tiles and the start gate (the tutorial,
// tests). start: { x, u } (u metres below the top line) or null for the default; tiles can
// be a function of the new slope's grid, tiles(hf).
function applyWorld({ design, tiles = [], start = null }) {
  newWorld(design, { quiet: true });
  state.tiles = trimTiles(typeof tiles === 'function' ? tiles(hf) : tiles, cols(), rows());
  if (start) state.start = clampStart({ x: start.x, z: hf.startZ + start.u });
  generate();
  refreshScene();
  scheduleSave();
}

// ---------- the tutorial ----------
// Its levels take the place of your slope (and your tiles, start, best run and tracks) until
// you leave it; nothing is saved meanwhile, so a reload is back on your own slope too.
const tutorial = createTutorial({
  hf,
  bar,
  game: () => ({ tiles: state.tiles, sel: selection, clip, start: state.start }),
  enter() {
    if (riding) exitRide();
    endRun();
    ui.hideResults();
    tutSaved = {
      design: cloneDesign(state.design),
      tiles: state.tiles,
      start: { x: state.start.x, u: state.start.z - hf.startZ },
      best: state.best,
      bestPath: state.bestPath,
      bestTime: state.bestTime,
      bestTimePath: state.bestTimePath,
      brush: state.brush,
    };
    tutOn = true;
    document.body.classList.add('tutorial');
  },
  leave() {
    const s = tutSaved;
    tutSaved = null;
    goalTiles = [];
    clip = null;
    if (s) {
      applyWorld(s);
      state.best = s.best;
      state.bestPath = s.bestPath;
      state.bestTime = s.bestTime;
      state.bestTimePath = s.bestTimePath;
      ui.setBest(state.best, state.bestTime);
      state.brush = s.brush;
      bar.setSize(s.brush);
      tracks.clear();
      try {
        const saved = localStorage.getItem(TRACKS_KEY);
        if (saved) tracks.unpack(saved);
      } catch {
        /* no tracks */
      }
    }
    tutOn = false;
    document.body.classList.remove('tutorial');
    writeTiles();
    // first visit, straight into the tutorial: now design your own slope
    if (!hadSave && !pickedOnce) {
      pickedOnce = true;
      slopeEd.open(null, { cancel: false });
    }
  },
  load(level) {
    clip = null;
    goalTiles = [];
    applyWorld({ design: level.design, tiles: level.tiles || [], start: level.start });
    refreshBar();
  },
  frame: (x, u) => frameAt(x, u),
  focus: (x, u) => focusAt(x, u),
  setGoal(g) {
    goalTiles = g;
    writeTiles();
  },
  setRidePulse: (on) => document.getElementById('send').classList.toggle('tut-pulse', on),
  toast: (m) => ui.toast(m),
  cheer: () => sound.finish(),
  ownSlope: () => hadSave || pickedOnce,
});

function startTutorial() {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* ignore */
  }
  ui.closeMenu();
  tutorial.start();
}

// A close look at (x, u) from up the slope: a level's goal tiles, big enough to tap (on a
// phone a little low on the screen, below the tutorial's card)
function viewOf(x, u) {
  const portrait = camera.aspect < 1;
  const z = hf.startZ + u + (portrait ? 22 : 0);
  // on a wide screen, a little to the side so the card (top left) doesn't hide the goals
  const tx0 = x + (camera.aspect > 1.3 ? 28 : 0);
  const target = new THREE.Vector3(tx0, hf.heightAt(tx0, z), z);
  const pos = target.clone().add(portrait ? new THREE.Vector3(0, 120, -100) : new THREE.Vector3(-55, 85, -115));
  const g = hf.inside(pos.x, pos.z) ? hf.heightAt(pos.x, pos.z) : hf.heightAt(pos.x, hf.startZ);
  pos.y = Math.max(pos.y, g + 50);
  return { pos, target };
}
function frameAt(x, u) {
  const v = viewOf(x, u);
  camera.position.copy(v.pos);
  controls.target.copy(v.target);
  controls.update();
  viewAnim = null;
}
// glide there, unless (x, u) is already well in view (clear of the card on top)
const _fp = new THREE.Vector3();
function focusAt(x, u) {
  if (riding) return;
  const z = hf.startZ + u;
  _fp.set(x, hf.heightAt(x, z), z).project(camera);
  const top = camera.aspect < 1 ? 0.25 : 0.55;
  const left = camera.aspect > 1.3 ? -0.3 : -0.65;
  if (_fp.z < 1 && _fp.x > left && _fp.x < 0.65 && _fp.y > -0.6 && _fp.y < top) return;
  const v = viewOf(x, u);
  viewAnim = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: v.pos, toTarget: v.target };
}

// ---------- the start gate ----------
function moveStart(x, z) {
  state.start = clampStart({ x, z });
  generate();
  refreshScene({ redrape: false });
}

// ---------- selecting tiles, acting on them ----------
const hoverTile = () => tileOf(hf, hover.x, hover.z);
const onGrid = ([i, j]) => i >= 0 && j >= 0 && i < cols() && j < rows();

// add (or take away) the brush's tiles around each tile of a stroke
function strokeSelect(path, mode) {
  for (const [i, j] of path) {
    for (const t of brushTiles(i, j, state.brush)) {
      if (!onGrid(t)) continue;
      const k = tileKey(t[0], t[1]);
      if (mode === 'add') selection.add(k);
      else selection.delete(k);
    }
  }
  writeTiles();
}

function clearSelection() {
  if (!selection.size) return;
  selection.clear();
  writeTiles();
  refreshBar();
}

// the build bar shows what the selection holds (and greys out what needs one)
function refreshBar() {
  const info = describe(state.tiles, selList());
  bar.setSelection(info, !!clip);
  terrain && (terrain.uniforms.uTileOn.value = gridShown() ? 1 : 0);
}
// the grid shows while selecting or pasting, and whenever something is selected
function gridShown() {
  return !riding && (state.tool === 'select' || state.tool === 'paste' || selection.size > 0);
}

// the way a new jump or drop faces: down the fall line under the selection
function fallDir(sel) {
  let x = 0;
  let z = 0;
  for (const [i, j] of sel) {
    const c = tileCenter(hf, i, j);
    x += c.x;
    z += c.z;
  }
  const [dx, dz] = fallLine(hf, x / sel.length, z / sel.length, 10);
  return Math.round((Math.atan2(dx, dz) * 180) / Math.PI);
}

const signed = (v) => `${v > 0 ? '+' : ''}${num(v)}`;
const pitchDone = (p) => (p > 0 ? tx('done.steeper', { n: p }) : p < 0 ? tx('done.gentler', { n: -p }) : tx('done.natural'));
const ACT_DONE = {
  raise: (d) => tx('done.raise', { v: signed(d.lift) }),
  lower: (d) => tx('done.lower', { v: signed(d.lift) }),
  flatten: () => tx('done.flatten'),
  smooth: (d) => tx('done.smooth', { n: d.smooth }),
  steepen: (d) => pitchDone(d.pitch),
  ease: (d) => pitchDone(d.pitch),
  jump: (d) => tx(d.jump ? 'done.jump' : 'done.jumpOff'),
  drop: (d) => tx(d.drop ? 'done.drop' : 'done.dropOff'),
  rocks: (d) => tx(d.rocks ? 'done.rocks' : 'done.rocksOff'),
  gate: (d) => tx(d.gate ? 'done.gate' : 'done.gateOff'),
  trees: (d) => tx(`done.trees${d.trees}`),
  clear: (d) => tx(d.clear ? 'done.clear' : 'done.clearOff'),
  powder: (d) => tx(d.powder ? 'done.powder' : 'done.packed'),
  ice: (d) => tx(d.ice ? 'done.ice' : 'done.packed'),
  rotate: () => tx('done.rotate'),
  erase: () => tx('done.erase'),
};

// Do an action to the selected tiles (the buttons, the keys)
function act(name) {
  if (riding || ui.blocking) return;
  if (paint) return;
  if (name === 'copy') {
    if (!selection.size) return ui.toast(tx('toast.copyFirst'));
    clip = copyTiles(state.tiles, selList());
    refreshBar();
    return ui.toast(tx(COARSE ? 'toast.copied.touch' : 'toast.copied.desktop', { n: selection.size }));
  }
  if (name === 'paste') {
    if (!clip) return ui.toast(tx('toast.nothingCopied'));
    return setTool(state.tool === 'paste' ? 'select' : 'paste');
  }
  if (name === 'rotate' && state.tool === 'paste') {
    clip = rotateCopy(clip);
    showHoverPreview();
    return ui.toast(tx('toast.turnedCopy'));
  }
  const sel = selList();
  if (!sel.length) return ui.toast(tx(COARSE ? 'toast.selectFirst.touch' : 'toast.selectFirst.desktop'));
  const next = applyAction(state.tiles, sel, name, { dir: name === 'jump' || name === 'drop' ? fallDir(sel) : 0 });
  if (next === state.tiles) {
    if (name === 'rotate') ui.toast(tx('toast.nothingToTurn'));
    else if (name === 'erase') ui.toast(tx('toast.nothingToErase'));
    else ui.toast(tx('toast.asFar', { what: tx(`act.${name}`) }));
    return;
  }
  history.push(snapshot());
  state.tiles = next;
  sound.stamp();
  rebuild();
  ui.toast(ACT_DONE[name](describe(state.tiles, sel)));
}

// Put the copy down with its anchor on tile t: the pasted tiles become the selection
function placePaste(t) {
  const r = pasteTiles(state.tiles, clip, t.i, t.j, cols(), rows());
  if (!r.placed.length) return;
  history.push(snapshot());
  state.tiles = r.tiles;
  selection.clear();
  for (const [i, j] of r.placed) selection.add(tileKey(i, j));
  sound.stamp();
  rebuild();
  setTool('select');
  ui.toast(tx('toast.pasted', { n: r.placed.length }));
}

// a stroke cut short (a second finger: it was a pinch): the selection goes back to how it was
function cancelPaint() {
  const p = paint;
  paint = null;
  if (p && p.before) {
    selection.clear();
    for (const k of p.before) selection.add(k);
    refreshBar();
  }
  setGhost();
}

// desktop: show where the brush (or the paste) will go before you click
function showHoverPreview() {
  if (riding || !hover.valid) return setGhost();
  const t = hoverTile();
  if (state.tool === 'select') setGhost(brushTiles(t.i, t.j, state.brush));
  else if (state.tool === 'paste' && clip) setGhost(pasteCells(clip, t.i, t.j));
  else setGhost();
}

// ---------- input ----------
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// browsers only start audio from a gesture
document.addEventListener('pointerdown', () => sound.unlock());
// no sound from a background tab or a locked phone
document.addEventListener('visibilitychange', () => {
  sound.setHidden(document.hidden);
  if (document.hidden) rideControls.reset();
});

// on the window, capture phase: this runs before the camera controls (in every browser),
// so selecting tiles or moving the gate doesn't also turn the view
window.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target !== canvas) return;
    // a fresh first finger means any touch we still track is stale
    if (e.pointerType === 'touch' && e.isPrimary) pointers.clear();
    if (riding) return;
    pointers.set(e.pointerId, e);
    // a second finger turns the gesture into camera control: cancel the edit
    if (pointers.size > 1) {
      if (paint) cancelPaint();
      if (moving) endMove(false);
      return;
    }
    if (e.button !== 0 || altHeld || e.altKey) return;
    updateHover(e);
    if (!hover.valid) return;

    if (state.tool === 'start') {
      moving = { pointerId: e.pointerId, snap: snapshot() };
      aimField = new Heightfield(hf.sizeX, hf.sizeZ, hf.cell);
      aimField.h.set(hf.h);
      moveStart(hover.x, hover.z);
      e.stopImmediatePropagation();
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (state.tool === 'select') {
      const t = hoverTile();
      // starting on a selected tile, the stroke takes tiles away; anywhere else it adds
      const mode = selection.has(tileKey(t.i, t.j)) ? 'remove' : 'add';
      paint = { pointerId: e.pointerId, mode, tile: t, before: new Set(selection) };
      strokeSelect([[t.i, t.j]], mode);
      setGhost();
      e.stopImmediatePropagation();
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (state.tool === 'paste' && clip) {
      const t = hoverTile();
      paint = { pointerId: e.pointerId, paste: true, tile: t };
      setGhost(pasteCells(clip, t.i, t.j));
      e.stopImmediatePropagation();
      canvas.setPointerCapture(e.pointerId);
    }
  },
  { capture: true }
);

function endMove(commit) {
  const m = moving;
  moving = null;
  aimField = null;
  if (!m) return;
  if (commit) {
    history.push(m.snap);
    sound.stamp();
    ui.toast(tx(paused ? 'toast.startMovedPaused' : 'toast.startMoved'));
    rebuild();
  } else restore(m.snap);
}

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
  if (riding) return;
  if (moving && e.pointerId === moving.pointerId) {
    updateHover(e, aimField || hf);
    if (hover.valid) moveStart(hover.x, hover.z);
    return;
  }
  if (paint && e.pointerId === paint.pointerId) {
    updateHover(e);
    if (!hover.valid) return;
    const t = hoverTile();
    if (t.i !== paint.tile.i || t.j !== paint.tile.j) {
      if (paint.paste) setGhost(pasteCells(clip, t.i, t.j));
      else strokeSelect(lineTiles(paint.tile, t).slice(1), paint.mode);
      paint.tile = t;
    }
    return;
  }
  if (e.pointerType === 'mouse' && pointers.size === 0) {
    updateHover(e);
    showHoverPreview();
  }
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (moving && moving.pointerId === e.pointerId) endMove(e.type !== 'pointercancel');
  if (paint && paint.pointerId === e.pointerId) {
    if (e.type === 'pointercancel') cancelPaint();
    else {
      const p = paint;
      paint = null;
      if (p.paste) placePaste(p.tile);
      else {
        setGhost();
        refreshBar();
      }
    }
  }
  if (e.pointerType !== 'mouse') {
    hover.valid = false;
    if (!paint) setGhost();
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', (e) => {
  const mine = (moving && moving.pointerId === e.pointerId) || (paint && paint.pointerId === e.pointerId);
  if (mine && !pointers.has(e.pointerId)) endPointer(e);
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !paint && !moving) {
    hover.valid = false;
    setGhost();
  }
});

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
  // step grows with distance: fine near the camera, quick across the far mountain
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
  if (paint || moving) return;
  const prev = history.undo(snapshot());
  if (!prev) return;
  restore(prev);
  refreshHistoryButtons();
  scheduleSave();
}

function redo() {
  if (paint || moving) return;
  const next = history.redo(snapshot());
  if (!next) return;
  restore(next);
  refreshHistoryButtons();
  scheduleSave();
}

function refreshHistoryButtons() {
  ui.setHistory(history.canUndo, history.canRedo);
}

const r1 = (v) => Math.round(v * 10) / 10;
function scheduleSave() {
  if (tutOn) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          v: 11,
          design: state.design,
          tiles: packTiles(state.tiles),
          start: { x: r1(state.start.x), u: r1(state.start.z - hf.startZ) },
          brush: state.brush,
          best: state.best,
          bestPath: state.bestPath,
          bestTime: state.bestTime,
          bestTimePath: state.bestTimePath,
          course: state.course,
          rideCam: state.rideCam,
          relief: state.relief,
          contours: state.contours,
          muted: state.muted,
        })
      );
      saveFailed = false;
    } catch {
      // storage full or blocked: the session still works, but say so once
      if (!saveFailed) ui.toast(tx('toast.saveFailed'), 'bad');
      saveFailed = true;
    }
  }, 400);
}

// A save that can't be read (or comes from before wild mountains) is kept under BACKUP_KEY,
// never silently overwritten. Saves with painted pieces keep their mountain, and the pieces
// become tile actions (v8: on the hexagons; v7: on squares, with pistes, moved onto them).
function loadSave() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (![7, 8, 9, 10, 11].includes(data.v)) {
      backupSave(raw);
      loadNote = 'toast.oldRun';
      return false;
    }
    // v10 saves the slope you designed; before, a wild mountain (size, steepness, seed): it
    // becomes sections of about the same length, width and steepness
    const wild = data.v < 10;
    if (wild && !(data.mountain && data.mountain.size && data.mountain.steep)) throw new Error('no mountain in save');
    if (!wild && !(data.design && Array.isArray(data.design.sections))) throw new Error('no slope in save');
    makeSlope(wild ? designFromWild(data.mountain) : normalizeDesign(data.design));
    // v11: tiles and their actions, gates too; v9 and v10 the same without gates; v8
    // painted pieces on the hexagons; v7 on 10 m squares
    let tiles;
    if (data.v >= 11) tiles = unpackTiles(data.tiles);
    else if (data.v >= 9) tiles = unpackTiles(data.tiles, 12);
    else {
      const pieces = unpackPieces(data.tiles);
      tiles = fromPieces(data.v === 7 ? squaresToHexes(pieces, cols(), rows()) : pieces);
    }
    // the wild mountains were wider or narrower: keep the tiles centred
    const di = wild ? Math.round((cols() - hexCols(WILD_WIDTH[data.mountain.size] || 720)) / 2) : 0;
    state.tiles = trimTiles(di ? tiles.map((t) => ({ ...t, i: t.i + di })) : tiles, cols(), rows());
    const st = data.start;
    state.start = st && Number.isFinite(st.x) && Number.isFinite(st.u) ? clampStart({ x: st.x, z: hf.startZ + st.u }) : defaultStart(hf, base);
    if ([1, 2, 3].includes(data.brush)) state.brush = data.brush;
    generate();
    state.relief = !!data.relief;
    state.contours = !!data.contours;
    state.muted = !!data.muted;
    // the records, if they were set on this course
    if (data.v >= 10 && (data.course || '') === state.course) {
      if (data.best && typeof data.best.score === 'number') {
        state.best = data.best;
        state.bestPath = Array.isArray(data.bestPath) ? data.bestPath : null;
      }
      if (data.bestTime && typeof data.bestTime.time === 'number') {
        state.bestTime = { time: data.bestTime.time, score: data.bestTime.score || 0, splits: Array.isArray(data.bestTime.splits) ? data.bestTime.splits : [] };
        state.bestTimePath = Array.isArray(data.bestTimePath) ? data.bestTimePath : null;
      }
    }
    if (data.rideCam === 'helmet' || data.rideCam === 'chase') state.rideCam = data.rideCam;
    if (wild) loadNote = 'toast.fromWild';
    return true;
  } catch {
    if (raw) {
      backupSave(raw);
      loadNote = 'toast.unreadable';
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
// Look: one finger or the left button turns the view. Select, Paste and Start: one finger or
// the left button uses the tool, the right button orbits. Two fingers always move and zoom.
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
  if (paint) cancelPaint();
  if (moving) endMove(false);
  if (t === 'paste' && !clip) t = 'select';
  state.tool = t;
  ui.setTool(t);
  bar.set(t);
  ui.setHint(tx(`hint.${t}`));
  setGhost();
  refreshBar();
  applyControlScheme();
}

// ---------- runs ----------
// A run lives on while you build: Build pauses it (the skier waits where he is), Ride picks
// it up at the same speed, From the start begins a new one at the gate.
const rig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), snap: true, shake: 0, air: 0, roll: 0 };

// Ride: carry on with the paused run, or start one at the gate
function ride() {
  if (ui.blocking) return;
  if (paused && skier && skier.status === 'running') resumeRide();
  else startRun();
}

function startRun() {
  if (ui.blocking) return;
  sound.unlock();
  if (paint) cancelPaint();
  if (moving) endMove(true);
  setGhost();
  skier = new Skier(hf, startOf());
  skier.props = props;
  skier.surface = surf;
  skier.course = new CourseRun(gates);
  tracks.startRun();
  score = new ScoreKeeper({ splits: state.bestTime?.splits });
  lastEventCount = 0;
  lastFeedCount = 0;
  spray.clear();
  skierMesh.reset();
  skierMesh.visible = true;
  trail.clear();
  ghostRider.setPath(ghostPath());
  tutorial.runStarted();
  lastStatus = 'running';
  ui.setStatus('running');
  ui.hideResults();
  ui.clearStats();
  ui.clearTricks();
  paused = false;
  ui.setPaused(false);
  enterRide();
  showGates();
  rig.snap = true;
  rig.shake = 0;
  trail.line.visible = false; // behind the chase cam the trail climbs past the lens
}

function resumeRide() {
  sound.unlock();
  if (paint) cancelPaint();
  if (moving) endMove(true);
  setGhost();
  skier.resume();
  // the course may have changed while you built: the gates still there keep their state
  skier.course = skier.course.carryTo(gates);
  rideControls.reset();
  paused = false;
  ui.setPaused(false);
  ui.setStatus('running');
  lastStatus = 'running';
  enterRide();
  rig.snap = true;
  trail.line.visible = false;
}

// Build: the run waits where it is
function pauseRide() {
  if (!riding) return;
  if (skier && skier.status === 'running') {
    paused = true;
    ui.setPaused(true);
    ui.setStatus('paused');
    tracks.lift();
  }
  ui.hideResults();
  exitRide();
}

// the run is over (or thrown away): nothing to resume
function endRun() {
  paused = false;
  ui.setPaused(false);
  if (skier && skier.status === 'running') skier.status = 'aborted';
  skier = null;
  skierMesh.visible = false;
  showGates();
}

function enterRide() {
  if (riding) return;
  riding = true;
  viewAnim = null;
  controls.enabled = false;
  camera.near = 0.1;
  hover.valid = false;
  rideControls.reset();
  setGhost();
  terrain.uniforms.uTileOn.value = 0;
  // contour lines are an editing aid; on the ride they read as seams in the snow
  terrain.uniforms.uContours.value = 0;
  showEnds();
  ui.setRiding(true);
  gateMeshes.building = false;
  ui.setRideCam(state.rideCam);
  skierMesh.setFirstPerson(state.rideCam === 'helmet');
}

function exitRide() {
  if (!riding) return;
  tracks.lift();
  saveTracks();
  riding = false;
  rideControls.reset();
  terrain.uniforms.uContours.value = state.contours ? 1 : 0;
  terrain.uniforms.uTileOn.value = gridShown() ? 1 : 0;
  setGateFade(1);
  gateMeshes.building = true;
  ui.setRiding(false);
  ui.clearTricks();
  ui.setRush(0);
  skierMesh.setFirstPerson(false);
  ghostRider.update(0, 0, false);
  camera.near = 1;
  camera.up.set(0, 1, 0);
  camera.fov = camera.aspect < 1 ? 58 : 40;
  camera.updateProjectionMatrix();
  controls.enabled = true;
  trail.line.visible = true;
  showEnds();
  showGates();
  // look down on where the skier is, a drone's view of him and the snow ahead: ready to
  // build right there
  const p = skier ? new THREE.Vector3(skier.pos[0], skier.pos[1], skier.pos[2]) : HOME_TARGET.clone();
  const dir = skier ? new THREE.Vector3(skier.vel[0], 0, skier.vel[2]) : new THREE.Vector3(0, 0, 1);
  if (dir.lengthSq() < 1) dir.set(0, 0, 1);
  dir.normalize();
  viewAnim = { t: 0, fromPos: camera.position.clone(), fromTarget: rig.look.clone(), toPos: pauseView(p, dir), toTarget: p.clone().addScaledVector(dir, 6) };
}

// Where to look at the paused skier from: behind and above him if nothing is in the way,
// otherwise further round to the side (the start gate is often right behind him, and the
// trees anywhere)
function pauseView(p, dir) {
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const at = (back, across, up) => {
    const v = p.clone().addScaledVector(dir, -back).addScaledVector(side, across);
    const g = hf.inside(v.x, v.z) ? hf.heightAt(v.x, v.z) : p.y;
    v.y = Math.max(p.y + up, g + 14);
    return v;
  };
  const tries = [at(34, 12, 26), at(34, -12, 26), at(22, 30, 26), at(22, -30, 26), at(4, 38, 24), at(4, -38, 24), at(14, 0, 40)];
  for (const v of tries) if (clearView(v, p)) return v;
  return tries[tries.length - 1];
}

// Can the camera at `from` see the skier's body at `to`: no snow, tree or gate in between?
const _seg = new THREE.Vector3();
function clearView(from, to) {
  if (!lineOfSight(from, to)) return false;
  const gate = decor.gate.visible ? decor.gate.position : null;
  for (let i = 1; i < 24; i++) {
    _seg.lerpVectors(from, to, i / 24);
    _seg.y += 1 * (i / 24);
    if (treeAt(_seg, 0.3)) return false;
    // the gate: about 7.5 m across and 5 m up
    if (gate && Math.hypot(_seg.x - gate.x, _seg.z - gate.z) < 4.2 && _seg.y < gate.y + 6) return false;
  }
  return true;
}

// A tree whose crown (or trunk) holds point v, with `pad` metres to spare, or null. The
// crowns are cones, widest a quarter of the way up; the tallest of the tree models stand
// 1.25 × their nominal height (props.js) and reach out 0.4 × it.
const TREE_CROWN = 0.4;
const crownOf = (t, y) => {
  const h = propHeight(t) * 1.25;
  const top = hf.heightAt(t.x, props.worldZ(t)) + h;
  return y > top ? -1 : Math.max(0.4 * t.s, TREE_CROWN * propHeight(t) * Math.min(1, (top - y) / (0.75 * h)));
};
function treeAt(v, pad = 0.5) {
  for (const t of props.near(v.x, v.z, 7)) {
    if (t.k !== TREE) continue;
    const r = crownOf(t, v.y - pad);
    if (r >= 0 && Math.hypot(v.x - t.x, v.z - props.worldZ(t)) < r + pad) return t;
  }
  return null;
}

// Push v out of any tree crown, sideways (from inside one the whole screen is ink)
function outOfTrees(v, pad = 0.5) {
  for (let k = 0; k < 3; k++) {
    const t = treeAt(v, pad);
    if (!t) return;
    const tz = props.worldZ(t);
    const r = Math.max(0, crownOf(t, v.y - pad)) + pad;
    let dx = v.x - t.x;
    let dz = v.z - tz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = 1;
      dz = 0;
    } else {
      dx /= d;
      dz /= d;
    }
    v.x = t.x + dx * (r + 0.05);
    v.z = tz + dz * (r + 0.05);
  }
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
    const y = from.y + (to.y + 1.2 - from.y) * t;
    if (y < hf.heightAt(x, z) + 0.2) return false;
  }
  return true;
}

const _flat = new THREE.Vector3();
const _p = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dp = [0, 0, 0];
const _gateC = new THREE.Vector3();
function updateRideCamera(dt) {
  const [x, y, z] = skier.drawPos(_dp);
  _p.set(x, y, z);
  // follow the direction of travel (not the skis), so spins don't whip the camera around
  _vel.set(skier.vel[0], 0, skier.vel[2]);
  if (_vel.lengthSq() > 2) _flat.copy(_vel).normalize();
  else {
    _flat.set(skier.heading[0], 0, skier.heading[2]);
    if (_flat.lengthSq() < 1e-4) _flat.set(0, 0, 1);
    _flat.normalize();
  }
  const speed = skier.speed;
  // airborne: ease the camera back and up to show the trick
  const airTarget = !skier.grounded && skier.curAir > 0.25 ? 1 : 0;
  rig.air += (airTarget - rig.air) * Math.min(1, dt * 3);
  let posRate;
  let lookRate;
  const kick = Math.min(1, Math.max(0, (speed - 6) / 30));
  // read the slope ahead: where the snow actually is 6-25 m down the line, so the camera
  // aims at the run (not over a crest into the sky) and rises to see down steep faces
  const groundHere = hf.heightAt(x, z);
  const aheadAt = (d) => hf.heightAt(x + _flat.x * d, z + _flat.z * d);
  const lookDist = 8 + Math.min(14, speed * 0.3);
  const gLook = aheadAt(lookDist);
  // how far the snow falls away ahead (steep faces, drops behind a crest)
  const drop = Math.max(0, groundHere - Math.min(aheadAt(10), aheadAt(20) + 2, aheadAt(30) + 5));
  if (state.rideCam === 'helmet') {
    // just behind the (hidden) head and tipped down a little, so the ski tips and pole
    // baskets sit at the bottom of the frame: they show speed, lean and where you point
    _want.copy(_p).addScaledVector(_flat, -0.35);
    _want.y = Math.max(y, groundHere) + 1.65;
    _look.copy(_p).addScaledVector(_flat, lookDist + 6);
    _look.y = Math.min(_want.y - 1.9, aheadAt(lookDist + 6) + 0.4);
    posRate = 30;
    lookRate = 12;
    camera.fov = 74 + 18 * kick;
  } else {
    const portrait = camera.aspect < 1;
    const back = (portrait ? 5.4 : 4.4) + 1.6 * kick + 3.5 * rig.air;
    _want.copy(_p).addScaledVector(_flat, -back);
    // higher on steep or dropping ground so you see down the slope over the skier
    const lift = Math.min(9, drop * 0.45);
    _want.y = y + (portrait ? 2.3 : 1.9) + lift + 1.6 * rig.air;
    // never below the snow behind (uphill of the skier on steep runs)
    const behind = hf.heightAt(_want.x, _want.z);
    const clear = (portrait ? 2.6 : 2.1) + Math.min(2.5, Math.max(0, behind - y) * 0.25);
    if (_want.y < behind + clear) _want.y = behind + clear;
    // aim between the skier and the snow ahead; in the air, favour the skier
    const toSkier = 0.42 + 0.4 * rig.air;
    _look.copy(_p).addScaledVector(_flat, lookDist * (1 - toSkier));
    _look.y = (y + 0.8) * toSkier + (gLook + 0.6) * (1 - toSkier);
    posRate = 8;
    lookRate = 10;
    camera.fov = (portrait ? 68 : 60) + 22 * kick;
  }
  // a little rumble over the snow at speed
  if (skier.grounded && speed > 15) {
    const amp = Math.min(0.06, (speed - 15) * 0.0022);
    const t = performance.now() * 0.001;
    _look.x += Math.sin(t * 37.1) * amp;
    _look.y += Math.sin(t * 43.7 + 1.3) * amp;
  }
  const ground = hf.heightAt(_want.x, _want.z);
  if (_want.y < ground + 1) _want.y = ground + 1;
  if (state.rideCam === 'chase') {
    for (let tries = 0; tries < 8 && !lineOfSight(_want, _p); tries++) _want.y += 1.2;
    // in the woods: come in closer behind him rather than through a tree
    for (let tries = 0; tries < 5 && treeAt(_want); tries++) {
      _want.x = _p.x + (_want.x - _p.x) * 0.75;
      _want.z = _p.z + (_want.z - _p.z) * 0.75;
    }
  }
  if (rig.snap) {
    rig.pos.copy(_want);
    rig.look.copy(_look);
    rig.roll = 0;
    rig.snap = false;
  } else {
    rig.pos.lerp(_want, 1 - Math.exp(-dt * posRate));
    rig.look.lerp(_look, 1 - Math.exp(-dt * lookRate));
  }
  // the lens lags behind: never let it drift through a crown on the way
  if (state.rideCam === 'chase') outOfTrees(rig.pos, 0.35);
  camera.position.copy(rig.pos);
  // landing / wipeout shake
  if (rig.shake > 0.001) {
    const s = rig.shake;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    rig.shake *= Math.exp(-dt * 7);
  }
  // the camera banks a little with the skier's lean, like a follow cam on a gimbal
  _right.set(-_flat.z, 0, _flat.x);
  const lean = skier.grounded ? -(skier.tilt[0] * _right.x + skier.tilt[2] * _right.z) : 0;
  rig.roll += (Math.max(-0.5, Math.min(0.5, lean)) * (state.rideCam === 'helmet' ? 0.35 : 0.22) - rig.roll) * Math.min(1, dt * 4);
  _up.set(0, 1, 0).addScaledVector(_right, -Math.sin(rig.roll)).normalize();
  camera.up.copy(_up);
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
      rig.shake = Math.max(rig.shake, 0.08 + 0.4 * k * k);
    }
  } else if (ev.type === 'bump') {
    // brushed a tree or rock, or the edge of the mountain
    sound.land(Math.min(16, 6 + (ev.value || 3)), 'sketchy');
    spray.burst(skier, 0.5);
    rig.shake = Math.max(rig.shake, 0.2);
  } else if (ev.type === 'wipeout') {
    sound.wipeout();
    spray.burst(skier, 2);
    rig.shake = Math.max(rig.shake, 0.7);
  }
}

function onRunEnd(s) {
  score.finish(s);
  drainFeed();
  tracks.lift();
  saveTracks();
  paused = false;
  ui.setPaused(false);
  const finished = s.status === 'finished';
  // a run counts once it's down, through every gate
  const course = s.course;
  const valid = finished && (!course || course.complete);
  const isBest = valid && (!state.best || score.total > state.best.score);
  const lastBestTime = state.bestTime ? state.bestTime.time : null;
  const isBestTime = valid && (lastBestTime === null || s.time < lastBestTime);
  if (isBest) {
    state.best = { score: score.total, time: s.time };
    state.bestPath = packPath(s.path);
  }
  if (isBestTime) {
    state.bestTime = { time: Math.round(s.time * 100) / 100, score: score.total, splits: course ? course.splits.map((t) => (t === null ? null : Math.round(t * 100) / 100)) : [] };
    state.bestTimePath = packPath(s.path);
  }
  if (isBest || isBestTime) {
    ui.setBest(state.best, state.bestTime);
    scheduleSave();
  }
  if (finished) sound.finish();
  ui.showResults({
    eyebrow: finished ? (valid ? 'res.complete' : 'res.invalid') : s.status === 'stuck' ? 'res.stuck' : 'res.timeout',
    score: score.total,
    isBest,
    isBestTime,
    timeDelta: valid && lastBestTime !== null ? s.time - lastBestTime : null,
    gates: course && course.total ? { count: course.count, total: course.total, missing: course.missing } : null,
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

// Near the top of the slope, looking down it from above the start: close enough to see the
// tiles, which is where you begin building (R goes back to the whole mountain)
function frameTop() {
  const portrait = camera.aspect < 1;
  const L = hf.finishZ - hf.startZ;
  const u = Math.min(portrait ? 110 : 140, L * 0.35);
  const z = hf.startZ + u;
  const target = new THREE.Vector3(0, hf.heightAt(0, z), z);
  const pos = target.clone().add(portrait ? new THREE.Vector3(0, 200, -190) : new THREE.Vector3(-150, 170, -190));
  const g = hf.inside(pos.x, pos.z) ? hf.heightAt(pos.x, pos.z) : hf.heightAt(pos.x, hf.startZ);
  pos.y = Math.max(pos.y, g + 70);
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.update();
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

// The skis write into the snow: two carved grooves on packed snow, a trench in powder, a
// smear where they skid. Not while really in the air (a bump the legs soak up keeps drawing).
function recordTrack(sk) {
  const flying = !sk.grounded && (sk.curAir > 0.1 || sk.pos[1] - hf.heightAt(sk.pos[0], sk.pos[2]) > 0.3);
  if (sk.status !== 'running' || flying || sk.wipeout > 0) {
    tracks.lift();
    return;
  }
  if (!sk.grounded || sk.speed < 0.8) return;
  const kind = sk.powder > 0.5 ? 1 : sk.skid > 0.45 ? 2 : 0;
  tracks.add(sk.pos[0], sk.pos[2], kind);
}

function saveTracks() {
  if (tutOn) return;
  try {
    localStorage.setItem(TRACKS_KEY, tracks.pack());
  } catch {
    /* no room: tracks just won't survive a reload */
  }
}

// how far down the mountain the skier is, from the gate to the bottom
function progressOf(sk) {
  const z0 = state.start.z;
  return (sk.pos[2] - z0) / Math.max(1, hf.finishZ - z0);
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
    if (wasPortrait !== camera.aspect < 1 && w > 0 && h > 0 && !riding) resetView();
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  resize();
  spray.setScale(renderer.domElement.height / 3);

  terrain.refreshLocalMean();
  // a paused run: a ring under the skier, so you see where Ride on picks up
  if (paused && skier && !riding) {
    const pulse = 2.2 + 0.35 * Math.sin(performance.now() * 0.005);
    terrain.setBrush(true, skier.pos[0], skier.pos[1], skier.pos[2], pulse);
  } else terrain.setBrush(false);

  if (skier && riding) rideStep(dt);
  else tutorial.tick(dt);
  if (goalTiles.length) terrain.uniforms.uTime.value = clock.elapsedTime;

  spray.update(dt);
  tracks.update(dt);
  sound.update({ skier: riding ? skier : null, sculpt: 0 });

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
      if (camera.position.y < g + 4) camera.position.y = g + 4;
    }
  }
  // the decor follows the snow
  if (terrain.version !== decorSeen && performance.now() - decorAt > 300) {
    decorSeen = terrain.version;
    decorAt = performance.now();
    decor.refresh();
  }
  updateSun();
  renderer.render(scene, camera);
  debug?.tick();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// One frame of riding: input, physics, score, the skier's mesh, spray, tracks, camera
let scriptedInput = null; // tests drive the skier with this instead of the controls
function rideStep(dt) {
  {
    if (skier.status === 'running') {
      const inp = scriptedInput || rideControls.update(dt);
      skier.input.steer = inp.steer;
      skier.input.pitch = inp.pitch;
      skier.input.crouch = inp.crouch;
    }
    skier.update(dt);
    if (score) score.update(skier, skier.status === 'running' ? dt : 0);
    for (; lastEventCount < skier.events.length; lastEventCount++) onSkierEvent(skier.events[lastEventCount]);
    if (score) drainFeed();
    showGates();
    tutorial.rideFrame(skier);
    skierMesh.sync(skier, hf, dt);
    trail.setPath(skier.path);
    if (score) ui.setStats(skier, progressOf(skier), score);
    rideControls.setCharge(skier.charge, !skier.grounded);
    if (skier.status !== lastStatus) {
      lastStatus = skier.status;
      ui.setStatus(skier.status);
      if (skier.status !== 'running' && skier.status !== 'aborted') onRunEnd(skier);
    }
    spray.fromSkier(skier, dt);
    recordTrack(skier);
    ui.setRush(skier.status === 'running' ? (skier.speed - 14) / 20 : 0);
    ghostRider.update(skier.time, dt, skier.status === 'running');
    updateRideCamera(dt);
    const d = camera.position.distanceTo(_gateC.copy(decor.gate.position).setY(decor.gate.position.y + 2));
    setGateFade(Math.round(THREE.MathUtils.smoothstep(d, 5, 12) * 50) / 50);
  }
}

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

window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.key === 'Alt') {
    e.preventDefault();
    setAlt(true);
    return;
  }
  if (ui.blocking) return;
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (riding && !mod) {
    if (ui.resultsOpen) {
      if (key === 'r' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) startRun();
      } else if (e.key === 'Escape') {
        ui.hideResults();
        exitRide();
      } else if (key === 'c') toggleRideCam();
      else if (key === 'm') ui.toggleMute();
      return;
    }
    if (rideControls.key(e.code, true)) {
      e.preventDefault();
      return;
    }
    if (key === 'r') {
      if (!e.repeat) startRun(); // holding R must not restart over and over
    } else if (e.key === 'Escape' || key === 'b' || e.key === 'Tab') {
      e.preventDefault();
      pauseRide();
    } else if (key === 'c') toggleRideCam();
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
  if (mod && (key === 'c' || key === 'v')) {
    e.preventDefault();
    act(key === 'c' ? 'copy' : 'paste');
    return;
  }
  if (mod) return;
  if (e.code === 'Space' || e.key === 'Tab') {
    e.preventDefault();
    if (!e.repeat) e.shiftKey ? startRun() : ride();
    return;
  }
  if (e.key === 'Escape') {
    // one step back at a time: the stroke, the paste, the selection
    if (paint) cancelPaint();
    else if (moving) endMove(false);
    else if (state.tool === 'paste') setTool('select');
    else if (selection.size) clearSelection();
    else setTool('select');
  } else if (key === 'x' || e.key === 'Delete' || e.key === 'Backspace') act('erase');
  else if (e.key === '+' || e.key === '=') act('raise');
  else if (e.key === '-' || e.key === '_') act('lower');
  else if (key === 'f') act('flatten');
  else if (key === 'q') act('rotate');
  else if (key === 's') setTool('select');
  else if (key === 'g') setTool('start');
  else if (key === 'v') setTool('view');
  else if (key === 'c') ui.toggleContours();
  else if (key === 't') ui.toggleRelief();
  else if (key === 'n') editSlope();
  else if (key === 'm') ui.toggleMute();
  else if (key === 'r') resetView();
  else if (e.key === '[' || e.key === ']') {
    state.brush = Math.max(1, Math.min(3, state.brush + (e.key === ']' ? 1 : -1)));
    bar.setSize(state.brush);
  }
});

// ---------- helpers ----------
// The chase cam starts right behind the gate: fade it out when the camera is close so
// the banner doesn't cover the screen at the start of every run.
function setGateFade(a) {
  decor.setGateFade(a);
}

// Nothing on this page scrolls. iOS Safari still rubber-bands the page and ignores
// user-scalable=no, so block page panning/zooming everywhere except dialog text.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    const card = e.target.closest?.('.intro-card, .results-card, .bb-pieces, .bb-tabs');
    if (card && (card.scrollHeight > card.clientHeight || card.scrollWidth > card.clientWidth) && e.touches.length === 1) return;
    e.preventDefault();
  },
  { passive: false }
);

// ---------- start ----------
if (!hadSave) document.getElementById('intro-go').dataset.i18n = 'intro.goFirst';
applyDom();
onLang(() => setTool(state.tool));
if (!seenIntro) ui.openIntro();
else if (!hadSave) setTimeout(() => slopeEd.open(null, { cancel: false }), 0);
ui.setBest(state.best, state.bestTime);
if (loadNote) ui.toast(tx(loadNote), 'bad');
setTool(state.tool);
refreshScene();
refreshHistoryButtons();

// read-only handle for debugging in the browser console (and the smoke test)
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
  get paused() {
    return paused;
  },
  camera,
  hf,
  props,
  surf,
  tracks,
  controls,
  get state() {
    return state;
  },
  get base() {
    return base;
  },
  get riding() {
    return riding;
  },
  snapCamera: () => (rig.snap = true),
  // rebuild the snow after changing state.tiles / state.start by hand (tests)
  rebuild: () => rebuild(),
  // is the camera inside a tree crown right now (tests)
  cameraInTree: () => !!treeAt(camera.position, 0),
  // select the brush's tiles around world (x, z) (tests; add: false takes them away)
  selectAt(x, z, size = state.brush, add = true) {
    const t = tileOf(hf, x, z);
    const was = state.brush;
    state.brush = size;
    strokeSelect([[t.i, t.j]], add ? 'add' : 'remove');
    state.brush = was;
    refreshBar();
    return selection.size;
  },
  clearSelection: () => clearSelection(),
  applyWorld: (w) => applyWorld(w),
  tutorial,
  get gates() {
    return gates;
  },
  // select these tiles ([[i, j], ...]), put the start gate at (x, u), paste with the copy's
  // anchor on tile (i, j) (tests)
  selectTiles(list) {
    for (const [i, j] of list) if (onGrid([i, j])) selection.add(tileKey(i, j));
    writeTiles();
    refreshBar();
  },
  startAt(x, u) {
    moveStart(x, hf.startZ + u);
    rebuild();
  },
  pasteTile(i, j) {
    if (clip) placePaste({ i, j });
  },
  get selection() {
    return selList();
  },
  act: (name) => act(name),
  pasteAt(x, z) {
    const t = tileOf(hf, x, z);
    if (clip) placePaste(t);
  },
  // ride `seconds` of game time right now with a scripted input (tests: the software
  // renderer draws a frame every few seconds, far too slow to ride in real time)
  advance(seconds, input, step = 1 / 60) {
    if (!riding || !skier) return;
    scriptedInput = { steer: 0, pitch: 0, crouch: false, ...input };
    for (let t = 0; t < seconds && skier.status === 'running'; t += step) {
      rideStep(step);
      spray.update(step);
    }
    scriptedInput = null;
  },
};
