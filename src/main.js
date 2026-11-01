// =====================================================================
// main.js — lobby (solo albo pokój PeerJS) -> odliczanie ->
// wyścig z botami i przedmiotami -> wyniki -> lobby.
//
// Tryby:
//   solo   — wszystko lokalnie (jak w etapach 1–5)
//   host   — liczy grę (game.js), rozsyła stan, przyjmuje sterowanie
//   client — przewiduje własny kart, resztę dostaje od hosta
// Symulacja: game.js / net/*; tutaj wejście, rysowanie i UI.
// =====================================================================
import * as THREE from 'three';
import { SETTINGS_SCHEMA, RENDER, PHYSICS, KART_COLORS, RACE, NET, MAX_RACERS, GAME_VERSION, PRESETS, AUDIO, CAMERA, OBSTACLES } from './config.js';
import { defaultSettings, applySettingChange, randomSeed, sanitizeSettings } from './settings.js';
import { generateTrack, trackParamsFromSettings } from './track/generator.js';
import { buildTrackVisual, applyThemeToScene, disposeObject } from './track/trackMesh.js';
import { createSettingsForm } from './ui/settingsForm.js';
import { createMinimap } from './ui/minimap.js';
import { createLobbyPanel } from './ui/lobbyPanel.js';
import { createInput } from './input.js';
import { createKartMesh } from './kartMesh.js';
import { createItemsView } from './itemsMesh.js';
import { buildObstaclesVisual } from './track/obstacleMesh.js';
import { createChaseCamera } from './camera.js';
import { createGame, buildRoster } from './game.js';
import { createTournament, mapSeedOf } from './tournament.js';
import { createHud } from './ui/hud.js';
import { createAudio } from './audio.js';
import { createRng, deriveSeed } from './rng.js';
import { hostRoom, joinRoom, normalizeRoomCode } from './net/peer.js';
import { createHostSession, createClientSession } from './net/session.js';
import { createClientSim } from './net/clientSim.js';
import { sanitizeName, HOST_ID } from './net/lobby.js';

const $ = (id) => document.getElementById(id);
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const SOLO_ID = 'local';

// --- Renderer i scena
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: $('game') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
const scene = new THREE.Scene();
const chase = createChaseCamera();
const minimap = createMinimap($('minimap'));
const input = createInput();
const hud = createHud();
const audio = createAudio();

// --- Profil gracza (pamiętany w przeglądarce; może się nie udać — wtedy domyślny).
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(NET.profileStorageKey));
    return { name: sanitizeName(p?.name, ''), color: KART_COLORS.includes(p?.color) ? p.color : KART_COLORS[0] };
  } catch {
    return { name: '', color: KART_COLORS[0] };
  }
}
function saveProfile(p) {
  try { localStorage.setItem(NET.profileStorageKey, JSON.stringify(p)); } catch { /* tryb prywatny itp. */ }
}

// --- Stan
let profile = loadProfile();
let mode = 'solo'; // solo | connecting | host | client
let transport = null; // peer.js
let host = null; // sesja hosta
let client = null; // sesja klienta
let localId = SOLO_ID;
let roomCode = '';
let lobbyPlayers = []; // klient: lista od hosta
let hostRacing = false; // klient: host jest w trakcie wyścigu

let settings = defaultSettings();
let randomTrackSeed = randomSeed(); // używany, gdy pole seeda jest puste
let trackKey = null; // parametry, z których powstał bieżący tor
let track = null;
let visual = null;
let itemsView = null;
let game = null; // w lobby: podgląd stawki (bez kroków symulacji)
let sim = null; // klient: predykcja + interpolacja
let inRace = false;
let menuOpen = false;
let resultsIn = null; // odliczanie do pokazania tabeli wyników
let tournament = null; // turniej (host/solo są jego właścicielem; klient: null)
let tourneyView = null; // widok turnieju do pokazania (host/solo: z tournament, klient: z wiadomości)
let hostTick = 0;
let pendingEvents = []; // host: zdarzenia do najbliższego snapshotu
const meshes = new Map(); // id -> mesh karta
const prev = new Map(); // id -> stan z poprzedniego kroku (interpolacja)

const effectiveSeed = () => settings.trackSeed || randomTrackSeed;
// Seed toru w lobby: w trybie turnieju podgląd mapy 1.
const lobbyTrackSeed = () => (settings.gameMode === 'tournament' ? mapSeedOf(effectiveSeed(), 0) : effectiveSeed());
const isOnline = () => mode === 'host' || mode === 'client';

