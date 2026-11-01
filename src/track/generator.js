// =====================================================================
// track/generator.js — deterministyczny generator toru z seeda.
// Czysty JS bez Three.js (da się testować w Node). Ten sam seed +
// te same parametry = identyczny tor u każdego klienta.
//
// Algorytm:
//   1. losowe punkty wokół okręgu: promień = płaty (niskie harmoniczne,
//      wcięcia jak w literze B) + szum,
//   2. zamknięta splajna Catmull-Rom (centripetalna),
//   3. skalowanie do docelowej długości + równomierny resampling,
//   4. walidacja (ostre zakręty, samoprzecięcia / za blisko siebie);
//      porażka -> kolejna próba z pochodnym seedem i spokojniejszym kształtem,
//   5. z tej samej linii: checkpointy, start, pola startowe, skrzynki, przeszkody,
//      linia jazdy botów, dekoracje, paleta.
// =====================================================================
import { TRACK, KART, ITEMS, THEMES, OBSTACLES } from '../config.js';
import { createRng, deriveSeed } from '../rng.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mod = (i, n) => ((i % n) + n) % n;

// Pół-szerokość całego pasa toru: jezdnia + krawężnik + pobocze + banda.
export const OUTER_HALF = TRACK.width / 2 + TRACK.kerbWidth + TRACK.runoffWidth + TRACK.barrierThickness;
// Minimalna odległość linii środkowych dwóch różnych odcinków.
const CLEARANCE = 2 * OUTER_HALF + TRACK.clearanceMargin;

// Docelowa długość: średnia prędkość × docelowy czas okrążenia × rozmiar.
export function targetTrackLength(size) {
  return KART.baseMaxSpeed * TRACK.avgSpeedFraction * TRACK.targetLapSeconds * TRACK.sizes[size].lengthMul;
}

// ---------------------------------------------------------------------
// Krok 1: punkty kontrolne (w skali jednostkowej).
// calm ∈ [0,1] — 1 = pełna losowość, 0 = regularny wielokąt (zawsze OK).
// ---------------------------------------------------------------------
function controlPoints(rng, diff, calm, length) {
  const n = Math.max(TRACK.minControlPoints, Math.round(length / rng.range(...diff.metersPerPoint)));
  const angles = [], noise = [];
  for (let i = 0; i < n; i++) {
    // Rozrzut kątowy < 0.5 slotu, więc kolejność punktów się nie zmienia.
    angles.push(((i + (rng.next() - 0.5) * diff.angleJitter * calm) / n) * TAU);
    noise.push(rng.next() * 2 - 1);
  }
  // Wydłużenie w losowym kierunku daje długie proste zamiast "okręgu".
  const aspect = 1 + (rng.range(...diff.aspect) - 1) * calm;
  const rot = rng.range(0, TAU);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  // Płaty: 1–2 harmoniczne z losową fazą.
  const lobeCount = rng.int(diff.lobes.count[0], diff.lobes.count[1]);
  const lobes = Array.from({ length: lobeCount }, () => ({
    k: rng.pick(TRACK.lobeHarmonics),
    amp: rng.range(...diff.lobes.amplitude) * calm,
    phase: rng.range(0, TAU),
  }));
  const k = TRACK.radiusSmoothing;
  return angles.map((a, i) => {
    const nz = noise[i] * (1 - 2 * k) + (noise[mod(i - 1, n)] + noise[(i + 1) % n]) * k;
    const lobe = lobes.reduce((sum, l) => sum + l.amp * Math.cos(l.k * a + l.phase), 0);
    const r = Math.max(TRACK.minRadiusFactor, 1 + lobe + nz * diff.radiusVariance * calm);
    const x = Math.cos(a) * r * aspect, z = Math.sin(a) * r;
    return { x: x * cr - z * sr, z: x * sr + z * cr };
  });
}

// ---------------------------------------------------------------------
// Krok 2: centripetalna Catmull-Rom (alfa = 0.5 — brak pętli i ostrzy).
// ---------------------------------------------------------------------
function catmullRom(p0, p1, p2, p3, u) {
  const knot = (a, b) => Math.max(Math.hypot(b.x - a.x, b.z - a.z) ** 0.5, 1e-6);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => {
    const w = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function sampleClosedSpline(ctrl, perSegment) {
  const n = ctrl.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[mod(i - 1, n)], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < perSegment; k++) out.push(catmullRom(p0, p1, p2, p3, k / perSegment));
  }
  return out;
}

