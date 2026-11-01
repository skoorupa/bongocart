# Przeszkody na torze — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Statyczne słupki (szykany) i progi zwalniające na torze, generowane z seeda, jako łagodne urozmaicenie.

**Architecture:** Przeszkody są częścią toru (`track.obstacles`, `track.posts`) generowaną w `generator.js`. Kolizję liczy `stepKart` w `physics.js`, więc host, boty i predykcja klienta działają bez zmian w protokole (poza nowym polem `bumpTime` w `KART_FIELDS`). Boty omijają słupki przez istniejące `avoidance()` w `ai.js`.

**Tech Stack:** czysty JS (moduły ES), Three.js 0.170 (tylko rysowanie), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-01-przeszkody-design.md`

## Global Constraints

- Komentarze po polsku; żadnych magicznych liczb — wszystkie stałe w nowej sekcji `OBSTACLES` w `src/config.js` (z komentarzem i jednostką).
- Determinizm: tylko `createRng(deriveSeed(seed, 'obstacles'))`, nigdy `Math.random` w logice.
- Logika (`generator.js`, `physics.js`, `ai.js`, `game.js`) bez DOM/Three.js; Three.js tylko w `src/track/obstacleMesh.js`, `kartMesh.js`, `main.js`.
- Klasa prędkości nie wpływa na przeszkody (działa tylko w `kartStats()`).
- Podbić `GAME_VERSION` z `'0.9.0'` na `'0.10.0'`.
- Wolny przejazd przy każdej przeszkodzie ≥ `OBSTACLES.minFreeFraction` = 0,6 szerokości jezdni (`TRACK.width` = 14 m).
- Słupek: bez `spinOut`, nie przerywa dryfu. Commity po polsku z prefiksem „Przeszkody:”.
- Pełne `npm test` zielone na końcu każdego zadania.

## Review Focus

1. Kart wjeżdżający w słupek przy dużej prędkości bokiem/pod kątem — nie może przeniknąć słupka w jednym kroku (120 Hz × 36 m/s ≈ 0,3 m < promień sumy, OK — test w Task 2).
2. Próg tuż przy linii mety: przejście `trackS` przez 0/`length` nie może dawać fałszywego „przejazdu” wszystkich progów — test zawinięcia w Task 2.
3. Kart cofający się przez próg — też kara tylko raz na przejście, w obie strony (test w Task 2).
4. Seed, na którym tor jest prawie okręgiem/krótki („small”) — generator nie może wpaść w nieskończoną pętlę ani wstawić przeszkód w strefy wykluczone (test na wielu seedach w Task 1).
5. Bot przy słupku na tle innego karta — omijanie nie może go wypchnąć w drugi słupek szykany ani zakleszczyć (symulacja `many` w Task 3).

---

### Task 1: Konfiguracja i generator przeszkód

**Files:**
- Modify: `src/config.js` (nowa sekcja `OBSTACLES` przy `ITEMS`; `GAME_VERSION`)
- Modify: `src/track/generator.js` (`placeObstacles`, `generateTrack`, `trackParamsFromSettings`)
- Test: `tests/track.test.js`

**Interfaces:**
- Produces:
  - `OBSTACLES` w `config.js`:
    ```js
    densities: { none: {label:'Brak', spacing:0}, few: {label:'Mało', spacing:220}, many: {label:'Dużo', spacing:110} }, // [m] między przeszkodami
    jitter: 0.25, afterStart: 60, beforeFinish: 40, boxClearance: 25, // [m]
    cornerWindow: 20, minCornerRadius: 45, // [m] tylko proste i łagodne łuki
    bumpChance: 0.4, minFreeFraction: 0.6, edgeMargin: 0.6, // [m] słupek/próg od krawędzi jezdni
    post: { radius: 0.35, height: 0.9, count: [2, 3], spacing: 6, maxBlockFraction: 0.35, restitution: 0.3, speedKeep: 0.7, hitMinSpeed: 2 },
    bump: { widthFraction: 0.5, depth: 0.8, height: 0.12, speedKeep: 0.85, minSpeed: 8, hopSeconds: 0.25 },
    ```
  - `generateTrack({ ..., obstacles = 'none' })` → `track.obstacles: Array<{type:'post', x, z, radius} | {type:'bump', index, s, latFrom, latTo, heading}>` oraz `track.posts` (same słupki, `{x, z, radius}`).
  - `trackParamsFromSettings(settings, seed)` zwraca też `obstacles: settings.obstacles`.

- [ ] **Step 1: Napisz testy w `tests/track.test.js`**

  - `'przeszkody: none = brak, ten sam seed = te same przeszkody, nie zmieniają kształtu toru'` — `obstacles` puste dla `'none'` i domyślnie; `JSON.stringify(t.obstacles)` równe dla dwóch wywołań z `'many'`; `t.points` identyczne dla `'none'` i `'many'`.
  - `'przeszkody leżą na jezdni, poza strefami i zostawiają wolny przejazd (wiele seedów)'` — dla 40 seedów × 3 rozmiary × `difficulty:'hard'`, `obstacles:'many'`, `itemFrequency:'often'`:
    - `t.obstacles.length > 0` przynajmniej dla większości seedów;
    - każdy słupek: `|nearestOnTrack(t, x, z).lateral| + radius <= t.halfWidth`;
    - każda przeszkoda (s słupka z `nearestOnTrack`): `s >= OBSTACLES.afterStart && s <= t.length - OBSTACLES.beforeFinish`;
    - odległość wzdłuż toru (modulo `t.length`) od każdej przeszkody do każdego rzędu skrzynek `>= OBSTACLES.boxClearance - (OBSTACLES.post.count[1] - 1) * OBSTACLES.post.spacing` (pierwszy słupek szykany jest sprawdzany, kolejne leżą dalej);
    - próg: `latTo - latFrom <= TRACK.width * (1 - OBSTACLES.minFreeFraction)` i `[latFrom, latTo]` w `[-halfWidth, halfWidth]`;
    - słupki jednej szykany (grupa po `s` w odstępie ≤ `post.count[1] * post.spacing`): zajęty pas `max(|lat|)+r` od krawędzi ≤ `TRACK.width * (1 - minFreeFraction)`;
    - `t.posts.length === t.obstacles.filter(o => o.type === 'post').length`.
  - Dopisz `o: t.obstacles` do `strip()` w teście determinizmu.

- [ ] **Step 2: `npm test -- tests/track.test.js`** — Expected: FAIL (`obstacles` undefined).

- [ ] **Step 3: Zaimplementuj**

  `placeObstacles(seed, points, step, length, itemBoxes, density)` w `generator.js`: pętla `s` od `afterStart` do `length - beforeFinish` co `spacing * (1 + rng.range(-jitter, jitter))` (wzorem `placeItemBoxes`); pomiń pozycje przy skrzynkach (`|s − points[box.index].s| < boxClearance`) i przy zakrętach (min `radius` w `[s − cornerWindow, s + cornerWindow]` < `minCornerRadius`). Losuj stronę `side = rng.next() < 0.5 ? -1 : 1` i typ (`bumpChance`).
  - Szykana: `count = rng.int(count[0], count[1])` (włącznie), słupki co `post.spacing` m wzdłuż toru; `lateral = side * (halfWidth − edgeMargin − radius − rng.range(0, width*maxBlockFraction − 2*(edgeMargin+radius)))`, pozycja `p.x + p.nx*lat`.
  - Próg: `latFrom/latTo` = pas od krawędzi `side` o szerokości `widthFraction * width`; `heading = p.heading`.

  W `generateTrack` dodaj parametr `obstacles = 'none'`, pola `obstacles` i `posts`. Podbij `GAME_VERSION`.

- [ ] **Step 4: `npm test -- tests/track.test.js`** — Expected: PASS.

- [ ] **Step 5: Commit** — `Przeszkody: generator słupków i progów w torze`

### Task 2: Fizyka — kolizja ze słupkiem i próg

**Files:**
- Modify: `src/physics.js` (`createKartState`, `stepKart`, nowa `collideObstacles`, `resetKartToTrack`)
- Modify: `src/net/protocol.js:81` (dopisz `'bumpTime'` do `KART_FIELDS`)
- Test: `tests/physics.test.js`

**Interfaces:**
- Consumes: `track.posts`, `track.obstacles` (type `'bump'`), `OBSTACLES.post`, `OBSTACLES.bump` z Task 1.
- Produces: pole stanu `kart.bumpTime` (s, 0 = brak podskoku); `stepKart` sygnatura bez zmian.

- [ ] **Step 1: Napisz testy w `tests/physics.test.js`**

  Buduj sztuczny tor: `const t = { ...track, posts: [...], obstacles: [...] }` (tor bez przeszkód z istniejącego `track`, przeszkody dokładane ręcznie przed kartem na prostej — użyj punktu `track.points[k]` przed `gridSlot(0)`).
  - `'słupek odbija i spowalnia, ale nie zatrzymuje ani nie obraca'` — kart ustawiony ~8 m przed słupkiem na wprost, `speed = 25`, jedzie z gazem 1 s: odległość kart–słupek zawsze `>= KART.radius + post.radius - 1e-6` (sprawdzaj co krok); po kontakcie `0 < |speed| < 25`; `spinTime === 0`.
  - `'dryf nie jest przerywany przez słupek'` — kart z `drift.active = true` ociera się bokiem: po kontakcie `drift.active === true`.
  - `'próg zwalnia raz przy dużej prędkości'` — próg przez całą szerokość w teście (`latFrom = -halfWidth, latTo = halfWidth`), kart przy 25 m/s bez gazu przejeżdża: tuż po przejściu `speed ≈ 25 * bump.speedKeep` (±1 m/s dryfu oporu); `bumpTime > 0`; w kolejnych 0,5 s żadnego drugiego skoku spadku (różnica prędkości krok-do-kroku < 0,5).
  - `'próg przy małej prędkości nie karze'` — `speed = bump.minSpeed - 2`: brak spadku > 0,3 m/s, `bumpTime === 0`.
  - `'próg poza pasem nie działa'` — próg `latFrom = 3, latTo = 7`, kart na `lateral ≈ -3`: brak kary.
  - `'cofanie przez próg też karze raz'` — kart 2 m za progiem, `speed = -KART.reverseMaxSpeed` (9 m/s > `bump.minSpeed` 8), wejście `brake: 1`: po przejściu `|speed| ≈ 9 * bump.speedKeep` (±0,5), dokładnie jeden skokowy spadek.
  - `'próg nie reaguje na przejazd przez linię mety'` — próg na `s = 50`, kart przejeżdża przez `s = 0`: brak kary.

- [ ] **Step 2: `npm test -- tests/physics.test.js`** — Expected: FAIL.

- [ ] **Step 3: Zaimplementuj**

  - `createKartState`: `bumpTime: 0` (komentarz). `resetKartToTrack`: zeruje `bumpTime`.
  - `stepKart`: zapamiętaj `prevS = kart.trackS` przed `collideWithTrack`; po nim `kart.bumpTime = Math.max(0, kart.bumpTime - dt)` i `collideObstacles(kart, track, prevS)`.
  - `collideObstacles(kart, track, prevS)`:
    - Słupki: jak połowa `collideKarts` z nieruchomym obiektem — wypchnij kart na `KART.radius + o.radius`, odbij składową normalną `vn` z `post.restitution`, przy `vn > post.hitMinSpeed` pomnóż prędkość przez `post.speedKeep` i ustaw `kart.wallHit = Math.max(kart.wallHit, vn)`; przelicz `kart.speed`.
    - Progi: przejście, gdy `prevS` i `kart.trackS` leżą po różnych stronach `o.s`, licząc różnicę ze znakiem modulo `track.length` (`d = ((x − o.s + L/2) mod L) − L/2`; przejście = znaki `d(prev)` i `d(now)` różne i `|d(prev)| < L/4`). Warunek boczny `lateral ∈ [latFrom − KART.radius, latTo + KART.radius]`, `|speed| > bump.minSpeed` → `vx, vz, speed *= bump.speedKeep`, `bumpTime = bump.hopSeconds`.
  - `protocol.js`: dopisz `'bumpTime'` na końcu `KART_FIELDS` (sprawdź, czy `applyKart`/walidacja nie zależą od stałej długości — `net.test.js` to pokaże).

- [ ] **Step 4: `npm test`** — Expected: PASS (całość, łącznie z `net.test.js`).

- [ ] **Step 5: Commit** — `Przeszkody: kolizje ze słupkami i progi w fizyce`

### Task 3: Boty, ustawienia i presety

**Files:**
- Modify: `src/ai.js` (`avoidance`, `control` — nowe pole kontekstu `obstacles`)
- Modify: `src/game.js:98` (przekazanie `obstacles: track.posts`)
- Modify: `src/config.js` (`SETTINGS_SCHEMA`, `PRESETS`)
- Test: `tests/game.test.js`, `tests/settings.test.js` (istniejący test presetów)

**Interfaces:**
- Consumes: `track.posts` (Task 1), fizyka słupków (Task 2).
- Produces: `ctx.obstacles: Array<{x, z}>` w `driver.control`; ustawienie `settings.obstacles ∈ {'none','few','many'}`, domyślnie `'few'`.

- [ ] **Step 1: Testy**

  W `tests/game.test.js`:
  - `'boty kończą wyścig z gęstymi przeszkodami i rzadko w nie trafiają'` — tor `generateTrack({ seed: 'bots', size: 'small', difficulty: 'hard', theme: 'random', itemFrequency: 'none', obstacles: 'many' })` (assert `posts.length > 0`), 4 boty `medium`, 1 okrążenie: wszyscy kończą; najlepszy czas ≤ 1,08 × najlepszy czas na torze bez przeszkód z tym samym seedem; po fazie odliczania żaden kart nie ma ciągłego odcinka `|speed| < AI.stuck.speed` dłuższego niż `AI.stuck.time` (licz w pętli `runUntil` na `game.karts`).
  - `settingsWith` bazuje na `defaultSettings()`, więc `obstacles` dostaje domyślną wartość ze schematu — nic nie zmieniaj, tylko upewnij się, że tak jest.

  W `tests/settings.test.js` nic nowego poza tym, że istniejący test presetów musi przejść z nowym kluczem; dopisz asercję `defaultSettings().obstacles === 'few'` (`defaultSettings` z `src/settings.js`).

- [ ] **Step 2: `npm test -- tests/game.test.js tests/settings.test.js`** — Expected: FAIL.

- [ ] **Step 3: Zaimplementuj**

  - `ai.js`: `avoidance(kart, others, hazards, obstacles)` — lista kandydatów `[...others, ...(skill.dodge ? hazards : []), ...obstacles]`; reszta logiki bez zmian. `control` przekazuje `ctx.obstacles ?? []`; zaktualizuj komentarz `ctx`.
  - `game.js`: `obstacles: track.posts`.
  - `config.js`: wpis `{ key: 'obstacles', type: 'select', label: 'Przeszkody na torze', options: optionsOf(OBSTACLES.densities), default: 'few' }` po `trackDifficulty`; `PRESETS`: `standard` → `obstacles: 'few'`, `chaos` → `'many'`, `clean` → `'none'`.
  - Jeśli bot mimo to często trafia (test), zwiększ `AI.avoid` tylko dla słupków osobną stałą `AI.avoidObstacle` (np. `ahead` większe) — nie zmieniaj zachowania wobec kartów.

- [ ] **Step 4: `npm test`** — Expected: PASS.

- [ ] **Step 5: Commit** — `Przeszkody: boty omijają słupki, ustawienie w lobby i presety`

### Task 4: Rysowanie, podskok i dźwięk

**Files:**
- Create: `src/track/obstacleMesh.js`
- Modify: `src/kartMesh.js:161` (podskok z `view.bumpTime`)
- Modify: `src/main.js` (`rebuildTrack` ~l.156–164: dodanie/usuwanie widoku przeszkód; pętla ~l.530–590: dźwięk)
- Modify: `src/config.js` (`OBSTACLES.colors`, `OBSTACLES.bump.hopHeight`, ewentualnie `AUDIO.bumpVolume`)

**Interfaces:**
- Consumes: `track.obstacles`, `kart.bumpTime`.
- Produces: `buildObstaclesVisual(track) -> THREE.Group` (sprzątany istniejącym `disposeObject`).

- [ ] **Step 1: Zaimplementuj `buildObstaclesVisual(track)`** — słupki jako `InstancedMesh` stożka (pomarańczowy) + białej opaski (wymiary `post.radius`, `post.height`); progi jako `BoxGeometry(latTo − latFrom, bump.height, bump.depth)` w żółto-czarne pasy (kolory wierzchołków lub dwa materiały), ustawione w punkcie toru `index` na środku `[latFrom, latTo]`, obrócone o `heading`. Kolory w `OBSTACLES.colors`.
- [ ] **Step 2: `main.js`** — w `rebuildTrack` buduj/usuwaj grupę obok `itemsView`; w pętli: gdy `bumpTime` własnego karta wzrósł względem poprzedniej klatki, `audio.play('wall', OBSTACLES.bump.soundStrength)` (stała w config) i lekki `chase.shake`.
- [ ] **Step 3: `kartMesh.js`** — `hop` = max(podskok dryfu, `sin((view.bumpTime / bump.hopSeconds) * π) * bump.hopHeight`). Upewnij się, że `viewOf()` w `main.js` przekazuje `bumpTime` (interpolowany widok kopiuje pola karta — sprawdź).
- [ ] **Step 4: Weryfikacja w przeglądarce** — `python -m http.server 8080`, przeładuj zmienione moduły (`fetch('/src/…', {cache:'reload'})` dla `config.js`, `physics.js`, `generator.js`, `obstacleMesh.js`, `kartMesh.js`, `main.js`, `ai.js`, `game.js`, `protocol.js`), `/?debug`, ustawienie „Dużo”: widać pachołki i progi na torze, kart odbija się od pachołka, podskakuje na progu, boty omijają słupki; brak błędów w konsoli. Zrzut ekranu dla użytkownika.
- [ ] **Step 5: `npm test`** — PASS. **Commit** — `Przeszkody: modele pachołków i progów, podskok i dźwięk`

### Task 5: Dokumentacja

- [ ] `README.md`: krótka wzmianka o przeszkodach i ustawieniu; `CLAUDE.md` sekcja „Stan”: dopisać przeszkody. Commit — `Przeszkody: README i CLAUDE.md`.
