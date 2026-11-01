// Testy modelu jazdy: przyspieszanie, klasy prędkości, bandy, pobocze, dryf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack, nearestOnTrack } from '../src/track/generator.js';
import { createKartState, stepKart, kartStats } from '../src/physics.js';
import { KART, PHYSICS, TRACK, OBSTACLES } from '../src/config.js';

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

// --- Przeszkody: tor bez przeszkód + ręcznie dołożone słupki/progi na prostej startowej.
const n = track.points.length;
const withObstacles = (obstacles) => ({ ...track, obstacles, posts: obstacles.filter((o) => o.type === 'post') });
const at = (i, lat = 0) => { const p = track.points[((i % n) + n) % n]; return { x: p.x + p.nx * lat, z: p.z + p.nz * lat, p }; };
const postAt = (i, lat = 0) => { const q = at(i, lat); return { type: 'post', x: q.x, z: q.z, s: q.p.s, radius: OBSTACLES.post.radius }; };
const bumpAt = (i, latFrom = -track.halfWidth, latTo = track.halfWidth) => {
  const p = track.points[((i % n) + n) % n];
  return { type: 'bump', index: ((i % n) + n) % n, s: p.s, latFrom, latTo, heading: p.heading };
};
// Kart w punkcie i (przesunięty o lat), patrzy wzdłuż toru, jedzie z prędkością v.
const placed = (t, i, lat, v) => {
  const k = createKartState(t, 0);
  const q = at(i, lat);
  Object.assign(k, { x: q.x, z: q.z, heading: q.p.heading, vx: Math.sin(q.p.heading) * v, vz: Math.cos(q.p.heading) * v, speed: v });
  stepKart(k, idle, t, kartStats('150cc'), 0); // odśwież trackS/lateral bez ruchu
  return k;
};
// Jazda z zapisem prędkości w każdym kroku.
const drive = (t, k, input, seconds) => {
  const speeds = [k.speed];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepKart(k, input, t, kartStats('150cc'), DT);
    speeds.push(k.speed);
  }
  return speeds;
};
const drops = (speeds) => speeds.slice(1).map((v, i) => Math.abs(speeds[i]) - Math.abs(v));
const metersPerIdx = track.step;

test('słupek odbija i spowalnia, ale nie zatrzymuje ani nie obraca', () => {
  const post = postAt(Math.round(8 / metersPerIdx) + 2, 0.6);
  const t = withObstacles([post]);
  const k = placed(t, 2, 0, 25);
  const minD = KART.radius + post.radius;
  let minSpeed = Infinity, touched = false;
  for (let i = 0; i < Math.round(2 / DT); i++) {
    stepKart(k, gas, t, kartStats('150cc'), DT);
    const d = Math.hypot(k.x - post.x, k.z - post.z);
    assert.ok(d >= minD - 1e-6, `przenika słupek: ${d}`);
    if (d < minD + 0.05) touched = true;
    minSpeed = Math.min(minSpeed, k.speed);
    assert.equal(k.spinTime, 0);
  }
  assert.ok(touched, 'nie dotknął słupka');
  assert.ok(minSpeed < 25 * 0.9 && minSpeed > 0, `min ${minSpeed}`);
  assert.ok(k.trackS > post.s + 2, `utknął: ${k.trackS} vs ${post.s}`);
});

test('dryf nie jest przerywany przez słupek', () => {
  const t = withObstacles([postAt(2 + Math.round(2 / metersPerIdx), 0.8)]);
  const k = placed(t, 2, 0, 20);
  Object.assign(k.drift, { active: true, dir: 1 });
  const input = { ...gas, drift: true, steer: 1 };
  let hit = false;
  for (let i = 0; i < Math.round(0.4 / DT) && !hit; i++) {
    stepKart(k, input, t, kartStats('150cc'), DT);
    hit = k.wallHit > 0;
  }
  assert.ok(hit, 'brak uderzenia');
  assert.equal(k.drift.active, true);
});

test('próg zwalnia raz przy dużej prędkości', () => {
  const t = withObstacles([bumpAt(12)]);
  const k = placed(t, 2, 0, 25);
  const speeds = drive(t, k, idle, 1);
  const d = drops(speeds);
  const big = d.filter((x) => x > 0.5);
  assert.equal(big.length, 1, JSON.stringify(big));
  assert.ok(Math.abs(big[0] - speeds[d.indexOf(big[0])] * (1 - OBSTACLES.bump.speedKeep)) < 0.3, `spadek ${big[0]}`);
  assert.ok(speeds.some((_, i) => i > 0) && k.trackS > t.obstacles[0].s);
});

test('próg ustawia podskok (bumpTime)', () => {
  const t = withObstacles([bumpAt(12)]);
  const k = placed(t, 2, 0, 25);
  let maxBump = 0;
  for (let i = 0; i < Math.round(1 / DT); i++) { stepKart(k, idle, t, kartStats('150cc'), DT); maxBump = Math.max(maxBump, k.bumpTime); }
  assert.ok(maxBump > 0 && maxBump <= OBSTACLES.bump.hopSeconds);
});

test('próg przy małej prędkości nie karze', () => {
  const t = withObstacles([bumpAt(6)]);
  const k = placed(t, 2, 0, OBSTACLES.bump.minSpeed - 2);
  const d = drops(drive(t, k, idle, 2));
  assert.ok(Math.max(...d) < 0.3, `spadek ${Math.max(...d)}`);
  assert.equal(k.bumpTime, 0);
});

test('próg poza pasem nie działa', () => {
  const t = withObstacles([bumpAt(12, 3, 7)]);
  const k = placed(t, 2, -3, 25);
  const d = drops(drive(t, k, idle, 1));
  assert.ok(Math.max(...d) < 0.5, `spadek ${Math.max(...d)}`);
});

test('cofanie przez próg też karze raz', () => {
  const t = withObstacles([bumpAt(20)]);
  const k = placed(t, 20 + Math.round(2 / metersPerIdx), 0, -KART.reverseMaxSpeed);
  const speeds = drive(t, k, { ...idle, brake: 1 }, 1);
  const big = drops(speeds).filter((x) => x > 0.5);
  assert.equal(big.length, 1, JSON.stringify(big));
  assert.ok(Math.abs(big[0] - KART.reverseMaxSpeed * (1 - OBSTACLES.bump.speedKeep)) < 0.5, `spadek ${big[0]}`);
});

test('próg nie reaguje na przejazd przez linię mety', () => {
  const t = withObstacles([bumpAt(Math.round(50 / metersPerIdx))]);
  const k = placed(t, -Math.round(6 / metersPerIdx), 0, 25);
  const d = drops(drive(t, k, idle, 0.5));
  assert.ok(k.trackS < 40, `trackS ${k.trackS}`);
  assert.ok(Math.max(...d) < 0.5, `spadek ${Math.max(...d)}`);
});
