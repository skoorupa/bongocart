// Testy przedmiotów: skrzynki, losowanie wg miejsca, użycie, trafienia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack } from '../src/track/generator.js';
import { createItems, stepItems, rollItem } from '../src/items.js';
import { createKartState, stepKart, kartStats } from '../src/physics.js';
import { createGame } from '../src/game.js';
import { defaultSettings } from '../src/settings.js';
import { ITEMS, KART, PHYSICS } from '../src/config.js';

const DT = PHYSICS.fixedDt;
const track = generateTrack({ seed: 'items', size: 'small', difficulty: 'medium', theme: 'random', itemFrequency: 'often' });
const settings = (o = {}) => ({ ...defaultSettings(), itemFrequency: 'often', ...o });
const NOBODY = new Set();

// Dwa karty ustawione w odległości s od startu (a za b).
function setup(o = {}) {
  const items = createItems({ track, settings: settings(o), seed: 'x', racerIds: ['a', 'b'] });
  const karts = new Map([['a', createKartState(track, 0)], ['b', createKartState(track, 1)]]);
  const ctx = { track, karts, order: ['b', 'a'], finished: new Set() };
  return { items, karts, ctx };
}
const placeAt = (k, s, lateral = 0) => {
  const p = track.points[Math.round(s / track.step) % track.points.length];
  Object.assign(k, { x: p.x + p.nx * lateral, z: p.z + p.nz * lateral, heading: p.heading, trackS: p.s, lateral, vx: 0, vz: 0, speed: 0 });
};
const ready = (items, id, item) => Object.assign(items.slots.get(id), { item, roll: 0 });

test('losowanie: tylko włączone przedmioty; prowadzący bronią się, ostatni atakują', () => {
  const items = createItems({ track, settings: settings({ enabledItems: ['banana', 'rocket'] }), seed: 'r', racerIds: [] });
  const count = (place) => {
    const c = { banana: 0, rocket: 0 };
    for (let i = 0; i < 2000; i++) c[rollItem(items, place, 8)]++;
    return c;
  };
  const first = count(0), last = count(7);
  assert.equal(Object.keys(first).length, 2);
  assert.ok(first.banana > first.rocket * 2, JSON.stringify(first));
  assert.ok(last.rocket > last.banana * 2, JSON.stringify(last));
});

test('skrzynka: przedmiot po ruletce, skrzynka znika i wraca; z pełnym slotem przejeżdża się przez nią', () => {
  const { items, karts, ctx } = setup();
  const box = items.boxes[0];
  Object.assign(karts.get('a'), { x: box.x, z: box.z });
  const ev = stepItems(items, ctx, NOBODY, DT);
  assert.ok(ev.some((e) => e.type === 'pickup' && e.id === 'a'));
  const slot = items.slots.get('a');
  assert.ok(ITEMS.types[slot.item] && slot.roll > 0);
  assert.ok(box.respawn > 0);
  // Użycie w trakcie ruletki nie działa.
  stepItems(items, ctx, new Set(['a']), DT);
  assert.ok(slot.item);
  const item = slot.item;
  placeAt(karts.get('a'), 0); // odjeżdża
  for (let t = 0; t < ITEMS.box.respawnSeconds + DT; t += DT) stepItems(items, ctx, NOBODY, DT);
  assert.equal(box.respawn, 0);
  Object.assign(karts.get('a'), { x: box.x, z: box.z }); // wraca z pełnym slotem
  stepItems(items, ctx, NOBODY, DT);
  assert.equal(box.respawn, 0); // skrzynka zostaje dla innych
  assert.equal(slot.item, item);
});

test('brak włączonych przedmiotów: slot zostaje pusty', () => {
  const { items, karts, ctx } = setup({ enabledItems: [] });
  Object.assign(karts.get('a'), { x: items.boxes[0].x, z: items.boxes[0].z });
  stepItems(items, ctx, NOBODY, DT);
  assert.equal(items.slots.get('a').item, null);
});

test('turbo i tarcza', () => {
  const { items, karts, ctx } = setup();
  ready(items, 'a', 'boost');
  stepItems(items, ctx, new Set(['a']), DT);
  assert.ok(karts.get('a').boostTime > 0);
  assert.equal(items.slots.get('a').item, null);
  ready(items, 'a', 'shield');
  stepItems(items, ctx, new Set(['a']), DT);
  assert.ok(karts.get('a').shieldTime > ITEMS.shield.seconds - 2 * DT);
});

