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
import { PropSet } from './core/props.js';
import { SurfaceMap } from './core/surface.js';
import { newWild, buildWild, SIZES, STEEPNESS, sizeOf, steepOf } from './core/wild.js';
import { buildWorld } from './core/world.js';
import { WIDTHS, DEFAULT_WIDTH, newPiste, clonePistes, nearestOnCurves, insertIndex, suggestPiste } from './core/piste.js';
import { KINDS, TILE, gridCols, gridRows, tileOf, placeTiles, eraseTiles, brushTiles, lineTiles, trimTiles, packTiles, unpackTiles } from './core/terrain.js';
import { PropMeshes } from './render/propMeshes.js';
import { Tracks } from './render/tracks.js';
import { Decor } from './render/decor.js';
import { TerrainMesh } from './render/terrainMesh.js';
import { SkierMesh, Trail } from './render/skierMesh.js';
import { Spray } from './render/spray.js';
import { GhostRider, packPath } from './render/ghost.js';
import { PisteGizmo } from './render/pisteGizmo.js';
import { Sound } from './audio.js';
import { RideControls } from './rideControls.js';
import { createUI } from './ui.js';
import { createBuildBar } from './buildBar.js';
import { CATEGORY_COLORS } from './pieceIcons.js';
import { THEME, SUN_DIR } from './render/theme.js';
import { createDebugOverlay } from './debugOverlay.js';

// ---------- state ----------
const COARSE = window.matchMedia('(pointer: coarse)').matches;
let altHeld = false; // Alt/Option held: left button orbits
const SAVE_KEY = 'highrise.ski.v3'; // v7: a wild mountain (seed), its pistes and the terrain pieces
const INTRO_KEY = 'highrise.intro.v6';
const TRACKS_KEY = 'highrise.tracks.v1';
const BACKUP_KEY = 'highrise.ski.backup';
let loadNote = null; // told to the player once the UI is up
let saveFailed = false;

const hf = new Heightfield();
const props = new PropSet(hf); // trees and rocks
const surf = new SurfaceMap(hf); // groomed / powder / ice / rock
const history = new History(40);
const state = {
  tool: 'trace', // view | trace | paint | erase
  piece: 'bump', // what Paint paints
  brush: 2, // brush size in tiles (1, 2 or 3)
  mountain: null, // { size, steep, seed } (see core/wild.js)
  pistes: [], // see core/piste.js
  pieces: [], // { k, i, j } on the 10 m grid (see core/terrain.js)
  active: null, // id of the piste being traced: a tap on the snow extends it
  fresh: true, // the next tap starts a new piste (or a branch, if it's on a piste)
  sel: null, // the selected waypoint: { id, idx }
  rideCam: 'chase', // chase | helmet
  contours: false,
  relief: false,
  muted: false,
  best: null, // { score, time }
  bestPath: null, // packed path of the best run, for the ghost
};
let base = null; // the wild mountain before any piste or piece
let world = { curves: new Map(), ends: { start: null, finishes: [] } };

function makeMountain(m) {
  state.mountain = m;
  base = buildWild(hf, surf, m);
}

// Build the pistes and pieces on the base (the whole mountain, a few milliseconds)
function generate(pistes = state.pistes, pieces = state.pieces) {
  world = buildWorld(hf, surf, base, { pistes, pieces });
  props.set(world.props);
}

const cols = () => gridCols(hf);
const rows = () => gridRows(hf);
const pisteById = (id) => state.pistes.find((p) => p.id === id) || null;

const hadSave = loadSave();
if (!hadSave) {
  // first visit: a medium mountain sits behind the welcome card, waiting for a piste
  makeMountain(newWild('medium', 'medium'));
  generate();
}

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

// ---------- input state ----------
const pointers = new Map();
const hover = { valid: false, x: 0, y: 0, z: 0 };
let press = null; // a finger or the mouse down in Trace: on a pin, on a piste or on the snow
let paint = null; // painting or erasing pieces: { pointerId, path, snap, dirty, last }
let aimField = null; // the snow as it was when a drag began (aim at it, not at the preview)
let shownH = null; // the heights the terrain mesh shows (to upload only what changed)
let saveTimer = 0;

// ---------- the build grid on the snow ----------
const CAT_INDEX = { terrain: 0, nature: 1 };
let ghost = { add: [], erase: [] };

