import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { normalizePlan } from './loader.js';
import { buildHouse, W } from './builder.js';
import { makeWorld, EYE, RADIUS } from './physics.js';
import { Minimap } from './minimap.js';
import bundledPlan from '../public/plans/cozy-3-bed.json';
import bundledSample from '../public/plans/sample.json';
import bundledTest from '../public/plans/test-two-storey.json';
import bundledIndex from '../public/plans/index.json';
const BUNDLED = { './plans/cozy-3-bed.json': bundledPlan, './plans/sample.json': bundledSample, './plans/test-two-storey.json': bundledTest };
const IS_FILE = location.protocol === 'file:';
import { pointInPolygon, polygonArea, centroid } from './geom.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 5 });
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = skyTexture();
scene.fog = new THREE.Fog(0xdde6ec, 80, 260);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.495; orbit.screenSpacePanning = true;

const hemi = new THREE.HemisphereLight(0xe3efff, 0x8d7f63, 1.15); scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.35); scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

function skyTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#6f9fd6'); gr.addColorStop(0.45, '#b9d2ea'); gr.addColorStop(0.5, '#e6edf1'); gr.addColorStop(0.53, '#cfc9b8'); gr.addColorStop(1, '#a59d88');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- state
const state = { plan: null, build: null, world: null, mode: 'orbit', cut: -1, labels: [], lights: [], planUrl: null };
const player = { x: 0, y: 0, feet: 0, vz: 0, yaw: 0, pitch: 0, eye: 0 };
const keys = new Set();
const minimap = new Minimap($('minimap'));
minimap.onClick = (x, y) => { if (state.mode !== 'walk') setMode('walk'); teleport(x, y, player.yaw); };

function toast(msg, ms = 3500) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = 'none'), ms); }

function disposeTree(o) {
  o.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
}

function loadPlanObject(raw, label) {
  let plan;
  try { plan = normalizePlan(raw); } catch (e) { console.error(e); toast('Could not read plan: ' + e.message, 6000); return false; }
  if (state.build) { scene.remove(state.build.root); disposeTree(state.build.root); }
  state.labels.forEach((l) => l.removeFromParent()); state.labels = [];
  state.lights.forEach((l) => l.removeFromParent()); state.lights = [];
  const build = buildHouse(plan);
  scene.add(build.root);
  state.plan = plan; state.build = build; state.world = makeWorld(build);
  $('planName').textContent = plan.meta.name || label || 'Plan';
  document.title = `${plan.meta.name} · House 3D`;
  // sun: southern-hemisphere friendly default (from the north-west, afternoon); respects northAngleDeg
  const sb = build.siteB, R = Math.max(sb.w, sb.h) * 0.75 + 12;
  const az = ((330 + (plan.meta.northAngleDeg || 0)) * Math.PI) / 180, el = (52 * Math.PI) / 180;
  const c = W(sb.cx, sb.cy, 0);
  sun.target.position.copy(c);
  sun.position.copy(c).add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(60));
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 160 });
  sun.shadow.camera.updateProjectionMatrix();
  // soft interior lights (one per indoor room)
  for (const r of plan.rooms) {
    if (r.outdoor) continue;
    const lvl = plan.levels.find((l) => l.id === r.level);
    const area = Math.abs(polygonArea(r.polygon));
    const [cx, cy] = centroid(r.polygon);
    const L = new THREE.PointLight(0xffe2c0, Math.min(10, 2.5 + area * 0.22), Math.sqrt(area) * 2.2 + 3, 1.6);
    L.position.copy(W(cx, cy, lvl.elevation + lvl.height - 0.35));
    build.levelGroups.get(lvl.id).add(L); state.lights.push(L);
  }
  // room labels (shown in cutaway views)
  for (const a of build.labelAnchors) {
    const el = document.createElement('div'); el.className = 'roomLabel'; el.textContent = a.text;
    const o = new CSS2DObject(el); o.position.copy(a.pos); o.userData.level = a.level;
    build.levelGroups.get(a.level).add(o); state.labels.push(o);
  }
  // level buttons
  const lb = $('levelBtns'); lb.innerHTML = '';
  const mk = (txt, idx, title) => { const b = document.createElement('button'); b.textContent = txt; b.title = title; b.onclick = () => setCut(idx); b.dataset.idx = idx; lb.appendChild(b); };
  mk('All', -1, 'Show everything (0)');
  plan.levels.forEach((l, i) => mk(l.name.replace(/\s*floor$/i, '') || l.id, i, `Cutaway at ${l.name} (${i + 1})`));
  // notes
  $('notesBtn').textContent = `Notes (${plan.warnings.length})`;
  $('notes').innerHTML = `<b>Loader notes for “${esc(plan.meta.name)}”</b>` + (plan.warnings.length ? '<ul>' + plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul>' : '<p>No issues: plan loaded as-is.</p>');
  if (plan.warnings.length) console.info('[plan] loader notes:\n - ' + plan.warnings.join('\n - '));
  minimap.setPlan(plan, build.siteB);
  respawn();
  setCut(state.mode === 'orbit' && state.cut >= plan.levels.length ? -1 : Math.min(state.cut, plan.levels.length - 1));
  frameOrbit();
  return true;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadPlanUrl(url) {
  if (IS_FILE && BUNDLED[url]) { const ok = loadPlanObject(structuredClone(BUNDLED[url]), url); if (ok) state.planUrl = url; return ok; }
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ok = loadPlanObject(await res.json(), url);
    if (ok) { state.planUrl = url; toast(`Loaded ${state.plan.meta.name}`, 2000); }
    return ok;
  } catch (e) { console.error(e); toast(`Could not load ${url}: ${e.message}`, 6000); return false; }
}

