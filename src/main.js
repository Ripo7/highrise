import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { Heightfield, encodeHeights, decodeHeights } from './core/heightfield.js';
import { strokeTo, TOOLS } from './core/brushes.js';
import { History } from './core/history.js';
import { Skier } from './core/skier.js';
import { TEMPLATES, buildTemplate, getTemplate } from './core/templates.js';
import { TerrainMesh } from './render/terrainMesh.js';
import { SkierMesh, Trail } from './render/skierMesh.js';
import { createUI } from './ui.js';

// ---------- state ----------
const isBrush = (t) => t in TOOLS;
const COARSE = window.matchMedia('(pointer: coarse)').matches;
let altHeld = false; // Alt/Option held: left button orbits
const SAVE_KEY = 'highrise.ski.v2'; // v2: 1.2 km piste (v1 saves were 240 m square)
const INTRO_KEY = 'highrise.intro.v1';
const DEFAULT_TEMPLATE = 'valley';

const hf = new Heightfield();
const history = new History(25);
const state = {
  tool: 'raise',
  radius: COARSE ? 16 : 12, // fingers are less precise and the phone camera sits further back
  strength: 0.5,
  start: null,
  templateId: DEFAULT_TEMPLATE,
  rideCam: 'chase', // chase | helmet
  contours: true,
  best: null,
  runs: 0,
};
const hadSave = loadSave();
if (!hadSave) state.start = buildTemplate(hf, DEFAULT_TEMPLATE);

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
// phones: cap resolution a little to keep sculpting smooth
renderer.setPixelRatio(Math.min(window.devicePixelRatio, COARSE ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 1, 9000);
const HOME_CAM = new THREE.Vector3();
const HOME_TARGET = new THREE.Vector3();
// Frame the whole run from below the finish, looking up the piste so its full length
// stays in view (3/4 on wide screens, straight up the fall line on phones)
function computeHome() {
  const aspect = Math.max(0.3, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  const portrait = aspect < 1;
  camera.fov = portrait ? 58 : 40;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  if (portrait) {
    // phones: straight up the fall line, the run stretches away up the screen
    HOME_TARGET.set(0, hf.heightAt(0, -hf.halfZ * 0.15), -hf.halfZ * 0.15);
    HOME_CAM.copy(HOME_TARGET).addScaledVector(new THREE.Vector3(0.08, 0.62, 0.78).normalize(), 1150);
  } else {
    // wide screens: side-on 3/4 view, start on the left and finish on the right
    HOME_TARGET.set(0, hf.heightAt(0, 0), 0);
    const hTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    const d = THREE.MathUtils.clamp((hf.halfZ * 1.12) / hTan, 800, 2800);
    HOME_CAM.copy(HOME_TARGET).addScaledVector(new THREE.Vector3(-0.72, 0.64, 0.26).normalize(), d);
  }
}
computeHome();
camera.position.copy(HOME_CAM);

scene.add(new THREE.HemisphereLight('#cfe0ef', '#e7d8c6', 1.6));
const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
sun.position.set(-0.55, 0.75, 0.35).multiplyScalar(200);
scene.add(sun);

const terrain = new TerrainMesh(hf, { finishZ: hf.finishZ, start: state.start });
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
controls.minDistance = 20;
controls.maxDistance = 3000;
controls.zoomToCursor = true; // scroll / pinch zooms towards what you point at
controls.screenSpacePanning = false; // panning slides along the ground, up and down the piste
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
  onResetView: resetView,
  onControl: (name, on) => setControl(name, on),
  onRideExit: () => exitRide(true),
  onRideCam: () => toggleRideCam(),
  onPickTemplate: (id) => chooseTemplate(id),
  templates: TEMPLATES,
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
    // first visit: go straight on to choosing a mountain
    if (!hadSave && !pickedOnce) {
      pickedOnce = true;
      ui.openPicker();
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
if (!hadSave) document.getElementById('intro-go').textContent = 'Choose a mountain';
if (!seenIntro) ui.openIntro();
else if (!hadSave) ui.openPicker();
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
  // a fresh first finger means any touch we still track is stale (a lost pointerup
  // would otherwise make every new touch look like a second finger and block sculpting)
  if (e.pointerType === 'touch' && e.isPrimary) pointers.clear();
  if (riding) return;
  pointers.set(e.pointerId, e);
  updateHover(e);

  // a second finger turns the gesture into camera control: cancel the stroke
  if (pointers.size > 1) {
    if (stroke) cancelStroke();
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

  if (isBrush(state.tool) && hover.valid) {
    history.push(hf.copy());
    stroke = { pointerId: e.pointerId, targetHeight: hover.y, last: null, carry: 0 };
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
canvas.addEventListener('lostpointercapture', (e) => {
  if (stroke && stroke.pointerId === e.pointerId && !pointers.has(e.pointerId)) endPointer(e);
});
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
  hover.valid = false;
  // step grows with distance: fine near the camera, quick across the far piste
  for (let t = 0, step = 0.75; t < 6000; t += step, step = Math.max(0.75, t * 0.003)) {
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

function chooseTemplate(id) {
  if (riding) exitRide(true);
  history.push(hf.copy());
  state.start = buildTemplate(hf, id);
  state.templateId = id;
  state.best = null;
  terrain.setStart(state.start.x, state.start.z);
  terrain.updateAll();
  placeGate();
  skier = null;
  skierMesh.visible = false;
  trail.clear();
  ghost.clear();
  ui.setBest(null);
  ui.setStatus('idle');
  refreshHistoryButtons();
  scheduleSave();
  resetView();
  ui.toast(`${getTemplate(id).name} loaded. Undo brings your old mountain back.`);
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
          h: encodeHeights(hf.h),
          start: state.start,
          best: state.best,
          rideCam: state.rideCam,
          templateId: state.templateId,
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
    const h = data.h && decodeHeights(data.h, hf.nx * hf.nz);
    if (!h || !data.start) return false;
    hf.set(h);
    state.start = data.start;
    if (data.templateId) state.templateId = data.templateId;
    if (data.best) state.best = data.best;
    if (data.rideCam === 'helmet' || data.rideCam === 'chase') state.rideCam = data.rideCam;
    return true;
  } catch {
    /* ignore corrupt saves */
    return false;
  }
}

// ---------- tools ----------
// Desktop: left = tool, right = orbit, middle or Shift+right = pan, scroll = zoom; holding
// Alt/Option turns the left button into orbit (for trackpads). Touch: one finger = tool,
// two fingers = pan + pinch. With the Orbit tool, one finger orbits.
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
    // the piste is long: two fingers slide along it and pinch to zoom; turning the
    // view is the Orbit tool's job (one finger)
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
let lastStatus = null;

// ---------- ride mode: camera behind the skier, player steers ----------
let riding = false;
let rideEndTimer = 0;
const editView = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
const rig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), snap: true };
const held = { left: false, right: false, tuck: false, brake: false };

function setControl(name, on) {
  held[name] = on;
  applyInput();
}

function applyInput() {
  if (!skier) return;
  skier.input.steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  skier.input.tuck = held.tuck;
  skier.input.brake = held.brake;
}

function sendSkier() {
  if (ui.blocking) return;
  if (skier && skier.path.length > 2) ghost.setPath(skier.path, 0.25);
  if (stroke) {
    stroke = null;
    scheduleSave();
  }
  skier = new Skier(hf, state.start);
  applyInput();
  skierMesh.reset();
  skierMesh.visible = true;
  trail.clear();
  lastStatus = 'running';
  state.runs++;
  ui.setStatus('running');
  rideEndTimer = 0;
  if (!riding) enterRide();
  rig.snap = true;
}

function enterRide() {
  riding = true;
  viewAnim = null;
  editView.pos.copy(camera.position);
  editView.target.copy(controls.target);
  controls.enabled = false;
  camera.near = 0.2;
  hover.valid = false;
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
  for (const k in held) held[k] = false;
  applyInput();
  ui.setRiding(false);
  skierMesh.setFirstPerson(false);
  camera.near = 1;
  camera.fov = camera.aspect < 1 ? 58 : 40;
  camera.updateProjectionMatrix();
  controls.enabled = true;
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
function updateRideCamera(dt) {
  const [x, y, z] = skier.pos;
  _p.set(x, y, z);
  _h.set(skier.heading[0], skier.heading[1], skier.heading[2]).normalize();
  // a level version of the heading keeps the chase cam steady over bumps
  _flat.set(_h.x, 0, _h.z);
  if (_flat.lengthSq() < 1e-4) _flat.set(0, 0, 1);
  _flat.normalize();
  const speed = skier.speed;
  let posRate;
  let lookRate;
  if (state.rideCam === 'helmet') {
    _want.copy(_p).addScaledVector(_flat, 0.4);
    _want.y += 3.4;
    _look.copy(_want).addScaledVector(_h, 24);
    _look.y -= 3;
    posRate = 30;
    lookRate = 12;
    camera.fov = 74 + Math.min(14, speed * 0.3);
  } else {
    // portrait screens are narrow: sit further back so the line ahead stays in frame
    const portrait = camera.aspect < 1;
    _want.copy(_p).addScaledVector(_flat, portrait ? -15 : -11);
    _want.y += portrait ? 6.5 : 4.5;
    _look.copy(_p).addScaledVector(_flat, 9);
    _look.y += 1;
    posRate = 5;
    lookRate = 9;
    camera.fov = 60 + Math.min(14, speed * 0.25);
  }
  // never dip under the snow, and rise until the skier isn't hidden behind a crest
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
  camera.lookAt(rig.look);
  camera.updateProjectionMatrix();
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
    const ev = s.events.findLast((e) => e.type === 'crash' || e.type === 'sideways');
    if (ev && ev.type === 'sideways') ui.toast('Crashed: landed sideways. Straighten the skis before touchdown.', 'bad');
    else ui.toast(`Crashed: landed at ${ev ? ev.value.toFixed(1) : '?'} m/s into the slope. Soften the landing.`, 'bad');
  } else if (s.status === 'stuck') {
    ui.toast('Stopped: not enough slope to keep moving.', 'bad');
  } else if (s.status === 'out') {
    ui.toast('Off the side of the mountain. Raise a berm to hold the line.', 'bad');
  } else {
    ui.toast('Too slow: no finish after 2 minutes.', 'bad');
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
    // phone rotated: re-frame the mountain for the new shape
    if (wasPortrait !== camera.aspect < 1 && w > 0 && h > 0) resetView();
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
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
    }
  }

  const showBrush = !riding && hover.valid && isBrush(state.tool);
  terrain.setBrush(showBrush, hover.x, hover.y, hover.z, state.radius);

  if (skier) {
    skier.update(dt);
    skierMesh.sync(skier, hf, dt);
    trail.setPath(skier.path);
    ui.setStats(skier, (skier.pos[2] - state.start.z) / (hf.finishZ - state.start.z));
    if (skier.status !== lastStatus) {
      lastStatus = skier.status;
      ui.setStatus(skier.status);
      if (skier.status !== 'running') onRunEnd(skier);
    }
    if (riding) {
      updateRideCamera(dt);
      // after the run ends, hold the shot a moment, then fly back to the sculpting view
      if (skier.status !== 'running') {
        rideEndTimer += dt;
        if (rideEndTimer > 2.4) exitRide(false);
      }
    }
  }

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

// ---------- keyboard ----------
const setAlt = (v) => {
  if (altHeld === v) return;
  altHeld = v;
  applyControlScheme();
};
const RIDE_KEYS = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'tuck',
  KeyW: 'tuck',
  ArrowDown: 'brake',
  KeyS: 'brake',
};
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') setAlt(false);
  const ctl = RIDE_KEYS[e.code];
  if (ctl && held[ctl]) {
    setControl(ctl, false);
    ui.showControl(ctl, false);
  }
});
window.addEventListener('blur', () => {
  setAlt(false);
  for (const k in held) if (held[k]) ui.showControl(k, false);
  for (const k in held) held[k] = false;
  applyInput();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') {
    e.preventDefault();
    setAlt(true);
    return;
  }
  if (ui.blocking) return;
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  if (riding && !e.ctrlKey && !e.metaKey) {
    const ctl = RIDE_KEYS[e.code];
    if (ctl) {
      e.preventDefault();
      if (!e.repeat) {
        setControl(ctl, true);
        ui.showControl(ctl, true);
      }
      return;
    }
    if (e.key === 'Escape') {
      exitRide(true);
      return;
    }
    if (e.key.toLowerCase() === 'c') {
      toggleRideCam();
      return;
    }
  }
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

// Nothing on this page scrolls. iOS Safari still rubber-bands the page and ignores
// user-scalable=no, so block page panning/zooming everywhere except the help card text.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    const card = e.target.closest?.('.intro-card');
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
  camera,
  hf,
};