// ---------------------------------------------------------------------
// Krok 3: skalowanie do długości i równomierny resampling zamkniętej łamanej.
// ---------------------------------------------------------------------
function resampleClosed(dense, targetLength, spacing) {
  const m = dense.length;
  const cum = [0];
  for (let i = 0; i < m; i++) {
    const a = dense[i], b = dense[(i + 1) % m];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const scale = targetLength / cum[m];
  const n = Math.round(targetLength / spacing);
  const step = cum[m] / n; // w skali jednostkowej
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (cum[seg + 1] < target) seg++;
    const t = (target - cum[seg]) / (cum[seg + 1] - cum[seg]);
    const a = dense[seg], b = dense[(seg + 1) % m];
    out.push({ x: (a.x + (b.x - a.x) * t) * scale, z: (a.z + (b.z - a.z) * t) * scale });
  }
  return { points: out, step: step * scale };
}

// Styczne, normalne (w prawo z perspektywy kierowcy), kurs i krzywizna ze znakiem.
// Krzywizna > 0 = zakręt w stronę normalnej (+n to wnętrze zakrętu).
function computeFrames(points, step) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[mod(i - 1, n)], b = points[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const p = points[i];
    p.tx = dx / len; p.tz = dz / len;
    p.nx = -p.tz; p.nz = p.tx;
    p.heading = Math.atan2(p.tx, p.tz); // obrót Y w Three.js (obiekt patrzy w +Z)
  }
  const w = TRACK.curvatureWindow;
  for (let i = 0; i < n; i++) {
    const a = points[mod(i - w, n)], b = points[(i + w) % n];
    const k = wrapAngle(Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx)) / (2 * w * step);
    points[i].curvature = k;
    points[i].radius = 1 / Math.max(Math.abs(k), 1e-6);
  }
}

// Lokalne wygładzanie (Laplacian) tylko wokół za ostrych zakrętów —
// zachowuje charakter toru, a usuwa pojedyncze "załamania" splajny.
// Zwraca true, jeśli coś zmieniono (wtedy trzeba ponownie zresamplować).
function relaxSharpTurns(points, step, minR) {
  const n = points.length;
  const { maxIterations, windowSamples, stencil, strength } = TRACK.relax;
  let changed = false;
  for (let it = 0; it < maxIterations; it++) {
    const marked = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (points[i].radius >= minR) continue;
      any = true;
      for (let j = -windowSamples; j <= windowSamples; j++) marked[mod(i + j, n)] = 1;
    }
    if (!any) break;
    changed = true;
    const prev = points.map((p) => ({ x: p.x, z: p.z }));
    for (let i = 0; i < n; i++) {
      if (!marked[i]) continue;
      const a = prev[mod(i - stencil, n)], b = prev[(i + stencil) % n];
      points[i].x += ((a.x + b.x) / 2 - points[i].x) * strength;
      points[i].z += ((a.z + b.z) / 2 - points[i].z) * strength;
    }
    computeFrames(points, step);
  }
  return changed;
}

// ---------------------------------------------------------------------
// Krok 4: walidacja. Zwraca null (OK) albo powód odrzucenia.
// Długość jest gwarantowana przez skalowanie, a szerokość jest stała —
// zwężenia mogłyby powstać tylko przez zbyt ciasne zakręty lub
// zbliżenie odcinków, a to sprawdzamy tutaj.
// ---------------------------------------------------------------------
function validate(points, step, diff) {
  const n = points.length;
  for (const p of points) if (p.radius < diff.minTurnRadius) return 'sharp-turn';

  // Każda para próbek odległych po łuku musi być dalej niż CLEARANCE.
  // To wyłapuje samoprzecięcia oraz "zachodzące na siebie" bandy.
  const windowSamples = Math.ceil((CLEARANCE * TRACK.clearanceArcWindow) / step);
  const c2 = CLEARANCE * CLEARANCE;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    for (let j = i + windowSamples; j < n; j++) {
      if (n - (j - i) < windowSamples) break; // blisko "przez zawinięcie"
      const b = points[j];
      const dx = a.x - b.x, dz = a.z - b.z;
      if (dx * dx + dz * dz < c2) return 'too-close';
    }
  }
  return null;
}

