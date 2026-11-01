// =====================================================================
// config.js — JEDYNE miejsce na stałe gry i schemat ustawień lobby.
// Jednostka długości ≈ 1 metr, czas w sekundach.
// =====================================================================

// ---------------------------------------------------------------------
// Kart — arcade'owy model jazdy. Wartości dla 150cc; klasa prędkości
// mnoży je w JEDNYM miejscu: physics.js -> kartStats().
// ---------------------------------------------------------------------
export const KART = {
  baseMaxSpeed: 30, // prędkość maksymalna [m/s]
  accel: 17, // przyspieszenie przy zerowej prędkości [m/s²]
  accelFalloff: 0.7, // im bliżej v.max, tym słabsze przyspieszanie (0..1)
  brakeDecel: 38,
  reverseAccel: 10,
  reverseMaxSpeed: 9,
  coastDrag: 5, // wytracanie prędkości bez gazu [m/s²]
  overSpeedDrag: 20, // hamowanie, gdy jedziemy szybciej niż limit (np. po turbo)

  // Skręt zależny od prędkości [rad/s].
  turnRateLow: 2.5, // przy małej prędkości
  turnRateHigh: 1.55, // przy prędkości maksymalnej
  turnRampSpeed: 6, // poniżej tej prędkości skręt słabnie do 0 (brak obrotu w miejscu)
  // Wygładzanie skrętu z klawiatury [1/s].
  steerRiseRate: 7,
  steerReturnRate: 11,

  // Przyczepność boczna: jak szybko znika poślizg boczny [1/s].
  grip: 12,
  driftGrip: 2.4,

  // Dryf + mini-turbo.
  drift: {
    minSpeed: 11, // wejście w dryf od tej prędkości
    minSteer: 0.3, // trzeba skręcać, żeby zacząć dryf
    cancelSpeedFactor: 0.65, // dryf przerywa spadek poniżej minSpeed × to
    turnMin: 0.15, // skręt w dryfie (× turnRateLow), kontra   -> promień ~80 m przy 30 m/s
    turnMax: 0.95, // skręt w dryfie, pełne dociśnięcie         -> promień ~13 m
    chargeBase: 0.6, // ładowanie [1/s] bez dociśnięcia
    chargeSteer: 0.6, // dodatkowe ładowanie przy pełnym dociśnięciu
    levels: [0.9, 1.9], // progi ładowania (s) -> poziom 1, 2
    boostTimes: [0.55, 1.1], // czas turbo dla poziomu 1, 2
    hopTime: 0.18, // podskok przy wejściu w dryf (tylko wizualnie)
  },

  boostSpeed: 8, // dodatek do v.max w trakcie turbo
  boostAccel: 45,

  // Nawierzchnia.
  offroadSpeedFactor: 0.45, // limit prędkości poza torem (× v.max)
  offroadDrag: 28,

  // Bandy.
  radius: 1.1, // promień kolizji karta
  wallRestitution: 0.25, // odbicie od bandy (0..1)
  wallSpeedKeep: 0.85, // ułamek prędkości zachowany przy uderzeniu
  wallHitMinSpeed: 2, // poniżej: tylko "ślizg" wzdłuż bandy
  // Obrót po trafieniu (banan, pocisk): brak kontroli, mocne hamowanie.
  spin: { seconds: 1.1, drag: 26, turns: 2 },
  bumpRestitution: 0.6, // odbicie przy zderzeniu kart (0 = plastycznie, 1 = sprężyście)
  wallAlign: 0.12, // przy kontakcie kurs obraca się w stronę bandy (ułamek na krok) — brak "zakleszczenia"

  // Model (metry).
  length: 2.4,
  width: 1.6,
  wheelRadius: 0.36,
  maxBodyRoll: 0.12, // przechył nadwozia w zakręcie [rad]
  driftBodyYaw: 0.35, // dodatkowy obrót nadwozia w dryfie [rad]
};

