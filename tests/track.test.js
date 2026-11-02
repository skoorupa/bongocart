// Testy generatora toru: determinizm, poprawność geometrii, długość.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack, targetTrackLength, nearestOnTrack, gridSlot, OUTER_HALF } from '../src/track/generator.js';
import { TRACK, KART, OBSTACLES, COINS } from '../src/config.js';

const params = (seed, size = 'medium', difficulty = 'medium') => ({ seed, size, difficulty, theme: 'random', itemFrequency: 'normal' });
const strip = (t) => JSON.stringify({ p: t.points, r: t.racingLine, c: t.checkpoints, b: t.itemBoxes, d: t.decorations, o: t.obstacles, th: t.themeId });

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

// --- Przeszkody (słupki, progi) ---
const alongDist = (a, b, L) => { const d = Math.abs(a - b) % L; return Math.min(d, L - d); };

test('przeszkody: none = brak, ten sam seed = te same przeszkody, nie zmieniają kształtu toru', () => {
  assert.equal(generateTrack(params('obs')).obstacles.length, 0); // domyślnie brak
  assert.equal(generateTrack({ ...params('obs'), obstacles: 'none' }).obstacles.length, 0);
  const a = generateTrack({ ...params('obs'), obstacles: 'many' });
  const b = generateTrack({ ...params('obs'), obstacles: 'many' });
  assert.ok(a.obstacles.length > 0);
  assert.equal(JSON.stringify(a.obstacles), JSON.stringify(b.obstacles));
  assert.equal(JSON.stringify(a.points), JSON.stringify(generateTrack(params('obs')).points));
});

test('przeszkody leżą na jezdni, poza strefami i zostawiają wolny przejazd (wiele seedów)', () => {
  const boxGap = OBSTACLES.boxClearance - (OBSTACLES.post.count[1] - 1) * OBSTACLES.post.spacing;
  let withObstacles = 0, total = 0;
  for (const size of Object.keys(TRACK.sizes)) {
    for (let i = 0; i < 40; i++) {
      const t = generateTrack({ seed: `obs${i}`, size, difficulty: 'hard', theme: 'random', itemFrequency: 'often', obstacles: 'many' });
      total++;
      if (t.obstacles.length) withObstacles++;
      const posts = t.obstacles.filter((o) => o.type === 'post');
      assert.equal(t.posts.length, posts.length);
      for (const o of t.obstacles) {
        const s = o.type === 'post' ? nearestOnTrack(t, o.x, o.z).s : o.s;
        assert.ok(s >= OBSTACLES.afterStart && s <= t.length - OBSTACLES.beforeFinish, `${t.seed}: s=${s}`);
        for (const b of t.itemBoxes) assert.ok(alongDist(s, t.points[b.index].s, t.length) >= boxGap, `${t.seed}: skrzynka`);
        if (o.type === 'post') {
          const lat = Math.abs(nearestOnTrack(t, o.x, o.z).lateral);
          // Słupki w środkowej strefie: przejazd po OBU stronach każdego słupka.
          assert.ok(lat + o.radius + OBSTACLES.post.minGap <= t.halfWidth + 1e-6, `${t.seed}: za mało miejsca obok słupka (lat ${lat})`);
        } else {
          assert.ok(o.latFrom >= -t.halfWidth - 1e-6 && o.latTo <= t.halfWidth + 1e-6 && o.latFrom < o.latTo);
          const w = o.latTo - o.latFrom;
          assert.ok(TRACK.width - w >= OBSTACLES.bump.minGap - 1e-6, `${t.seed}: próg nie zostawia wolnego pasa`);
          assert.ok(w >= TRACK.width * 0.65, `${t.seed}: próg za wąski (${w})`);
        }
      }
    }
  }
  assert.ok(withObstacles > total * 0.8, `${withObstacles}/${total}`);
});