// Linia startu na najprostszym fragmencie; obracamy tablicę, by start = 0.
function rotateToStraightest(points) {
  const n = points.length;
  let best = 0, bestCost = Infinity;
  for (let i = 0; i < n; i++) {
    let cost = 0;
    for (let j = -TRACK.startStraightBefore; j <= TRACK.startStraightAfter; j++) {
      cost += Math.abs(points[mod(i + j, n)].curvature);
    }
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  return points.slice(best).concat(points.slice(0, best));
}

function blurCyclic(values, radius) {
  const n = values.length;
  if (radius < 1) return values.slice();
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += values[mod(i + j, n)];
    out[i] = sum / (2 * radius + 1);
  }
  return out;
}

// Linia jazdy botów: przesunięcie w stronę wnętrza nadchodzących zakrętów.
function computeRacingLine(points, step) {
  const rl = TRACK.racingLine;
  const maxOff = TRACK.width / 2 - rl.edgeMargin;
  const k = blurCyclic(points.map((p) => p.curvature), Math.round(rl.curvatureBlurMeters / step));
  const raw = k.map((v) => clamp(v * rl.curvatureGain, -maxOff, maxOff));
  const off = blurCyclic(raw, Math.round(rl.offsetBlurMeters / step));
  return points.map((p, i) => ({ x: p.x + p.nx * off[i], z: p.z + p.nz * off[i], offset: off[i] }));
}