export const PHYSICS = {
  fixedDt: 1 / 120, // stały krok symulacji
  maxStepsPerFrame: 8, // ochrona przed "spiralą śmierci" po zawieszeniu karty
};

// Kolory kartów do wyboru przez graczy (i dla botów).
export const KART_COLORS = [0xe63946, 0x1e88e5, 0x43aa8b, 0xffb703, 0x9b5de5, 0xff6fb5, 0xf77f00, 0x2ec4b6];

// ---------------------------------------------------------------------
// Sterowanie (KeyboardEvent.code) i gamepad (indeksy przycisków
// w standardowym mapowaniu Gamepad API).
// ---------------------------------------------------------------------
export const CONTROLS = {
  keys: {
    accelerate: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    drift: ['Space'],
    item: ['ShiftLeft', 'ShiftRight', 'KeyE'],
    lookBack: ['KeyC'],
    reset: ['KeyR'],
    menu: ['Escape'],
    mute: ['KeyM'],
  },
  gamepad: {
    deadzone: 0.15,
    steerAxis: 0,
    accelerate: [7, 0], // RT, A
    brake: [6, 1], // LT, B
    drift: [5], // RB
    item: [4, 2], // LB, X
    lookBack: [3], // Y
    menu: [9], // Start
  },
};

// ---------------------------------------------------------------------
// Kamera trzecioosobowa.
// ---------------------------------------------------------------------
export const CAMERA = {
  distance: 6.8, // za kartem
  height: 2.7,
  lookHeight: 1.1,
  lookAhead: 4, // punkt patrzenia przed kartem
  posLerp: 9, // szybkość podążania pozycją [1/s]
  yawLerp: 4.5, // opóźnienie obrotu [1/s]
  fovBase: 66,
  fovSpeedAdd: 10, // przy v.max
  fovBoostAdd: 9,
  fovLerp: 4,
  driftRoll: 0.07, // pochylenie przy dryfie [rad]
  rollLerp: 5,
  // Wstrząs kamery (uderzenie w bandę, trafienie).
  shake: { decay: 6, maxAmplitude: 0.5, wallPerSpeed: 0.03, hit: 0.4, frequency: 37 },
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
    easy: {
      label: 'Łatwy', metersPerPoint: [95, 120], radiusVariance: 0.3, angleJitter: 0.3, minTurnRadius: 30, aspect: [1.3, 1.8],
      lobes: { count: [1, 1], amplitude: [0.38, 0.5] },
    },
    medium: {
      label: 'Średni', metersPerPoint: [65, 80], radiusVariance: 0.35, angleJitter: 0.4, minTurnRadius: 22, aspect: [1.2, 1.8],
      lobes: { count: [2, 2], amplitude: [0.38, 0.52] },
    },
    hard: {
      label: 'Trudny', metersPerPoint: [48, 60], radiusVariance: 0.4, angleJitter: 0.45, minTurnRadius: 16, aspect: [1.1, 1.8],
      lobes: { count: [2, 2], amplitude: [0.42, 0.58] },
    },
  },
  // "Płaty" toru: niskie harmoniczne promienia r(θ) = 1 + Σ a·cos(kθ + φ).
  // k = 2 daje kształt fasolki / litery B (dwa brzuśce i wcięcie), k = 3
  // koniczynkę, k = 4 krzyż. Wcięcia = zakręty w drugą stronę, tor
  // przestaje przypominać koło.
  lobeHarmonics: [2, 2, 3, 3, 4], // losowane (powtórzenia = większa szansa)
  minRadiusFactor: 0.35, // dolne ograniczenie promienia (× średni promień)
  minControlPoints: 6,
  // Kolejne próby generacji łagodzą kształt: calm = 1 − (próba/max)^wykładnik.
  calmExponent: 2,
  // Lokalne wygładzanie za ostrych zakrętów przed walidacją.
  // stencil = odległość sąsiadów w próbkach (szerszy = szybsza zbieżność).
  // targetMargin: wygładzamy do promienia minR × margines, bo późniejsze
  // przeskalowanie do docelowej długości lekko zacieśnia zakręty.
  relax: { maxIterations: 80, windowSamples: 8, stencil: 4, strength: 0.5, targetMargin: 1.4 },
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
  // Nick nad kartem (wszyscy poza tobą).
  nameTag: {
    height: 2.6, // [m] nad ziemią
    worldHeight: 0.55, // [m] wysokość napisu w świecie (szerokość wg tekstu)
    fontPx: 48, // rozdzielczość tekstury
    maxDistance: 90, // [m] dalej nie pokazujemy (bałagan na horyzoncie)
  },
  minimapPadding: 12,
};