test('banan: ląduje za kartem, wjeżdżający się obraca, tarcza chroni raz', () => {
  const { items, karts, ctx } = setup();
  const a = karts.get('a'), b = karts.get('b');
  placeAt(b, 200);
  placeAt(a, 150);
  ready(items, 'b', 'banana');
  stepItems(items, ctx, new Set(['b']), DT);
  assert.equal(items.bananas.length, 1);
  const ban = items.bananas[0];
  assert.ok(Math.hypot(ban.x - b.x, ban.z - b.z) > KART.radius + ITEMS.banana.hitRadius); // nie trafia zrzucającego
  Object.assign(a, { x: ban.x, z: ban.z });
  a.shieldTime = 1;
  stepItems(items, ctx, NOBODY, DT);
  assert.equal(a.spinTime, 0);
  assert.equal(a.shieldTime, 0);
  assert.equal(items.bananas.length, 0);
  items.bananas.push({ id: 99, owner: 'b', x: a.x, z: a.z });
  stepItems(items, ctx, NOBODY, DT);
  assert.ok(a.spinTime > 0);
});

test('pocisk dogania kierowcę przed strzelającym', () => {
  const { items, karts, ctx } = setup();
  const a = karts.get('a'), b = karts.get('b');
  placeAt(a, 100, -3);
  placeAt(b, 200, 4);
  ready(items, 'a', 'rocket');
  const stats = kartStats('150cc');
  const gas = { throttle: 1, brake: 0, steer: 0, drift: false };
  let hit = null;
  for (let t = 0; t < ITEMS.rocket.lifetime && !hit; t += DT) {
    stepKart(b, gas, track, stats, DT); // cel ucieka (prosto, może zahaczyć o bandę)
    hit = stepItems(items, ctx, t === 0 ? new Set(['a']) : NOBODY, DT).find((e) => e.type === 'hit');
  }
  assert.deepEqual(hit && [hit.id, hit.by, hit.what], ['b', 'a', 'rocket']);
  assert.ok(b.spinTime > 0);
});

test('obrót: brak kontroli i mocne hamowanie', () => {
  const stats = kartStats('150cc');
  const k = createKartState(track, 0);
  for (let i = 0; i < 4 / DT; i++) stepKart(k, { throttle: 1, brake: 0, steer: 0, drift: false }, track, stats, DT);
  const v0 = k.speed;
  k.spinTime = KART.spin.seconds;
  for (let i = 0; i < 0.5 / DT; i++) stepKart(k, { throttle: 1, brake: 0, steer: 1, drift: false }, track, stats, DT);
  assert.ok(k.speed < v0 - KART.spin.drag * 0.4, `${v0} -> ${k.speed}`);
});

test('wyścig botów z przedmiotami: wszyscy dojeżdżają, przedmioty są używane', () => {
  const game = createGame({ track, settings: settings({ minRacers: 8, laps: 2 }), humans: [], seed: 'chaos' });
  const used = new Set();
  for (let i = 0; i < 200 / DT && game.race.phase !== 'finished'; i++) {
    for (const e of game.step(DT, new Map())) if (e.type === 'use') used.add(e.item);
  }
  assert.ok(game.race.racers.every((r) => r.finishTime !== null));
  assert.ok(used.size >= 3, [...used].join());
});

// --- Pociski: but, klucz, limity dystansu i czasu.
// Kart b dokładnie na linii kursu a (dist m przed nim, side m w prawo).
const inFront = (a, b, dist, side = 0) => {
  const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
  Object.assign(b, { x: a.x + fx * dist - fz * side, z: a.z + fz * dist + fx * side, heading: a.heading, vx: 0, vz: 0, speed: 0 });
  stepKart(b, { throttle: 0, brake: 0, steer: 0, drift: false }, track, kartStats('150cc'), 0); // odśwież trackS/lateral
};
const fire = (items, ctx, id, seconds, extra = () => {}) => {
  const events = [];
  for (let t = 0; t < seconds; t += DT) {
    events.push(...stepItems(items, ctx, t === 0 ? new Set([id]) : NOBODY, DT));
    extra();
  }
  return events;
};

