// =====================================================================
// net/session.js — logika pokoju po stronie hosta i klienta, niezależna
// od PeerJS (transport podaje funkcje send/broadcast/disconnect i woła
// handle*). Dzięki temu całość testujemy w Node na sztucznej sieci.
//
// Host jest autorytetem: prowadzi lobby i ustawienia, liczy wyścig,
// a od klientów przyjmuje tylko profil (imię, kolor) i sterowanie.
// =====================================================================
import { createLobby, addPlayer, updatePlayer, removePlayer, HOST_ID } from './lobby.js';
import { createInputQueue, makeSnapshot } from './protocol.js';

// room: {settings, seed} — ustawienia i efektywny seed toru (podgląd w lobby).
export function createHostSession({ send, broadcast, disconnect, profile, room, onChange }) {
  const lobby = createLobby(profile);
  const players = new Map(); // peerId -> id gracza
  const queues = new Map(); // id gracza -> kolejka sterowania
  let racers = null; // Set id ludzi w bieżącym wyścigu (null = lobby)

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
      return id;
    },

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
    handleOpen() { send({ t: 'hello', profile }); },
    handleMessage(msg) {
      if (!msg || typeof msg !== 'object') return;
      const handler = { welcome: on.welcome, lobby: on.lobby, start: on.start, snap: on.snapshot, abort: on.abort, reject: on.reject }[msg.t];
      handler?.(msg);
    },
    setProfile(p) { send({ t: 'profile', profile: p }); },
    sendInput(msg) { if (msg) send(msg); },
  };
}