// ---------------------------------------------------------------------
// Przeszkody na torze (urozmaicenie, lekka kara). Rozmieszczenie liczy
// generator toru, kolizje physics.js, wygląd track/obstacleMesh.js.
// ---------------------------------------------------------------------
export const OBSTACLES = {
  densities: {
    none: { label: 'Brak', spacing: 0 },
    few: { label: 'Mało', spacing: 220 }, // [m] między kolejnymi przeszkodami
    many: { label: 'Dużo', spacing: 110 },
  },
  jitter: 0.25, // losowe przesunięcie (× spacing)
  searchStep: 4, // [m] krok szukania dozwolonego miejsca, gdy wylosowane jest zajęte
  searchFraction: 0.5, // szukamy najdalej tyle × spacing do przodu
  afterStart: 60, // [m] brak przeszkód tuż za startem
  beforeFinish: 40, // [m] i tuż przed metą
  boxClearance: 25, // [m] odstęp od rzędu skrzynek (wzdłuż toru)
  cornerWindow: 20, // [m] okno (±) sprawdzania zakrętu wokół przeszkody
  minCornerRadius: 45, // [m] przeszkody tylko na prostych i łagodnych łukach
  bumpChance: 0.4, // szansa, że przeszkoda to próg (reszta: szykana)
  minFreeFraction: 0.6, // wolny przejazd: min. część szerokości jezdni
  post: {
    radius: 0.6, // [m] promień kolizji słupka
    height: 1.4, // [m]
    count: [2, 3], // słupków w grupie (włącznie)
    spacing: 8, // [m] między słupkami grupy (wzdłuż toru)
    minGap: 3.5, // [m] wolny przejazd z KAŻDEJ strony słupka (słupki w środkowej strefie)
    slalomChance: 0.5, // szansa na slalom (zygzak); reszta: rządek na osi toru
    slalomOffset: 2.4, // [m] odsunięcie słupków slalomu od osi (na przemian lewo/prawo)
    rowJitter: 0.8, // [m] rozrzut boczny rządka wokół osi
    speedKeep: 0.7, // mnożnik prędkości po uderzeniu (kart ześlizguje się po słupku)
    hitMinSpeed: 2, // [m/s] poniżej: tylko otarcie, bez kary
    contactSlop: 0.05, // [m] luz: kart tuż przy słupku (po wypchnięciu) nadal "w kontakcie"
  },
  bump: {
    widthFraction: 0.5, // część szerokości jezdni od krawędzi
    depth: 0.8, // [m] wzdłuż toru
    height: 0.12, // [m]
    speedKeep: 0.85, // mnożnik prędkości przy przejeździe
    minSpeed: 8, // [m/s] wolniej = bez kary
    hopSeconds: 0.25, // [s] podskok karta (wizualny)
    hopHeight: 0.22, // [m] wysokość podskoku
    stripeWidth: 0.7, // [m] szerokość pasa żółty/czarny
  },
  colors: { post: 0xff6d00, postBand: 0xffffff, postBase: 0x263238, bumpA: 0xffd600, bumpB: 0x212121 },
  postBands: [0.55, 0.78], // wysokości środków białych pasów (× wysokość słupka)
  postBandHeight: 0.14, // [m] wysokość pasa
  postBandBulge: 0.03, // [m] pas wystaje ponad korpus (bez z-fightingu)
  postBaseHeight: 0.12, // [m] ciemna podstawa
  postBaseBulge: 0.08, // [m] podstawa szersza od korpusu
  postSegments: 14, // boki walca
  postCapFlatten: 0.35, // czubek: półkula spłaszczona do tej części promienia
  bumpSound: 0.25, // siła dźwięku uderzenia przy progu (0..1, jak wall)
  bumpShake: 0.12, // [m] wstrząs kamery przy progu
};

