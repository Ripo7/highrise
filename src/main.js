import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { Heightfield, encodeHeights, decodeHeights } from './core/heightfield.js';
import { applyBrush, TOOLS } from './core/brushes.js';
import { History } from './core/history.js';
import { Skier, PHYS } from './core/skier.js';
import { TerrainMesh } from './render/terrainMesh.js';
import { SkierMesh, Trail } from './render/skierMesh.js';
import { createUI } from './ui.js';

// ---------- state ----------
const isBrush = (t) => t in TOOLS;
const SAVE_KEY = 'highrise.ski.v1';
const DEFAULT_START = { x: 0, z: -105 };

const hf = new Heightfield();
hf.generateDefault();
const history = new History();
const state = {
  tool: 'raise',
  radius: 12,
  strength: 0.5,
  start: { ...DEFAULT_START },
  follow: true,
  contours: true,
  best: null,
  runs: 0,
};
loadSave();

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 1, 4000);
const HOME_CAM = new THREE.Vector3();
const HOME_TARGET = new THREE.Vector3(0, 30, 8);
// Frame the whole mountain: a 3/4 view on wide screens, looking up the fall line on phones
function computeHome() {
  const aspect = Math.max(0.3, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  const portrait = aspect < 1;
  camera.fov = portrait ? 58 : 40;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const hTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
  const dir = portrait ? new THREE.Vector3(0.12, 0.62, 0.78) : new THREE.Vector3(0.48, 0.5, 0.72);
  const d = THREE.MathUtils.clamp((portrait ? 135 : 190) / hTan, 360, 900);
  HOME_CAM.copy(HOME_TARGET).addScaledVector(dir.normalize(), d);
}
computeHome();
camera.position.copy(HOME_CAM);

scene.add(new THREE.HemisphereLight('#cfe0ef', '#e7d8c6', 1.6));
const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
sun.position.set(-0.55, 0.75, 0.35).multiplyScalar(200);
scene.add(sun);

const terrain = new TerrainMesh(hf, { finishZ: PHYS.finishZ, start: state.start });
scene.add(terrain.group);

const skierMesh = new SkierMesh();
skierMesh.addTo(scene);
skierMesh.visible = false;

const trail = new Trail({ color: '#ff5a1f' });
const ghost = new Trail({ color: '#2f6fd6', opacity: 0.75, dashed: true });
scene.add(trail.line, ghost.line);

// start gate: two little poles with a banner
const gate = makeGate();
scene.add(gate);
placeGate();

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 25;
controls.maxDistance = 1100;
controls.update();

// ---------- UI ----------
const ui = createUI({
  tools: TOOLS,
  initial: state,
  onTool: setTool,
  onRadius: (v) => (state.radius = v),
  onStrength: (v) => (state.strength = v),
  onSend: sendSkier,
  onUndo: undo,
  onRedo: redo,
  onReset: resetTerrain,
  onResetView: resetView,
  onFollow: (v) => (state.follow = v),
  onContours: (v) => {
    state.contours = v;
    terrain.uniforms.uContours.value = v ? 1 : 0;
  },
});
ui.setBest(state.best);
setTool(state.tool);
refreshHistoryButtons();

// ---------- sculpting input ----------
const pointers = new Map();
const hover = { valid: false, x: 0, y: 0, z: 0 };
let stroke = null; // { pointerId, targetHeight, dirty }
let saveTimer = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, e);
  updateHover(e);

  // a second finger turns the gesture into camera control: cancel the stroke
  if (pointers.size > 1) {
    if (stroke) cancelStroke();
    return;
  }
  if (e.button !== 0) return;

  if (state.tool === 'start' && hover.valid) {
    if (hover.z < PHYS.finishZ - 30) {
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

  if (isBrush(state.tool) && hover.valid) {
    history.push(hf.copy());
    stroke = { pointerId: e.pointerId, targetHeight: hover.y, dirty: null };
    canvas.setPointerCapture(e.pointerId);
    refreshHistoryButtons();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
  if (e.pointerType === 'mouse' || pointers.size === 1) updateHover(e);
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (stroke && stroke.pointerId === e.pointerId) {
    stroke = null;
    scheduleSave();
  }
  if (e.pointerType !== 'mouse') hover.valid = false;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !stroke) hover.valid = false;
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

// Ray-march the heightfield (much cheaper than raycasting 130k triangles)
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function updateHover(e) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  let prevT = 0;
  const step = 1.0;
  hover.valid = false;
  for (let t = 0; t < 1400; t += step) {
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    const z = o.z + d.z * t;
    if (!hf.inside(x, z)) {
      prevT = t;
      continue;
    }
    if (y <= hf.heightAt(x, z)) {
      // refine by bisection
      let a = prevT;
      let b = t;
      for (let k = 0; k < 12; k++) {
        const m = (a + b) / 2;
        const mx = o.x + d.x * m;
        const mz = o.z + d.z * m;
        if (o.y + d.y * m <= hf.heightAt(mx, mz)) b = m;
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
  if (stroke) return;
  const prev = history.undo(hf.copy());
  if (!prev) return;
  hf.set(prev);
  terrain.updateAll();
  placeGate();
  refreshHistoryButtons();
  scheduleSave();
}

function redo() {
  if (stroke) return;
  const next = history.redo(hf.copy());
  if (!next) return;
  hf.set(next);
  terrain.updateAll();
  placeGate();
  refreshHistoryButtons();
  scheduleSave();
}

function resetTerrain() {
  history.push(hf.copy());
  hf.generateDefault();
  state.start = { ...DEFAULT_START };
  terrain.setStart(state.start.x, state.start.z);
  terrain.updateAll();
  placeGate();
  refreshHistoryButtons();
  scheduleSave();
  ui.toast('Fresh mountain. Undo brings yours back.');
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
        JSON.stringify({ h: encodeHeights(hf.h), start: state.start, best: state.best })
      );
    } catch {
      /* storage unavailable: fine, the session still works */
    }
  }, 400);
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const h = data.h && decodeHeights(data.h, hf.res * hf.res);
    if (h) hf.set(h);
    if (data.start) state.start = data.start;
    if (data.best) state.best = data.best;
  } catch {
    /* ignore corrupt saves */
  }
}