test('słupki: oba układy (slalom i rządek) występują, slalom zmienia stronę', () => {
  let slalom = 0, row = 0;
  for (let i = 0; i < 30; i++) {
    const t = generateTrack({ seed: `bol${i}`, size: 'large', difficulty: 'easy', theme: 'random', itemFrequency: 'none', obstacles: 'many' });
    // Grupy: kolejne słupki w odstępie spacing wzdłuż toru.
    const groups = [];
    for (const o of t.posts) {
      const g = groups.at(-1);
      if (g && Math.abs(o.s - g.at(-1).s) <= OBSTACLES.post.spacing + t.step) g.push(o); else groups.push([o]);
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      const lats = g.map((o) => nearestOnTrack(t, o.x, o.z).lateral);
      const alternates = lats.every((l, k) => k === 0 || Math.sign(l) !== Math.sign(lats[k - 1]));
      const spread = Math.max(...lats) - Math.min(...lats);
      if (alternates && spread > OBSTACLES.post.slalomOffset) slalom++;
      else if (spread <= 2 * OBSTACLES.post.rowJitter + 1e-6) row++;
    }
  }
  assert.ok(slalom > 5 && row > 5, `slalom ${slalom}, rządek ${row}`);
});

// --- Plamy oleju i monety.
const oilParams = (seed, extra = {}) => ({ seed, size: 'medium', difficulty: 'hard', theme: 'random', itemFrequency: 'often', ...extra });

test('plamy oleju: none = brak, deterministyczne, osobny strumień (przeszkody bez zmian)', () => {
  assert.equal(generateTrack(oilParams('oil', { obstacles: 'none' })).oils.length, 0);
  const a = generateTrack(oilParams('oil', { obstacles: 'many' }));
  const b = generateTrack(oilParams('oil', { obstacles: 'many' }));
  assert.ok(a.oils.length > 0);
  assert.equal(JSON.stringify(a.oils), JSON.stringify(b.oils));
  const few = generateTrack(oilParams('oil', { obstacles: 'few' }));
  assert.ok(few.oils.length < a.oils.length);
  // Monety nie przesuwają plam ani przeszkód.
  const c = generateTrack(oilParams('oil', { obstacles: 'many', coins: true }));
  assert.equal(JSON.stringify(c.oils), JSON.stringify(a.oils));
  assert.equal(JSON.stringify(c.obstacles), JSON.stringify(a.obstacles));
});

test('plamy: na jezdni, wolny przejazd, z dala od skrzynek i przeszkód (wiele seedów)', () => {
  const O = OBSTACLES.oil;
  for (let i = 0; i < 25; i++) {
    const t = generateTrack(oilParams(`oil${i}`, { obstacles: 'many' }));
    for (const o of t.oils) {
      assert.ok(Math.abs(o.lateral) + o.radius <= t.halfWidth - O.edgeMargin + 1e-9, `poza jezdnią: oil${i}`);
      // Wolny pas po szerszej stronie plamy mieści karta z zapasem.
      const free = t.halfWidth + Math.abs(o.lateral) - o.radius;
      assert.ok(free >= 4 * KART.radius, `wąski przejazd: oil${i}`);
      for (const b of t.itemBoxes) assert.ok(alongDist(o.s, t.points[b.index].s, t.length) >= O.clearance - t.step, `przy skrzynce: oil${i}`);
      for (const x of t.obstacles) assert.ok(alongDist(o.s, x.s, t.length) >= O.clearance - t.step, `przy przeszkodzie: oil${i}`);
    }
  }
});

test('monety: tylko gdy coins, deterministyczne, rzędy na jezdni z dala od skrzynek, przeszkód i plam', () => {
  assert.equal(generateTrack(oilParams('coin', { obstacles: 'many' })).coins.length, 0);
  for (let i = 0; i < 15; i++) {
    const p = oilParams(`coin${i}`, { obstacles: 'many', coins: true });
    const t = generateTrack(p);
    assert.ok(t.coins.length >= COINS.perRow[0], `brak monet: coin${i}`);
    assert.equal(JSON.stringify(t.coins), JSON.stringify(generateTrack(p).coins));
    for (const c of t.coins) {
      const q = nearestOnTrack(t, c.x, c.z);
      assert.ok(Math.abs(q.lateral) <= t.halfWidth, `poza jezdnią: coin${i}`);
      for (const b of t.itemBoxes) assert.ok(alongDist(c.s, t.points[b.index].s, t.length) >= COINS.clearance - t.step);
      for (const x of [...t.obstacles, ...t.oils]) assert.ok(alongDist(c.s, x.s, t.length) >= COINS.clearance - t.step);
    }
  }
});