// G channel: where pieces are; A: their category; R: the ghost; B: tiles about to be erased
function writeTiles() {
  const d = terrain?.tileData;
  if (!d) return;
  const nc = terrain.tileCols;
  const nr = terrain.tileRows;
  d.fill(0);
  const put = (i, j, ch, v) => {
    if (i >= 0 && j >= 0 && i < nc && j < nr) d[(j * nc + i) * 4 + ch] = v;
  };
  for (const p of state.pieces) {
    const o = (p.j * nc + p.i) * 4;
    if (p.i < 0 || p.j < 0 || p.i >= nc || p.j >= nr) continue;
    // a shape shows over the forest or powder on the same tile
    if (d[o + 1] && KINDS[p.k].layer !== 's') continue;
    d[o + 1] = 255;
    d[o + 3] = CAT_INDEX[KINDS[p.k].cat] || 0;
  }
  for (const [i, j] of ghost.add) put(i, j, 0, 255);
  for (const [i, j] of ghost.erase) put(i, j, 2, 255);
  terrain.updateTiles();
}

function setGhost(add = [], erase = []) {
  ghost = { add, erase };
  writeTiles();
}

const propMeshes = new PropMeshes(props);
scene.add(propMeshes.group);
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
// the pistes' waypoints and lines
const gizmo = new PisteGizmo(hf);
scene.add(gizmo.group);
let decorSeen = -1;
let decorAt = 0;

let terrain = null;
function rebuildTerrain() {
  if (terrain) {
    scene.remove(terrain.group);
    terrain.dispose();
  }
  terrain = new TerrainMesh(hf, { start: { x: 1e6, z: 1e6 }, surface: surf });
  terrain.setRelief(state.relief);
  // the terrain shading its own hollows is costly on phones: there only props and the rider cast
  terrain.top.castShadow = !COARSE;
  terrain.uniforms.uContours.value = state.contours ? 1 : 0;
  terrain.setTileGrid(cols(), rows(), -hf.halfX, TILE);
  terrain.uniforms.uCatCol.value[0].set(CATEGORY_COLORS.terrain);
  terrain.uniforms.uCatCol.value[1].set(CATEGORY_COLORS.nature);
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

// the start ring and finish lines on the snow, the gate and the arch
function showEnds() {
  const { start, finishes } = world.ends;
  terrain.setStart(start ? start.x : 1e6, start ? start.z : 1e6);
  terrain.setFinishes(finishes);
  const main = start ? finishes.find((f) => f.id === start.id) || finishes[0] : finishes[0];
  decor.setEnds(start, main || null);
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
controls.minDistance = 20;
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
  onSend: sendSkier,
  onUndo: undo,
  onRedo: redo,
  onResetView: resetView,
  onRideExit: () => exitRide(true),
  onRideCam: () => toggleRideCam(),
  onNewMountain: () => ui.openMountain(state.mountain, true),
  onMountain: (m, suggest) => newWorld(m, suggest),
  onSuggest: suggestForMe,
  onFreshSnow: () => {
    if (tracks.freshSnow()) {
      ui.toast('Fresh snow: your tracks are covered.');
      try {
        localStorage.removeItem(TRACKS_KEY);
      } catch {
        /* ignore */
      }
    } else ui.toast('No tracks yet: ride the mountain first.');
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
    // first visit: pick a mountain
    if (!hadSave && !pickedOnce) {
      pickedOnce = true;
      ui.openMountain(state.mountain, false);
    }
  },
});
window.__highriseToast = (msg, kind) => ui.toast(msg, kind);

