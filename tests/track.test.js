// Testy generatora toru: determinizm, poprawność geometrii, długość.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack, targetTrackLength, nearestOnTrack, gridSlot, OUTER_HALF } from '../src/track/generator.js';
import { TRACK, KART } from '../src/config.js';

const params = (seed, size = 'medium', difficulty = 'medium') => ({ seed, size, difficulty, theme: 'random', itemFrequency: 'normal' });
const strip = (t) => JSON.stringify({ p: t.points, r: t.racingLine, c: t.checkpoints, b: t.itemBoxes, d: t.decorations, th: t.themeId });

test('ten sam seed daje identyczny tor', () => {
  for (const seed of ['abc', '123', 'k3x9pq']) {
    assert.equal(strip(generateTrack(params(seed))), strip(generateTrack(params(seed))));
  }
});

test('różne seedy dają różne tory', () => {
  assert.notEqual(strip(generateTrack(params('a'))), strip(generateTrack(params('b'))));
});

test('częstotliwość skrzynek nie zmienia kształtu toru', () => {
  const a = generateTrack({ ...params('x'), itemFrequency: 'often' });
  const b = generateTrack({ ...params('x'), itemFrequency: 'none' });
  assert.equal(JSON.stringify(a.points), JSON.stringify(b.points));
  assert.equal(b.itemBoxes.length, 0);
  assert.ok(a.itemBoxes.length > 0);
});

test('wszystkie rozmiary i trudności spełniają walidację (200 seedów)', () => {
  const clearance = 2 * OUTER_HALF + TRACK.clearanceMargin;
  for (const size of Object.keys(TRACK.sizes)) {
    for (const difficulty of Object.keys(TRACK.difficulties)) {
      const minR = TRACK.difficulties[difficulty].minTurnRadius;
      for (let i = 0; i < 200; i++) {
        const t = generateTrack(params(`v${i}`, size, difficulty));
        const target = targetTrackLength(size);
        assert.ok(Math.abs(t.length - target) / target < TRACK.lengthTolerance, `długość ${t.length}`);
        assert.ok(t.points.every((p) => p.radius >= minR), `ostry zakręt: ${size}/${difficulty}/v${i}`);
        // Brak samoprzecięć / nakładania: punkty odległe po łuku są daleko w przestrzeni.
        const n = t.points.length, w = Math.ceil((clearance * TRACK.clearanceArcWindow) / t.step);
        for (let a = 0; a < n; a += 3) for (let b = a + w; b < Math.min(n, n - w + a); b += 3) {
          const d = Math.hypot(t.points[a].x - t.points[b].x, t.points[a].z - t.points[b].z);
          assert.ok(d >= clearance, `za blisko: ${size}/${difficulty}/v${i}`);
        }
      }
    }
  }
});

test('5 okrążeń na torze średnim trwa ok. 3,5–4,5 min', () => {
  const t = generateTrack(params('lap'));
  const race = (5 * t.length) / (KART.baseMaxSpeed * TRACK.avgSpeedFraction);
  assert.ok(race >= 210 && race <= 270, `wyścig ${race} s`);
});

test('nearestOnTrack: punkty linii środkowej i przesunięcie boczne', () => {
  const t = generateTrack(params('near'));
  for (const i of [0, 37, 150, t.points.length - 1]) {
    const p = t.points[i];
    const onLine = nearestOnTrack(t, p.x, p.z);
    assert.ok(onLine.dist < 1e-6);
    const off = nearestOnTrack(t, p.x + p.nx * 4, p.z + p.nz * 4);
    assert.ok(Math.abs(off.lateral - 4) < 0.3, `lateral ${off.lateral}`);
    assert.ok(Math.abs(off.s - p.s) < t.step * 1.5 || Math.abs(off.s - p.s) > t.length - t.step * 1.5);
  }
});

test('pola startowe leżą na jezdni, za linią startu', () => {
  const t = generateTrack(params('grid'));
  for (let i = 0; i < 8; i++) {
    const g = gridSlot(t, i);
    const q = nearestOnTrack(t, g.x, g.z);
    assert.ok(Math.abs(q.lateral) < t.halfWidth);
    assert.ok(q.s > t.length / 2, 'slot powinien być przed metą (koniec okrążenia)');
  }
});

test('dekoracje nie stoją na torze', () => {
  const t = generateTrack(params('decor'));
  assert.ok(t.decorations.length >= TRACK.decorations.min);
  for (const d of t.decorations) assert.ok(nearestOnTrack(t, d.x, d.z).dist >= OUTER_HALF);
});

// Pole toru / pole otoczki wypukłej: okrąg = 1, kształt z wcięciami (B, koniczynka) < 1.
function convexity(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (list) => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h.at(-2), h.at(-1), q) <= 0) h.pop();
      h.push(q);
    }
    return h.slice(0, -1);
  };
  const hull = [...half(p), ...half([...p].reverse())];
  const area = (poly) => Math.abs(poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a.x * b.z - b.x * a.z; }, 0) / 2);
  return area(pts) / area(hull);
}

test('tory nie są kołami: średni i trudny mają wyraźne wcięcia', () => {
  const avg = (difficulty) => {
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += convexity(generateTrack({ seed: `shape${i}`, size: 'medium', difficulty, theme: 'random', itemFrequency: 'none' }).points);
    return sum / 20;
  };
  const medium = avg('medium'), hard = avg('hard');
  assert.ok(medium < 0.94, `średni ${medium}`);
  assert.ok(hard < 0.86, `trudny ${hard}`);
  assert.ok(hard < medium);
});
