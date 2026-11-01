// Testy symulacji wyścigu z botami: skład, AI, kolizje, determinizm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack } from '../src/track/generator.js';
import { createGame, buildRoster } from '../src/game.js';
import { createDriver } from '../src/ai.js';
import { kartStats } from '../src/physics.js';
import { defaultSettings } from '../src/settings.js';
import { collideKarts, createKartState } from '../src/physics.js';
import { PHYSICS, MAX_RACERS, KART, RACE, TRACK, AI, OBSTACLES } from '../src/config.js';

const DT = PHYSICS.fixedDt;
const track = generateTrack({ seed: 'bots', size: 'small', difficulty: 'hard', theme: 'random', itemFrequency: 'none' });
const settingsWith = (o) => ({ ...defaultSettings(), ...o });
const human = (id, color = 0xe63946) => ({ id, name: id, color });
const NONE = new Map();

function runUntil(game, cond, maxSeconds, inputs = () => NONE) {
  for (let i = 0; i < maxSeconds / DT && !cond(); i++) game.step(DT, inputs());
}

test('skład: boty dopełniają do minimum, ludzie za botami, kolory bez powtórzeń', () => {
  const r = buildRoster(settingsWith({ minRacers: 5 }), [human('p1'), human('p2', 0x1e88e5)]);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((x) => x.isHuman), [false, false, false, true, true]);
  assert.equal(new Set(r.map((x) => x.color)).size, 5);
  assert.equal(buildRoster(settingsWith({ minRacers: 1 }), [human('a'), human('b', 1)]).length, 2);
  // Limit graczy pilnuje lobby; skład nigdy nie dokłada botów ponad MAX_RACERS.
  const full = Array.from({ length: MAX_RACERS }, (_, i) => human(`h${i}`, i));
  assert.equal(buildRoster(settingsWith({ minRacers: MAX_RACERS }), full).filter((x) => !x.isHuman).length, 0);
});

test('w odliczaniu nikt się nie rusza', () => {
  const game = createGame({ track, settings: settingsWith({ minRacers: 4 }), humans: [human('p')], seed: 's' });
  const before = [...game.karts.values()].map((k) => [k.x, k.z]);
  const gas = new Map([['p', { throttle: 1, brake: 0, steer: 0, drift: false }]]);
  runUntil(game, () => game.race.phase !== 'countdown', RACE.countdownSeconds + 1, () => gas);
  [...game.karts.values()].forEach((k, i) => {
    assert.ok(Math.hypot(k.x - before[i][0], k.z - before[i][1]) < 0.5);
  });
});

test('boty kończą wyścig na każdym poziomie; trudniejsze są szybsze', () => {
  const best = {};
  for (const diff of ['easy', 'medium', 'hard']) {
    const game = createGame({ track, settings: settingsWith({ minRacers: 4, laps: 1, botDifficulty: diff }), humans: [], seed: diff });
    runUntil(game, () => game.race.phase === 'finished', 120);
    const times = game.race.racers.map((r) => r.finishTime);
    assert.ok(times.every((t) => t !== null), `${diff}: ${times}`);
    best[diff] = Math.min(...times);
  }
  assert.ok(best.easy > best.medium && best.medium > best.hard, JSON.stringify(best));
});

test('zderzenia: karty się rozsuwają i odbijają; wyłączone = przenikają', () => {
  const a = createKartState(track, 0), b = createKartState(track, 0);
  b.x += 0.5;
  a.vx = 10; b.vx = -10;
  collideKarts([a, b]);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= KART.radius * 2 - 1e-9);
  assert.ok(a.vx < 10 && b.vx > -10);

  for (const kartCollisions of [true, false]) {
    const game = createGame({ track, settings: settingsWith({ minRacers: 8, laps: 1, kartCollisions }), humans: [], seed: 'c' });
    let minGap = Infinity;
    runUntil(game, () => game.race.time > 8, 20);
    for (let i = 0; i < 2 / DT; i++) {
      game.step(DT, NONE);
      const ks = [...game.karts.values()];
      for (let x = 0; x < ks.length; x++) for (let y = x + 1; y < ks.length; y++) minGap = Math.min(minGap, Math.hypot(ks[x].x - ks[y].x, ks[x].z - ks[y].z));
    }
    if (kartCollisions) assert.ok(minGap >= KART.radius * 2 - 0.05, `gap ${minGap}`);
  }
});

test('gracz po mecie: kartem jedzie AI', () => {
  const game = createGame({ track, settings: settingsWith({ minRacers: 1, laps: 1 }), humans: [human('p')], seed: 'f' });
  const me = game.race.racers[0];
  // "Gracz" jedzie do mety; potem przejmuje AI.
  const k = game.karts.get('p');
  runUntil(game, () => me.finishTime !== null, 150, () => {
    const p = track.racingLine[(Math.round(k.trackS / track.step) + 5) % track.points.length];
    const err = Math.atan2(Math.sin(Math.atan2(p.x - k.x, p.z - k.z) - k.heading), Math.cos(Math.atan2(p.x - k.x, p.z - k.z) - k.heading));
    return new Map([['p', { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -err * 3)), drift: false }]]);
  });
  assert.notEqual(me.finishTime, null);
  runUntil(game, () => false, 5); // brak sterowania gracza
  assert.ok(k.speed > 10, `speed ${k.speed}`);
});

