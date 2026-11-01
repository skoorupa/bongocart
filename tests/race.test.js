// Testy przebiegu wyścigu: odliczanie, checkpointy, okrążenia, meta, kolejność.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack } from '../src/track/generator.js';
import { createRace, updateRace, standings, formatTime, showWrongWay, gapToLeader, spectateTargets, cycleSpectate } from '../src/race.js';
import { createKartState, stepKart, kartStats } from '../src/physics.js';
import { RACE, PHYSICS, TRACK } from '../src/config.js';

const track = generateTrack({ seed: 'race', size: 'small', difficulty: 'easy', theme: 'random', itemFrequency: 'none' });
const L = track.length;
const DT = PHYSICS.fixedDt;

// Sztuczny kart jadący po linii środkowej: tylko trackS i kurs toru.
const synthetic = (s, speed = 20) => {
  const k = { x: 0, z: 0, speed, trackS: 0, heading: 0 };
  return place(k, s);
};
const place = (k, s) => {
  k.trackS = ((s % L) + L) % L;
  const p = track.points[Math.round(k.trackS / track.step) % track.points.length];
  k.heading = k.speed >= 0 ? p.heading : p.heading + Math.PI;
  return k;
};
const newRace = (laps, ids = ['a'], humans = ids) =>
  createRace({ track, laps, racers: ids.map((id) => ({ id, name: id, color: 0, isHuman: humans.includes(id) })) });

// Przesuwa kart o `meters` krokami po 0.3 m (~prędkość 36 m/s przy 120 Hz).
function drive(race, karts, id, meters, stepM = 0.3) {
  const k = karts.get(id);
  const events = [];
  const n = Math.ceil(Math.abs(meters) / stepM);
  for (let i = 0; i < n; i++) {
    place(k, k.trackS + Math.sign(meters) * stepM);
    events.push(...updateRace(race, DT, karts));
  }
  return events;
}
const toGo = (race, karts) => {
  const ev = [];
  while (race.phase === 'countdown') ev.push(...updateRace(race, DT, karts));
  return ev;
};

test('okno zaliczenia checkpointu mniejsze niż odstęp checkpointów (każdy rozmiar)', () => {
  for (const size of Object.keys(TRACK.sizes)) {
    const t = generateTrack({ seed: 'cp', size, difficulty: 'hard', theme: 'random', itemFrequency: 'none' });
    for (let i = 0; i < t.checkpoints.length; i++) {
      const a = t.checkpoints[i].s, b = i + 1 < t.checkpoints.length ? t.checkpoints[i + 1].s : t.length;
      assert.ok(b - a > RACE.checkpointPassWindow * 1.5, `${size}: odstęp ${b - a}`);
    }
  }
});

test('odliczanie: START dokładnie po RACE.countdownSeconds', () => {
  const race = newRace(3);
  const karts = new Map([['a', synthetic(L - 8)]]);
  const ev = toGo(race, karts);
  assert.deepEqual(ev.map((e) => e.type), ['go']);
  assert.ok(Math.abs(race.time) < DT * 1.01);
});

test('pełne okrążenia po kolei -> meta, czasy się sumują', () => {
  const laps = 3;
  const race = newRace(laps);
  const karts = new Map([['a', synthetic(L - 8)]]);
  toGo(race, karts);
  const ev = drive(race, karts, 'a', 8 + laps * L + 1);
  const r = race.racers[0];
  assert.equal(ev.filter((e) => e.type === 'lap').length, laps);
  assert.equal(ev.filter((e) => e.type === 'finalLap').length, 1);
  assert.equal(ev.find((e) => e.type === 'finish').place, 1);
  assert.equal(race.phase, 'finished');
  const sum = r.lapTimes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - r.finishTime) < 1e-6);
  assert.equal(r.bestLap, Math.min(...r.lapTimes));
});

test('skrót przez linię mety (pominięte checkpointy) nie liczy okrążenia', () => {
  const race = newRace(3);
  const karts = new Map([['a', synthetic(L - 8)]]);
  toGo(race, karts);
  drive(race, karts, 'a', 30); // przez start, okrążenie uzbrojone
  place(karts.get('a'), L - 5); // "teleport" tuż przed metę
  const ev = drive(race, karts, 'a', 10);
  assert.equal(ev.filter((e) => e.type === 'lap').length, 0);
  assert.equal(race.racers[0].lap, 0);
});

test('jazda pod prąd: brak okrążenia i ostrzeżenie', () => {
  const race = newRace(3);
  const k = synthetic(L - 8, -20); // cofanie = ruch pod prąd
  const karts = new Map([['a', k]]);
  toGo(race, karts);
  k.speed = 20;
  place(k, k.trackS);
  k.heading += Math.PI; // przodem pod prąd
  const r = race.racers[0];
  for (let i = 0; i < 2 / DT; i++) {
    k.trackS = ((k.trackS - 0.3) % L + L) % L;
    updateRace(race, DT, karts);
  }
  assert.equal(r.lap, 0);
  assert.ok(showWrongWay(r));
});

test('kolejność: wyżej ten, kto dalej; ukończeni wg czasu', () => {
  const race = newRace(1, ['a', 'b', 'c']);
  const karts = new Map([['a', synthetic(L - 8)], ['b', synthetic(L - 10)], ['c', synthetic(L - 12)]]);
  toGo(race, karts);
  drive(race, karts, 'c', 200);
  drive(race, karts, 'a', 100);
  assert.deepEqual(standings(race).map((r) => r.id), ['c', 'a', 'b']);
  drive(race, karts, 'a', L); // a kończy pierwszy
  drive(race, karts, 'c', L);
  assert.deepEqual(standings(race).map((r) => r.id), ['a', 'c', 'b']);
});

