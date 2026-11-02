// Testy turnieju: punktacja, DNF, remisy, seedy map, gotowość, fazy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, mapSeedOf, coinBonus, coinsPossible, racePoints } from '../src/tournament.js';
import { TOURNAMENT, PHYSICS } from '../src/config.js';
import { createGame, buildRoster } from '../src/game.js';
import { generateTrack } from '../src/track/generator.js';
import { defaultSettings } from '../src/settings.js';

const H = (id) => ({ id, name: id, color: 0xe63946, isHuman: true });
const B = (id) => ({ id, name: id, color: 0x1e88e5, isHuman: false });
// Minimalny wyścig: standings() potrzebuje racers {id, finishTime, progress} i time.
const race = (time, rows) => ({ time, racers: rows.map(([id, finishTime, progress = 0]) => ({ id, finishTime, progress })) });

test('punkty za miejsca i DNF z czasem trwania wyścigu', () => {
  const t = createTournament({ seed: 's', mapCount: 3, roster: [H('a'), B('b'), B('c')] });
  t.recordRace(race(75, [['c', null, 500], ['a', 60], ['b', 62]]));
  const tab = Object.fromEntries(t.table().map((r) => [r.id, r]));
  assert.deepEqual([tab.a.points, tab.b.points, tab.c.points], TOURNAMENT.points.slice(0, 3));
  assert.deepEqual([tab.a.time, tab.b.time, tab.c.time], [60, 62, 75]);
  assert.equal(tab.a.lastPoints, TOURNAMENT.points[0]);
  assert.deepEqual(t.table().map((r) => r.id), ['a', 'b', 'c']);
});

test('sumowanie po mapach; remis rozstrzyga czas', () => {
  const t = createTournament({ seed: 's', mapCount: 3, roster: [H('a'), H('b')] });
  t.recordRace(race(70, [['a', 50], ['b', 60]]));
  t.nextMap();
  t.recordRace(race(70, [['b', 55], ['a', 56]]));
  const [first, second] = t.table();
  assert.equal(first.points, second.points);
  assert.equal(first.id, 'a'); // 106 s < 115 s
  assert.equal(first.time, 106);
});

test('mapSeed deterministyczny i różny dla map', () => {
  const t = createTournament({ seed: 'abc', mapCount: 10, roster: [H('a')] });
  assert.equal(t.mapSeed(0), 'abc-1');
  assert.equal(t.mapSeed(9), 'abc-10');
  assert.equal(mapSeedOf('abc', 0), 'abc-1');
});

test('gotowość: tylko ludzie w fazie between; boty i nieobecni nie blokują', () => {
  const t = createTournament({ seed: 's', mapCount: 3, roster: [H('h1'), H('h2'), B('b')] });
  assert.equal(t.setReady('h1'), false); // faza racing
  t.recordRace(race(70, [['h1', 50], ['h2', 60], ['b', 65]]));
  assert.equal(t.setReady('b'), false);
  assert.equal(t.setReady('obcy'), false);
  assert.equal(t.allReady(), false);
  assert.equal(t.setReady('h1'), true);
  assert.equal(t.setReady('h1'), false); // bez zmiany
  assert.equal(t.allReady(), false);
  t.markLeft('h2');
  assert.equal(t.allReady(), true);
  assert.deepEqual(t.view().ready, ['h1']);
  t.nextMap();
  assert.deepEqual(t.view().ready, []);
});

test('fazy: racing → between → racing → done', () => {
  const t = createTournament({ seed: 's', mapCount: 2, roster: [H('a')] });
  assert.equal(t.phase, 'racing');
  t.recordRace(race(10, [['a', 9]]));
  assert.equal(t.phase, 'between');
  t.nextMap();
  assert.equal(t.phase, 'racing');
  assert.equal(t.index, 1);
  t.recordRace(race(10, [['a', 9]]));
  assert.equal(t.phase, 'done');
  assert.equal(t.view().count, 2);
});

test('markLeft zachowuje punkty i oznacza w tabeli', () => {
  const t = createTournament({ seed: 's', mapCount: 3, roster: [H('a'), H('b')] });
  t.recordRace(race(70, [['b', 50], ['a', 60]]));
  t.markLeft('b');
  const b = t.table().find((r) => r.id === 'b');
  assert.equal(b.points, TOURNAMENT.points[0]);
  assert.equal(b.left, true);
});

test('więcej zawodników niż punktowanych miejsc: reszta 0 pkt', () => {
  const roster = Array.from({ length: TOURNAMENT.points.length + 1 }, (_, i) => B(`b${i}`));
  const t = createTournament({ seed: 's', mapCount: 2, roster });
  t.recordRace(race(70, roster.map((r, i) => [r.id, 50 + i])));
  assert.equal(t.table().at(-1).points, 0);
});

// --- Turniej z prawdziwymi wyścigami botów.
const DT = PHYSICS.fixedDt;
const settings = { ...defaultSettings(), minRacers: 4, laps: 1 };
const trackOf = (seed) => generateTrack({ seed, size: 'small', difficulty: 'easy', theme: 'random', itemFrequency: 'none' });
const runToEnd = (game, inputs = new Map()) => {
  for (let i = 0; i < 120 / DT && game.race.phase !== 'finished'; i++) game.step(DT, inputs);
};

