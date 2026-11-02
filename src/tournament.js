// =====================================================================
// tournament.js — turniej: seria map z sumowaniem punktów i czasu.
// Czysty JS (bez DOM). Właścicielem stanu jest host (albo gra solo);
// klienci dostają gotowy widok (view()) w wiadomości "tourney".
//
// Fazy: racing (trwa mapa) -> between (wyniki, gotowość) -> racing ...
//       -> done (po ostatniej mapie).
// Skład (roster) jest zamrożony na starcie: gracz, który wyjdzie, zostaje
// w tabeli, a w kolejnych mapach jego kartem jedzie bot.
// =====================================================================
import { TOURNAMENT } from './config.js';
import { standings } from './race.js';

// Monety możliwe do zebrania w wyścigu: każda raz na okrążenie.
export const coinsPossible = (track, laps) => (track.coins?.length ?? 0) * laps;

// Premia za monety: proporcjonalna do zebranych, komplet = maxCoinPoints.
// Dzięki maksimum ostatni nie przeskoczy czołówki samymi monetami.
export const coinBonus = (coins, possible) =>
  (possible > 0 ? Math.round((TOURNAMENT.maxCoinPoints * Math.min(coins, possible)) / possible) : 0);

// Punkty za wyścig, osobno za miejsce i za monety (kolejność = standings):
// [{id, place, coins, total}]. possible = coinsPossible(track, laps).
export const racePoints = (race, possible) => standings(race).map((r, i) => {
  const place = TOURNAMENT.points[i] ?? 0;
  const coins = coinBonus(r.coins ?? 0, possible);
  return { id: r.id, place, coins, total: place + coins };
});

// Seed toru mapy i (0..count-1) — ten sam seed turnieju = te same tory.
export const mapSeedOf = (seed, i) => `${seed}-${i + 1}`;

// roster: [{id, name, color, isHuman}]
export function createTournament({ seed, mapCount, roster }) {
  const order = roster.map((r) => r.id);
  // maps: wynik każdej rozegranej mapy {points, time} (sumy = points, time).
  const rows = new Map(roster.map((r) => [r.id, { ...r, points: 0, time: 0, lastPoints: 0, maps: [], left: false }]));
  const ready = new Set();

  const t = {
    roster: roster.map((r) => ({ ...r })),
    index: 0,
    count: mapCount,
    phase: 'racing',

    mapSeed: (i) => mapSeedOf(seed, i),

    // Wyniki zakończonej mapy: punkty za miejsce + premia za monety
    // (coinsPossible = coinsPossible(track, laps)), czas mety (DNF = czas
    // trwania wyścigu).
    recordRace(race, possibleCoins = 0) {
      const pts = new Map(racePoints(race, possibleCoins).map((p) => [p.id, p.total]));
      for (const r of race.racers) {
        const row = rows.get(r.id);
        if (!row) continue;
        const time = r.finishTime ?? race.time;
        row.lastPoints = pts.get(r.id);
        row.points += row.lastPoints;
        row.time += time;
        row.maps.push({ points: row.lastPoints, time });
      }
      t.phase = t.index >= t.count - 1 ? 'done' : 'between';
    },

    // Ranking: punkty malejąco, potem łączny czas, potem kolejność składu.
    table() {
      return [...rows.values()]
        .sort((a, b) => b.points - a.points || a.time - b.time || order.indexOf(a.id) - order.indexOf(b.id))
        .map(({ id, name, color, isHuman, points, time, lastPoints, maps, left }) => ({ id, name, color, isHuman, points, time, lastPoints, maps: maps.map((m) => ({ ...m })), left }));
    },

    // Gotowość zgłasza tylko obecny człowiek z turnieju, między mapami.
    // Zwraca true, gdy coś się zmieniło.
    setReady(id) {
      const row = rows.get(id);
      if (t.phase !== 'between' || !row?.isHuman || row.left || ready.has(id)) return false;
      ready.add(id);
      return true;
    },
    allReady: () => [...rows.values()].every((r) => !r.isHuman || r.left || ready.has(r.id)),

    markLeft(id) {
      const row = rows.get(id);
      if (row) row.left = true;
      ready.delete(id);
    },

    nextMap() {
      t.index++;
      ready.clear();
      t.phase = 'racing';
    },

    view: () => ({ index: t.index, count: t.count, phase: t.phase, table: t.table(), ready: [...ready] }),
  };
  return t;
}
