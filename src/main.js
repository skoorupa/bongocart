// =====================================================================
// main.js — ETAP 2: jeden kart na losowym torze, fizyka, kamera.
// Esc otwiera panel ustawień (lokalny "host"; w etapie 6 trafi do lobby).
// =====================================================================
import * as THREE from 'three';
import { SETTINGS_SCHEMA, RENDER, PHYSICS, KART_COLORS } from './config.js';
import { defaultSettings, applySettingChange, randomSeed } from './settings.js';
import { generateTrack, trackParamsFromSettings } from './track/generator.js';
import { buildTrackVisual, applyThemeToScene, disposeObject } from './track/trackMesh.js';
import { createSettingsForm } from './ui/settingsForm.js';
import { createMinimap } from './ui/minimap.js';
import { createInput } from './input.js';
import { createKartState, stepKart, kartStats, resetKartToTrack } from './physics.js';
import { createKartMesh } from './kartMesh.js';
import { createChaseCamera } from './camera.js';

const $ = (id) => document.getElementById(id);
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// --- Renderer i scena
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: $('game') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
const scene = new THREE.Scene();
const chase = createChaseCamera();
const minimap = createMinimap($('minimap'));
const input = createInput();

// --- Stan
let settings = defaultSettings();
let randomTrackSeed = randomSeed(); // używany, gdy pole seeda jest puste
let track = null;
let visual = null;
let stats = null;
let kart = null; // stan fizyczny
let prev = null; // stan z poprzedniego kroku (interpolacja)
const kartColor = KART_COLORS[0];
const kartMesh = createKartMesh(kartColor);
scene.add(kartMesh.object);

const form = createSettingsForm($('settings'), SETTINGS_SCHEMA, {
  onChange(key, value) {
    const next = applySettingChange(settings, key, value);
    if (next) {
      settings = next;
      rebuild();
    }
    form.setValues(settings); // odrzucona wartość wraca do poprzedniej
  },
});
form.setValues(settings);

function rebuild() {
  const seed = settings.trackSeed || randomTrackSeed;
  track = generateTrack(trackParamsFromSettings(settings, seed));
  if (visual) {
    scene.remove(visual.group);
    disposeObject(visual.group);
  }
  visual = buildTrackVisual(track);
  visual.debug.visible = $('showDebug').checked;
  scene.add(visual.group);
  applyThemeToScene(scene, track.theme, true);
  minimap.setTrack(track);
  $('seedLabel').textContent = `Seed: ${seed} · ${Math.round(track.length)} m`;

  stats = kartStats(settings.speedClass);
  kart = createKartState(track, 0);
  prev = { x: kart.x, z: kart.z, heading: kart.heading };
  chase.snap(viewOf(kart, 1));
}

// --- Panel ustawień (Esc). Gdy otwarty, symulacja stoi.
let paused = false;
function setPaused(p) {
  paused = p;
  $('panel').hidden = !p;
  if (!p) document.activeElement?.blur?.(); // klawisze wracają do gry
}
$('newTrack').addEventListener('click', () => {
  randomTrackSeed = randomSeed();
  settings = applySettingChange(settings, 'trackSeed', '');
  form.setValues(settings);
  rebuild();
});
$('pinSeed').addEventListener('click', () => {
  const next = applySettingChange(settings, 'trackSeed', track.seed);
  if (next) { settings = next; form.setValues(settings); }
});
$('resume').addEventListener('click', () => setPaused(false));
$('showDebug').addEventListener('change', (e) => { visual.debug.visible = e.target.checked; });

// Stan do rysowania: interpolacja między krokami fizyki (płynność przy
// dowolnym odświeżaniu monitora).
function viewOf(k, alpha, lookBack = false) {
  return {
    x: prev.x + (k.x - prev.x) * alpha,
    z: prev.z + (k.z - prev.z) * alpha,
    heading: lerpAngle(prev.heading, k.heading, alpha),
    speed: k.speed,
    steer: k.steer,
    drift: k.drift,
    boostTime: k.boostTime,
    speedFrac: Math.abs(k.speed) / stats.maxSpeed,
    boosting: k.boostTime > 0,
    driftDir: k.drift.active ? k.drift.dir : 0,
    lookBack,
  };
}

// --- Pętla
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  chase.setAspect(w / h);
}
window.addEventListener('resize', resize);
resize();
rebuild();
setPaused(false);

const clock = new THREE.Clock();
let acc = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), PHYSICS.fixedDt * PHYSICS.maxStepsPerFrame);
  const ctl = input.read();
  if (ctl.menuPressed) setPaused(!paused);

  if (!paused) {
    if (ctl.resetPressed) {
      resetKartToTrack(kart, track);
      prev = { x: kart.x, z: kart.z, heading: kart.heading };
    }
    acc += dt;
    while (acc >= PHYSICS.fixedDt) {
      prev = { x: kart.x, z: kart.z, heading: kart.heading };
      stepKart(kart, ctl, track, stats, PHYSICS.fixedDt);
      acc -= PHYSICS.fixedDt;
    }
  }

  const view = viewOf(kart, paused ? 1 : acc / PHYSICS.fixedDt, ctl.lookBack);
  kartMesh.update(view, paused ? 0 : dt);
  chase.update(view, dt);
  minimap.draw([{ x: view.x, z: view.z, color: kartColor, isLocal: true }]);
  $('speed').textContent = Math.round(Math.abs(kart.speed) * 3.6);
  $('hud').dataset.surface = kart.surface;
  renderer.render(scene, chase.camera);
});
