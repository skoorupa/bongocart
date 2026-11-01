// =====================================================================
// net/protocol.js — format wiadomości: sterowanie, kolejka sterowania
// po stronie hosta, stan gry (snapshot) i jego wczytywanie u klienta.
//
// Wiadomości (pole t):
//   klient -> host: hello {profile}, profile {profile}, input {from, list}, ping
//   host -> klient: welcome {id, lobby}, reject {reason}, lobby {lobby},
//                   start {...}, snap {...}, abort, ping
// =====================================================================
import { NET } from '../config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, a, b) => (Number.isFinite(v) ? clamp(v, a, b) : 0);
const round = (v) => Math.round(v * 1000) / 1000;
export const NEUTRAL = Object.freeze({ throttle: 0, brake: 0, steer: 0, drift: false, item: false, reset: false });

// --- Sterowanie: tablica liczb (mało bajtów).
export const encodeInput = (i) => [round(i.throttle), round(i.brake), round(i.steer), i.drift ? 1 : 0, i.item ? 1 : 0, i.reset ? 1 : 0];

// Od klienta = niezaufane: liczby przycinamy, reszta -> neutralne.
export function decodeInput(a) {
  if (!Array.isArray(a)) return NEUTRAL;
  return {
    throttle: num(a[0], 0, 1),
    brake: num(a[1], 0, 1),
    steer: num(a[2], -1, 1),
    drift: a[3] === 1,
    item: a[4] === 1,
    reset: a[5] === 1,
  };
}

// --- Kolejka sterowania jednego klienta (host). Klient numeruje kroki
// fizyki (seq); host zużywa jeden wpis na krok i potwierdza ostatni
// zużyty numer w snapshocie — klient powtarza od niego swoją predykcję.
export function createInputQueue() {
  let queue = [];
  let received = 0; // najwyższy odebrany seq
  let ack = 0; // ostatni zużyty seq
  let last = NEUTRAL;
  let started = false;

  return {
    get ack() { return ack; },
    // Wiadomość {from, list} od klienta.
    push(msg) {
      if (!msg || !Number.isInteger(msg.from) || !Array.isArray(msg.list)) return;
      msg.list.slice(0, NET.maxInputsPerMessage).forEach((raw, k) => {
        const seq = msg.from + k;
        if (seq <= received) return; // duplikat / stare
        received = seq;
        queue.push({ seq, input: decodeInput(raw) });
      });
      // Za długa kolejka (zegar klienta szybszy): wyrzucamy najstarsze,
      // zachowując jednorazowe akcje.
      while (queue.length > NET.inputBufferMax) {
        const old = queue.shift();
        ack = old.seq;
        queue[0].input = { ...queue[0].input, item: queue[0].input.item || old.input.item, reset: queue[0].input.reset || old.input.reset };
      }
    },
    // Sterowanie na jeden krok hosta.
    next() {
      if (!started && queue.length < NET.inputBufferMin) return NEUTRAL;
      started = true;
      if (!queue.length) return { ...last, item: false, reset: false }; // brak danych: powtarzamy
      const e = queue.shift();
      ack = e.seq;
      last = e.input;
      return e.input;
    },
    clear() {
      queue = [];
      last = NEUTRAL;
      started = false;
    },
  };
}

// --- Stan karta jako tablica (kolejność = KART_FIELDS + dryf + nawierzchnia).
const KART_FIELDS = ['x', 'z', 'heading', 'vx', 'vz', 'speed', 'steer', 'boostTime', 'spinTime', 'shieldTime', 'trackS', 'lateral', 'wallHit'];
const SURFACES = ['road', 'kerb', 'offroad'];

export function encodeKart(k) {
  const d = k.drift;
  return [...KART_FIELDS.map((f) => round(k[f])), d.active ? 1 : 0, d.dir, round(d.charge), d.level, round(d.hop), SURFACES.indexOf(k.surface)];
}

export function applyKart(k, a) {
  KART_FIELDS.forEach((f, i) => { k[f] = a[i]; });
  const n = KART_FIELDS.length;
  Object.assign(k.drift, { active: a[n] === 1, dir: a[n + 1], charge: a[n + 2], level: a[n + 3], hop: a[n + 4] });
  k.surface = SURFACES[a[n + 5]] ?? 'road';
}

// --- Snapshot: wszystko, czego klient potrzebuje do rysowania i HUD.
const RACER_FIELDS = ['isHuman', 'takenOver', 'started', 'lap', 'nextCp', 'lapStartTime', 'lapTimes', 'bestLap', 'finishTime', 'progress', 'wrongWayTime'];

// ht: czas symulacji hosta [s] (do interpolacji), acks: {id: seq}.
export function makeSnapshot(game, ht, acks, events) {
  const { race, items } = game;
  return {
    t: 'snap',
    ht,
    acks,
    events,
    race: { phase: race.phase, time: round(race.time), firstFinishTime: race.firstFinishTime },
    racers: race.racers.map((r) => RACER_FIELDS.map((f) => r[f])),
    karts: race.racers.map((r) => encodeKart(game.karts.get(r.id))),
    items: {
      boxes: items.boxes.map((b) => round(b.respawn)),
      bananas: items.bananas.map((b) => [b.id, round(b.x), round(b.z)]),
      rockets: items.rockets.map((r) => [r.id, round(r.x), round(r.z), round(r.heading)]),
      slots: race.racers.map((r) => {
        const s = items.slots.get(r.id);
        return [s.item, round(s.roll)];
      }),
    },
  };
}

// Klient: przebieg wyścigu i przedmioty (karty osobno — interpolacja).
export function applyRaceAndItems(game, snap) {
  const { race, items } = game;
  Object.assign(race, snap.race);
  race.racers.forEach((r, i) => RACER_FIELDS.forEach((f, j) => { r[f] = snap.racers[i][j]; }));
  snap.items.boxes.forEach((v, i) => { if (items.boxes[i]) items.boxes[i].respawn = v; });
  items.bananas = snap.items.bananas.map(([id, x, z]) => ({ id, x, z }));
  items.rockets = snap.items.rockets.map(([id, x, z, heading]) => ({ id, x, z, heading }));
  race.racers.forEach((r, i) => {
    const [item, roll] = snap.items.slots[i];
    Object.assign(items.slots.get(r.id), { item, roll });
  });
}