// --- Formularz ustawień: zmienia tylko solo/host; host rozsyła wynik.
const form = createSettingsForm($('settings'), SETTINGS_SCHEMA, {
  onChange(key, value) {
    const next = mode === 'client' ? null : applySettingChange(settings, key, value);
    if (next) {
      settings = next;
      roomChanged();
    }
    form.setValues(settings); // odrzucona wartość wraca do poprzedniej
  },
});

const lobbyUi = createLobbyPanel({
  profile(p) {
    profile = { name: sanitizeName(p.name, ''), color: p.color };
    saveProfile(profile);
    if (mode === 'host') host.setHostProfile(profile);
    else if (mode === 'client') client.setProfile(profile);
    else refreshLobby();
  },
  create: createRoom,
  join: (code) => joinByCode(code),
  leave: () => leaveRoom('Opuszczono pokój.'),
  copyLink() {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard?.writeText(url).then(
      () => lobbyUi.setStatus('Link skopiowany — wyślij go znajomym.'),
      () => lobbyUi.setStatus(`Link: ${url}`));
  },
});
lobbyUi.setProfile(profile);

// --- Presety: zestawy ustawień rozgrywki (solo/host). Każda wartość
// przechodzi tę samą walidację co zmiana z formularza.
const presetButtons = Object.entries(PRESETS).map(([id, preset]) => {
  const b = document.createElement('button');
  b.textContent = preset.label;
  b.addEventListener('click', () => {
    if (mode === 'client' || inRace) return;
    for (const [key, value] of Object.entries(preset.values)) settings = applySettingChange(settings, key, value) ?? settings;
    form.setValues(settings);
    roomChanged();
  });
  $('presets').append(b);
  return { b, preset };
});
const presetActive = (preset) => Object.entries(preset.values).every(([k, v]) => JSON.stringify(settings[k]) === JSON.stringify(v));

// --- Dźwięk: M albo przycisk.
function renderMute() {
  const label = audio.muted ? '🔇 Dźwięk wyłączony (M)' : '🔊 Dźwięk włączony (M)';
  $('muteToggle').textContent = $('muteToggleMenu').textContent = label;
}
for (const id of ['muteToggle', 'muteToggleMenu']) $(id).addEventListener('click', () => { audio.toggleMuted(); renderMute(); });
renderMute();

