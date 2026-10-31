// =====================================================================
// main.js — ETAP 3: lobby (ustawienia, podgląd toru) -> odliczanie ->
// wyścig na N okrążeń -> wyniki -> lobby. Jeden kart lokalny; w etapie 4
// dojdą boty, w etapie 6 sieć (lobby to wtedy pokój PeerJS).
// =====================================================================
import * as THREE from 'three';
import { SETTINGS_SCHEMA, RENDER, PHYSICS, KART_COLORS, RACE } from './config.js';
import { defaultSettings, applySettingChange, randomSeed } from './settings.js';
import { generateTrack, trackParamsFromSettings } from './track/generator.js';
import { buildTrackVisual, applyThemeToScene, disposeObject } from './track/trackMesh.js';
import { createSettingsForm } from './ui/settingsForm.js';
import { createMinimap } from './ui/minimap.js';
import { createInput } from './input.js';
import { createKartState, stepKart, kartStats, resetKartToTrack } from './physics.js';
import { createKartMesh } from './kartMesh.js';
import { createChaseCamera } from './camera.js';
import { createRace, updateRace } from './race.js';
import { createHud } from './ui/hud.js';

const $ = (id) => document.getElementById(id);
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// --- Renderer i scena
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: $('game') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
const scene = new THREE.Scene();
const chase = createChaseCamera();
const minimap = createMinimap($('minimap'));
const input = createInput();
const hud = createHud();
const LOCAL_ID = 'local';
const NEUTRAL = { throttle: 0, brake: 0, steer: 0, drift: false };

// --- Stan
let settings = defaultSettings();
let randomTrackSeed = randomSeed(); // używany, gdy pole seeda jest puste
let track = null;
let visual = null;
let stats = null;
let kart = null; // stan fizyczny
let prev = null; // stan z poprzedniego kroku (interpolacja)
let race = null; // null = lobby
let resultsIn = null; // odliczanie do pokazania tabeli wyników
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
  resetKarts();
}

function resetKarts() {
  kart = createKartState(track, 0);
  prev = { x: kart.x, z: kart.z, heading: kart.heading };
  chase.snap(viewOf(kart, 1));
}

// --- Tryby: lobby (panel ustawień) i wyścig. Ustawienia są zablokowane
// w trakcie wyścigu. Pauza (Esc) działa tylko w grze lokalnej — w sieci
// (etap 6) Esc pokaże menu bez zatrzymywania symulacji.
let paused = false;
function enterLobby() {
  race = null;
  resultsIn = null;
  paused = false;
  $('pause').hidden = true;
  hud.hideResults();
  hud.setRaceVisible(false);
  form.setReadOnly(false);
  $('panel').hidden = false;
  resetKarts();
}
function startRace() {
  resetKarts();
  race = createRace({
    track,
    laps: settings.laps,
    racers: [{ id: LOCAL_ID, name: 'Ty', color: kartColor, isHuman: true }],
  });
  form.setReadOnly(true);
  $('panel').hidden = true;
  hud.setRaceVisible(true);
  document.activeElement?.blur?.(); // klawisze wracają do gry
}
function setPaused(p) {
  paused = p;
  $('pause').hidden = !p;
  if (p) $('resume').focus();
  else document.activeElement?.blur?.();
}
$('startRace').addEventListener('click', startRace);
$('resume').addEventListener('click', () => setPaused(false));
$('quitRace').addEventListener('click', enterLobby);
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
enterLobby();

// Podgląd stanu z konsoli (http://.../?debug) — do strojenia i testów ręcznych.
if (new URLSearchParams(location.search).has('debug')) {
  window.bongo = { get kart() { return kart; }, get track() { return track; }, get race() { return race; } };
}

const clock = new THREE.Clock();
let acc = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), PHYSICS.fixedDt * PHYSICS.maxStepsPerFrame);
  const ctl = input.read();
  if (ctl.menuPressed && race && resultsIn === null && $('results').hidden) setPaused(!paused);

  const simulate = race && !paused;
  if (simulate) {
    const me = race.racers[0];
    // Sterowanie tylko w trakcie jazdy; w odliczaniu i po mecie kart toczy się sam.
    const canDrive = race.phase === 'racing' && me.finishTime === null;
    if (ctl.resetPressed && canDrive) {
      resetKartToTrack(kart, track);
      prev = { x: kart.x, z: kart.z, heading: kart.heading };
    }
    acc += dt;
    const karts = new Map([[LOCAL_ID, kart]]);
    while (acc >= PHYSICS.fixedDt) {
      prev = { x: kart.x, z: kart.z, heading: kart.heading };
      const live = race.phase === 'racing' && me.finishTime === null; // zmienia się w trakcie pętli
      stepKart(kart, live ? ctl : NEUTRAL, track, stats, PHYSICS.fixedDt);
      const events = updateRace(race, PHYSICS.fixedDt, karts);
      hud.handleEvents(events, LOCAL_ID, race);
      if (events.some((e) => e.type === 'end')) resultsIn = RACE.resultsDelaySeconds;
      acc -= PHYSICS.fixedDt;
    }
    if (resultsIn !== null) {
      resultsIn -= dt;
      if (resultsIn <= 0) {
        resultsIn = null;
        hud.showResults(race, LOCAL_ID, enterLobby);
      }
    }
    hud.update(race, LOCAL_ID, dt);
  }

  const view = viewOf(kart, simulate ? acc / PHYSICS.fixedDt : 1, ctl.lookBack && simulate);
  kartMesh.update(view, simulate ? dt : 0);
  chase.update(view, dt);
  minimap.draw([{ x: view.x, z: view.z, color: kartColor, isLocal: true }]);
  $('speed').textContent = Math.round(Math.abs(kart.speed) * 3.6);
  $('hud').dataset.surface = kart.surface;
  renderer.render(scene, chase.camera);
});