// ---------------------------------------------------------------------
// Przedmioty. Rozmieszczenie skrzynek liczy generator toru, logikę
// items.js, wygląd itemsMesh.js.
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

  box: { pickupRadius: 1.4, respawnSeconds: 2, size: 1.5, height: 1.3, spinSpeed: 1.5 },
  rollSeconds: 1.2, // "ruletka" w slocie, zanim przedmiot jest gotowy
  rollIconSeconds: 0.08, // zmiana ikony w ruletce

  // Wagi losowania wg miejsca: [przód stawki, środek, tył]. Prowadzący
  // dostają obronę, ostatni — przedmioty do odrabiania strat.
  positionBands: [1 / 3, 2 / 3],
  types: {
    rocket: { label: 'Pocisk', icon: '🚀', weights: [1, 3, 4] },
    banana: { label: 'Banan', icon: '🍌', weights: [4, 2, 1] },
    boost: { label: 'Turbo', icon: '⚡', weights: [1, 3, 4] },
    shield: { label: 'Tarcza', icon: '🛡️', weights: [3, 2, 1] },
  },

  boost: { seconds: 1.6 },
  shield: { seconds: 8 },
  banana: { dropBack: 2.6, hitRadius: 0.9, maxOnTrack: 24 },
  // Pocisk leci wzdłuż toru i dopasowuje się bokiem do celu; z bliska
  // naprowadza się wprost. Cel = kierowca bezpośrednio przed strzelającym.
  rocket: {
    speed: 55, // [m/s] (szybszy od każdego karta)
    lifetime: 7, // [s]
    launchAhead: 2.5, // [m] przed kartem
    lateralRate: 12, // [m/s] zmiana przesunięcia bocznego
    homingRange: 18, // [m]
    hitRadius: 1.0,
    armSeconds: 0.3, // tyle nie trafia strzelającego
  },
  // Bot: kiedy używa przedmiotu.
  ai: {
    holdSeconds: [0.8, 3.5], // losowa zwłoka po wylosowaniu
    rocketRange: 90, // [m] strzela, gdy cel jest bliżej
    bananaBehind: 15, // [m] zrzuca, gdy ktoś jest tuż za nim
    boostStraightRadius: 90, // [m] turbo na prostej (brak ciaśniejszych zakrętów)
    boostLookMeters: 50,
    maxHoldSeconds: 10, // potem używa i tak
  },
};

// Poziomy botów. speedFactor ogranicza prędkość docelową (× v.max klasy),
// cornerFactor — jak odważnie wchodzą w zakręty, lineNoise — jak bardzo
// "pływają" wokół linii jazdy [m], dodge — omijają banany.
export const BOT_DIFFICULTIES = {
  easy: { label: 'Łatwy', speedFactor: 0.8, cornerFactor: 0.8, lineNoise: 2.5, steerGain: 2.5, drift: false, dodge: false },
  medium: { label: 'Średni', speedFactor: 0.9, cornerFactor: 0.92, lineNoise: 1.2, steerGain: 3, drift: true, dodge: true },
  hard: { label: 'Trudny', speedFactor: 0.98, cornerFactor: 1.0, lineNoise: 0.4, steerGain: 3.5, drift: true, dodge: true },
};

