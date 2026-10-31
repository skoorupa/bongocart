// Testy modelu jazdy: przyspieszanie, klasy prędkości, bandy, pobocze, dryf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack, nearestOnTrack } from '../src/track/generator.js';
import { createKartState, stepKart, kartStats } from '../src/physics.js';
import { KART, PHYSICS, TRACK } from '../src/config.js';

const track = generateTrack({ seed: 'phys', size: 'medium', difficulty: 'easy', theme: 'random', itemFrequency: 'none' });
const DT = PHYSICS.fixedDt;
const idle = { throttle: 0, brake: 0, steer: 0, drift: false };
const gas = { ...idle, throttle: 1 };
const run = (kart, input, seconds, stats = kartStats('150cc')) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepKart(kart, typeof input === 'function' ? input(kart) : input, track, stats, DT);
  return kart;
};

// Prosty "kierowca": skręca w stronę linii środkowej kilka metrów przed kartem.
const follow = (extra = {}) => (k) => {
  const q = nearestOnTrack(track, k.x, k.z);
  const p = track.points[(q.index + 6) % track.points.length];
  const want = Math.atan2(p.x - k.x, p.z - k.z);
  const err = Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading));
  return { ...gas, steer: Math.max(-1, Math.min(1, -err * 3)), ...extra };
};

test('kart przyspiesza do v.max i nie przekracza jej', () => {
  const k = run(createKartState(track, 0), follow(), 12);
  const max = kartStats('150cc').maxSpeed;
  assert.ok(k.speed > max * 0.9 && k.speed <= max + 1e-6, `speed ${k.speed}`);
});

test('200cc szybsze niż 100cc', () => {
  const a = run(createKartState(track, 0), follow(), 8, kartStats('100cc'));
  const b = run(createKartState(track, 0), follow(), 8, kartStats('200cc'));
  assert.ok(b.speed > a.speed * 1.25);
});

test('kart nie przejeżdża przez bandę', () => {
  const k = createKartState(track, 0);
  const limit = track.halfWidth + TRACK.kerbWidth + TRACK.runoffWidth - KART.radius;
  run(k, (kk) => ({ ...gas, steer: 1 }), 15); // ciągle w prawo -> w bandę
  for (let i = 0; i < 2000; i++) {
    stepKart(k, { ...gas, steer: i % 400 < 200 ? 1 : -1 }, track, kartStats('150cc'), DT);
    assert.ok(Math.abs(nearestOnTrack(track, k.x, k.z).lateral) <= limit + 0.05);
  }
});

test('pobocze ogranicza prędkość', () => {
  const k = createKartState(track, 0);
  k.surface = 'offroad';
  const p = track.points[0];
  // Ustaw kart na poboczu (między krawężnikiem a bandą) i jedź prosto.
  const off = track.halfWidth + TRACK.kerbWidth + 2.5;
  Object.assign(k, { x: p.x + p.nx * off, z: p.z + p.nz * off, heading: p.heading, vx: p.tx * 30, vz: p.tz * 30 });
  run(k, gas, 1.0);
  assert.equal(k.surface, 'offroad');
  assert.ok(k.speed <= kartStats('150cc').maxSpeed * KART.offroadSpeedFactor + 1, `speed ${k.speed}`);
});

test('dryf w zakręcie daje mini-turbo poziomu 2', () => {
  // Najdłuższy zakręt toru: tam dryf ma sens.
  const n = track.points.length;
  let best = 0, bestLen = 0;
  for (let i = 0; i < n; i++) {
    let len = 0;
    const dir = Math.sign(track.points[i].curvature);
    while (len < n && track.points[(i + len) % n].radius < 90 && Math.sign(track.points[(i + len) % n].curvature) === dir) len++;
    if (len > bestLen) { bestLen = len; best = i; }
  }
  const dir = Math.sign(track.points[best].curvature);
  const k = createKartState(track, 0);
  // Dojazd do zakrętu.
  const entry = track.points[best].s;
  for (let t = 0; t < 120 && !(Math.abs(k.trackS - entry) < 3 && k.speed > KART.drift.minSpeed); t += DT) {
    stepKart(k, follow()(k), track, kartStats('150cc'), DT);
  }
  stepKart(k, { ...gas, steer: dir, drift: true }, track, kartStats('150cc'), DT);
  assert.ok(k.drift.active, 'wejście w dryf');
  // Dryf z korektą skrętu (jak gracz), aż do poziomu 2.
  for (let t = 0; t < 4 && k.drift.level < 2; t += DT) stepKart(k, follow({ drift: true })(k), track, kartStats('150cc'), DT);
  assert.equal(k.drift.level, 2);
  stepKart(k, gas, track, kartStats('150cc'), DT);
  assert.ok(k.boostTime > KART.drift.boostTimes[0]);
  assert.equal(k.drift.active, false);
});

test('krótki dryf nie daje turbo', () => {
  const k = run(createKartState(track, 0), follow(), 4);
  run(k, { ...gas, steer: -1, drift: true }, 0.3);
  run(k, gas, DT);
  assert.equal(k.boostTime, 0);
});

test('bez gazu kart się zatrzymuje, wsteczny ma limit', () => {
  const k = run(createKartState(track, 0), follow(), 3);
  run(k, idle, 10);
  assert.ok(Math.abs(k.speed) < 0.01);
  run(k, { ...idle, brake: 1 }, 5);
  assert.ok(k.speed < 0 && k.speed >= -KART.reverseMaxSpeed - 1e-6);
});

test('prosty kierowca przejeżdża całe okrążenie w rozsądnym czasie', () => {
  const k = createKartState(track, 0);
  let dist = 0, last = k.trackS, t = 0;
  run(k, idle, DT);
  last = k.trackS;
  while (dist < track.length && t < 120) {
    stepKart(k, follow()(k), track, kartStats('150cc'), DT);
    let d = k.trackS - last;
    if (d < -track.length / 2) d += track.length;
    dist += d; last = k.trackS; t += DT;
  }
  assert.ok(t < 60, `okrążenie ${t.toFixed(1)} s`);
});

test('kart wbity prostopadle w bandę nie zakleszcza się', () => {
  const k = createKartState(track, 0);
  const p = track.points[0];
  const wall = track.halfWidth + TRACK.kerbWidth + TRACK.runoffWidth - KART.radius;
  // Przy bandzie, przodem prosto w nią (lekko skośnie — jak po złym dryfie).
  Object.assign(k, { x: p.x + p.nx * (wall - 0.5), z: p.z + p.nz * (wall - 0.5), heading: Math.atan2(p.nx, p.nz) + 0.15 });
  run(k, gas, 3);
  assert.ok(k.speed > 10, `speed ${k.speed}`);
});