// ---------------------------------------------------------------------
// Siatka przestrzenna: szybkie "najbliższy punkt toru" (dekoracje, a
// w kolejnych etapach fizyka: poza torem, postęp na okrążeniu).
// ---------------------------------------------------------------------
function buildSpatial(points) {
  const cell = TRACK.spatialCellSize;
  const cells = new Map();
  points.forEach((p, i) => {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  return { cell, cells };
}

// Rzut punktu na odcinek i -> i+1.
function projectOnSegment(points, i, x, z) {
  const n = points.length;
  const a = points[i], b = points[(i + 1) % n];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
  const px = a.x + dx * t, pz = a.z + dz * t;
  const len = Math.sqrt(len2);
  // Normalna odcinka (w prawo od kierunku jazdy) — znak przesunięcia bocznego.
  const lateral = (x - px) * (-dz / len) + (z - pz) * (dx / len);
  return { index: i, t, dist: Math.hypot(x - px, z - pz), lateral };
}

// Najbliższe miejsce na linii środkowej: {index, t, dist, lateral, s}.
// lateral > 0 = po prawej (w stronę normalnej), s = metr okrążenia.
export function nearestOnTrack(track, x, z) {
  const { points, spatial, step } = track;
  const n = points.length;
  const { cell, cells } = spatial;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  const maxRing = Math.ceil(Math.hypot(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ) / cell) + 2
    + Math.ceil(Math.max(0, track.bounds.minX - x, x - track.bounds.maxX, track.bounds.minZ - z, z - track.bounds.maxZ) / cell);
  let best = -1, bestD2 = Infinity;
  for (let r = 0; r <= maxRing; r++) {
    if (best >= 0 && (r - 1) * cell > Math.sqrt(bestD2)) break;
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue; // tylko obwód pierścienia
        const list = cells.get(`${ix},${iz}`);
        if (!list) continue;
        for (const i of list) {
          const dx = points[i].x - x, dz = points[i].z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
      }
    }
  }
  const a = projectOnSegment(points, mod(best - 1, n), x, z);
  const b = projectOnSegment(points, best, x, z);
  const res = a.dist < b.dist ? a : b;
  res.s = ((res.index + res.t) * step) % track.length;
  return res;
}

// ---------------------------------------------------------------------
// Pola startowe: 2 kolumny za linią startu, prawa kolumna lekko z tyłu.
// ---------------------------------------------------------------------
export function gridSlot(track, slot) {
  const g = TRACK.grid;
  const row = Math.floor(slot / 2), col = slot % 2;
  const back = g.firstRowOffset + row * g.rowSpacing + (col ? g.stagger : 0);
  const p = track.points[mod(-Math.round(back / track.step), track.points.length)];
  const lat = (col ? -1 : 1) * TRACK.width * g.lateralFactor;
  return { x: p.x + p.nx * lat, z: p.z + p.nz * lat, heading: p.heading };
}

function placeItemBoxes(seed, points, step, length, itemFrequency) {
  const spacing = ITEMS.frequencies[itemFrequency].rowSpacing;
  if (!spacing) return [];
  const rng = createRng(deriveSeed(seed, 'boxes'));
  const half = TRACK.width / 2 - ITEMS.rowEdgeMargin;
  const boxes = [];
  for (let s = ITEMS.firstRowAfterStart; s < length - ITEMS.lastRowBeforeFinish;
    s += spacing * (1 + rng.range(-ITEMS.rowJitter, ITEMS.rowJitter))) {
    const index = Math.round(s / step) % points.length;
    const p = points[index];
    for (let b = 0; b < ITEMS.boxesPerRow; b++) {
      const lat = -half + (2 * half * b) / (ITEMS.boxesPerRow - 1);
      boxes.push({ x: p.x + p.nx * lat, z: p.z + p.nz * lat, index });
    }
  }
  return boxes;
}

// Przeszkody: grupy słupków w środku jezdni (slalom albo rządek) i progi
// zwalniające przy krawędzi.
// Tylko na prostych/łagodnych łukach, z dala od startu, mety i skrzynek;
// wolny przejazd: obok słupka >= post.minGap z każdej strony, obok progu
// >= bump.minGap.
function placeObstacles(seed, points, step, length, itemBoxes, density) {
  const O = OBSTACLES, P = O.post, B = O.bump;
  const spacing = O.densities[density].spacing;
  if (!spacing) return [];
  const rng = createRng(deriveSeed(seed, 'obstacles'));
  const n = points.length, half = TRACK.width / 2;
  const boxS = [...new Set(itemBoxes.map((b) => b.index))].map((i) => points[i].s);
  const along = (a, b) => { const d = Math.abs(a - b) % length; return Math.min(d, length - d); };
  const nearBox = (s) => boxS.some((bs) => along(s, bs) < O.boxClearance);
  const gentle = (s) => {
    for (let m = -O.cornerWindow; m <= O.cornerWindow; m += step) {
      if (points[mod(Math.round((s + m) / step), n)].radius < O.minCornerRadius) return false;
    }
    return true;
  };
  // Słupki w środkowej strefie: z każdej strony zostaje >= P.minGap.
  const maxLat = half - P.radius - P.minGap;
  const out = [];
  for (let s = O.afterStart + step; ; s += spacing * (1 + rng.range(-O.jitter, O.jitter))) {
    // Losowania zawsze w tej samej kolejności (determinizm).
    const side = rng.next() < 0.5 ? -1 : 1;
    const isBump = rng.next() < O.bumpChance;
    const count = rng.int(P.count[0], P.count[1]);
    const slalom = rng.next() < P.slalomChance;
    const jitter = Array.from({ length: P.count[1] }, () => rng.range(-P.rowJitter, P.rowJitter));
    const span = isBump ? B.depth : (count - 1) * P.spacing;
    // Wylosowane miejsce zajęte (skrzynki, zakręt) -> szukamy dalej, zamiast pomijać.
    const ok = (x) => !nearBox(x) && !nearBox(x + span) && gentle(x) && gentle(x + span);
    let at = s;
    while (at - s <= spacing * O.searchFraction && !ok(at)) at += O.searchStep;
    if (at + span + step > length - O.beforeFinish) break; // + step: zaokrąglenie do próbki
    if (!ok(at)) continue;
    s = at; // kolejna przeszkoda liczy odstęp od tej
    if (isBump) {
      const index = mod(Math.round(s / step), n);
      const w = Math.min(TRACK.width * B.widthFraction, TRACK.width - B.minGap);
      const [latFrom, latTo] = side > 0 ? [half - w, half] : [-half, -half + w];
      out.push({ type: 'bump', index, s: points[index].s, latFrom, latTo, heading: points[index].heading });
    } else {
      for (let k = 0; k < count; k++) {
        const index = mod(Math.round((s + k * P.spacing) / step), n);
        const p = points[index];
        // Slalom: na przemian lewo/prawo od osi; rządek: na osi z rozrzutem.
        const lat = clamp(slalom ? side * (k % 2 ? -1 : 1) * P.slalomOffset : jitter[k], -maxLat, maxLat);
        out.push({ type: 'post', x: p.x + p.nx * lat, z: p.z + p.nz * lat, s: p.s, index, lateral: lat, radius: P.radius });
      }
    }
  }
  return out;
}

function placeDecorations(seed, track) {
  const d = TRACK.decorations;
  const rng = createRng(deriveSeed(seed, 'decor'));
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const m = d.boundsMargin;
  const area = (maxX - minX + 2 * m) * (maxZ - minZ + 2 * m);
  const count = clamp(Math.round(area / d.areaPerItem), d.min, d.max);
  const minDist = OUTER_HALF + d.trackMargin;
  const out = [];
  for (let tries = 0; tries < count * 4 && out.length < count; tries++) {
    const x = rng.range(minX - m, maxX + m);
    const z = rng.range(minZ - m, maxZ + m);
    const type = rng.next() < d.rockChance ? 'rock' : 'tree';
    const scale = rng.range(0.7, 1.4);
    const rot = rng.range(0, TAU);
    if (nearestOnTrack(track, x, z).dist < minDist) continue;
    out.push({ type, x, z, scale, rot });
  }
  return out;
}

// ---------------------------------------------------------------------
// API: generateTrack({seed, size, difficulty, theme, itemFrequency, obstacles})
// ---------------------------------------------------------------------
export function generateTrack({ seed, size, difficulty, theme, itemFrequency, obstacles = 'none' }) {
  seed = String(seed);
  const diff = TRACK.difficulties[difficulty];
  const length0 = targetTrackLength(size);
  const rejections = {};

  let points = null, step = 0, attempts = 0;
  for (let attempt = 0; attempt < TRACK.maxAttempts; attempt++) {
    attempts = attempt + 1;
    // Każda kolejna próba jest spokojniejsza; ostatnia to prawie okrąg,
    // który zawsze przechodzi walidację.
    const calm = 1 - (attempt / (TRACK.maxAttempts - 1)) ** TRACK.calmExponent;
    const rng = createRng(deriveSeed(seed, 'shape', attempt));
    const dense = sampleClosedSpline(controlPoints(rng, diff, calm, length0), TRACK.splineSamplesPerSegment);
    let res = resampleClosed(dense, length0, TRACK.sampleSpacing);
    computeFrames(res.points, res.step);
    if (relaxSharpTurns(res.points, res.step, diff.minTurnRadius * TRACK.relax.targetMargin)) {
      // Wygładzanie skraca tor i psuje równe odstępy — przywracamy jedno i drugie.
      res = resampleClosed(res.points, length0, TRACK.sampleSpacing);
      computeFrames(res.points, res.step);
    }
    const reason = validate(res.points, res.step, diff);
    if (!reason) { points = res.points; step = res.step; break; }
    rejections[reason] = (rejections[reason] || 0) + 1;
  }
  if (!points) throw new Error(`Nie udało się wygenerować toru dla seeda "${seed}"`);

  points = rotateToStraightest(points);
  points.forEach((p, i) => { p.s = i * step; });
  const length = points.length * step;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = OUTER_HALF;
  const bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };

  const ckCount = Math.max(TRACK.minCheckpoints, Math.round(length / TRACK.checkpointSpacing));
  const checkpoints = [];
  for (let j = 0; j < ckCount; j++) {
    const index = Math.round((j * points.length) / ckCount) % points.length;
    checkpoints.push({ index, s: points[index].s });
  }

  const themeId = theme === 'random'
    ? createRng(deriveSeed(seed, 'theme')).pick(Object.keys(THEMES))
    : theme;

  const track = {
    seed, size, difficulty, attempts, rejections,
    themeId, theme: THEMES[themeId],
    length, step,
    width: TRACK.width, halfWidth: TRACK.width / 2, outerHalf: OUTER_HALF,
    points, bounds,
    checkpoints, // checkpoint 0 = linia startu/mety
    racingLine: computeRacingLine(points, step),
    itemBoxes: placeItemBoxes(seed, points, step, length, itemFrequency),
    spatial: buildSpatial(points),
  };
  track.obstacles = placeObstacles(seed, points, step, length, track.itemBoxes, obstacles);
  track.posts = track.obstacles.filter((o) => o.type === 'post'); // dla fizyki i botów
  track.decorations = placeDecorations(seed, track);
  return track;
}

// Parametry generatora wyciągnięte z obiektu ustawień lobby.
export function trackParamsFromSettings(settings, seed) {
  return {
    seed,
    size: settings.trackSize,
    difficulty: settings.trackDifficulty,
    theme: settings.theme,
    itemFrequency: settings.itemFrequency,
    obstacles: settings.obstacles,
  };
}