// Wspólne parametry kierowcy AI (boty, gracz po mecie, rozłączony gracz).
export const AI = {
  lookAheadMin: 6, // [m] punkt celowania przed kartem
  lookAheadTime: 0.3, // [s] + tyle sekund jazdy
  brakeHysteresis: 1, // [m/s] ponad prędkością docelową, zanim zahamuje
  brakeScanExtra: 15, // [m] skanowania zakrętów ponad drogę hamowania
  noisePeriods: [7, 13], // [s] dwie sinusoidy "pływania" po torze
  avoid: { ahead: 12, width: 2.6, shift: 3.5, rate: 5 }, // omijanie kart z przodu
  // Omijanie słupków toru: zasięg patrzenia [m], zapas ponad styk [m].
  avoidPost: { ahead: 35, margin: 0.6 },
  drift: {
    lookMeters: 10, // zakręt musi zaczynać się tyle przed kartem
    enterRadius: 45, // [m] wchodzi w dryf w zakręcie ciaśniejszym niż to
    exitRadius: 70, // wychodzi, gdy zakręt łagodnieje
    minArcMeters: 35, // zakręt musi być na tyle długi, żeby naładować mini-turbo
    maxHeadingError: 0.6, // [rad] przerywa dryf, gdy wynosi go z linii
  },
  stuck: { speed: 2, time: 1.5, reverseTime: 1, resetTime: 6 },
  // Lekkie wyrównywanie szans: boty przed najlepszym człowiekiem zwalniają,
  // za nim jadą bliżej swojego maksimum.
  rubberBand: { distance: 150, strength: 0.08 },
};

export const BOT_NAMES = ['Bongo', 'Kluska', 'Turbo Tomek', 'Pani Pędzik', 'Śrubka', 'Zygzak', 'Gumiś', 'Dr Drift'];

export const MAX_RACERS = 8;

// ---------------------------------------------------------------------
// Przebieg wyścigu: odliczanie, checkpointy, meta, HUD.
// ---------------------------------------------------------------------
export const RACE = {
  countdownSeconds: 3, // 3-2-1, potem START
  goBannerSeconds: 1, // jak długo widać "START!"
  // Checkpoint zaliczony, gdy kart jest 0..okno metrów ZA nim (po linii
  // toru). Musi być mniejsze niż odstęp checkpointów (test pilnuje).
  checkpointPassWindow: 20,
  finishTimeoutSeconds: 30, // po pierwszym na mecie reszta ma tyle czasu
  resultsDelaySeconds: 2.5, // od końca wyścigu do tabeli wyników
  bannerSeconds: 2.5, // komunikaty: ostatnie okrążenie, czas okrążenia
  hitBannerSeconds: 1.2, // komunikat o trafieniu
  leaderboardRefreshSeconds: 0.2, // tabela pozycji: odświeżanie (oszczędza DOM)
  wrongWay: {
    dot: -0.3, // cos kąta między kursem a kierunkiem toru
    minSpeed: 3, // [m/s] poniżej nie ostrzegamy (manewrowanie)
    delaySeconds: 1, // tyle musi trwać, zanim pokażemy ostrzeżenie
  },
};

// Wersja gry: klient z inną wersją niż host nie dołączy (inny protokół
// albo fizyka). Zmieniaj przy każdym wdrożeniu, które zmienia grę.
export const GAME_VERSION = '0.10.0';

