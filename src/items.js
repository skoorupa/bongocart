// =====================================================================
// items.js — skrzynki i przedmioty: losowanie wg miejsca, użycie, banany
// na torze, pociski, tarcze, trafienia. Czysty JS (liczy host).
//
// Przedmioty:
//   rocket — pocisk: leci do kierowcy bezpośrednio przed strzelającym (obrót)
//   banana — zostaje za kartem; kto wjedzie, ten się obraca
//   boost  — turbo
//   shield — przez chwilę chroni przed jednym trafieniem
//   boot   — but: rzut prosto przed siebie, trafiony dostaje kopniaka w bok
//   wrench — klucz: leci jak pocisk, trafiony ma zepsute koła (gaz do dechy,
//            brak hamulca)
// Pociski (rocket, boot, wrench) to jeden mechanizm (pole kind); każdy
// znika po ITEMS[kind].maxDistance albo lifetime.
// =====================================================================
import { ITEMS, KART, COINS } from './config.js';
import { createRng, deriveSeed } from './rng.js';
import { applyBoost, spinOut, knockOut, breakWheels } from './physics.js';

const approach = (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

// Rodzaje pocisków (kolejność stała — także w protokole).
export const PROJECTILE_KINDS = ['rocket', 'boot', 'wrench'];

export function createItems({ track, settings, seed, racerIds }) {
  return {
    // Kolejność z ITEMS.types (stała), tylko włączone w ustawieniach.
    enabled: Object.keys(ITEMS.types).filter((t) => settings.enabledItems.includes(t)),
    boxes: track.itemBoxes.map((b) => ({ x: b.x, z: b.z, respawn: 0 })), // respawn > 0 = rozbita
    bananas: [], // {id, owner, x, z, age}
    // {id, kind, owner, target, s, lateral, x, z, heading, age, dist, homing}
    projectiles: [],
    slots: new Map(racerIds.map((id) => [id, { item: null, roll: 0 }])),
    // Monety (pozycje w track.coins): respawn > 0 = zebrana, wraca po chwili.
    coins: (track.coins ?? []).map(() => ({ respawn: 0 })),
    // Monety zebrane przez zawodnika na bieżącym okrążeniu (indeksy) i to okrążenie.
    coinTaken: new Map(racerIds.map((id) => [id, new Set()])),
    coinLap: new Map(racerIds.map((id) => [id, 0])),
    nextId: 1,
    rng: createRng(deriveSeed(seed, 'items')),
  };
}

// Punkt linii środkowej w odległości s (z interpolacją między próbkami).
function pointAt(track, s) {
  const n = track.points.length;
  const f = (((s % track.length) + track.length) % track.length) / track.step;
  const i = Math.floor(f) % n, t = f - Math.floor(f);
  const a = track.points[i], b = track.points[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: a.nx, nz: a.nz, heading: a.heading };
}

// Losowanie przedmiotu wg miejsca (0 = prowadzący).
export function rollItem(items, place, total) {
  const frac = total > 1 ? place / (total - 1) : 0;
  const band = ITEMS.positionBands.findIndex((b) => frac <= b);
  const col = band === -1 ? ITEMS.positionBands.length : band;
  const weights = items.enabled.map((t) => ITEMS.types[t].weights[col]);
  let r = items.rng.next() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return items.enabled[i];
  return items.enabled[items.enabled.length - 1];
}

// ctx: {track, karts: Map id->stan, order: [id wg kolejności], finished: Set id,
//       laps: Map id->ukończone okrążenia (monety: raz na okrążenie)}
// uses: Set id kierowców, którzy w tym kroku chcą użyć przedmiotu.
// Zwraca zdarzenia: pickup, use, hit, blocked, coin.
export function stepItems(items, ctx, uses, dt) {
  const events = [];
  const { track, karts, finished } = ctx;

  // Trafienie: tarcza blokuje wszystko, inaczej efekt wg rodzaju.
  const hit = (id, by, what) => {
    const k = karts.get(id);
    if (k.shieldTime > 0) {
      k.shieldTime = 0;
      events.push({ type: 'blocked', id, by, what });
      return;
    }
    if (what === 'boot') {
      // W bok, w stronę bliższej krawędzi toru (normalna toru = w prawo).
      const p = track.points[Math.round(k.trackS / track.step) % track.points.length];
      const side = k.lateral >= 0 ? 1 : -1;
      knockOut(k, p.nx * side, p.nz * side, ITEMS.boot.push);
    } else if (what === 'wrench') breakWheels(k, ITEMS.wrench.brokenSeconds);
    else spinOut(k);
    events.push({ type: 'hit', id, by, what });
  };

  // --- Skrzynki: rozbija tylko kart z pustym slotem (inaczej czołówka
  // "zjada" cały rząd i reszta stawki nic nie dostaje).
  const pickR2 = (ITEMS.box.pickupRadius + KART.radius) ** 2;
  const canTake = (id) => items.enabled.length && !items.slots.get(id).item && !finished.has(id);
  for (const box of items.boxes) {
    if (box.respawn > 0) { box.respawn = Math.max(0, box.respawn - dt); continue; }
    for (const [id, k] of karts) {
      if (!canTake(id) || dist2(box, k) > pickR2) continue;
      box.respawn = ITEMS.box.respawnSeconds;
      const slot = items.slots.get(id);
      slot.item = rollItem(items, ctx.order.indexOf(id), ctx.order.length);
      slot.roll = ITEMS.rollSeconds;
      events.push({ type: 'pickup', id });
      break;
    }
  }

  // --- Monety: znikają na chwilę dla wszystkich; jeden kart bierze tę samą
  // monetę najwyżej raz na okrążenie.
  for (const [id, taken] of items.coinTaken) {
    const lap = ctx.laps?.get(id) ?? 0;
    if (items.coinLap.get(id) !== lap) {
      items.coinLap.set(id, lap);
      taken.clear();
    }
  }
  const coinR2 = (COINS.pickupRadius + KART.radius) ** 2;
  items.coins.forEach((coin, i) => {
    if (coin.respawn > 0) { coin.respawn = Math.max(0, coin.respawn - dt); return; }
    const pos = track.coins[i];
    for (const [id, k] of karts) {
      const taken = items.coinTaken.get(id);
      if (finished.has(id) || !taken || taken.has(i) || dist2(pos, k) > coinR2) continue;
      taken.add(i);
      coin.respawn = COINS.respawnSeconds;
      events.push({ type: 'coin', id });
      break;
    }
  });

  // --- Sloty, tarcze, użycie.
  for (const [id, slot] of items.slots) {
    slot.roll = Math.max(0, slot.roll - dt);
    const k = karts.get(id);
    if (!k) continue; // kart po mecie (poza symulacją)
    k.shieldTime = Math.max(0, k.shieldTime - dt);
    if (!uses.has(id) || !slot.item || slot.roll > 0 || k.spinTime > 0) continue;
    useItem(items, id, slot.item, ctx);
    events.push({ type: 'use', id, item: slot.item });
    slot.item = null;
  }

  // --- Pociski.
  items.projectiles = items.projectiles.filter((r) => {
    const c = ITEMS[r.kind];
    r.age += dt;
    if (r.age > c.lifetime || r.dist > c.maxDistance) return false;
    const x0 = r.x, z0 = r.z;
    const target = r.target !== null ? karts.get(r.target) : null;
    if (!c.guided) {
      // Prosto przed siebie.
      r.x += Math.sin(r.heading) * c.speed * dt;
      r.z += Math.cos(r.heading) * c.speed * dt;
    } else if (target && (r.homing || dist2(r, target) < c.homingRange ** 2)) {
      // Z bliska: wprost na cel.
      r.homing = true;
      const dx = target.x - r.x, dz = target.z - r.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(d, c.speed * dt);
      r.x += (dx / d) * step;
      r.z += (dz / d) * step;
      r.heading = Math.atan2(dx, dz);
    } else {
      // Wzdłuż toru, bokiem do linii celu.
      r.s += c.speed * dt;
      r.lateral = approach(r.lateral, target ? target.lateral : r.lateral, c.lateralRate * dt);
      const p = pointAt(track, r.s);
      r.x = p.x + p.nx * r.lateral;
      r.z = p.z + p.nz * r.lateral;
      r.heading = p.heading;
    }
    r.dist += Math.hypot(r.x - x0, r.z - z0);
    const hitR2 = (c.hitRadius + KART.radius) ** 2;
    for (const [id, k] of karts) {
      if (id === r.owner && r.age < c.armSeconds) continue;
      if (dist2(r, k) < hitR2) {
        hit(id, r.owner, r.kind);
        return false;
      }
    }
    return true;
  });

  // --- Banany (znikają też po czasie).
  const banR2 = (ITEMS.banana.hitRadius + KART.radius) ** 2;
  items.bananas = items.bananas.filter((b) => {
    b.age += dt;
    if (b.age > ITEMS.banana.lifetime) return false;
    for (const [id, k] of karts) {
      if (dist2(b, k) < banR2) {
        hit(id, b.owner, 'banana');
        return false;
      }
    }
    return true;
  });

  return events;
}

function useItem(items, id, item, { karts, order, finished }) {
  const k = karts.get(id);
  const fx = Math.sin(k.heading), fz = Math.cos(k.heading);
  if (item === 'boost') applyBoost(k, ITEMS.boost.seconds);
  else if (item === 'shield') k.shieldTime = ITEMS.shield.seconds;
  else if (item === 'banana') {
    const b = ITEMS.banana;
    items.bananas.push({ id: items.nextId++, owner: id, x: k.x - fx * b.dropBack, z: k.z - fz * b.dropBack, age: 0 });
    if (items.bananas.length > b.maxOnTrack) items.bananas.shift();
  } else if (PROJECTILE_KINDS.includes(item)) {
    const c = ITEMS[item];
    // Cel (pociski naprowadzane): najbliższy przed strzelającym, który
    // jeszcze jedzie; prowadzący strzela przed siebie.
    const ahead = c.guided ? order.slice(0, order.indexOf(id)).filter((o) => !finished.has(o)) : [];
    items.projectiles.push({
      id: items.nextId++,
      kind: item,
      owner: id,
      target: ahead.length ? ahead[ahead.length - 1] : null,
      s: k.trackS + c.launchAhead,
      lateral: k.lateral,
      x: k.x + fx * c.launchAhead,
      z: k.z + fz * c.launchAhead,
      heading: k.heading,
      age: 0,
      dist: 0,
      homing: false,
    });
  }
}