// ---------- visibility / cutaway
function setCut(idx) {
  state.cut = idx;
  const b = state.build; if (!b) return;
  const levels = state.plan.levels;
  levels.forEach((l, i) => {
    b.levelGroups.get(l.id).visible = state.mode === 'walk' || idx < 0 || i <= idx;
    b.ceilingGroups.get(l.id).visible = state.mode === 'walk' || idx < 0 || i < idx;
  });
  b.roofGroup.visible = state.mode === 'walk' || idx < 0;
  for (const o of state.labels) {
    const li = levels.findIndex((l) => l.id === o.userData.level);
    o.visible = state.mode === 'orbit' && idx >= 0 && li === idx;
    o.element.style.display = o.visible ? '' : 'none';
  }
  document.querySelectorAll('#levelBtns button').forEach((btn) => btn.classList.toggle('on', +btn.dataset.idx === idx && state.mode === 'orbit'));
}

function frameOrbit(dir = 'ne') {
  const b = state.build.houseB, s = state.build.siteB;
  const target = W(b.cx, b.cy, 1.2);
  const d = Math.max(s.w, s.h) * 0.85 + 6;
  const off = { ne: [0.6, 0.75], n: [0.15, 1], sw: [-0.6, -0.75], s: [0.1, -1] }[dir] || [0.6, 0.75];
  camera.position.copy(target).add(new THREE.Vector3(off[0] * d * 0.7, d * 0.55, -off[1] * d * 0.7));
  orbit.target.copy(target); camera.fov = 50; camera.updateProjectionMatrix(); orbit.update();
}
function topDown(levelIdx = 0) {
  if (state.mode !== 'orbit') setMode('orbit');
  const b = state.build.houseB, s = state.build.siteB;
  const l = state.plan.levels[Math.max(0, levelIdx)];
  const span = Math.max(b.w * innerHeight / innerWidth, b.h) + 4;
  camera.fov = 40; camera.updateProjectionMatrix();
  const h = span / 2 / Math.tan((20 * Math.PI) / 180);
  orbit.target.copy(W(b.cx, b.cy, l.elevation));
  camera.position.copy(W(b.cx, b.cy - 0.001, l.elevation + h));
  orbit.update();
  setCut(Math.max(0, levelIdx));
}

