// =====================================================================
// items.js — skrzynki i przedmioty: losowanie wg miejsca, użycie, banany
// na torze, pociski, tarcze, trafienia. Czysty JS (liczy host).
//
// Przedmioty:
//   rocket — leci do kierowcy bezpośrednio przed strzelającym
//   banana — zostaje za kartem; kto wjedzie, ten się obraca
//   boost  — turbo
//   shield — przez chwilę chroni przed jednym trafieniem
// =====================================================================
import { ITEMS, KART } from './config.js';
import { createRng, deriveSeed } from './rng.js';
import { applyBoost, spinOut } from './physics.js';

const approach = (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export function createItems({ track, settings, seed, racerIds }) {
  return {
    // Kolejność z ITEMS.types (stała), tylko włączone w ustawieniach.
    enabled: Object.keys(ITEMS.types).filter((t) => settings.enabledItems.includes(t)),
    boxes: track.itemBoxes.map((b) => ({ x: b.x, z: b.z, respawn: 0 })), // respawn > 0 = rozbita
    bananas: [], // {id, x, z}
    rockets: [], // {id, owner, target, s, lateral, x, z, heading, age, homing}
    slots: new Map(racerIds.map((id) => [id, { item: null, roll: 0 }])),
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

// ctx: {track, karts: Map id->stan, order: [id wg kolejności], finished: Set id}
// uses: Set id kierowców, którzy w tym kroku chcą użyć przedmiotu.
// Zwraca zdarzenia: pickup, use, hit, blocked.
export function stepItems(items, ctx, uses, dt) {
  const events = [];
  const { track, karts, order, finished } = ctx;

  const hit = (id, by, what) => {
    const k = karts.get(id);
    if (k.shieldTime > 0) {
      k.shieldTime = 0;
      events.push({ type: 'blocked', id, by, what });
    } else {
      spinOut(k);
      events.push({ type: 'hit', id, by, what });
    }
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
      slot.item = rollItem(items, order.indexOf(id), order.length);
      slot.roll = ITEMS.rollSeconds;
      events.push({ type: 'pickup', id });
      break;
    }
  }

  // --- Sloty, tarcze, użycie.
  for (const [id, slot] of items.slots) {
    slot.roll = Math.max(0, slot.roll - dt);
    const k = karts.get(id);
    k.shieldTime = Math.max(0, k.shieldTime - dt);
    if (!uses.has(id) || !slot.item || slot.roll > 0 || k.spinTime > 0) continue;
    useItem(items, id, slot.item, ctx);
    events.push({ type: 'use', id, item: slot.item });
    slot.item = null;
  }

  // --- Pociski.
  const rc = ITEMS.rocket;
  items.rockets = items.rockets.filter((r) => {
    r.age += dt;
    if (r.age > rc.lifetime) return false;
    const target = r.target !== null ? karts.get(r.target) : null;
    if (target && (r.homing || dist2(r, target) < rc.homingRange ** 2)) {
      // Z bliska: wprost na cel.
      r.homing = true;
      const dx = target.x - r.x, dz = target.z - r.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(d, rc.speed * dt);
      r.x += (dx / d) * step;
      r.z += (dz / d) * step;
      r.heading = Math.atan2(dx, dz);
    } else {
      // Wzdłuż toru, bokiem do linii celu.
      r.s += rc.speed * dt;
      r.lateral = approach(r.lateral, target ? target.lateral : r.lateral, rc.lateralRate * dt);
      const p = pointAt(track, r.s);
      r.x = p.x + p.nx * r.lateral;
      r.z = p.z + p.nz * r.lateral;
      r.heading = p.heading;
    }
    const hitR2 = (rc.hitRadius + KART.radius) ** 2;
    for (const [id, k] of karts) {
      if (id === r.owner && r.age < rc.armSeconds) continue;
      if (dist2(r, k) < hitR2) {
        hit(id, r.owner, 'rocket');
        return false;
      }
    }
    return true;
  });

  // --- Banany.
  const banR2 = (ITEMS.banana.hitRadius + KART.radius) ** 2;
  items.bananas = items.bananas.filter((b) => {
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
    items.bananas.push({ id: items.nextId++, owner: id, x: k.x - fx * b.dropBack, z: k.z - fz * b.dropBack });
    if (items.bananas.length > b.maxOnTrack) items.bananas.shift();
  } else if (item === 'rocket') {
    // Cel: najbliższy przed strzelającym, który jeszcze jedzie.
    const ahead = order.slice(0, order.indexOf(id)).filter((o) => !finished.has(o));
    const rc = ITEMS.rocket;
    items.rockets.push({
      id: items.nextId++,
      owner: id,
      target: ahead.length ? ahead[ahead.length - 1] : null, // prowadzący strzela przed siebie
      s: k.trackS + rc.launchAhead,
      lateral: k.lateral,
      x: k.x + fx * rc.launchAhead,
      z: k.z + fz * rc.launchAhead,
      heading: k.heading,
      age: 0,
      homing: false,
    });
  }
}