test('bot zakleszczony przodem w bandzie wyjeżdża', () => {
  const game = createGame({ track, settings: settingsWith({ minRacers: 1, laps: 3 }), humans: [], seed: 'w' });
  runUntil(game, () => game.race.phase === 'racing', 5);
  const k = game.karts.get('bot0');
  const p = track.points[100];
  const wall = track.halfWidth + TRACK.kerbWidth + TRACK.runoffWidth - KART.radius;
  Object.assign(k, { x: p.x + p.nx * wall, z: p.z + p.nz * wall, heading: Math.atan2(p.nx, p.nz), vx: 0, vz: 0, speed: 0 });
  const s0 = p.s;
  runUntil(game, () => false, 10);
  const moved = (k.trackS - s0 + track.length) % track.length;
  assert.ok(moved > 100, `przejechał ${moved} m`);
});

test('determinizm: ten sam seed -> te same pozycje', () => {
  const run = () => {
    const g = createGame({ track, settings: settingsWith({ minRacers: 6, laps: 1 }), humans: [], seed: 'det' });
    runUntil(g, () => g.race.time > 15, 30);
    return [...g.karts.values()].map((k) => [k.x, k.z]);
  };
  assert.deepEqual(run(), run());
});

test('rozłączony gracz: kart przejmuje AI, wyścig na niego nie czeka', () => {
  const game = createGame({ track, settings: settingsWith({ minRacers: 1, laps: 1 }), humans: [human('a'), human('b', 0x1e88e5)], seed: 't' });
  runUntil(game, () => game.race.time > 2, 10);
  const b = game.karts.get('b');
  const e = game.takeOver('b');
  assert.deepEqual(e, { type: 'takeover', id: 'b', name: 'b' });
  assert.equal(game.takeOver('b'), null); // drugi raz nic
  // "a" stoi (brak sterowania), "b" jedzie sam i kończy wyścig.
  runUntil(game, () => game.race.racers.find((r) => r.id === 'b').finishTime !== null, 120);
  const rb = game.race.racers.find((r) => r.id === 'b');
  assert.notEqual(rb.finishTime, null, `b przejechał ${b.trackS} m`);
  assert.ok(rb.takenOver && !rb.isHuman);
  assert.equal(game.race.phase, 'racing'); // czeka na człowieka "a" (albo limit czasu)
});

test('boty kończą wyścig z gęstymi przeszkodami, omijają słupki i się nie zakleszczają', () => {
  const params = { seed: 'bots', size: 'small', difficulty: 'hard', theme: 'random', itemFrequency: 'none' };
  const obs = generateTrack({ ...params, obstacles: 'many' });
  assert.ok(obs.posts.length > 0);
  const race = (t) => {
    const game = createGame({ track: t, settings: settingsWith({ minRacers: 4, laps: 1, botDifficulty: 'medium', obstacles: 'many' }), humans: [], seed: 'obs' });
    const slow = new Map(), touching = new Map();
    let hits = 0, maxSlow = 0;
    for (let i = 0; i < 120 / DT && game.race.phase !== 'finished'; i++) {
      game.step(DT, NONE);
      if (game.race.phase !== 'racing') continue;
      for (const [id, k] of game.karts) {
        const s = Math.abs(k.speed) < AI.stuck.speed ? (slow.get(id) ?? 0) + DT : 0;
        slow.set(id, s);
        maxSlow = Math.max(maxSlow, s);
        const near = t.posts.some((o) => Math.hypot(k.x - o.x, k.z - o.z) < KART.radius + o.radius + 0.05);
        if (near && !touching.get(id)) hits++;
        touching.set(id, near);
      }
    }
    return { times: game.race.racers.map((r) => r.finishTime), hits, maxSlow };
  };
  const base = race(generateTrack(params));
  const res = race(obs);
  assert.ok(res.times.every((x) => x !== null), JSON.stringify(res.times));
  assert.ok(Math.min(...res.times) <= Math.min(...base.times) * 1.08, `${Math.min(...res.times)} vs ${Math.min(...base.times)}`);
  assert.ok(res.maxSlow <= AI.stuck.time, `stał ${res.maxSlow} s`);
  // Deterministyczne: przy prostym unikaniu (stałe przesunięcie, najbliższy
  // słupek) boty trafiały tu 9–11 razy, z objazdem grupy — 1 otarcie.
  assert.ok(res.hits <= 2, `uderzeń w słupki: ${res.hits} (słupków ${obs.posts.length})`);
});

test('bot omijający wolny kart nie skręca w słupek', () => {
  // Prosta startowa: słupek z przodu po prawej, wolny kart z przodu lekko po lewej.
  const p0 = track.points[0], n = track.points.length;
  const at = (m, lat) => { const p = track.points[Math.round(m / track.step) % n]; return { x: p.x + p.nx * lat, z: p.z + p.nz * lat }; };
  const kart = createKartState(track, 0);
  Object.assign(kart, at(0, 0), { heading: p0.heading, speed: 20, vx: Math.sin(p0.heading) * 20, vz: Math.cos(p0.heading) * 20, lateral: 0, trackS: 0 });
  const other = { ...createKartState(track, 1), ...at(6, -0.5), speed: 5 };
  const post = { ...at(9, 1.5), index: Math.round(9 / track.step) % n, lateral: 1.5, radius: OBSTACLES.post.radius };
  const driver = createDriver(track, 'medium', 1);
  let out;
  for (let i = 0; i < Math.round(0.5 / DT); i++) {
    out = driver.control(kart, { others: [other], stats: kartStats('150cc'), speedMul: 1, slot: null, hazards: [], obstacles: [post], gapAhead: null, gapBehind: null }, DT);
  }
  assert.ok(out.steer < 0, `steer ${out.steer} (+ = w prawo, w słupek)`);
});
