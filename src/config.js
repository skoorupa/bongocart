// =====================================================================
// config.js — JEDYNE miejsce na stałe gry i schemat ustawień lobby.
// Jednostka długości ≈ 1 metr, czas w sekundach.
// =====================================================================

// ---------------------------------------------------------------------
// Kart (na razie tylko to, czego potrzebuje generator toru; resztę
// fizyki dopiszemy w etapie 2).
// ---------------------------------------------------------------------
export const KART = {
  baseMaxSpeed: 30, // prędkość maksymalna przy 150cc [j/s]
};

// Klasy prędkości: mnożniki stosowane w JEDNYM miejscu (fizyka, etap 2).
export const SPEED_CLASSES = {
  '100cc': { label: '100cc', speedMul: 0.85, accelMul: 0.85 },
  '150cc': { label: '150cc', speedMul: 1.0, accelMul: 1.0 },
  '200cc': { label: '200cc', speedMul: 1.2, accelMul: 1.25 },
};

// ---------------------------------------------------------------------
// Tor
// ---------------------------------------------------------------------
export const TRACK = {
  // Docelowy czas okrążenia przy średniej prędkości (150cc) dla toru
  // średniego. 5 okrążeń ≈ 4 min.
  targetLapSeconds: 46,
  // Średnia prędkość na okrążeniu jako ułamek prędkości maksymalnej.
  avgSpeedFraction: 0.75,
  // Dopuszczalne odchylenie długości od celu (walidacja).
  lengthTolerance: 0.1,

  width: 14, // szerokość jezdni
  kerbWidth: 1.2, // krawężnik po każdej stronie
  runoffWidth: 5, // pobocze (trawa) między krawężnikiem a bandą
  barrierHeight: 1.1,
  barrierThickness: 0.6,
  // Dodatkowy margines między bandami dwóch różnych odcinków toru.
  clearanceMargin: 2,
  // Pary próbek bliżej niż (okno × prześwit) po długości łuku nie są
  // sprawdzane pod kątem kolizji — to ten sam fragment toru.
  clearanceArcWindow: 1.7,

  sampleSpacing: 2, // odstęp próbek linii środkowej [j]
  splineSamplesPerSegment: 24, // gęstość próbkowania splajny przed resamplingiem
  curvatureWindow: 2, // ± próbek do liczenia krzywizny
  maxAttempts: 40, // prób generacji (każda z pochodnym seedem)

  // Wybór linii startu: najprostszy fragment w oknie [−przed, +za] próbek.
  startStraightBefore: 15,
  startStraightAfter: 10,

  checkpointSpacing: 50, // ~co tyle metrów checkpoint
  minCheckpoints: 8,

  // Pola startowe (za linią startu).
  grid: {
    firstRowOffset: 8,
    rowSpacing: 6,
    lateralFactor: 0.22, // × szerokość toru
    stagger: 2, // przesunięcie prawej kolumny do tyłu
  },

  // Linia jazdy dla botów: przesunięcie w stronę wnętrza zakrętu.
  racingLine: {
    curvatureBlurMeters: 24,
    offsetBlurMeters: 16,
    curvatureGain: 150,
    edgeMargin: 2.5,
  },

  // Rozmiar toru: mnożnik długości docelowej.
  sizes: {
    small: { label: 'Mały', lengthMul: 0.75 },
    medium: { label: 'Średni', lengthMul: 1.0 },
    large: { label: 'Duży', lengthMul: 1.4 },
  },

  // Trudność toru: metry toru na punkt kontrolny (mniej = więcej zakrętów),
  // zmienność promienia (ostrość), rozrzut kątowy, min. promień zakrętu,
  // wydłużenie kształtu [min, max] (1 = koło, więcej = długie proste).
  difficulties: {
    easy: { label: 'Łatwy', metersPerPoint: [110, 140], radiusVariance: 0.3, angleJitter: 0.3, minTurnRadius: 30, aspect: [1.4, 2.0] },
    medium: { label: 'Średni', metersPerPoint: [75, 95], radiusVariance: 0.45, angleJitter: 0.4, minTurnRadius: 22, aspect: [1.3, 2.1] },
    hard: { label: 'Trudny', metersPerPoint: [55, 70], radiusVariance: 0.55, angleJitter: 0.45, minTurnRadius: 16, aspect: [1.2, 2.2] },
  },
  minControlPoints: 6,
  // Kolejne próby generacji łagodzą kształt: calm = 1 − (próba/max)^wykładnik.
  calmExponent: 2,
  // Lokalne wygładzanie za ostrych zakrętów przed walidacją.
  // stencil = odległość sąsiadów w próbkach (szerszy = szybsza zbieżność).
  relax: { maxIterations: 60, windowSamples: 8, stencil: 4, strength: 0.5 },
  // Wygładzenie szumu promienia między sąsiednimi punktami kontrolnymi
  // (0 = niezależny szum, 0.5 = mocno skorelowany) — mniej zygzaków.
  radiusSmoothing: 0.2,

  // Dekoracje poza torem.
  decorations: {
    areaPerItem: 650, // m² na jeden obiekt
    min: 60,
    max: 450,
    boundsMargin: 70, // jak daleko poza obrys toru sadzić
    trackMargin: 4, // min. odległość od bandy
    rockChance: 0.3,
  },

  groundMargin: 400, // wielkość podłoża poza obrysem toru
  spatialCellSize: 20, // komórka siatki do szybkiego "najbliższy punkt toru"
};