// ---------- modes
function setMode(m) {
  state.mode = m;
  document.body.classList.toggle('walk', m === 'walk');
  $('modeBtn').textContent = m === 'walk' ? 'Orbit' : 'Walk';
  $('modeBtn').classList.toggle('on', m === 'walk');
  orbit.enabled = m === 'orbit';
  if (m === 'walk') { camera.fov = 70; camera.updateProjectionMatrix(); applyCamera(); }
  else { if (document.pointerLockElement) document.exitPointerLock(); frameOrbit(); }
  setCut(state.cut);
}
function respawn() {
  const p = state.plan, b = state.build;
  const wallsBy = new Map(p.walls.map((w) => [w.id, w]));
  const doors = p.openings.filter((o) => o.type === 'door' && wallsBy.get(o.wall)?.exterior && wallsBy.get(o.wall).level === p.levels[0].id);
  const front = doors.find((o) => /front|entr|main/i.test(o.id)) || doors[0];
  if (front) {
    const w = wallsBy.get(front.wall);
    const ux = (w.end[0] - w.start[0]) / w.length, uy = (w.end[1] - w.start[1]) / w.length;
    const c = [w.start[0] + ux * (front.offset + front.width / 2), w.start[1] + uy * (front.offset + front.width / 2)];
    const side = w.inside || 1; // left normal * side points inside
    const n = [-uy * side, ux * side];
    teleport(c[0] - n[0] * 2.6, c[1] - n[1] * 2.6, Math.atan2(n[0], n[1]));
  } else teleport(b.houseB.cx, b.houseB.minY - 3, 0);
}
function teleport(x, y, yaw = player.yaw, pitch = 0, feet = null) {
  player.x = x; player.y = y; player.yaw = yaw; player.pitch = pitch; player.vz = 0;
  const f = state.world.floorAt(x, y, feet ?? 50);
  player.feet = feet !== null ? state.world.floorAt(x, y, feet).h : f.h;
  if (feet === null) {
    // prefer the lowest walkable floor (ground level) when teleporting from the map
    const surf = state.world.surfaces(x, y).map((s) => s.h).filter((h) => h < (state.plan.levels[1]?.elevation ?? 99) - 0.5);
    if (surf.length) player.feet = Math.max(...surf);
  }
  player.eye = player.feet + EYE;
  applyCamera();
}
function applyCamera() {
  camera.position.copy(W(player.x, player.y, player.eye));
  camera.rotation.set(player.pitch, -player.yaw, 0, 'YXZ');
}

// ---------- input
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  const k = e.key.toLowerCase();
  if (k === 'v') setMode(state.mode === 'walk' ? 'orbit' : 'walk');
  else if (k === 't') topDown(Math.max(0, currentLevelIndex()));
  else if (k === 'h' || k === '?') $('help').classList.toggle('hidden');
  else if (k === 'm') $('minimap').classList.toggle('hidden');
  else if (k === 'r') { respawn(); }
  else if (/^[0-9]$/.test(k)) { const i = +k - 1; if (i < state.plan.levels.length) { if (state.mode === 'walk') setMode('orbit'); setCut(i); } }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const canvas = renderer.domElement;
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'walk') return;
  if (e.pointerType === 'mouse' && !document.pointerLockElement) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', (e) => {
  if (state.mode !== 'walk') return;
  if (document.pointerLockElement === canvas) { look(e.movementX, e.movementY, 0.0022); return; }
  if (drag && drag.id === e.pointerId) { look(e.clientX - drag.x, e.clientY - drag.y, e.pointerType === 'touch' ? 0.005 : 0.004); drag.x = e.clientX; drag.y = e.clientY; }
});
addEventListener('pointerup', (e) => { if (drag && drag.id === e.pointerId) drag = null; });
document.addEventListener('pointerlockchange', () => document.body.classList.toggle('locked', document.pointerLockElement === canvas));
function look(dx, dy, s) {
  player.yaw += dx * s;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * s));
}
// virtual joystick
const joy = { x: 0, y: 0, id: null };
const jEl = $('joystick'), stick = $('stick');
jEl.addEventListener('pointerdown', (e) => { joy.id = e.pointerId; jEl.setPointerCapture(e.pointerId); moveJoy(e); e.stopPropagation(); });
jEl.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) moveJoy(e); });
const endJoy = (e) => { if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; stick.style.transform = ''; } };
jEl.addEventListener('pointerup', endJoy); jEl.addEventListener('pointercancel', endJoy);
function moveJoy(e) {
  const r = jEl.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
  joy.x = dx; joy.y = -dy; stick.style.transform = `translate(${dx * 35}px, ${-joy.y * 35}px)`;
}

