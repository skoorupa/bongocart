// =====================================================================
// main.js — ETAP 1: podgląd generatora toru.
// Formularz ustawień działa tu jak lokalny "host" (walidacja przez
// settings.js). W etapie 6 ten sam formularz trafi do lobby.
// =====================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SETTINGS_SCHEMA, RENDER, KART, TRACK, THEMES } from './config.js';
import { defaultSettings, applySettingChange, randomSeed } from './settings.js';
import { generateTrack, trackParamsFromSettings, gridSlot } from './track/generator.js';
import { buildTrackVisual, applyThemeToScene, disposeObject } from './track/trackMesh.js';
import { createSettingsForm } from './ui/settingsForm.js';
import { createMinimap } from './ui/minimap.js';

const $ = (id) => document.getElementById(id);

// --- Renderer i scena
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: $('game') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49; // nie schodzimy pod podłoże

const minimap = createMinimap($('minimap'));

// --- Stan
let settings = defaultSettings();
let randomTrackSeed = randomSeed(); // używany, gdy pole seeda jest puste
let track = null;
let visual = null;

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
  const t0 = performance.now();
  track = generateTrack(trackParamsFromSettings(settings, seed));
  const genMs = performance.now() - t0;

  if (visual) {
    scene.remove(visual.group);
    disposeObject(visual.group);
  }
  visual = buildTrackVisual(track);
  visual.debug.visible = $('showDebug').checked;
  scene.add(visual.group);
  applyThemeToScene(scene, track.theme, $('showFog').checked);

  minimap.setTrack(track);
  // Pola startowe jako kropki — test minimapy przed etapem 2.
  minimap.draw(Array.from({ length: settings.minRacers }, (_, i) => ({ ...gridSlot(track, i), color: 0xffd166, isLocal: i === 0 })));

  frameCamera();
  showStats(seed, genMs);
}

function frameCamera() {
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);
  controls.target.set(cx, 0, cz);
  camera.position.set(cx, span * 0.75, cz + span * 0.6);
  controls.update();
}

function showStats(seed, genMs) {
  const lapSec = track.length / (KART.baseMaxSpeed * TRACK.avgSpeedFraction);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const rows = [
    ['Seed', seed],
    ['Długość', `${Math.round(track.length)} m`],
    ['Szac. okrążenie', `${lapSec.toFixed(0)} s`],
    [`Wyścig (${settings.laps} okr.)`, fmt(lapSec * settings.laps)],
    ['Checkpointy', track.checkpoints.length],
    ['Skrzynki', track.itemBoxes.length],
    ['Motyw', THEMES[track.themeId].label],
    ['Próby generacji', track.attempts],
    ['Czas generacji', `${genMs.toFixed(1)} ms`],
  ];
  $('stats').replaceChildren(...rows.map(([k, v]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${k}</th><td></td>`;
    tr.lastChild.textContent = v;
    return tr;
  }));
}

// --- Przyciski
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
$('showFog').addEventListener('change', (e) => applyThemeToScene(scene, track.theme, e.target.checked));

// --- Pętla
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
rebuild();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
