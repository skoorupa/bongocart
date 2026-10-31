// =====================================================================
// main.js — ETAP 5: lobby (ustawienia, podgląd toru i stawki) ->
// odliczanie -> wyścig z botami i przedmiotami -> wyniki -> lobby.
// Symulację liczy game.js; tutaj tylko wejście, rysowanie i UI.
// W etapie 6 dojdzie sieć (lobby = pokój PeerJS, host liczy game.js).
// =====================================================================
import * as THREE from 'three';
import { SETTINGS_SCHEMA, RENDER, PHYSICS, KART_COLORS, RACE } from './config.js';
import { defaultSettings, applySettingChange, randomSeed } from './settings.js';
import { generateTrack, trackParamsFromSettings } from './track/generator.js';
import { buildTrackVisual, applyThemeToScene, disposeObject } from './track/trackMesh.js';
import { createSettingsForm } from './ui/settingsForm.js';
import { createMinimap } from './ui/minimap.js';
import { createInput } from './input.js';
import { createKartMesh } from './kartMesh.js';
import { createItemsView } from './itemsMesh.js';
import { createChaseCamera } from './camera.js';
import { createGame } from './game.js';
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

// Gracz lokalny (imię i kolor wybierane w lobby w etapie 6).
const LOCAL = { id: 'local', name: 'Ty', color: KART_COLORS[0] };

// --- Stan
let settings = defaultSettings();
let randomTrackSeed = randomSeed(); // używany, gdy pole seeda jest puste
let trackKey = null; // parametry, z których powstał bieżący tor
let track = null;
let visual = null;
let itemsView = null;
let game = null; // w lobby: podgląd stawki (bez kroków symulacji)
let inRace = false;
let paused = false;
let resultsIn = null; // odliczanie do pokazania tabeli wyników
const meshes = new Map(); // id -> mesh karta
const prev = new Map(); // id -> stan z poprzedniego kroku (interpolacja)

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

// Tor generujemy tylko, gdy zmieniły się jego parametry; resztę ustawień
// (okrążenia, boty, klasa...) odświeża nowa gra.
function rebuild() {
  const seed = settings.trackSeed || randomTrackSeed;
  const params = trackParamsFromSettings(settings, seed);
  const key = JSON.stringify(params);
  if (key !== trackKey) {
    trackKey = key;
    track = generateTrack(params);
    if (visual) {
      scene.remove(visual.group);
      disposeObject(visual.group);
    }
    visual = buildTrackVisual(track);
    visual.debug.visible = $('showDebug').checked;
    scene.add(visual.group);
    if (itemsView) {
      scene.remove(itemsView.group);
      itemsView.dispose();
    }
    itemsView = createItemsView(track);
    scene.add(itemsView.group);
    applyThemeToScene(scene, track.theme, true);
    minimap.setTrack(track);
    $('seedLabel').textContent = `Seed: ${seed} · ${Math.round(track.length)} m`;
  }
  newGame();
}

function newGame() {
  game = createGame({ track, settings, humans: [LOCAL], seed: randomSeed() });
  for (const m of meshes.values()) {
    scene.remove(m.object);
    m.dispose();
  }
  meshes.clear();
  prev.clear();
  for (const r of game.roster) {
    const m = createKartMesh(r.color);
    meshes.set(r.id, m);
    scene.add(m.object);
  }
  savePrev();
  for (const [id, m] of meshes) m.update(viewOf(id, 1), 0);
  chase.snap(viewOf(LOCAL.id, 1));
}

function savePrev() {
  for (const [id, k] of game.karts) prev.set(id, { x: k.x, z: k.z, heading: k.heading });
}

// --- Tryby: lobby (panel ustawień) i wyścig. Ustawienia są zablokowane
// w trakcie wyścigu. Pauza (Esc) działa tylko w grze lokalnej — w sieci
// (etap 6) Esc pokaże menu bez zatrzymywania symulacji.
function enterLobby() {
  inRace = false;
  resultsIn = null;
  paused = false;
  $('pause').hidden = true;
  hud.hideResults();
  hud.setRaceVisible(false);
  form.setReadOnly(false);
  $('panel').hidden = false;
  newGame();
}
function startRace() {
  newGame();
  inRace = true;
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
function viewOf(id, alpha, lookBack = false) {
  const k = game.karts.get(id), p = prev.get(id);
  return {
    x: p.x + (k.x - p.x) * alpha,
    z: p.z + (k.z - p.z) * alpha,
    heading: lerpAngle(p.heading, k.heading, alpha),
    speed: k.speed,
    steer: k.steer,
    drift: k.drift,
    boostTime: k.boostTime,
    spinTime: k.spinTime,
    shieldTime: k.shieldTime,
    speedFrac: Math.abs(k.speed) / game.stats.maxSpeed,
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
  window.bongo = {
    get game() { return game; },
    get kart() { return game.karts.get(LOCAL.id); },
    get track() { return track; },
    get race() { return inRace ? game.race : null; },
  };
}

const clock = new THREE.Clock();
let acc = 0;
let pending = { reset: false, item: false };
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), PHYSICS.fixedDt * PHYSICS.maxStepsPerFrame);
  const ctl = input.read();
  if (ctl.menuPressed && inRace && resultsIn === null && $('results').hidden) setPaused(!paused);

  const simulate = inRace && !paused;
  if (simulate) {
    acc += dt;
    // Akcje jednorazowe (reset, przedmiot) czekają na pierwszy krok
    // fizyki — klatka może nie mieć żadnego kroku.
    pending.reset ||= ctl.resetPressed;
    pending.item ||= ctl.itemPressed;
    while (acc >= PHYSICS.fixedDt) {
      savePrev();
      const inputs = new Map([[LOCAL.id, { ...ctl, ...pending }]]);
      pending = { reset: false, item: false };
      const events = game.step(PHYSICS.fixedDt, inputs);
      hud.handleEvents(events, LOCAL.id, game.race);
      if (events.some((e) => e.type === 'end')) resultsIn = RACE.resultsDelaySeconds;
      acc -= PHYSICS.fixedDt;
    }
    if (resultsIn !== null) {
      resultsIn -= dt;
      if (resultsIn <= 0) {
        resultsIn = null;
        hud.showResults(game.race, LOCAL.id, enterLobby);
      }
    }
    hud.update(game.race, LOCAL.id, dt, game.items);
  }

  const alpha = simulate ? acc / PHYSICS.fixedDt : 1;
  for (const [id, m] of meshes) m.update(viewOf(id, alpha), simulate ? dt : 0);
  itemsView.update(game.items, simulate || !inRace ? dt : 0);
  const me = viewOf(LOCAL.id, alpha, ctl.lookBack && simulate);
  chase.update(me, dt);
  minimap.draw(game.roster.map((r) => {
    const v = r.id === LOCAL.id ? me : viewOf(r.id, alpha);
    return { x: v.x, z: v.z, color: r.color, isLocal: r.id === LOCAL.id };
  }));
  const k = game.karts.get(LOCAL.id);
  $('speed').textContent = Math.round(Math.abs(k.speed) * 3.6);
  $('hud').dataset.surface = k.surface;
  renderer.render(scene, chase.camera);
});