// --- Tor i podgląd stawki
function rebuildTrack(seed = lobbyTrackSeed()) {
  const params = trackParamsFromSettings(settings, seed);
  const key = JSON.stringify(params);
  if (key === trackKey) return;
  trackKey = key;
  track = generateTrack(params);
  if (visual) {
    scene.remove(visual.group);
    disposeObject(visual.group);
  }
  visual = buildTrackVisual(track);
  visual.group.add(buildObstaclesVisual(track)); // sprzątane razem z torem (disposeObject)
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

// Ludzie w lobby (kolejność = kolejność dołączania).
function lobbyHumans() {
  if (mode === 'host') return host.lobby.players.map(({ id, name, color }) => ({ id, name, color }));
  if (mode === 'client') return lobbyPlayers.map(({ id, name, color }) => ({ id, name, color }));
  return [{ id: SOLO_ID, name: profile.name || 'Ty', color: profile.color }];
}

function setGame(g) {
  game = g;
  for (const m of meshes.values()) {
    scene.remove(m.object);
    m.dispose();
  }
  meshes.clear();
  prev.clear();
  for (const r of game.roster) {
    const m = createKartMesh(r.color, r.id === localId ? null : r.name);
    meshes.set(r.id, m);
    scene.add(m.object);
  }
  savePrev();
  const followId = game.karts.has(localId) ? localId : game.roster[0].id;
  for (const id of meshes.keys()) meshes.get(id).update(viewOf(id, 1), 0);
  chase.snap(viewOf(followId, 1));
}

// Lobby: podgląd toru i stawki (ludzie + boty) bez symulacji.
function refreshLobby() {
  rebuildTrack();
  if (!inRace) setGame(createGame({ track, settings, humans: lobbyHumans(), seed: 'preview' }));
  updateLobbyUi();
}

// Zmiana ustawień/seeda u hosta albo solo.
function roomChanged() {
  if (mode === 'host') host.setRoom({ settings, seed: effectiveSeed() });
  refreshLobby();
}

function updateLobbyUi() {
  const players = mode === 'host' ? host.lobby.players : mode === 'client' ? lobbyPlayers : [];
  lobbyUi.setMode(mode, roomCode);
  lobbyUi.setPlayers(players, localId);
  const canEdit = mode !== 'client' && !inRace;
  form.setReadOnly(!canEdit);
  for (const id of ['newTrack', 'pinSeed', 'startRace']) $(id).disabled = !canEdit;
  $('startRace').textContent = settings.gameMode === 'tournament' ? '🏁 Start turnieju' : '🏁 Start wyścigu';
  for (const { b, preset } of presetButtons) {
    b.disabled = !canEdit;
    b.setAttribute('aria-pressed', String(presetActive(preset)));
  }
  $('startHint').textContent = mode === 'client'
    ? (hostRacing ? 'Trwa wyścig — dołączysz do następnego.' : 'Czekamy, aż host wystartuje wyścig.')
    : mode === 'host' ? `Graczy: ${players.length}/${MAX_RACERS}. Boty dopełnią do minimum.` : '';
}

// --- Sieć: tworzenie pokoju, dołączanie, wyjście
function createRoom() {
  mode = 'connecting';
  updateLobbyUi();
  lobbyUi.setStatus('Tworzę pokój…');
  transport = hostRoom({
    onReady(code) {
      roomCode = code;
      mode = 'host';
      localId = HOST_ID;
      host = createHostSession({
        send: (peer, msg) => transport.send(peer, msg),
        broadcast: (msg) => transport.broadcast(msg),
        disconnect: (peer) => transport.disconnect(peer),
        profile,
        room: { settings, seed: effectiveSeed() },
        onChange: () => {
          if (!inRace) refreshLobby();
          else updateLobbyUi();
          if (tournament) showTourney(tournament.view());
        },
        onAllReady: () => nextMap(),
      });
      lobbyUi.setStatus('Pokój gotowy. Wyślij znajomym kod albo link.');
      refreshLobby();
    },
    onJoin() { /* czekamy na "hello" z profilem */ },
    onLeave(peer) {
      const id = host?.handleLeave(peer);
      // W trakcie wyścigu kart rozłączonego gracza przejmuje bot (etap 7).
      const e = id && inRace ? game.takeOver(id) : null;
      if (e) {
        pendingEvents.push(e);
        handleEvents([e]);
      }
    },
    onMessage(peer, msg) { host?.handleMessage(peer, msg); },
    onError(type) { leaveRoom(`Błąd sieci (${type}).`); },
  });
}

function joinByCode(raw) {
  const code = normalizeRoomCode(raw);
  if (code.length !== NET.codeLength) {
    lobbyUi.setStatus(`Kod pokoju ma ${NET.codeLength} znaków.`);
    return;
  }
  mode = 'connecting';
  updateLobbyUi();
  lobbyUi.setStatus(`Łączę z pokojem ${code}…`);
  transport = joinRoom(code, {
    onOpen() {
      client = createClientSession({ send: (msg) => transport.send(msg), profile, on: clientHandlers });
      client.handleOpen();
    },
    onMessage(msg) {
      try {
        client?.handleMessage(msg);
      } catch (err) {
        console.error('Błędna wiadomość od hosta', err);
      }
    },
    onClose(reason) {
      const text = {
        notfound: `Nie ma pokoju ${code}.`,
        timeout: mode === 'connecting' ? 'Nie udało się połączyć.' : 'Host przestał odpowiadać — koniec gry.',
        closed: 'Host zamknął pokój — koniec gry.',
        error: 'Błąd połączenia.',
      }[reason];
      leaveRoom(text, false);
    },
  });
  roomCode = code;
}

// UWAGA (ograniczenie MVP): host jest jedynym miejscem, gdzie żyje gra.
// Gdy host się rozłączy, gra kończy się dla wszystkich — bez migracji hosta.
const clientHandlers = {
  welcome(m) {
    localId = String(m.id);
    mode = 'client';
    history.replaceState(null, '', `?room=${roomCode}`);
    lobbyUi.setStatus('Połączono. Ustawienia wybiera host.');
    updateLobbyUi();
  },
  lobby(m) {
    lobbyPlayers = Array.isArray(m.lobby?.players) ? m.lobby.players.slice(0, MAX_RACERS) : [];
    hostRacing = !!m.racing;
    settings = sanitizeSettings(m.room?.settings);
    randomTrackSeed = String(m.room?.seed ?? '');
    form.setValues(settings);
    const me = lobbyPlayers.find((p) => p.id === localId);
    if (me && me.color !== profile.color) lobbyUi.setProfile({ name: profile.name, color: me.color }); // host zmienił zajęty kolor
    if (!inRace) refreshLobby();
    else updateLobbyUi();
  },
  start(m) {
    settings = sanitizeSettings(m.settings);
    randomTrackSeed = String(m.seed ?? '');
    form.setValues(settings);
    rebuildTrack(m.tournament ? String(m.seed) : undefined);
    if (Math.abs(track.length - m.trackLength) > 0.5) {
      console.warn('Tor u klienta różni się od toru hosta', track.length, m.trackLength);
      lobbyUi.setStatus('Uwaga: tor może się różnić od toru hosta (inna przeglądarka?).');
    }
    const humans = (Array.isArray(m.humans) ? m.humans : []).slice(0, MAX_RACERS)
      .map((h) => ({ id: String(h.id), name: sanitizeName(h.name, 'Gracz'), color: KART_COLORS.includes(h.color) ? h.color : KART_COLORS[0] }));
    if (!humans.some((h) => h.id === localId)) return; // nie jedziemy w tym wyścigu
    const roster = m.tournament ? sanitizeRoster(m.tournament.roster) : null;
    if (!roster) tourneyView = null;
    const g = createGame({ track, settings, humans, seed: String(m.gameSeed), roster });
    sim = createClientSim(g, localId);
    beginRace(g);
  },
  snapshot(m) {
    if (!inRace || !sim) return;
    handleEvents(sim.onSnapshot(m));
  },
  abort() {
    tourneyView = null;
    if (inRace) enterLobby();
  },
  tourney(view) { showTourney(view); },
  reject(m) {
    const text = {
      full: 'Pokój jest pełny.',
      version: `Masz inną wersję gry niż host (${GAME_VERSION} vs ${m.version}). Odśwież stronę: Ctrl+Shift+R.`,
    }[m.reason] ?? 'Host odrzucił połączenie.';
    leaveRoom(text, false);
  },
};

function leaveRoom(status, closeTransport = true) {
  if (closeTransport) transport?.close();
  transport = host = client = sim = null;
  mode = 'solo';
  localId = SOLO_ID;
  roomCode = '';
  lobbyPlayers = [];
  hostRacing = false;
  tournament = tourneyView = null;
  history.replaceState(null, '', location.pathname);
  lobbyUi.setStatus(status ?? '');
  enterLobby();
}

// --- Tryby ekranu: lobby i wyścig
function enterLobby() {
  inRace = false;
  sim = null;
  resultsIn = null;
  setMenu(false);
  hud.hideResults();
  hud.setRaceVisible(false);
  $('panel').hidden = false;
  refreshLobby();
}

function beginRace(g) {
  setGame(g);
  lastCount = null;
  lastSlotReady = false;
  inRace = true;
  hostTick = 0;
  pendingEvents = [];
  resultsIn = null;
  hud.hideResults();
  setMenu(false);
  $('panel').hidden = true;
  hud.setRaceVisible(true);
  updateLobbyUi();
  document.activeElement?.blur?.(); // klawisze wracają do gry
}

// Start (solo/host). Ludzie na polach w kolejności losowej (z seeda).
function startRace() {
  const gameSeed = randomSeed();
  const rng = createRng(deriveSeed(gameSeed, 'grid'));
  const humans = lobbyHumans();
  for (let i = humans.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [humans[i], humans[j]] = [humans[j], humans[i]];
  }
  if (settings.gameMode === 'tournament') {
    // Skład zamrożony na cały turniej (kolejność pól = kolejność z losowania).
    tournament = createTournament({ seed: effectiveSeed(), mapCount: settings.mapCount, roster: buildRoster(settings, humans) });
    host?.setTournament(tournament);
    startMap();
    return;
  }
  endTournament();
  rebuildTrack();
  const g = createGame({ track, settings, humans, seed: gameSeed });
  if (mode === 'host') host.startRace({ settings, seed: effectiveSeed(), gameSeed, humans, trackLength: track.length });
  beginRace(g);
}

// Bieżąca mapa turnieju: tor z seeda mapy, zamrożony skład; za graczy,
// którzy wyszli, jedzie bot.
function startMap() {
  const seed = tournament.mapSeed(tournament.index);
  rebuildTrack(seed);
  const gameSeed = randomSeed();
  const g = createGame({ track, settings, humans: [], seed: gameSeed, roster: tournament.roster });
  const view = tournament.view();
  for (const r of view.table) if (r.left) g.takeOver(r.id);
  const humans = tournament.roster.filter((r) => r.isHuman && !view.table.find((x) => x.id === r.id).left)
    .map(({ id, name, color }) => ({ id, name, color }));
  tourneyView = view;
  if (mode === 'host') {
    host.startRace({
      settings, seed, gameSeed, humans, trackLength: track.length,
      tournament: { index: tournament.index, count: tournament.count, roster: tournament.roster },
    });
    host.sendTourney();
  }
  beginRace(g);
}

// Następna mapa (wszyscy gotowi albo "Start mimo wszystko").
function nextMap() {
  if (tournament?.phase !== 'between') return;
  tournament.nextMap();
  startMap();
}

function endTournament() {
  tournament = tourneyView = null;
  host?.setTournament(null);
}

// Nowy widok turnieju: zapamiętaj i odśwież okno wyników / tabelę Tab.
function showTourney(view) {
  tourneyView = view;
  hud.updateTournament(view);
  if (!$('tabBoard').hidden) hud.showTabBoard(view, localId);
}

// Gotowość lokalnego gracza między mapami.
function readyUp() {
  if (mode === 'client') client.sendReady();
  else if (mode === 'host') host.setReady(localId); // sesja rozgłasza i woła onAllReady
  else if (tournament?.setReady(localId)) {
    showTourney(tournament.view());
    if (tournament.allReady()) nextMap();
  }
}

// Opcje turnieju dla okna wyników (null = pojedynczy wyścig).
function tourOptions() {
  if (!tourneyView) return null;
  return {
    view: tourneyView,
    isHost: mode !== 'client',
    onReady: readyUp,
    onForce: nextMap,
    onQuit: () => {
      endTournament();
      if (mode === 'client') enterLobby();
      else finishToLobby();
    },
  };
}

// Roster turnieju od hosta (niezaufany): id unikalne, ≤ MAX_RACERS.
function sanitizeRoster(raw) {
  const seen = new Set();
  const list = (Array.isArray(raw) ? raw : []).slice(0, MAX_RACERS)
    .map((r) => ({ id: String(r?.id ?? ''), name: sanitizeName(r?.name, 'Gracz'), color: KART_COLORS.includes(r?.color) ? r.color : KART_COLORS[0], isHuman: !!r?.isHuman }))
    .filter((r) => r.id && !seen.has(r.id) && seen.add(r.id));
  return list.length ? list : null;
}

// Menu w wyścigu (Esc). Solo: pauza. W sieci gra toczy się dalej.
function setMenu(open) {
  menuOpen = open;
  $('pause').hidden = !open;
  $('pauseTitle').textContent = isOnline() ? 'Menu (gra trwa)' : 'Pauza';
  $('quitRace').textContent = mode === 'host' ? 'Przerwij wyścig (wszyscy do lobby)'
    : mode === 'client' ? 'Opuść pokój' : 'Wróć do lobby';
  if (open) $('resume').focus();
  else document.activeElement?.blur?.();
}

function finishToLobby() {
  if (mode === 'host') host.endRace(false);
  enterLobby();
}

$('startRace').addEventListener('click', startRace);

// Tab (trzymany) w wyścigu turniejowym: tabela turnieju. Poza wyścigiem
// i w polach formularza Tab działa normalnie (fokus).
const typing = (t) => t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Tab' || !inRace || !tourneyView || typing(e.target)) return;
  e.preventDefault();
  if (!e.repeat) hud.showTabBoard(tourneyView, localId);
});
window.addEventListener('keyup', (e) => { if (e.code === 'Tab') hud.hideTabBoard(); });
window.addEventListener('blur', () => hud.hideTabBoard());
$('resume').addEventListener('click', () => setMenu(false));
$('quitRace').addEventListener('click', () => {
  if (mode !== 'client') endTournament();
  if (mode === 'host') {
    host.endRace(true);
    enterLobby();
  } else if (mode === 'client') leaveRoom('Opuszczono pokój.');
  else enterLobby();
});
$('newTrack').addEventListener('click', () => {
  randomTrackSeed = randomSeed();
  settings = applySettingChange(settings, 'trackSeed', '');
  form.setValues(settings);
  roomChanged();
});
$('pinSeed').addEventListener('click', () => {
  const next = applySettingChange(settings, 'trackSeed', effectiveSeed());
  if (next) {
    settings = next;
    form.setValues(settings);
    roomChanged();
  }
});
$('showDebug').addEventListener('change', (e) => { visual.debug.visible = e.target.checked; });