const bar = createBuildBar({
  onTool: (t) => {
    setTool(t);
    if (t === 'erase') ui.toast('Erase: drag over pieces to remove them.');
  },
  onPiece: (k) => {
    state.piece = k;
    setTool('paint');
    ui.toast(`${KINDS[k].label}: ${KINDS[k].hint}`);
  },
  onAction: pisteAction,
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

// Undo snapshots: the pistes and the pieces (the snow is rebuilt from them)
const snapshot = () => ({ pistes: clonePistes(state.pistes), pieces: state.pieces, active: state.active });
function restore(snap) {
  state.pistes = clonePistes(snap.pistes);
  state.pieces = snap.pieces;
  state.active = pisteById(snap.active) ? snap.active : null;
  state.sel = null;
  state.fresh = !state.pistes.length;
  generate();
  refreshScene();
}

// what's on screen follows the model: the snow (only the cells that changed), the snow
// texture, trees, start and finish, the pins
function refreshScene({ redrape = true } = {}) {
  const rect = changedRect();
  if (rect) terrain.update(rect);
  terrain.refreshSurface();
  propMeshes.rebuild();
  showEnds();
  gizmo.set(state.pistes, world.curves, state.sel);
  bar.setSelection(!!selPoint());
  if (redrape && rect) tracks.redrape();
  writeTiles();
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

// ---------- a new mountain ----------
function newWorld(m, suggest = false) {
  if (riding) exitRide(true);
  makeMountain(m);
  state.pistes = [];
  state.pieces = [];
  state.sel = null;
  state.active = null;
  state.fresh = true;
  if (suggest) addSuggestion();
  generate();
  state.best = null;
  state.bestPath = null;
  history.clear();
  rebuildTerrain();
  propMeshes.rebuild();
  tracks.clear();
  saveTracks();
  skier = null;
  skierMesh.visible = false;
  trail.clear();
  ui.setBest(null);
  ui.setStatus('idle');
  ui.clearStats();
  refreshHistoryButtons();
  refreshScene();
  scheduleSave();
  computeHome();
  camera.position.copy(HOME_CAM);
  controls.target.copy(HOME_TARGET);
  viewAnim = null;
  setTool('trace');
  const s = sizeOf(m);
  const st = steepOf(m);
  ui.toast(
    suggest
      ? `${st.label} mountain, ${s.L >= 1000 ? `${s.L / 1000} km` : `${s.L} m`}. Here's a first piste: drag its points to make it yours.`
      : `${st.label} mountain, ${s.L >= 1000 ? `${s.L / 1000} km` : `${s.L} m`}. Tap the snow near the top to start your piste.`
  );
}

function addSuggestion() {
  const p = newPiste(state.pistes, suggestPiste(hf, base.rock, base.gen));
  state.pistes.push(p);
  state.active = p.id;
  state.fresh = false;
}

function suggestForMe() {
  if (riding) return;
  history.push(snapshot());
  state.pistes = [];
  state.sel = null;
  // trace it on the bare mountain, so it doesn't follow the old piste's cut
  generate([], state.pieces);
  addSuggestion();
  generate();
  refreshScene();
  refreshHistoryButtons();
  scheduleSave();
  setTool('trace');
  ui.toast('Here is a piste down the mountain: drag its points to make it yours (Undo brings yours back).');
}

// ---------- tracing pistes ----------
const activePiste = () => (state.active != null ? pisteById(state.active) : null);
const selPoint = () => {
  if (!state.sel) return null;
  const p = pisteById(state.sel.id);
  return p && p.pts[state.sel.idx] ? { p, q: p.pts[state.sel.idx] } : null;
};
// a piste may only join one that comes before it (so there are never loops)
const canJoin = (p, otherId) => {
  const a = state.pistes.indexOf(p);
  const b = state.pistes.findIndex((o) => o.id === otherId);
  return b >= 0 && b < a;
};
// is the piste being traced free to join this one?
const joinable = (id) => {
  const p = activePiste();
  return !!p && !state.fresh && !p.to && p.id !== id && p.pts.length > 0 && canJoin(p, id);
};
const onPisteAt = (x, z, slack = 0) => {
  const near = nearestOnCurves(world.curves, x, z);
  return near && near.d < near.w / 2 + slack ? near : null;
};

// a tap on the snow in Trace: start a piste, branch off one, extend the one being traced, or join another
function tapSnow(x, z) {
  const before = snapshot();
  const near = onPisteAt(x, z, 2);
  const p = activePiste();
  if (state.fresh || !p) {
    if (!state.fresh && state.pistes.length) {
      ui.toast('Pick New piste to start another piste, or drag a point to reshape this one.');
      return;
    }
    if (near) {
      const b = newPiste(state.pistes, [], { id: near.id, f: near.f });
      state.pistes.push(b);
      state.active = b.id;
      ui.toast('Branch started: tap where it goes. End it on a piste to join it.');
    } else {
      const first = !state.pistes.length;
      const n = newPiste(state.pistes, [{ x, z, w: DEFAULT_WIDTH }]);
      state.pistes.push(n);
      state.active = n.id;
      ui.toast(first ? 'Start placed. Now tap further down: the piste follows your points.' : 'New piste: tap further down to trace it.');
    }
    state.fresh = false;
  } else if (near && near.id !== p.id && canJoin(p, near.id)) {
    p.to = { id: near.id, f: near.f };
    state.active = null;
    ui.toast('Joined: the two pistes merge here.');
  } else if (near && near.id === p.id) {
    ui.toast('Drag the piste to add a bend, or tap further down to extend it.');
    return;
  } else if (p.to) {
    ui.toast('This piste joins another one. Drag its points, or pick New piste to start another.');
    return;
  } else {
    const w = p.pts.length ? p.pts[p.pts.length - 1].w : DEFAULT_WIDTH;
    const first = p.pts[0];
    const last = p.pts[p.pts.length - 1];
    // above the top of the piste and nearer to it: it grows upwards
    if (!p.from && first && z < first.z && Math.hypot(x - first.x, z - first.z) < Math.hypot(x - last.x, z - last.z)) p.pts.unshift({ x, z, w: first.w });
    else p.pts.push({ x, z, w });
  }
  state.sel = null;
  tidyPistes();
  history.push(before);
  sound.stamp();
  rebuild();
}

// drop branches that never got a point, and joins to pistes that are gone
function tidyPistes() {
  state.pistes = state.pistes.filter((p) => p.pts.length > 0 || p.id === state.active);
  const ids = new Set(state.pistes.map((p) => p.id));
  for (const p of state.pistes) {
    if (p.from && !ids.has(p.from.id)) p.from = null;
    if (p.to && !ids.has(p.to.id)) p.to = null;
  }
  if (state.active != null && !ids.has(state.active)) state.active = null;
}

function pisteAction(a) {
  if (riding) return;
  if (a === 'newPiste') {
    setTool('trace');
    state.fresh = true;
    state.active = null;
    state.sel = null;
    tidyPistes();
    refreshScene();
    ui.toast('New piste: tap the snow to start it, or tap on a piste to branch off it.');
    return;
  }
  const s = selPoint();
  if (!s) return;
  const before = snapshot();
  if (a === 'narrower' || a === 'wider') {
    const i = WIDTHS.findIndex((w) => w >= s.q.w - 0.5);
    const next = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, (i < 0 ? 1 : i) + (a === 'wider' ? 1 : -1)))];
    if (next === s.q.w) {
      ui.toast(a === 'wider' ? 'That is as wide as a piste gets.' : 'That is as narrow as a piste gets.');
      return;
    }
    s.q.w = next;
    ui.toast(`${next} m wide here.`);
  } else if (a === 'delete') {
    s.p.pts.splice(state.sel.idx, 1);
    if (!s.p.pts.length) {
      state.pistes = state.pistes.filter((o) => o !== s.p);
      ui.toast('Piste deleted.');
    }
    state.sel = null;
    tidyPistes();
    if (!state.pistes.length) state.fresh = true;
  }
  history.push(before);
  rebuild();
}

