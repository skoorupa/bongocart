// =====================================================================
// race.js — przebieg wyścigu: odliczanie, checkpointy, okrążenia, czasy,
// kolejność, meta. Czysty JS (bez Three.js i DOM) — liczy go host,
// testowalny w Node.
//
// Zasady:
//  - Karty stoją na polach ZA linią startu. Pierwsze przecięcie linii
//    tylko "uzbraja" licznik; czas okrążenia 1 liczy się od sygnału START.
//  - Checkpointy trzeba zaliczać po kolei, więc skróty i jazda pod prąd
//    nie dają okrążeń.
//  - Wyścig kończy się, gdy wszyscy ludzie dojadą albo minie
//    RACE.finishTimeoutSeconds od pierwszego na mecie.
// =====================================================================
import { RACE } from './config.js';

const wrap = (v, L) => ((v % L) + L) % L;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// racers: [{id, name, color, isHuman}]
export function createRace({ track, laps, racers }) {
  return {
    track,
    laps,
    phase: 'countdown', // countdown | racing | finished
    time: -RACE.countdownSeconds, // < 0 w trakcie odliczania
    firstFinishTime: null,
    racers: racers.map((r) => ({
      ...r,
      started: false, // czy przeciął linię startu po raz pierwszy
      lap: 0, // ukończone okrążenia
      nextCp: 0, // indeks następnego checkpointu
      lapStartTime: 0,
      lapTimes: [],
      bestLap: null,
      finishTime: null, // null = jeszcze jedzie / nie ukończył (DNF)
      progress: 0, // [m] dystans od startu (do kolejności)
      wrongWayTime: 0,
    })),
  };
}

// Aktualne okrążenie do wyświetlenia (1..laps).
export const displayLap = (race, r) => Math.min(r.lap + 1, race.laps);

// Krok wyścigu. karts: Map id -> {x, z, heading, speed, trackS}.
// Zwraca listę zdarzeń dla HUD / dźwięku / sieci:
//   {type:'go'} {type:'lap', id, lap, time, best} {type:'finalLap', id}
//   {type:'finish', id, place, time} {type:'end'}
export function updateRace(race, dt, karts) {
  const events = [];
  if (race.phase === 'finished') return events;

  race.time += dt;
  if (race.phase === 'countdown') {
    if (race.time < 0) return events;
    race.phase = 'racing';
    events.push({ type: 'go' });
    if (race.laps === 1) for (const r of race.racers) events.push({ type: 'finalLap', id: r.id });
  }

  for (const r of race.racers) {
    const k = karts.get(r.id);
    if (!k || r.finishTime !== null) continue;
    advanceCheckpoints(race, r, k, events);
    r.progress = progressOf(race, r, k.trackS);
    r.wrongWayTime = isWrongWay(race.track, k) ? r.wrongWayTime + dt : 0;
  }

  // Koniec: wszyscy ludzie na mecie albo minął limit od pierwszego finiszu.
  const humansDone = race.racers.every((r) => !r.isHuman || r.finishTime !== null);
  const timedOut = race.firstFinishTime !== null && race.time - race.firstFinishTime >= RACE.finishTimeoutSeconds;
  if (humansDone || timedOut) {
    race.phase = 'finished';
    events.push({ type: 'end' });
  }
  return events;
}

function advanceCheckpoints(race, r, k, events) {
  const { checkpoints: cps, length: L } = race.track;
  const cp = cps[r.nextCp];
  if (wrap(k.trackS - cp.s, L) >= RACE.checkpointPassWindow) return;

  r.nextCp = (r.nextCp + 1) % cps.length;
  if (cp !== cps[0]) return;
  if (!r.started) { r.started = true; return; }

  // Linia mety po komplecie checkpointów = okrążenie.
  const lapTime = race.time - r.lapStartTime;
  r.lapTimes.push(lapTime);
  r.lapStartTime = race.time;
  r.lap++;
  const best = r.bestLap === null || lapTime < r.bestLap;
  if (best) r.bestLap = lapTime;
  events.push({ type: 'lap', id: r.id, lap: r.lap, time: lapTime, best });

  if (r.lap >= race.laps) {
    r.finishTime = race.time;
    r.progress = race.laps * L;
    if (race.firstFinishTime === null) race.firstFinishTime = race.time;
    const place = race.racers.filter((o) => o.finishTime !== null).length;
    events.push({ type: 'finish', id: r.id, place, time: r.finishTime });
  } else if (r.lap === race.laps - 1) {
    events.push({ type: 'finalLap', id: r.id });
  }
}

// Dystans od startu liczony od ostatnio zaliczonego checkpointu, więc
// jazda na skróty nie poprawia pozycji. Przed linią startu: wartość ujemna.
function progressOf(race, r, s) {
  const { checkpoints: cps, length: L } = race.track;
  if (!r.started) return -wrap(-s, L);
  const last = (r.nextCp - 1 + cps.length) % cps.length;
  const segment = wrap(cps[r.nextCp].s - cps[last].s, L) || L;
  let d = wrap(s - cps[last].s, L);
  if (d > L / 2) d -= L; // za checkpointem do tyłu
  return r.lap * L + cps[last].s + clamp(d, -L / 2, segment);
}

export function isWrongWay(track, k) {
  const ww = RACE.wrongWay;
  if (Math.abs(k.speed) < ww.minSpeed) return false;
  const p = track.points[Math.round(k.trackS / track.step) % track.points.length];
  // Kierunek ruchu (cofanie też jest "jazdą" w drugą stronę).
  const dir = Math.sign(k.speed);
  const dot = dir * (Math.sin(k.heading) * p.tx + Math.cos(k.heading) * p.tz);
  return dot < ww.dot;
}

export const showWrongWay = (r) => r.wrongWayTime >= RACE.wrongWay.delaySeconds;

// Kolejność: ukończeni wg czasu, potem reszta wg dystansu.
export function standings(race) {
  return [...race.racers].sort((a, b) => {
    const fa = a.finishTime !== null, fb = b.finishTime !== null;
    if (fa !== fb) return fa ? -1 : 1;
    if (fa) return a.finishTime - b.finishTime;
    return b.progress - a.progress;
  });
}

// 83.456 -> "1:23.45"
export function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const cs = Math.floor(Math.max(0, seconds) * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