// ---------- tools ----------
function setTool(t) {
  state.tool = t;
  ui.setTool(t);
  const L = isBrush(t) || t === 'start' ? null : THREE.MOUSE.ROTATE;
  controls.mouseButtons = { LEFT: L, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = {
    ONE: L === null ? null : THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  canvas.dataset.tool = t;
}

// ---------- runs ----------
let skier = null;
let lastStatus = null;

function sendSkier() {
  if (skier && skier.path.length > 2) ghost.setPath(skier.path, 0.25);
  skier = new Skier(hf, state.start);
  skierMesh.reset();
  skierMesh.visible = true;
  trail.clear();
  lastStatus = 'running';
  state.runs++;
  ui.setStatus('running');
}

function onRunEnd(s) {
  const t = s.time.toFixed(2);
  const kmh = (s.maxSpeed * 3.6).toFixed(0);
  const jumps = s.jumps === 1 ? '1 jump' : `${s.jumps} jumps`;
  if (s.status === 'finished') {
    const isBest = !state.best || s.time < state.best.time;
    if (isBest) {
      state.best = { time: s.time, jumps: s.jumps, air: s.airTime };
      ui.setBest(state.best);
      scheduleSave();
    }
    ui.toast(`${isBest ? 'New best! ' : ''}Finished in ${t} s · top ${kmh} km/h · ${jumps}`, isBest ? 'good' : '');
  } else if (s.status === 'crashed') {
    const ev = s.events.findLast((e) => e.type === 'crash');
    ui.toast(`Crashed: landed at ${ev ? ev.value.toFixed(1) : '?'} m/s into the slope. Soften the landing.`, 'bad');
  } else if (s.status === 'stuck') {
    ui.toast('Stopped: not enough slope to keep moving.', 'bad');
  } else if (s.status === 'out') {
    ui.toast('Off the side of the mountain. Raise a berm to hold the line.', 'bad');
  } else {
    ui.toast('Too slow: no finish after 2 minutes.', 'bad');
  }
}

function resetView() {
  computeHome();
  viewAnim = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone() };
}
let viewAnim = null;

// ---------- loop ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 58 : 40;
    camera.updateProjectionMatrix();
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  resize();

  // sculpt continuously while held, so holding still keeps building
  if (stroke && hover.valid && isBrush(state.tool)) {
    const rect = applyBrush(hf, {
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
    }
  }

  const showBrush = hover.valid && isBrush(state.tool);
  terrain.setBrush(showBrush, hover.x, hover.y, hover.z, state.radius);

  if (skier) {
    skier.update(dt);
    skierMesh.sync(skier, hf, dt);
    trail.setPath(skier.path);
    ui.setStats(skier);
    if (skier.status !== lastStatus) {
      lastStatus = skier.status;
      ui.setStatus(skier.status);
      if (skier.status !== 'running') onRunEnd(skier);
    }
    if (state.follow && skier.status === 'running') {
      tmp.set(skier.pos[0], skier.pos[1], skier.pos[2]).sub(controls.target);
      const k = 1 - Math.exp(-dt * 3);
      tmp.multiplyScalar(k);
      controls.target.add(tmp);
      camera.position.add(tmp);
    }
  }

  if (viewAnim) {
    viewAnim.t = Math.min(1, viewAnim.t + dt * 1.6);
    const e = 1 - Math.pow(1 - viewAnim.t, 3);
    camera.position.lerpVectors(viewAnim.fromPos, HOME_CAM, e);
    controls.target.lerpVectors(viewAnim.fromTarget, HOME_TARGET, e);
    if (viewAnim.t >= 1) viewAnim = null;
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod) return;
  if (e.code === 'Space') {
    e.preventDefault();
    sendSkier();
    return;
  }
  const byKey = Object.entries(TOOLS).find(([, v]) => v.key === e.key);
  if (byKey) setTool(byKey[0]);
  else if (e.key === '5' || e.key.toLowerCase() === 'g') setTool('start');
  else if (e.key.toLowerCase() === 'v') setTool('view');
  else if (e.key === '[') ui.nudgeRadius(-2);
  else if (e.key === ']') ui.nudgeRadius(2);
  else if (e.key.toLowerCase() === 'f') ui.toggleFollow();
  else if (e.key.toLowerCase() === 'c') ui.toggleContours();
  else if (e.key.toLowerCase() === 'r') resetView();
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