// ---------------------------------------------------------------------
// Renderowanie
// ---------------------------------------------------------------------
export const RENDER = {
  fov: 65,
  near: 0.5,
  far: 4000,
  fogNear: 140,
  fogFar: 750,
  maxPixelRatio: 2, // ograniczenie dla ekranów HiDPI (wydajność)
  roadY: 0.03, // wysokości warstw (unikanie z-fightingu z podłożem)
  kerbY: 0.1,
  startLineY: 0.05,
  kerbStripeSamples: 1, // długość pasa krawężnika w próbkach
  barrierStripeSamples: 3,
  startLineColumns: 10,
  startLineRows: 2,
  debugLineY: 0.4,
  sunOffset: [120, 220, 80],
  minimapSize: 200,
  minimapPadding: 12,
};

// ---------------------------------------------------------------------
// Przedmioty (rozmieszczenie skrzynek liczy generator toru; logika
// przedmiotów w etapie 5).
// ---------------------------------------------------------------------
export const ITEMS = {
  frequencies: {
    none: { label: 'Brak', rowSpacing: 0 },
    rare: { label: 'Rzadko', rowSpacing: 260 },
    normal: { label: 'Normalnie', rowSpacing: 160 },
    often: { label: 'Często', rowSpacing: 100 },
  },
  boxesPerRow: 4,
  rowJitter: 0.2, // losowe przesunięcie rzędu (× rowSpacing)
  firstRowAfterStart: 80, // brak skrzynek tuż za startem
  lastRowBeforeFinish: 40,
  rowEdgeMargin: 2,
  types: {
    rocket: { label: 'Pocisk' },
    banana: { label: 'Banan' },
    boost: { label: 'Turbo' },
    shield: { label: 'Tarcza' },
  },
};

export const BOT_DIFFICULTIES = {
  easy: { label: 'Łatwy' },
  medium: { label: 'Średni' },
  hard: { label: 'Trudny' },
};

export const MAX_RACERS = 8;