const USE_SOUND = { boost: 'boost', rocket: 'rocket', banana: 'banana', shield: 'shield' };
function handleEvents(events) {
  hud.handleEvents(events, localId, game.race);
  for (const e of events) {
    if (e.type === 'go') audio.play('go');
    if (e.id !== localId) continue;
    if (e.type === 'pickup') audio.play('pickup');
    if (e.type === 'use') audio.play(USE_SOUND[e.item]);
    if (e.type === 'hit') {
      audio.play('hit');
      chase.shake(CAMERA.shake.hit);
    }
    if (e.type === 'blocked') audio.play('blocked');
    if (e.type === 'lap' && e.lap < game.race.laps) audio.play('lap');
    if (e.type === 'finalLap') audio.play('finalLap');
    if (e.type === 'finish') audio.play('finish');
  }
  if (events.some((e) => e.type === 'end')) {
    resultsIn = RACE.resultsDelaySeconds;
    if (tournament) {
      tournament.recordRace(game.race);
      tourneyView = tournament.view();
      host?.sendTourney();
    }
  }
}

// Stan do rysowania: interpolacja między krokami fizyki (płynność przy
// dowolnym odświeżaniu monitora) + wygładzona korekta predykcji klienta.
let ownOffset = { x: 0, z: 0 };
function viewOf(id, alpha, lookBack = false) {
  const k = game.karts.get(id), p = prev.get(id);
  const off = id === localId && sim?.predicting() ? ownOffset : { x: 0, z: 0 };
  return {
    x: p.x + (k.x - p.x) * alpha + off.x,
    z: p.z + (k.z - p.z) * alpha + off.z,
    heading: lerpAngle(p.heading, k.heading, alpha),
    speed: k.speed,
    steer: k.steer,
    drift: k.drift,
    boostTime: k.boostTime,
    spinTime: k.spinTime,
    shieldTime: k.shieldTime,
    bumpTime: k.bumpTime,
    speedFrac: Math.abs(k.speed) / game.stats.maxSpeed,
    boosting: k.boostTime > 0,
    driftDir: k.drift.active ? k.drift.dir : 0,
    lookBack,
  };
}
function savePrev(onlyId) {
  for (const [id, k] of game.karts) if (!onlyId || id === onlyId) prev.set(id, { x: k.x, z: k.z, heading: k.heading });
}