test('pełny turniej botów: 3 mapy, tabela sumuje rozdane punkty', () => {
  const t = createTournament({ seed: 'tour', mapCount: 3, roster: buildRoster(settings, []) });
  for (let i = 0; i < 3; i++) {
    const game = createGame({ track: trackOf(t.mapSeed(i)), settings, humans: [], seed: `g${i}`, roster: t.roster });
    assert.deepEqual(game.race.racers.map((r) => r.id), t.roster.map((r) => r.id));
    runToEnd(game);
    assert.equal(game.race.phase, 'finished');
    t.recordRace(game.race);
    if (i < 2) t.nextMap();
  }
  assert.equal(t.phase, 'done');
  const total = t.table().reduce((sum, r) => sum + r.points, 0);
  assert.equal(total, 3 * TOURNAMENT.points.slice(0, 4).reduce((a, b) => a + b, 0));
});

test('createGame z rosterem: człowiek, który wyszedł, jedzie botem', () => {
  const roster = [{ id: 'p1', name: 'Ola', color: 0xe63946, isHuman: true }, ...buildRoster({ ...settings, minRacers: 2 }, [])];
  const game = createGame({ track: trackOf('left'), settings, humans: [], seed: 'x', roster });
  assert.deepEqual(game.roster.map((r) => r.id), roster.map((r) => r.id));
  game.takeOver('p1');
  for (let i = 0; i < 6 / DT; i++) game.step(DT, new Map());
  assert.ok(game.karts.get('p1').speed > 5, `${game.karts.get('p1').speed}`);
  assert.equal(game.race.racers.find((r) => r.id === 'p1').takenOver, true);
});

// --- Premia za monety.
test('coinBonus: 0 / połowa / komplet → 0 / 3 / 6; brak możliwych → 0', () => {
  assert.equal(TOURNAMENT.maxCoinPoints, 6);
  assert.deepEqual([coinBonus(0, 120), coinBonus(60, 120), coinBonus(120, 120), coinBonus(5, 0)], [0, 3, 6, 0]);
  assert.equal(coinsPossible({ coins: new Array(25) }, 5), 125);
});

test('recordRace: punkty = miejsce + premia; ostatni z kompletem monet < 4. miejsce bez monet', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const t = createTournament({ seed: 's', mapCount: 2, roster: ids.map(B) });
  const r = race(100, ids.map((id, i) => [id, 50 + i]));
  r.racers.forEach((x) => { x.coins = x.id === 'p8' ? 100 : 0; });
  r.racers[1].coins = 50; // p2: połowa
  t.recordRace(r, 100);
  const tab = Object.fromEntries(t.table().map((x) => [x.id, x]));
  assert.equal(tab.p2.lastPoints, TOURNAMENT.points[1] + 3);
  assert.equal(tab.p8.points, (TOURNAMENT.points[7] ?? 0) + TOURNAMENT.maxCoinPoints);
  assert.ok(tab.p8.points < tab.p4.points, `${tab.p8.points} vs ${tab.p4.points}`);
});

// --- Rozbicie punktów: per mapa i per zawodnik.
test('racePoints: punkty za miejsce i za monety osobno, suma', () => {
  const r = race(100, [['a', 50], ['b', 51], ['c', null, 10]]);
  r.racers[1].coins = 50;
  assert.deepEqual(racePoints(r, 100), [
    { id: 'a', place: TOURNAMENT.points[0], coins: 0, total: TOURNAMENT.points[0] },
    { id: 'b', place: TOURNAMENT.points[1], coins: 3, total: TOURNAMENT.points[1] + 3 },
    { id: 'c', place: TOURNAMENT.points[2], coins: 0, total: TOURNAMENT.points[2] },
  ]);
});

test('tabela turnieju: wynik każdej mapy (pkt, czas); sumy = suma map', () => {
  const t = createTournament({ seed: 's', mapCount: 3, roster: [H('a'), B('b')] });
  t.recordRace(race(80, [['a', 60], ['b', null, 5]]));
  t.nextMap();
  const r2 = race(90, [['b', 70], ['a', 72]]);
  r2.racers[1].coins = 10;
  t.recordRace(r2, 10);
  const tab = Object.fromEntries(t.table().map((x) => [x.id, x]));
  assert.deepEqual(tab.a.maps, [{ points: TOURNAMENT.points[0], time: 60 }, { points: TOURNAMENT.points[1] + TOURNAMENT.maxCoinPoints, time: 72 }]);
  assert.deepEqual(tab.b.maps, [{ points: TOURNAMENT.points[1], time: 80 }, { points: TOURNAMENT.points[0], time: 70 }]);
  for (const row of t.table()) {
    assert.equal(row.points, row.maps.reduce((s, m) => s + m.points, 0));
    assert.equal(row.time, row.maps.reduce((s, m) => s + m.time, 0));
  }
});