// ---------------------------------------------------------------------
// Dźwięk (Web Audio, generowany). Głośności 0..1, częstotliwości [Hz].
// ---------------------------------------------------------------------
export const AUDIO = {
  storageKey: 'bongocart.audio',
  masterVolume: 0.6,
  sfxVolume: 0.25,
  attack: 0.01, // [s] narastanie dźwięków
  // Silnik jednocylindrowy: obroty z biegami (spadek przy zmianie biegu),
  // "pykanie" = modulacja głośności z częstotliwością zapłonów, harmoniczne
  // przez miękkie przesterowanie, chrapliwy wydech = szum pasmowy.
  engine: {
    gears: 4,
    shiftDropRpm: 0.35, // obroty po zmianie biegu (ułamek zakresu)
    idleHz: 32, rangeHz: 150, // częstotliwość podstawowa: bieg jałowy + zakres
    boostRpm: 0.12, // turbo podbija obroty
    revInPlace: 0.55, // gaz w miejscu: maks. obroty
    pulseDepth: 0.45, // głębokość "pykania" 0..1
    drive: 2.5, // przesterowanie (więcej = ostrzej)
    filterHz: 250, filterRpmHz: 1800, filterThrottleHz: 900,
    raspVolume: 0.25, raspHarmonic: 4, raspQ: 2.5, // szum wydechu
    volume: 0.11, offThrottleLevel: 0.55, idleLevel: 0.5,
    rpmSmoothing: 0.05, // [s] — szybko, żeby było słychać zmianę biegu
    toneSmoothing: 0.08,
  },
  drift: { q: 6, baseHz: 1800, levelHz: 500, volume: 0.06, smoothing: 0.05 },
  wallMinSpeed: 3, // [m/s] słabsze stuknięcia bez dźwięku
};

// ---------------------------------------------------------------------
// Sieć (PeerJS, gwiazda: host liczy grę, klienci wysyłają sterowanie).
// ---------------------------------------------------------------------
export const NET = {
  peerPrefix: 'bongocart-v1-', // id hosta w PeerJS = prefiks + kod pokoju
  codeLength: 5,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // bez 0/O, 1/I
  connectTimeoutSeconds: 10,
  heartbeatSeconds: 1, // ping co tyle
  heartbeatTimeoutSeconds: 3, // brak wiadomości tak długo = rozłączenie
  snapshotEverySteps: 6, // co ile kroków fizyki host wysyła stan (120/6 = 20 Hz)
  // Klient: inne karty rysujemy z opóźnieniem, interpolując między stanami.
  interpDelaySeconds: 0.1,
  interpResyncSeconds: 0.3, // większy rozjazd zegara = skok zamiast korekty
  interpCorrection: 0.1, // ułamek rozjazdu korygowany przy każdym stanie
  snapshotBufferSeconds: 1,
  // Host: kolejka sterowania od klienta (w krokach fizyki).
  inputBufferMin: 2, // tyle czekamy na start, żeby wygładzić wahania sieci
  inputBufferMax: 24, // więcej = zegar klienta ucieka, wyrzucamy najstarsze
  maxInputsPerMessage: 60,
  inputHistoryMax: 240, // klient: niepotwierdzone sterowanie do powtórki
  correctionDecay: 10, // [1/s] wygładzanie korekty pozycji własnego karta
  correctionTeleport: 6, // [m] większa korekta = skok bez wygładzania
  nameMaxLength: 16,
  profileStorageKey: 'bongocart.profile',
};

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
// Presety lobby: zestawy ustawień rozgrywki (tor — rozmiar, seed, motyw —
// zostaje bez zmian). Klucze muszą istnieć w SETTINGS_SCHEMA (test).
// ---------------------------------------------------------------------
export const PRESETS = {
  standard: {
    label: 'Standard',
    values: { itemFrequency: 'normal', enabledItems: ['rocket', 'banana', 'boost', 'shield'], kartCollisions: true, botDifficulty: 'medium', speedClass: '150cc', minRacers: 4, obstacles: 'few' },
  },
  chaos: {
    label: 'Chaos',
    values: { itemFrequency: 'often', enabledItems: ['rocket', 'banana', 'boost', 'shield'], kartCollisions: true, botDifficulty: 'hard', speedClass: '200cc', minRacers: 8, obstacles: 'many' },
  },
  clean: {
    label: 'Czysty wyścig',
    values: { itemFrequency: 'none', enabledItems: [], kartCollisions: false, botDifficulty: 'hard', speedClass: '150cc', minRacers: 4, obstacles: 'none' },
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
  { key: 'obstacles', type: 'select', label: 'Przeszkody na torze', options: optionsOf(OBSTACLES.densities), default: 'few' },
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