// --- Start strony
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  chase.setAspect(w / h);
}
window.addEventListener('resize', resize);
resize();
form.setValues(settings);
enterLobby();
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) joinByCode(roomFromUrl);

// Podgląd stanu z konsoli (http://.../?debug) — do strojenia i testów ręcznych.
if (new URLSearchParams(location.search).has('debug')) {
  window.bongo = {
    get game() { return game; },
    get kart() { return game.karts.get(localId); },
    get track() { return track; },
    get race() { return inRace ? game.race : null; },
    get mode() { return mode; },
    get localId() { return localId; },
    get host() { return host; },
  };
}

// --- Pętla
const clock = new THREE.Clock();
let acc = 0;
let pending = { reset: false, item: false }; // akcje jednorazowe do pierwszego kroku fizyki
let lastCount = null; // odliczanie: ostatnia cyfra (dźwięk)
let lastSlotReady = false; // przedmiot gotowy (dźwięk)

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), PHYSICS.fixedDt * PHYSICS.maxStepsPerFrame);
  const ctl = input.read();
  if (ctl.menuPressed && inRace && resultsIn === null && $('results').hidden) setMenu(!menuOpen);
  if (ctl.mutePressed) {
    audio.toggleMuted();
    renderMute();
  }
  let wallHit = 0; // najmocniejsze uderzenie własnego karta w tej klatce
  let bumped = false; // własny kart wjechał w tej klatce na próg

  // Solo z otwartym menu = pauza; w sieci gra toczy się dalej (sterowanie wyłączone).
  const running = inRace && !(menuOpen && !isOnline());
  if (running) {
    const control = menuOpen ? { ...ctl, throttle: 0, brake: 0, steer: 0, drift: false } : ctl;
    pending.reset ||= control.resetPressed && !menuOpen;
    pending.item ||= control.itemPressed && !menuOpen;
    acc += dt;
    while (acc >= PHYSICS.fixedDt) {
      const local = { ...control, ...pending };
      pending = { reset: false, item: false };
      if (mode === 'client') {
        savePrev(localId);
        sim.stepLocal(local);
        wallHit = Math.max(wallHit, game.karts.get(localId).wallHit);
        bumped ||= game.karts.get(localId).bumpTime >= OBSTACLES.bump.hopSeconds;
      } else {
        savePrev();
        const inputs = new Map([[localId, local]]);
        if (mode === 'host') host.remoteInputs(game, inputs);
        const events = game.step(PHYSICS.fixedDt, inputs);
        handleEvents(events);
        wallHit = Math.max(wallHit, game.karts.get(localId)?.wallHit ?? 0);
        bumped ||= (game.karts.get(localId)?.bumpTime ?? 0) >= OBSTACLES.bump.hopSeconds;
        if (mode === 'host') {
          pendingEvents.push(...events);
          if (++hostTick % NET.snapshotEverySteps === 0) {
            host.sendSnapshot(game, hostTick * PHYSICS.fixedDt, pendingEvents);
            pendingEvents = [];
          }
        }
      }
      acc -= PHYSICS.fixedDt;
    }
    if (mode === 'client') {
      client.sendInput(sim.takeOutgoing());
      sim.updateRemote(dt);
      for (const id of game.karts.keys()) if (id !== localId || !sim.predicting()) savePrev(id);
      ownOffset = sim.ownOffset(dt);
    }
    if (resultsIn !== null) {
      resultsIn -= dt;
      if (resultsIn <= 0) {
        resultsIn = null;
        hud.hideTabBoard();
        hud.showResults(game.race, localId, finishToLobby, tourOptions());
      }
    }
    hud.update(game.race, localId, dt, game.items);

    // Dźwięki stanu: odliczanie, gotowy przedmiot, uderzenie w bandę.
    if (game.race.time < 0) {
      const n = Math.ceil(-game.race.time);
      if (n !== lastCount) audio.play('tick');
      lastCount = n;
    }
    const slot = game.items.slots.get(localId);
    const ready = !!slot?.item && slot.roll <= 0;
    if (ready && !lastSlotReady) audio.play('ready');
    lastSlotReady = ready;
    if (wallHit > AUDIO.wallMinSpeed) {
      audio.play('wall', wallHit / game.stats.maxSpeed);
      chase.shake(wallHit * CAMERA.shake.wallPerSpeed);
    }
    if (bumped) {
      audio.play('wall', OBSTACLES.bumpSound);
      chase.shake(OBSTACLES.bumpShake);
    }
  }

  // Klient: inne karty są już zinterpolowane (prev = bieżący), więc alpha
  // działa tylko na własny kart między krokami predykcji.
  const alpha = running ? acc / PHYSICS.fixedDt : 1;
  for (const [id, m] of meshes) {
    const v = viewOf(id, alpha);
    m.update(v, running ? dt : 0);
    m.setLabelDistance(Math.hypot(v.x - chase.camera.position.x, v.z - chase.camera.position.z));
  }
  itemsView.update(game.items, running || !inRace ? dt : 0);
  const followId = game.karts.has(localId) ? localId : game.roster[0].id;
  const me = viewOf(followId, alpha, ctl.lookBack && running && !menuOpen);
  chase.update(me, dt);
  audio.update(running && !menuOpen && followId === localId ? me : null, ctl.throttle);
  minimap.draw(game.roster.map((r) => {
    const v = r.id === followId ? me : viewOf(r.id, alpha);
    return { x: v.x, z: v.z, color: r.color, isLocal: r.id === localId };
  }));
  const k = game.karts.get(followId);
  $('speed').textContent = Math.round(Math.abs(k.speed) * 3.6);
  $('hud').dataset.surface = k.surface;
  renderer.render(scene, chase.camera);
});
