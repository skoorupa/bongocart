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

// Seed toru mapy i (0..count-1) — ten sam seed turnieju = te same tory.
export const mapSeedOf = (seed, i) => `${seed}-${i + 1}`;

// roster: [{id, name, color, isHuman}]
export function createTournament({ seed, mapCount, roster }) {
  const order = roster.map((r) => r.id);
  const rows = new Map(roster.map((r) => [r.id, { ...r, points: 0, time: 0, lastPoints: 0, left: false }]));
  const ready = new Set();

  const t = {
    roster: roster.map((r) => ({ ...r })),
    index: 0,
    count: mapCount,
    phase: 'racing',

    mapSeed: (i) => mapSeedOf(seed, i),

    // Wyniki zakończonej mapy: punkty za miejsce, czas mety (DNF = czas
    // trwania wyścigu).
    recordRace(race) {
      standings(race).forEach((r, place) => {
        const row = rows.get(r.id);
        if (!row) return;
        row.lastPoints = TOURNAMENT.points[place] ?? 0;
        row.points += row.lastPoints;
        row.time += r.finishTime ?? race.time;
      });
      t.phase = t.index >= t.count - 1 ? 'done' : 'between';
    },

    // Ranking: punkty malejąco, potem łączny czas, potem kolejność składu.
    table() {
      return [...rows.values()]
        .sort((a, b) => b.points - a.points || a.time - b.time || order.indexOf(a.id) - order.indexOf(b.id))
        .map(({ id, name, color, isHuman, points, time, lastPoints, left }) => ({ id, name, color, isHuman, points, time, lastPoints, left }));
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