test('but leci prosto i odpycha pierwszego na linii', () => {
  const { items, karts, ctx } = setup();
  const a = karts.get('a'), b = karts.get('b');
  placeAt(a, 100);
  inFront(a, b, 15);
  ready(items, 'a', 'boot');
  const ev = fire(items, ctx, 'a', 1);
  const hit = ev.find((e) => e.type === 'hit');
  assert.deepEqual(hit && [hit.id, hit.by, hit.what], ['b', 'a', 'boot']);
  assert.ok(b.knockTime > 0);
  const x0 = b.x, z0 = b.z, rx = -Math.cos(b.heading), rz = Math.sin(b.heading);
  const stats = kartStats('150cc');
  for (let t = 0; t < 0.5; t += DT) stepKart(b, { throttle: 0, brake: 0, steer: 0, drift: false }, track, stats, DT);
  assert.ok(Math.abs((b.x - x0) * rx + (b.z - z0) * rz) > 2, 'brak zsuwu w bok');
});

test('but obok linii nie trafia i znika', () => {
  const { items, karts, ctx } = setup();
  const a = karts.get('a'), b = karts.get('b');
  placeAt(a, 100);
  inFront(a, b, 15, 4);
  ready(items, 'a', 'boot');
  const ev = fire(items, ctx, 'a', ITEMS.boot.lifetime + DT);
  assert.equal(ev.filter((e) => e.type === 'hit').length, 0);
  assert.equal(items.projectiles.length, 0);
});

test('każdy pocisk znika po maxDistance i po lifetime (także bez celu)', () => {
  for (const kind of ['rocket', 'boot', 'wrench']) {
    const { items, karts, ctx } = setup();
    const a = karts.get('a');
    placeAt(a, 100);
    placeAt(karts.get('b'), 40, 5); // za strzelającym, poza drogą pocisku
    ctx.order = ['a', 'b']; // a prowadzi: brak celu
    ready(items, 'a', kind);
    const c = ITEMS[kind];
    const limit = Math.min(c.maxDistance / c.speed, c.lifetime);
    let steps = 0;
    stepItems(items, ctx, new Set(['a']), DT);
    assert.equal(items.projectiles.length, 1, kind);
    assert.equal(items.projectiles[0].kind, kind);
    while (items.projectiles.length && steps < 10 / DT) { stepItems(items, ctx, NOBODY, DT); steps++; }
    assert.ok(steps * DT <= limit + 2 * DT, `${kind}: ${steps * DT} s > ${limit} s`);
    assert.ok(steps * DT >= limit - 2 * DT, `${kind}: zniknął za wcześnie (${steps * DT} s)`);
  }
});

test('klucz psuje koła celu', () => {
  const { items, karts, ctx } = setup();
  const a = karts.get('a'), b = karts.get('b');
  placeAt(a, 100, -2);
  placeAt(b, 160, 3);
  ready(items, 'a', 'wrench');
  const hit = fire(items, ctx, 'a', ITEMS.wrench.lifetime).find((e) => e.type === 'hit');
  assert.deepEqual(hit && [hit.id, hit.by, hit.what], ['b', 'a', 'wrench']);
  assert.ok(Math.abs(b.brokenTime - ITEMS.wrench.brokenSeconds) < 1e-9, String(b.brokenTime));
});

test('tarcza blokuje but i klucz', () => {
  for (const kind of ['boot', 'wrench']) {
    const { items, karts, ctx } = setup();
    const a = karts.get('a'), b = karts.get('b');
    placeAt(a, 100);
    inFront(a, b, 15);
    b.shieldTime = 5;
    ready(items, 'a', kind);
    const ev = fire(items, ctx, 'a', 1);
    assert.ok(ev.some((e) => e.type === 'blocked' && e.what === kind), kind);
    assert.deepEqual([b.knockTime, b.brokenTime, b.shieldTime], [0, 0, 0], kind);
  }
});

test('banan znika po lifetime', () => {
  const { items, karts, ctx } = setup();
  placeAt(karts.get('a'), 30);
  placeAt(karts.get('b'), 120);
  ready(items, 'b', 'banana');
  stepItems(items, ctx, new Set(['b']), DT);
  assert.equal(items.bananas.length, 1);
  for (let t = 0; t < ITEMS.banana.lifetime + DT; t += DT) stepItems(items, ctx, NOBODY, DT);
  assert.equal(items.bananas.length, 0);
});