test('koniec po limicie czasu od pierwszego na mecie', () => {
  const race = newRace(1, ['a', 'b']);
  const karts = new Map([['a', synthetic(L - 8)], ['b', synthetic(L - 10)]]);
  toGo(race, karts);
  drive(race, karts, 'a', L + 10);
  assert.equal(race.phase, 'racing');
  let ended = false;
  for (let t = 0; t < RACE.finishTimeoutSeconds + 1 && !ended; t += DT) {
    ended = updateRace(race, DT, karts).some((e) => e.type === 'end');
  }
  assert.ok(ended);
  assert.equal(race.racers[1].finishTime, null); // DNF
});

test('boty nie blokują końca wyścigu', () => {
  const race = newRace(1, ['a', 'bot'], ['a']);
  const karts = new Map([['a', synthetic(L - 8)], ['bot', synthetic(L - 10)]]);
  toGo(race, karts);
  const ev = drive(race, karts, 'a', L + 10);
  assert.ok(ev.some((e) => e.type === 'end'));
});

test('prawdziwy kart z fizyką: start z pola zalicza okrążenie po przejechaniu toru', () => {
  const race = newRace(1);
  const k = createKartState(track, 0);
  const karts = new Map([['a', k]]);
  toGo(race, karts);
  const stats = kartStats('150cc');
  // Kierowca jadący wzdłuż toru (jak w testach fizyki).
  let finished = false;
  for (let i = 0; i < 120 / DT && !finished; i++) {
    const idx = Math.round(k.trackS / track.step) % track.points.length;
    const p = track.points[(idx + 6) % track.points.length];
    const err = Math.atan2(Math.sin(Math.atan2(p.x - k.x, p.z - k.z) - k.heading), Math.cos(Math.atan2(p.x - k.x, p.z - k.z) - k.heading));
    stepKart(k, { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -err * 3)), drift: false }, track, stats, DT);
    finished = updateRace(race, DT, karts).some((e) => e.type === 'finish');
  }
  assert.ok(finished, `lap ${race.racers[0].lap}, s ${k.trackS}`);
});

test('formatTime', () => {
  assert.equal(formatTime(83.456), '1:23.45');
  assert.equal(formatTime(5), '0:05.00');
  assert.equal(formatTime(null), '—');
});

test('strata do lidera: lider null, dalej proporcjonalnie do dystansu; ukończeni wg czasu mety', () => {
  const race = newRace(1, ['a', 'b', 'c']);
  const karts = new Map([['a', synthetic(L - 8)], ['b', synthetic(L - 10)], ['c', synthetic(L - 12)]]);
  toGo(race, karts);
  drive(race, karts, 'a', 300);
  drive(race, karts, 'b', 200);
  drive(race, karts, 'c', 100);
  let order = standings(race);
  const [ga, gb, gc] = order.map((r) => gapToLeader(race, order, r));
  assert.equal(ga, null);
  assert.ok(gb > 0 && gc > gb * 1.5, `${gb} ${gc}`);
  drive(race, karts, 'a', L); // a na mecie
  drive(race, karts, 'b', L);
  order = standings(race);
  const b = race.racers.find((r) => r.id === 'b'), a = race.racers.find((r) => r.id === 'a');
  assert.ok(Math.abs(gapToLeader(race, order, b) - (b.finishTime - a.finishTime)) < 1e-9);
});

test('waitForAll (turniej): boty też muszą dojechać; limit czasu nadal działa', () => {
  const mk = () => createRace({ track, laps: 1, waitForAll: true, racers: [{ id: 'a', isHuman: true }, { id: 'bot', isHuman: false }] });
  const race = mk();
  const karts = new Map([['a', synthetic(L - 8)], ['bot', synthetic(L - 10)]]);
  toGo(race, karts);
  const ev = drive(race, karts, 'a', L + 10);
  assert.ok(!ev.some((e) => e.type === 'end'), 'czeka na bota');
  const ev2 = drive(race, karts, 'bot', L + 12);
  assert.ok(ev2.some((e) => e.type === 'end'));
  assert.notEqual(race.racers[1].finishTime, null);

  const late = mk();
  const k2 = new Map([['a', synthetic(L - 8)], ['bot', synthetic(L - 10)]]);
  toGo(late, k2);
  drive(late, k2, 'a', L + 10);
  let ended = false;
  for (let t = 0; t < RACE.finishTimeoutSeconds + 1 && !ended; t += DT) ended = updateRace(late, DT, k2).some((e) => e.type === 'end');
  assert.ok(ended, 'limit czasu kończy wyścig');
});

test('oglądanie po mecie: tylko jadący, najpierw ludzie; zmiana w kółko', () => {
  const race = { racers: [
    { id: 'me', isHuman: true, finishTime: 50, progress: 900 },
    { id: 'b1', isHuman: false, finishTime: null, progress: 800 },
    { id: 'h2', isHuman: true, finishTime: null, progress: 500 },
    { id: 'b2', isHuman: false, finishTime: null, progress: 700 },
    { id: 'b3', isHuman: false, finishTime: 52, progress: 900 },
  ] };
  const ids = spectateTargets(race, 'me');
  assert.deepEqual(ids, ['h2', 'b1', 'b2']);
  assert.equal(cycleSpectate(ids, 'h2', 1), 'b1');
  assert.equal(cycleSpectate(ids, 'h2', -1), 'b2');
  assert.equal(cycleSpectate(ids, 'b2', 1), 'h2');
  assert.equal(cycleSpectate(ids, 'zniknął', 1), 'h2', 'oglądany dojechał -> pierwszy z listy');
  assert.equal(cycleSpectate([], 'x', 1), null);
});
