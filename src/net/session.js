// =====================================================================
// net/session.js — logika pokoju po stronie hosta i klienta, niezależna
// od PeerJS (transport podaje funkcje send/broadcast/disconnect i woła
// handle*). Dzięki temu całość testujemy w Node na sztucznej sieci.
//
// Host jest autorytetem: prowadzi lobby i ustawienia, liczy wyścig,
// a od klientów przyjmuje tylko profil (imię, kolor) i sterowanie.
// =====================================================================
import { createLobby, addPlayer, updatePlayer, removePlayer, HOST_ID } from './lobby.js';
import { createInputQueue, makeSnapshot, sanitizeTourneyView } from './protocol.js';
import { GAME_VERSION } from '../config.js';

// room: {settings, seed} — ustawienia i efektywny seed toru (podgląd w lobby).
// onAllReady: między mapami turnieju wszyscy ludzie są gotowi (main.js
// startuje następną mapę).
export function createHostSession({ send, broadcast, disconnect, profile, room, onChange, onAllReady }) {
  const lobby = createLobby(profile);
  const players = new Map(); // peerId -> id gracza
  const queues = new Map(); // id gracza -> kolejka sterowania
  let racers = null; // Set id ludzi w bieżącym wyścigu (null = lobby)
  let tournament = null; // turniej (tournament.js) albo null

  const sendTourney = () => { if (tournament) broadcast({ t: 'tourney', ...tournament.view() }); };
  // Gotowość zmieniła się (ready / wyjście): rozgłoś i ewentualnie ruszaj.
  const readyChanged = () => {
    sendTourney();
    if (tournament?.phase === 'between' && tournament.allReady()) onAllReady?.();
  };

  const lobbyMsg = () => ({ t: 'lobby', lobby, room, racing: racers !== null });
  const changed = () => {
    broadcast(lobbyMsg());
    onChange?.();
  };

  return {
    lobby,
    get racing() { return racers !== null; },

    handleMessage(peer, msg) {
      if (!msg || typeof msg !== 'object') return;
      const id = players.get(peer);
      if (msg.t === 'hello' && !id) {
        // Inna wersja gry (np. stara kopia z pamięci przeglądarki) = inna
        // fizyka/protokół — nie wpuszczamy.
        if (msg.version !== GAME_VERSION) {
          send(peer, { t: 'reject', reason: 'version', version: GAME_VERSION });
          disconnect(peer);
          return;
        }
        const p = addPlayer(lobby, `p-${peer}`, msg.profile);
        if (!p) {
          send(peer, { t: 'reject', reason: 'full' });
          disconnect(peer);
          return;
        }
        players.set(peer, p.id);
        queues.set(p.id, createInputQueue());
        send(peer, { t: 'welcome', id: p.id });
        changed();
      } else if (msg.t === 'profile' && id) {
        updatePlayer(lobby, id, msg.profile);
        changed();
      } else if (msg.t === 'input' && id && racers?.has(id)) {
        queues.get(id).push(msg);
      } else if (msg.t === 'ready' && id && tournament?.setReady(id)) {
        readyChanged();
      }
    },

    // Rozłączenie (zamknięcie połączenia albo brak heartbeatu). Zwraca id gracza.
    handleLeave(peer) {
      const id = players.get(peer);
      if (!id) return null;
      players.delete(peer);
      queues.delete(id);
      removePlayer(lobby, id);
      changed();
      if (tournament?.roster.some((r) => r.id === id)) {
        tournament.markLeft(id);
        readyChanged();
      }
      return id;
    },

    // Turniej prowadzony przez main.js (null = brak turnieju).
    setTournament(t) { tournament = t; },
    sendTourney,
    // Gotowość lokalnego gracza hosta.
    setReady(id) { if (tournament?.setReady(id)) readyChanged(); },

    setRoom(next) {
      room = next;
      changed();
    },
    setHostProfile(p) {
      updatePlayer(lobby, HOST_ID, p);
      changed();
    },

    // start: {settings, seed, gameSeed, humans} — klienci budują z tego tę samą grę.
    startRace(start) {
      racers = new Set(start.humans.map((h) => h.id));
      for (const q of queues.values()) q.clear();
      broadcast({ t: 'start', ...start });
      onChange?.();
    },
    endRace(abort) {
      racers = null;
      if (abort) broadcast({ t: 'abort' });
      changed();
    },

    // Sterowanie zdalnych graczy na jeden krok — tylko gdy gra go użyje
    // (inaczej zużylibyśmy wpisy kolejki bez efektu).
    remoteInputs(game, inputs) {
      if (game.race.phase !== 'racing') return inputs;
      for (const r of game.race.racers) {
        const q = queues.get(r.id);
        if (q && r.finishTime === null) inputs.set(r.id, q.next());
      }
      return inputs;
    },

    sendSnapshot(game, ht, events) {
      const acks = {};
      for (const [id, q] of queues) acks[id] = q.ack;
      broadcast(makeSnapshot(game, ht, acks, events));
    },
  };
}

// Klient: przekazuje wiadomości hosta do callbacków main.js.
export function createClientSession({ send, profile, on }) {
  return {
    handleOpen() { send({ t: 'hello', profile, version: GAME_VERSION }); },
    handleMessage(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'tourney') {
        const view = sanitizeTourneyView(msg);
        if (view) on.tourney?.(view);
        return;
      }
      const handler = { welcome: on.welcome, lobby: on.lobby, start: on.start, snap: on.snapshot, abort: on.abort, reject: on.reject }[msg.t];
      handler?.(msg);
    },
    setProfile(p) { send({ t: 'profile', profile: p }); },
    sendInput(msg) { if (msg) send(msg); },
    sendReady() { send({ t: 'ready' }); },
  };
}