function rebuild() {
  generate();
  refreshScene();
  refreshHistoryButtons();
  scheduleSave();
}

// the pin being dragged follows the finger; the snow is rebuilt a dozen times a second
function dragPin(e) {
  updateHover(e, aimField || hf);
  if (!hover.valid) return;
  const p = pisteById(press.pid);
  const q = p && p.pts[press.idx];
  if (!q) return;
  q.x = Math.max(-hf.halfX + 8, Math.min(hf.halfX - 8, hover.x));
  q.z = Math.max(hf.startZ - 10, Math.min(hf.finishZ - 4, hover.z));
  press.dirty = true;
}

function previewPress() {
  if (!press || !press.drag || !press.dirty) return;
  const now = performance.now();
  if (now - press.last < 70) return;
  press.last = now;
  press.dirty = false;
  generate();
  refreshScene({ redrape: false });
}

function endPress(commit) {
  const pr = press;
  press = null;
  aimField = null;
  if (!pr || !pr.drag) return;
  if (commit) {
    history.push(pr.snap);
    sound.stamp();
  } else restore(pr.snap);
  rebuild();
}

// ---------- painting pieces ----------
const hoverTile = () => tileOf(hf, hover.x, hover.z);

function paintTiles(path) {
  const seen = new Set();
  const out = [];
  for (const [i, j] of path) {
    for (const t of brushTiles(i, j, state.brush)) {
      const k = `${t[0]},${t[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

function paintResult() {
  const tiles = paintTiles(paint.path);
  if (state.tool === 'erase') return { erase: tiles, pieces: eraseTiles(state.pieces, tiles) };
  return { add: tiles, pieces: placeTiles(state.pieces, tiles.map(([i, j]) => ({ k: state.piece, i, j })), cols(), rows()) };
}

function previewPaint() {
  if (!paint || !paint.dirty) return;
  const now = performance.now();
  if (now - paint.last < 90) return;
  paint.last = now;
  paint.dirty = false;
  const r = paintResult();
  generate(state.pistes, r.pieces);
  refreshScene({ redrape: false });
  setGhost(r.add || [], r.erase || []);
}

function commitPaint() {
  const r = paintResult();
  const changed = r.pieces !== state.pieces && JSON.stringify(r.pieces) !== JSON.stringify(state.pieces);
  if (changed) {
    history.push(paint.snap);
    state.pieces = r.pieces;
    sound.stamp();
  }
  paint = null;
  aimField = null;
  setGhost();
  rebuild();
}

function cancelPaint() {
  const was = paint;
  paint = null;
  aimField = null;
  setGhost();
  if (was) {
    generate();
    refreshScene();
  }
}

// desktop: show where the brush (or the next stretch of piste) will go before you click
function showHoverPreview() {
  if (riding || !hover.valid) {
    setGhost();
    gizmo.setPreview(null, null);
    return;
  }
  if (state.tool === 'paint' || state.tool === 'erase') {
    const t = hoverTile();
    const tiles = brushTiles(t.i, t.j, state.brush);
    if (state.tool === 'erase') setGhost([], tiles);
    else setGhost(tiles);
    return;
  }
  if (state.tool === 'trace') {
    const b = { x: hover.x, z: hover.z };
    const p = activePiste();
    const overPin = gizmo.pick(camera, canvas.getBoundingClientRect(), lastMouse.x, lastMouse.y, 18);
    if (overPin || (!state.fresh && onPisteAt(b.x, b.z))) return gizmo.setPreview(null, null);
    if (state.fresh || !p) gizmo.setPreview(null, state.fresh || !state.pistes.length ? b : null);
    else {
      const c = world.curves.get(p.id);
      const end = c ? { x: c.xs[c.n - 1], z: c.zs[c.n - 1] } : p.pts.length ? p.pts[p.pts.length - 1] : null;
      gizmo.setPreview(end, b);
    }
  }
}
const lastMouse = { x: 0, y: 0 };

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
// so grabbing a pin or the piste doesn't also turn the view
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
      if (press) endPress(false);
      if (paint) cancelPaint();
      press = null;
      return;
    }
    if (e.button !== 0 || altHeld || e.altKey) return;
    sound.unlock();
    updateHover(e);

    if (state.tool === 'trace') {
      const pin = gizmo.pick(camera, canvas.getBoundingClientRect(), e.clientX, e.clientY, e.pointerType === 'mouse' ? 18 : 30);
      if (pin) {
        press = { kind: 'pin', pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), pid: pin.id, idx: pin.idx };
        e.stopImmediatePropagation();
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (!hover.valid) return;
      const near = !state.fresh && onPisteAt(hover.x, hover.z);
      if (near) {
        press = { kind: 'curve', pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), near, x: hover.x, z: hover.z };
        e.stopImmediatePropagation();
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      // on the snow: a tap adds a point; a drag turns the view (the camera gets it too)
      press = { kind: 'snow', pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), x: hover.x, z: hover.z };
      return;
    }

    if ((state.tool === 'paint' || state.tool === 'erase') && hover.valid) {
      const t = hoverTile();
      paint = { pointerId: e.pointerId, path: [[t.i, t.j]], tile: t, snap: snapshot(), dirty: true, last: 0 };
      aimField = new Heightfield(hf.sizeX, hf.sizeZ, hf.cell);
      aimField.h.set(hf.h);
      setGhost(paintTiles(paint.path));
      canvas.setPointerCapture(e.pointerId);
    }
  },
  { capture: true }
);

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
  if (e.pointerType === 'mouse') {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
  }
  if (riding) return;
  if (press && e.pointerId === press.pointerId) {
    const moved = Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > (e.pointerType === 'mouse' ? 4 : 8);
    if (press.kind === 'snow') {
      if (moved) press = null; // it was a camera drag
      return;
    }
    if (!press.drag && moved) {
      // start dragging: a pin moves; on the piste, a new point is put in and moves
      press.drag = true;
      press.snap = snapshot();
      press.dirty = false;
      press.last = 0;
      aimField = new Heightfield(hf.sizeX, hf.sizeZ, hf.cell);
      aimField.h.set(hf.h);
      if (press.kind === 'curve') {
        const p = pisteById(press.near.id);
        const c = world.curves.get(press.near.id);
        const idx = insertIndex(p, c, press.near.k);
        p.pts.splice(idx, 0, { x: press.near.x, z: press.near.z, w: Math.round(press.near.w) });
        press.kind = 'pin';
        press.pid = p.id;
        press.idx = idx;
      }
      state.sel = { id: press.pid, idx: press.idx };
      state.active = press.pid;
      state.fresh = false;
    }
    if (press.drag) dragPin(e);
    return;
  }
  if (paint && e.pointerId === paint.pointerId) {
    updateHover(e, aimField || hf);
    if (!hover.valid) return;
    const t = hoverTile();
    if (t.i !== paint.tile.i || t.j !== paint.tile.j) {
      for (const p of lineTiles(paint.tile, t).slice(1)) paint.path.push(p);
      paint.tile = t;
      paint.dirty = true;
      setGhost(state.tool === 'erase' ? [] : paintTiles(paint.path), state.tool === 'erase' ? paintTiles(paint.path) : []);
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
  if (press && press.pointerId === e.pointerId) {
    const pr = press;
    if (e.type === 'pointercancel') endPress(false);
    else if (pr.drag) endPress(true);
    else {
      press = null;
      const pinAt = pr.kind === 'pin' && pisteById(pr.pid)?.pts[pr.idx];
      if (pinAt && (state.fresh || joinable(pr.pid))) {
        // starting a new piste on a point: it branches off there; tracing onto another
        // piste's point: it joins there
        tapSnow(pinAt.x, pinAt.z);
      } else if (pr.kind === 'pin') {
        // a tap on a pin selects it (and the piste it's on: taps then extend that piste)
        state.sel = { id: pr.pid, idx: pr.idx };
        state.active = pr.pid;
        state.fresh = false;
        refreshScene({ redrape: false });
        ui.toast('Point selected: drag it to move it, or change the width below.');
      } else if (pr.kind === 'curve' && joinable(pr.near.id)) {
        tapSnow(pr.x, pr.z); // tracing a piste and tapping another one: it joins it
      } else if (pr.kind === 'curve') {
        state.active = pr.near.id;
        state.sel = null;
        state.fresh = false;
        refreshScene({ redrape: false });
        ui.toast('Drag the piste to add a bend, or tap further down to extend it.');
      } else if (pr.kind === 'snow') tapSnow(pr.x, pr.z);
    }
  }
  if (paint && paint.pointerId === e.pointerId) {
    if (e.type === 'pointercancel') cancelPaint();
    else commitPaint();
  }
  if (e.pointerType !== 'mouse') {
    hover.valid = false;
    if (!paint) setGhost();
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', (e) => {
  const mine = (press && press.pointerId === e.pointerId && press.kind !== 'snow') || (paint && paint.pointerId === e.pointerId);
  if (mine && !pointers.has(e.pointerId)) endPointer(e);
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !press && !paint) {
    hover.valid = false;
    setGhost();
    gizmo.setPreview(null, null);
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
  if (press?.drag || paint) return;
  const prev = history.undo(snapshot());
  if (!prev) return;
  restore(prev);
  refreshHistoryButtons();
  scheduleSave();
}

function redo() {
  if (press?.drag || paint) return;
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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          v: 7,
          mountain: state.mountain,
          pistes: state.pistes
            .filter((p) => p.pts.length)
            .map((p) => ({ id: p.id, from: p.from, to: p.to, pts: p.pts.flatMap((q) => [r1(q.x), r1(q.z - hf.startZ), q.w]) })),
          tiles: packTiles(state.pieces),
          brush: state.brush,
          best: state.best,
          bestPath: state.bestPath,
          rideCam: state.rideCam,
          relief: state.relief,
          contours: state.contours,
          muted: state.muted,
        })
      );
      saveFailed = false;
    } catch {
      // storage full or blocked: the session still works, but say so once
      if (!saveFailed) ui.toast('Could not save your mountain: browser storage is full or blocked.', 'bad');
      saveFailed = true;
    }
  }, 400);
}

// A save that can't be read (or comes from an older version of the game, before wild
// mountains) is kept under BACKUP_KEY, never silently overwritten.
function loadSave() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.v !== 7) {
      backupSave(raw);
      loadNote = 'Highrise has wild mountains now: pick one and trace your piste. Your old run was kept aside.';
      return false;
    }
    const m = data.mountain;
    if (!m || !SIZES.some((s) => s.id === m.size) || !STEEPNESS.some((s) => s.id === m.steep) || !Number.isFinite(m.seed)) throw new Error('no mountain in save');
    makeMountain({ size: m.size, steep: m.steep, seed: m.seed });
    // pistes: waypoints inside the mountain, joins only to earlier pistes
    const pistes = [];
    for (const p of Array.isArray(data.pistes) ? data.pistes : []) {
      if (!Number.isInteger(p.id) || !Array.isArray(p.pts)) continue;
      const pts = [];
      for (let i = 0; i + 2 < p.pts.length; i += 3) {
        const [x, u, w] = [p.pts[i], p.pts[i + 1], p.pts[i + 2]];
        if (![x, u, w].every(Number.isFinite)) continue;
        pts.push({ x: Math.max(-hf.halfX + 8, Math.min(hf.halfX - 8, x)), z: Math.max(hf.startZ - 10, Math.min(hf.finishZ - 4, hf.startZ + u)), w: Math.max(WIDTHS[0], Math.min(WIDTHS[WIDTHS.length - 1], w)) });
      }
      if (!pts.length) continue;
      const join = (j) => (j && pistes.some((o) => o.id === j.id) && Number.isFinite(j.f) ? { id: j.id, f: Math.max(0, Math.min(1, j.f)) } : null);
      pistes.push({ id: p.id, pts, from: join(p.from), to: join(p.to) });
    }
    state.pistes = pistes;
    state.pieces = trimTiles(unpackTiles(data.tiles), cols(), rows());
    state.fresh = !pistes.length;
    state.active = pistes.length ? pistes[pistes.length - 1].id : null;
    if ([1, 2, 3].includes(data.brush)) state.brush = data.brush;
    generate();
    state.relief = !!data.relief;
    state.contours = !!data.contours;
    state.muted = !!data.muted;
    if (data.best && typeof data.best.score === 'number') {
      state.best = data.best;
      state.bestPath = Array.isArray(data.bestPath) ? data.bestPath : null;
    }
    if (data.rideCam === 'helmet' || data.rideCam === 'chase') state.rideCam = data.rideCam;
    return true;
  } catch {
    if (raw) {
      backupSave(raw);
      loadNote = 'Your saved mountain could not be read (a copy was kept).';
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
// Trace and Look: one finger or the left button turns the view (pins and the piste are
// grabbed before the camera sees them). Paint and Erase: one finger or the left button
// paints; the right button orbits. Two fingers always move and zoom.
function applyControlScheme() {
  const t = state.tool;
  const camOnly = t === 'view' || t === 'trace' || altHeld;
  controls.mouseButtons = {
    LEFT: camOnly ? THREE.MOUSE.ROTATE : null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: t === 'view' || t === 'trace' ? THREE.TOUCH.ROTATE : null,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  document.body.classList.toggle('alt-orbit', altHeld);
}

const HINTS = {
  view: 'Drag to orbit · Middle-drag to pan · Scroll to zoom',
  trace: 'Click the snow to add points down the mountain · Drag a point to move it · Drag to orbit',
  erase: 'Drag over pieces to erase them · Right-drag to orbit · Scroll to zoom',
};

function setTool(t) {
  if (press) endPress(false);
  if (paint) cancelPaint();
  state.tool = t;
  ui.setTool(t);
  bar.set(t, state.piece);
  ui.setHint(t === 'paint' ? `Drag on the snow to paint ${KINDS[state.piece].label.toLowerCase()} · Right-drag to orbit · Scroll to zoom` : HINTS[t]);
  if (terrain) {
    terrain.uniforms.uTileOn.value = t === 'paint' || t === 'erase' ? 1 : 0;
    if (t === 'paint') terrain.uniforms.uGhost.value.set(CATEGORY_COLORS[KINDS[state.piece].cat]);
  }
  gizmo.visible = t === 'trace';
  if (t !== 'trace') gizmo.setPreview(null, null);
  setGhost();
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
  if (ui.blocking) return;
  sound.unlock();
  const start = world.ends.start;
  if (!start || !world.curves.get(start.id)) {
    setTool('trace');
    ui.toast(state.pistes.length ? 'Your piste needs at least two points: tap further down the mountain.' : 'Trace a piste first: tap the snow near the top, then further down.');
    return;
  }
  if (press) endPress(true);
  if (paint) commitPaint();
  setGhost();
  terrain.uniforms.uTileOn.value = 0;
  gizmo.visible = false;
  skier = new Skier(hf, start);
  skier.props = props;
  skier.surface = surf;
  skier.finishes = world.ends.finishes;
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
  // contour lines are an editing aid; on the ride they read as seams in the snow
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
  terrain.uniforms.uTileOn.value = state.tool === 'paint' || state.tool === 'erase' ? 1 : 0;
  gizmo.visible = state.tool === 'trace';
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
  } else if (ev.type === 'bump') {
    // brushed a tree or rock, or the edge of the mountain
    sound.land(Math.min(16, 6 + (ev.value || 3)), 'sketchy');
    spray.burst(skier, 0.5);
    rig.shake = Math.max(rig.shake, 0.35);
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
// skidding. Nothing while flying or tumbling.
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

// how far down the run the skier is: from the start to the finish of the first piste
function progressOf(sk) {
  const { start, finishes } = world.ends;
  const f = finishes.find((q) => q.id === start?.id) || finishes[0];
  if (!start || !f) return 0;
  const zf = Math.max(f.z, start.z + 1);
  return (sk.pos[2] - start.z) / (zf - start.z);
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
  resize();
  spray.setScale(renderer.domElement.height / 3);

  if (!riding) {
    previewPress();
    previewPaint();
  }
  terrain.refreshLocalMean();

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
    if (score) ui.setStats(skier, progressOf(skier), score);
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
      if (camera.position.y < g + 6) camera.position.y = g + 6;
    }
  }
  // the decor follows the snow
  if (terrain.version !== decorSeen && performance.now() - decorAt > 300) {
    decorSeen = terrain.version;
    decorAt = performance.now();
    decor.refresh();
  }
  if (gizmo.visible) gizmo.update(camera, canvas.clientHeight);
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
  if (e.key === 'Escape') {
    if (press) endPress(false);
    if (paint) cancelPaint();
    if (state.sel || state.fresh) {
      state.sel = null;
      state.fresh = false;
      refreshScene({ redrape: false });
    } else setTool('view');
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel) pisteAction('delete');
  else if (key === 'x') setTool('erase');
  else if (key === 'p') setTool('trace');
  else if (key === 'v') setTool('view');
  else if (key === 'c') ui.toggleContours();
  else if (key === 't') ui.toggleRelief();
  else if (key === 'n') ui.openMountain(state.mountain, true);
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
if (!hadSave) document.getElementById('intro-go').textContent = 'Choose my mountain';
if (!seenIntro) ui.openIntro();
else if (!hadSave) setTimeout(() => ui.openMountain(state.mountain, false), 0);
ui.setBest(state.best);
if (loadNote) ui.toast(loadNote, 'bad');
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
  camera,
  hf,
  props,
  surf,
  tracks,
  controls,
  gizmo,
  get state() {
    return state;
  },
  get base() {
    return base;
  },
  get world() {
    return world;
  },
  get riding() {
    return riding;
  },
  snapCamera: () => (rig.snap = true),
  // rebuild the snow after changing state.pistes / state.pieces by hand (tests)
  rebuild: () => rebuild(),
};
