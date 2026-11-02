// =====================================================================
// game.js — symulacja jednego wyścigu: wszystkie karty, kierowcy AI,
// kolizje, przebieg wyścigu. Czysty JS (bez Three.js i DOM) — w etapie 6
// liczy to host i rozsyła stan do graczy.
//
// Kto steruje kartem:
//   odliczanie                        -> nikt (stoi)
//   człowiek w trakcie jazdy          -> jego sterowanie (inputs)
//   bot / człowiek po mecie / koniec  -> kierowca AI
//   rozłączony gracz (takeOver)       -> kierowca AI do końca wyścigu
// =====================================================================
import { AI, BOT_NAMES, KART_COLORS, MAX_RACERS } from './config.js';
import { createKartState, stepKart, kartStats, resetKartToTrack, collideKarts } from './physics.js';
import { createDriver } from './ai.js';
import { createRace, updateRace, standings } from './race.js';
import { createItems, stepItems } from './items.js';
import { deriveSeed } from './rng.js';

const NEUTRAL = { throttle: 0, brake: 0, steer: 0, drift: false };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Skład: ludzie + boty do settings.minRacers (maks. MAX_RACERS; limit
// ludzi pilnuje lobby).
// Boty stoją z przodu stawki, ludzie za nimi — jest kogo wyprzedzać.
export function buildRoster(settings, humans) {
  const total = Math.max(Math.min(settings.minRacers, MAX_RACERS), humans.length);
  const used = new Set(humans.map((h) => h.color));
  const freeColors = KART_COLORS.filter((c) => !used.has(c));
  const bots = Array.from({ length: total - humans.length }, (_, i) => ({
    id: `bot${i}`,
    name: BOT_NAMES[i % BOT_NAMES.length],
    color: freeColors[i % freeColors.length],
    isHuman: false,
  }));
  return [...bots, ...humans.map((h) => ({ ...h, isHuman: true }))];
}

// humans: [{id, name, color}]; seed: do losowości botów (deterministyczna).
// roster (opcjonalnie): zamrożony skład turnieju [{id, name, color, isHuman}]
// — wtedy humans/minRacers nie decydują o składzie.
export function createGame({ track, settings, humans, seed, roster: fixed = null }) {
  const roster = fixed ? fixed.map((r) => ({ ...r })) : buildRoster(settings, humans);
  const race = createRace({ track, laps: settings.laps, racers: roster, waitForAll: settings.gameMode === 'tournament' });
  const stats = kartStats(settings.speedClass);
  const karts = new Map(roster.map((r, slot) => [r.id, createKartState(track, slot)]));
  const drivers = new Map();
  const driverOf = (id) => {
    if (!drivers.has(id)) drivers.set(id, createDriver(track, settings.botDifficulty, deriveSeed(seed, 'bot', id)));
    return drivers.get(id);
  };
  const items = createItems({ track, settings, seed, racerIds: roster.map((r) => r.id) });

  // Gumka: odległość bota od najlepszego człowieka, który jeszcze jedzie.
  function speedMulFor(r, leaderProgress) {
    if (r.isHuman || leaderProgress === null) return 1;
    const rb = AI.rubberBand;
    return 1 + clamp((leaderProgress - r.progress) / rb.distance, -1, 1) * rb.strength;
  }

  return {
    track,
    race,
    roster,
    karts,
    stats,
    items,

    // Gracz się rozłączył: jego kart przejmuje AI (poziom botów z ustawień),
    // a wyścig przestaje na niego czekać. Zwraca zdarzenie albo null.
    takeOver(id) {
      const r = race.racers.find((x) => x.id === id);
      if (!r || !r.isHuman) return null;
      r.isHuman = false;
      r.takenOver = true;
      return { type: 'takeover', id, name: r.name };
    },

    // inputs: Map id -> sterowanie człowieka (z input.js / z sieci).
    // Zwraca zdarzenia wyścigu (patrz race.js).
    step(dt, inputs) {
      const racing = race.phase === 'racing';
      const order = standings(race);
      const live = race.racers.filter((r) => r.isHuman && r.finishTime === null);
      const leaderProgress = live.length ? Math.max(...live.map((r) => r.progress)) : null;
      const uses = new Set();
      // Po mecie kart znika z symulacji: stoi, nie zderza się, nie jest
      // celem przedmiotów ani przeszkodą dla botów (rysowanie go ukrywa).
      const active = new Map(order.filter((r) => r.finishTime === null).map((r) => [r.id, karts.get(r.id)]));
      const activeList = [...active.values()];

      order.forEach((r, place) => {
        if (r.finishTime !== null) return;
        const kart = karts.get(r.id);
        let input;
        if (race.phase === 'countdown') input = NEUTRAL;
        else if (r.isHuman && racing && r.finishTime === null) input = inputs.get(r.id) ?? NEUTRAL;
        else {
          const others = activeList.filter((k) => k !== kart);
          input = driverOf(r.id).control(kart, {
            others,
            stats,
            speedMul: speedMulFor(r, leaderProgress),
            slot: items.slots.get(r.id),
            hazards: [...items.bananas, ...(track.oils ?? [])], // omijają tylko boty z dodge
            obstacles: track.posts,
            // Odstępy [m] do sąsiadów w kolejności (null = brak sąsiada).
            gapAhead: place > 0 ? order[place - 1].progress - r.progress : null,
            gapBehind: place < order.length - 1 ? r.progress - order[place + 1].progress : null,
          }, dt);
        }
        if (input.reset) resetKartToTrack(kart, track);
        if (input.item) uses.add(r.id);
        stepKart(kart, input, track, stats, dt);
      });
      if (settings.kartCollisions) collideKarts(activeList);

      const events = race.phase === 'countdown' ? [] : stepItems(items, {
        track,
        karts: active,
        order: order.map((r) => r.id),
        finished: new Set(race.racers.filter((r) => r.finishTime !== null).map((r) => r.id)),
        laps: new Map(race.racers.map((r) => [r.id, r.lap])),
      }, uses, dt);
      for (const e of events) if (e.type === 'coin') race.racers.find((r) => r.id === e.id).coins++;
      return [...events, ...updateRace(race, dt, karts)];
    },
  };
}