// UI buttons
$('modeBtn').onclick = () => setMode(state.mode === 'walk' ? 'orbit' : 'walk');
$('topBtn').onclick = () => topDown(Math.max(0, currentLevelIndex()));
$('helpBtn').onclick = () => $('help').classList.toggle('hidden');
$('help').onclick = () => $('help').classList.add('hidden');
$('notesBtn').onclick = () => $('notes').classList.toggle('hidden');
$('openBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; };
$('planSelect').onchange = (e) => { const url = e.target.value; if (url) { history.replaceState(null, '', `?plan=${encodeURIComponent(url)}`); loadPlanUrl(url); } };
function readFile(file) {
  const fr = new FileReader();
  fr.onload = () => { try { if (loadPlanObject(JSON.parse(fr.result), file.name)) toast(`Loaded ${file.name}`, 2000); } catch (e) { toast('Invalid JSON: ' + e.message, 6000); } };
  fr.readAsText(file);
}
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const f = e.dataTransfer.files[0];
  if (f) readFile(f);
  else { const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (url) loadPlanUrl(url.trim()); }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});

// ---------- per-frame walking
function currentLevelIndex() {
  const p = state.plan; if (!p) return 0;
  if (state.mode === 'orbit' && state.cut >= 0) return state.cut;
  let idx = 0; p.levels.forEach((l, i) => { if (player.feet >= l.elevation - 0.3) idx = i; });
  return idx;
}
function whereAmI() {
  const p = state.plan; const li = currentLevelIndex(); const lvl = p.levels[li];
  const room = p.rooms.find((r) => r.level === lvl.id && pointInPolygon([player.x, player.y], r.polygon));
  if (room) return room.name;
  for (const s of p.stairs) { const st = state.build.ramps.find((r) => r.s === s); if (st && pointInPolygon([player.x, player.y], st.R.poly)) return 'Stairs'; }
  const order = ['pool', 'deck', 'patio', 'paving', 'driveway', 'planter', 'garden', 'lawn'];
  const feats = p.site.features.filter((f) => order.includes(f.type) && pointInPolygon([player.x, player.y], f.polygon)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  if (feats.length) return feats[0].name;
  return 'Outside';
}
function stepWalk(dt) {
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + joy.y;
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + joy.x;
  const turn = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  player.yaw += turn * dt * 1.8;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3.4 : 1.7;
  let mx = Math.sin(player.yaw) * fwd + Math.cos(player.yaw) * strafe;
  let my = Math.cos(player.yaw) * fwd - Math.sin(player.yaw) * strafe;
  const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  const dist = speed * dt;
  const n = Math.max(1, Math.ceil((dist * Math.max(ml, 0.0001)) / 0.08));
  const w = state.world;
  for (let i = 0; i < n; i++) {
    const pos = { x: player.x + (mx * dist) / n, y: player.y + (my * dist) / n };
    w.collide(pos, player.feet);
    const f = w.floorAt(pos.x, pos.y, player.feet);
    player.x = pos.x; player.y = pos.y;
    if (f.h >= player.feet - 0.02) { player.feet = Math.max(player.feet, f.h); player.vz = 0; player.feet = f.h > player.feet ? f.h : f.h; }
  }
  // gravity
  const g = w.floorAt(player.x, player.y, player.feet);
  if (player.feet > g.h + 0.001) { player.vz -= 9.8 * dt; player.feet = Math.max(g.h, player.feet + player.vz * dt); if (player.feet === g.h) player.vz = 0; }
  else { player.feet = g.h; player.vz = 0; }
  const target = player.feet + EYE;
  player.eye += (target - player.eye) * Math.min(1, dt * 14);
  if (Math.abs(target - player.eye) > 1.2) player.eye = target;
  applyCamera();
}

// ---------- loop
let lastT = performance.now();
let lastRoom = '', frames = 0;
function frame() {
  const now = performance.now(); const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (state.build) {
    if (state.mode === 'walk') stepWalk(dt); else orbit.update();
    const room = state.mode === 'walk' ? whereAmI() : '';
    if (room !== lastRoom) { $('roomName').textContent = room; lastRoom = room; }
    if (!$('minimap').classList.contains('hidden')) {
      const lvl = state.plan.levels[currentLevelIndex()];
      const pp = state.mode === 'walk' ? player : camPlayer();
      minimap.draw(lvl.id, pp);
    }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    frames++;
  }
  requestAnimationFrame(frame);
}
function camPlayer() {
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  return { x: camera.position.x, y: -camera.position.z, yaw: Math.atan2(dir.x, -dir.z) };
}

// ---------- boot
async function boot() {
  const params = new URLSearchParams(location.search);
  let list = [];
  if (IS_FILE) list = bundledIndex;
  else try { const r = await fetch('./plans/index.json', { cache: 'no-cache' }); if (r.ok) list = await r.json(); } catch (_) {}
  if (!list.length) list = bundledIndex;
  const sel = $('planSelect');
  sel.innerHTML = list.map((p) => `<option value="${esc(p.url)}">${esc(p.name)}</option>`).join('');
  let url = params.get('plan') || (list[0] && list[0].url) || './plans/cozy-3-bed.json';
  if (![...sel.options].some((o) => o.value === url)) { const o = document.createElement('option'); o.value = url; o.textContent = url.split('/').pop(); sel.appendChild(o); }
  sel.value = url;
  let ok = await loadPlanUrl(url);
  if (!ok && list[0] && url !== list[0].url) ok = await loadPlanUrl(list[0].url);
  if (!ok) { loadPlanObject(bundledPlan, 'bundled'); toast('Loaded the built-in copy of the cozy 3-bed plan (plans/ folder not reachable, e.g. opened from file://)', 6000); }
  const view = params.get('view');
  if (view === 'walk') setMode('walk'); else if (view === 'top') topDown(+(params.get('level') || 0)); else setMode('orbit');
  if (!localStorage.getItem('house3d-help-seen')) { $('help').classList.remove('hidden'); localStorage.setItem('house3d-help-seen', '1'); setTimeout(() => $('help').classList.add('hidden'), 6000); }
  requestAnimationFrame(frame);
  window.__app.ready = true;
}

// ---------- test / automation hooks
window.__app = {
  ready: false,
  get state() { return state; }, player, THREE, camera, scene, renderer,
  frames: () => frames,
  loadUrl: loadPlanUrl,
  walk(x, y, yawDeg = 0, pitchDeg = 0, feet = null) { setMode('walk'); teleport(x, y, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180, feet); },
  orbitView(pos, target, fov = 50) { setMode('orbit'); setCut(-1); camera.fov = fov; camera.updateProjectionMatrix(); camera.position.copy(W(...pos)); orbit.target.copy(W(...target)); orbit.update(); },
  topDown, setCut, setMode, whereAmI,
  hideUI(h = true) { for (const id of ['help', 'notes']) $(id).classList.add('hidden'); },
  simulate(codes, seconds, dt = 1 / 60) { codes.forEach((c) => keys.add(c)); for (let t = 0; t < seconds; t += dt) stepWalk(dt); codes.forEach((c) => keys.delete(c)); return { room: whereAmI(), x: +player.x.toFixed(2), y: +player.y.toFixed(2), feet: +player.feet.toFixed(2) }; },
  press(code, ms) { keys.add(code); return new Promise((r) => setTimeout(() => { keys.delete(code); r({ ...player }); }, ms)); },
  info() { return { mode: state.mode, cut: state.cut, room: whereAmI(), player: { ...player }, warnings: state.plan.warnings, meshes: countMeshes(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
};
function countMeshes() { let n = 0; state.build?.root.traverse((o) => o.isMesh && n++); return n; }
boot();