// ---------------------------------------------------------------------
// Motywy kolorystyczne (kolory jako 0xRRGGBB).
// ---------------------------------------------------------------------
export const THEMES = {
  meadow: {
    label: 'Zielona łąka',
    sky: 0x8fd3ff, fog: 0xbfe6ff, ground: 0x6abf4b, road: 0x4a4a55,
    kerbA: 0xe63946, kerbB: 0xf1faee, barrierA: 0x1d3557, barrierB: 0xf1faee,
    foliage: 0x2d8a3e, trunk: 0x7a4b2a, rock: 0x9a9a9a, accent: 0xffd166,
    sunColor: 0xffffff, sunIntensity: 2.2, hemiSky: 0xcfefff, hemiGround: 0x4a7a35, hemiIntensity: 1.2,
  },
  desert: {
    label: 'Pustynia',
    sky: 0xf6d7a7, fog: 0xf3e0c0, ground: 0xe0b872, road: 0x6b5b4b,
    kerbA: 0xd62828, kerbB: 0xfcbf49, barrierA: 0x9c4a1a, barrierB: 0xfcefd4,
    foliage: 0x4f772d, trunk: 0x8a6a3a, rock: 0xc07a4a, accent: 0x2ec4b6,
    sunColor: 0xfff1d6, sunIntensity: 2.6, hemiSky: 0xfff0d0, hemiGround: 0xb08850, hemiIntensity: 1.1,
  },
  snow: {
    label: 'Zima',
    sky: 0xcfe8ff, fog: 0xe8f3ff, ground: 0xf4f8fb, road: 0x5a6270,
    kerbA: 0x1e88e5, kerbB: 0xffffff, barrierA: 0x0d47a1, barrierB: 0xe3f2fd,
    foliage: 0x2f5d50, trunk: 0x5d4037, rock: 0x90a4ae, accent: 0xff6f91,
    sunColor: 0xffffff, sunIntensity: 1.9, hemiSky: 0xffffff, hemiGround: 0xb0c4d8, hemiIntensity: 1.3,
  },
  neon: {
    label: 'Neonowa noc',
    sky: 0x1a1033, fog: 0x241640, ground: 0x2b1b4a, road: 0x22222e,
    kerbA: 0xff2bd6, kerbB: 0x2bf3ff, barrierA: 0x7a5cff, barrierB: 0x2bf3ff,
    foliage: 0xff2bd6, trunk: 0x3a2a5a, rock: 0x4a3a7a, accent: 0xfff200,
    sunColor: 0xb8a0ff, sunIntensity: 1.2, hemiSky: 0x6a4aff, hemiGround: 0x200a30, hemiIntensity: 1.0,
  },
  autumn: {
    label: 'Jesień',
    sky: 0xf3c9a0, fog: 0xf6dcc0, ground: 0x9a8c3a, road: 0x4d4440,
    kerbA: 0xc1440e, kerbB: 0xfff3e0, barrierA: 0x6d2e0e, barrierB: 0xffe0b2,
    foliage: 0xd9622b, trunk: 0x5a3a22, rock: 0x8d7b68, accent: 0x6ab04c,
    sunColor: 0xffe0c0, sunIntensity: 2.0, hemiSky: 0xffe6cc, hemiGround: 0x6a5a2a, hemiIntensity: 1.1,
  },
  volcano: {
    label: 'Wulkan',
    sky: 0x4a2c2a, fog: 0x5a3430, ground: 0x3b2f2f, road: 0x2a2a2a,
    kerbA: 0xff6b00, kerbB: 0x222222, barrierA: 0xff3d00, barrierB: 0x1a1a1a,
    foliage: 0x5a3e36, trunk: 0x2a1e1a, rock: 0x1e1e1e, accent: 0xffc400,
    sunColor: 0xffb080, sunIntensity: 1.8, hemiSky: 0xff8a50, hemiGround: 0x2a1010, hemiIntensity: 1.0,
  },
};

// ---------------------------------------------------------------------
// Pomocnik: obiekt {id: {label}} -> opcje [{value, label}] do schematu.
// ---------------------------------------------------------------------
const optionsOf = (obj) => Object.entries(obj).map(([value, v]) => ({ value, label: v.label }));

// ---------------------------------------------------------------------
// SCHEMAT USTAWIEŃ GLOBALNYCH (edytuje tylko host).
// Dodanie ustawienia = dopisanie jednego wpisu. UI i walidacja
// generują się z tego schematu.
//
// Typy:
//   int         — min, max, step
//   select      — options [{value, label}]
//   bool
//   multiselect — options; wartość to tablica wybranych value
//   text        — maxLength, pattern (RegExp)
// ---------------------------------------------------------------------
export const SETTINGS_SCHEMA = [
  { key: 'laps', type: 'int', label: 'Liczba okrążeń', min: 1, max: 15, step: 1, default: 5 },
  {
    key: 'minRacers', type: 'int', label: 'Min. liczba uczestników (boty dopełniają)',
    min: 1, max: MAX_RACERS, step: 1, default: 4,
  },
  { key: 'botDifficulty', type: 'select', label: 'Trudność botów', options: optionsOf(BOT_DIFFICULTIES), default: 'medium' },
  { key: 'speedClass', type: 'select', label: 'Klasa prędkości', options: optionsOf(SPEED_CLASSES), default: '150cc' },
  { key: 'itemFrequency', type: 'select', label: 'Skrzynki z przedmiotami', options: optionsOf(ITEMS.frequencies), default: 'normal' },
  {
    key: 'enabledItems', type: 'multiselect', label: 'Włączone przedmioty',
    options: optionsOf(ITEMS.types), default: Object.keys(ITEMS.types),
  },
  { key: 'kartCollisions', type: 'bool', label: 'Kolizje między kartami', default: true },
  { key: 'trackSize', type: 'select', label: 'Rozmiar toru', options: optionsOf(TRACK.sizes), default: 'medium' },
  { key: 'trackDifficulty', type: 'select', label: 'Trudność toru', options: optionsOf(TRACK.difficulties), default: 'medium' },
  {
    key: 'trackSeed', type: 'text', label: 'Seed toru (puste = losowy)',
    maxLength: 24, pattern: /^[A-Za-z0-9_-]*$/, placeholder: 'losowy', default: '',
  },
  {
    key: 'theme', type: 'select', label: 'Motyw kolorystyczny',
    options: [{ value: 'random', label: 'Losowy (z seeda)' }, ...optionsOf(THEMES)], default: 'random',
  },
];

// Długość losowego seeda generowanego przez hosta (znaki base36).
export const RANDOM_SEED_LENGTH = 6;
