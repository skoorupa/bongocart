# Nowe przedmioty, olej, monety, ostrzejsze zakręty — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** But i zepsute koła, limity dystansu/czasu pocisków i bananów, plamy oleju, ostrzejsze zakręty i monety z proporcjonalną premią w turnieju.

**Architecture:** Pociski (rocket/boot/wrench) to jeden mechanizm w `items.js` z `kind`; efekty trafień i oleju to liczniki na stanie karta liczone w `physics.js` (predykcja klienta działa sama); plamy i monety generuje `generator.js` z seeda; licznik monet trzyma `race.js`, premię liczy `tournament.js`.

**Tech Stack:** czysty JS (moduły ES), Three.js 0.170 (tylko widok), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-02-przedmioty-olej-monety-design.md`

## Global Constraints

- Komentarze po polsku, wszystkie stałe w `src/config.js` z komentarzem i jednostką (wartości startowe — patrz spec).
- Logika gry bez `Math.random` — tylko `createRng(deriveSeed(seed, ...))`; nowe strumienie: `'oil'`, `'coins'`.
- Logika (`physics`, `items`, `race`, `game`, `ai`, `tournament`, `generator`, `net/*`) bez DOM/Three.js.
- Klasa prędkości tylko w `kartStats()`.
- `GAME_VERSION` = `'0.13.0'`.
- Nowe ustawienie wyłącznie przez wpis w `SETTINGS_SCHEMA`; presety przechodzą walidację.
- Commity po polsku z prefiksem funkcji, stopka `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Prowadzący strzela rakietą/kluczem (`target = null`) — pocisk musi zniknąć po `maxDistance`, nie krążyć 5 s po torze. Test w Task 3.
2. Tor bez monet (`coins: false` albo bardzo krótki) — `possible = 0`, premia 0, brak dzielenia przez zero, HUD „🪙 0/0”. Test w Task 4.
3. Kart z `brokenTime` w trakcie odliczania lub po resecie (R) — reset zeruje efekty; w odliczaniu efektów nie ma (przedmioty nie działają). Test w Task 1.
4. Snapshot od hosta z nieznanym `kind` pocisku / za długimi tablicami monet — klient nie wywala się (pomija). Test w Task 6.
5. Ten sam kart przejeżdża przez monetę, która właśnie się odradza (respawn > 0) — nie zbiera i nie zapisuje do `coinTaken`. Test w Task 4.

---

### Task 1: Efekty na karcie (fizyka): kopniak, zepsute koła, olej

**Files:**
- Modify: `src/config.js` (`KART.knock`, `KART.brokenWobble`, `OBSTACLES.oil`)
- Modify: `src/physics.js`
- Test: `tests/physics.test.js`

**Interfaces:**
- Produces: pola stanu karta `knockTime`, `brokenTime`, `oilTime` (0 w `createKartState`, zerowane w `resetKartToTrack`); `knockOut(kart, dirX, dirZ, push)` — dodaje `push` m/s w kierunku (dirX, dirZ), `knockTime = KART.knock.seconds`, kończy dryf i turbo; `breakWheels(kart, seconds)` — `brokenTime = max(brokenTime, seconds)`. Plamy czytane z `track.oils ?? []` (`{x, z, radius}`).

- [ ] **Step 1: Testy (failing)** w `tests/physics.test.js`:
  - `zepsute koła: kart sam przyspiesza, hamulec nie działa` — `breakWheels(k, 2)`, 1 s z `idle` → `k.speed > 5`; potem 0.5 s z `brake: 1` → prędkość nie spada.
  - `kopniak: brak kontroli i zsuw w bok` — kart jadący prosto 20 m/s, `knockOut(k, prawoX, prawoZ, 16)`, 0.5 s z `steer: -1` → `k.lateral` wzrósł o > 2 m (w prawo), `knockTime` maleje do 0 po `KART.knock.seconds`.
  - `plama oleju: poślizg i słabszy skręt` — tor z `oils: [plama na środku przed kartem]`; przejazd ustawia `oilTime ≈ OBSTACLES.oil.seconds`; zmiana kursu przy `steer: 1` przez 0.3 s mniejsza niż na torze bez plamy.
  - `reset zeruje efekty` — po ustawieniu wszystkich trzech `resetKartToTrack` → 0.
- [ ] **Step 2:** `npm test -- tests/physics.test.js` → FAIL (brak eksportów).
- [ ] **Step 3: Implementacja** — w `stepKart`: zmniejsz liczniki; kolejność wejścia: obrót/kopniak → `NO_INPUT`, inaczej `brokenTime > 0` → `{...input, throttle: 1, brake: 0}`; przyczepność boczna = min z (grip/driftGrip, `knock.grip` gdy knock, `oil.grip` gdy olej); skręt nie-dryfowy × `oil.steerMul` gdy olej. Wykrycie plamy w `collideObstacles` (środek karta w promieniu).
- [ ] **Step 4:** `npm test -- tests/physics.test.js` → PASS.
- [ ] **Step 5: Commit** `Fizyka: kopniak, zepsute koła i poślizg na oleju`.

### Task 2: Tor — ostrzejsze zakręty, plamy oleju, rozmieszczenie monet, ustawienie „Monety”

**Files:**
- Modify: `src/config.js` (`TRACK.difficulties` wg tabeli w spec, `COINS`, wpis `coins` w `SETTINGS_SCHEMA`, presety, etykieta „Przeszkody”)
- Modify: `src/track/generator.js`
- Test: `tests/track.test.js`, `tests/settings.test.js` (istniejące testy presetów)

**Interfaces:**
- Produces: `generateTrack({..., obstacles = 'none', coins = false})` → `track.oils: [{x, z, s, index, lateral, radius}]`, `track.coins: [{x, z, s, index}]`; `trackParamsFromSettings` zawiera `coins: settings.coins`.

- [ ] **Step 1: Testy (failing):**
  - `plamy oleju: none = brak, deterministyczne, nie zmieniają słupków i progów` — `obstacles: 'many'` dwa razy → te same `oils` (niepuste); `obstacles` (słupki/progi) identyczne z wersją liczoną bez plam (porównanie z zapisanym JSON-em jest zbędne — wystarczy: plamy z osobnego strumienia, więc `obstacles` przy `many` jest równe temu samemu wywołaniu; plus `oils.length === 0` przy `'none'`).
  - `plamy: na jezdni, wolny przejazd, z dala od skrzynek i przeszkód (wiele seedów)` — `|lateral| + radius <= halfWidth`, wolne ≥ `TRACK.width − 2·radius − edgeMargin`, odstęp wzdłuż toru ≥ `oil.clearance` od skrzynek i przeszkód.
  - `monety: tylko gdy coins, deterministyczne, na jezdni i z dala od skrzynek, przeszkód i plam` — `coins: false` → `[]`; `coins: true` → niepuste; rzędy 3–5; `|lateral| <= halfWidth`.
  - istniejący test walidacji 200 seedów (zaostrzone wartości) musi przejść.
- [ ] **Step 2:** `npm test -- tests/track.test.js` → FAIL.
- [ ] **Step 3: Implementacja** — `placeOilSlicks(seed, points, step, length, itemBoxes, obstacles, density)` i `placeCoins(seed, points, step, length, itemBoxes, obstacles, oils, enabled)` w stylu `placeObstacles` (szukanie dalej, gdy miejsce zajęte); zmiana `TRACK.difficulties`; ustawienie i presety wg spec. Jeśli walidacja 200 seedów nie przechodzi — łagodzić `minTurnRadius`/`metersPerPoint` minimalnie i zanotować w raporcie.
- [ ] **Step 4:** `npm test -- tests/track.test.js tests/settings.test.js` → PASS.
- [ ] **Step 5: Commit** `Tor: ostrzejsze zakręty, plamy oleju i monety`.

### Task 3: Pociski — wspólny mechanizm, but, zepsute koła, limity

**Files:**
- Modify: `src/config.js` (`ITEMS.types.boot/wrench`, `ITEMS.rocket/boot/wrench` z `guided/speed/maxDistance/lifetime`, `ITEMS.banana.lifetime`, `ITEMS.ai.bootRange/wrenchRange`)
- Modify: `src/items.js`
- Test: `tests/items.test.js`

**Interfaces:**
- Consumes: `knockOut`, `breakWheels`, `spinOut` (Task 1).
- Produces: `items.projectiles: [{id, kind, owner, target, s, lateral, x, z, heading, age, dist, homing}]` (zastępuje `items.rockets`); banany `{id, owner, x, z, age}`; zdarzenia `hit`/`blocked` z `what ∈ {rocket, banana, boot, wrench}`.

- [ ] **Step 1: Testy (failing):**
  - istniejący test rakiety przechodzi po zmianie nazwy (`items.projectiles`).
  - `but leci prosto i odpycha pierwszego na linii` — `b` 15 m przed `a` na tej samej linii; `a` rzuca; zdarzenie `hit` `['b','a','boot']`, `b.knockTime > 0`, po 0.5 s symulacji `|b.lateral|` większe.
  - `but obok linii nie trafia i znika po maxDistance` — cel 4 m w bok → brak trafienia, po `boot.lifetime` brak pocisków.
  - `każdy pocisk znika po maxDistance i po lifetime` — dla każdego `kind`: strzał bez celu (`order` = tylko strzelający) → `projectiles` puste najpóźniej, gdy `dist > maxDistance` lub `age > lifetime` (sprawdzić oba, np. podmieniając `speed` w kopii configu nie — zamiast tego: liczba kroków do zniknięcia ≤ `min(maxDistance/speed, lifetime)/DT + 1`).
  - `klucz psuje koła celu` — `hit` z `what: 'wrench'`, `b.brokenTime ≈ ITEMS.wrench.brokenSeconds`.
  - `tarcza blokuje but i klucz` — `blocked`, brak efektu, tarcza zdjęta.
  - `banan znika po lifetime`.
- [ ] **Step 2:** `npm test -- tests/items.test.js` → FAIL.
- [ ] **Step 3: Implementacja** — `launch(items, id, kind, ctx)` tworzy pocisk (guided: cel jak rakieta; boot: kurs strzelającego); jeden filtr kroku pocisków: guided → obecna logika rakiety, inaczej ruch prosto; `dist += przebyta droga`; znikanie po limitach; `hit` rozdziela efekt wg `what` (boot: kierunek w bok od celu w stronę `sign(lateral)`, dla 0 — w prawo).
- [ ] **Step 4:** `npm test -- tests/items.test.js` → PASS.
- [ ] **Step 5: Commit** `Przedmioty: but, zepsute koła, limity dystansu i czasu`.

### Task 4: Monety — zbieranie, reguła okrążenia, licznik, premia w turnieju

**Files:**
- Modify: `src/items.js`, `src/race.js` (`coins: 0`), `src/game.js`, `src/tournament.js`, `src/main.js` (wywołanie `recordRace`), `src/config.js` (`TOURNAMENT.maxCoinPoints = 6`, `COINS.respawnSeconds = 1`)
- Test: `tests/items.test.js`, `tests/tournament.test.js`, `tests/game.test.js`

**Interfaces:**
- Produces: `items.coins: [{respawn}]`, `items.coinTaken: Map id → Set<indeks>`; `ctx.laps: Map id → lap` w `stepItems`; zdarzenie `{type: 'coin', id}`; `racer.coins`; `coinsPossible(track, laps) → number`; `coinBonus(coins, possible) → int` (eksport z `tournament.js`); `tournament.recordRace(race, possible)`.

- [ ] **Step 1: Testy (failing):**
  - `moneta: +1, znika na 1 s, drugi raz na tym okrążeniu nic, na następnym znowu` (items, z `ctx.laps`).
  - `moneta w trakcie odradzania nie jest zbierana i nie trafia do coinTaken`.
  - `ukończony nie zbiera monet`.
  - `coinBonus: 0 / połowa / komplet → 0 / 3 / 6; possible 0 → 0`.
  - `recordRace: punkty = miejsce + premia; ostatni z kompletem monet ma mniej niż 4. miejsce bez monet`.
  - game: `wyścig botów z monetami: licznik coins rośnie u kogoś` (tor `coins: true`, 1 okrążenie).
- [ ] **Step 2:** `npm test -- tests/items.test.js tests/tournament.test.js` → FAIL.
- [ ] **Step 3: Implementacja** — zbieranie w `stepItems` obok skrzynek; `game.step` przekazuje `laps` i zamienia zdarzenia `coin` na `racer.coins++`; `recordRace` dolicza `coinBonus`; `main.js` podaje `coinsPossible(track, race.laps)`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `Monety: zbieranie raz na okrążenie i premia w turnieju`.

### Task 5: Boty — but, klucz, omijanie oleju

**Files:**
- Modify: `src/ai.js`, `src/game.js` (hazards = banany + `track.oils`)
- Test: `tests/game.test.js`

- [ ] **Step 1: Test (failing):** `boty używają buta i klucza` — gra 6 botów, `enabledItems: ['boot', 'wrench']`, `itemFrequency: 'often'`, 1 okrążenie → zdarzenia `use` z `item` `boot` i `wrench`; wyścig się kończy (`end`).
- [ ] **Step 2:** uruchom → FAIL lub PASS przez `maxHoldSeconds` (wtedy test i tak pilnuje końca wyścigu).
- [ ] **Step 3:** `wantsItem`: `boot` gdy `gapAhead < ITEMS.ai.bootRange`, `wrench` gdy `gapAhead < ITEMS.ai.wrenchRange`.
- [ ] **Step 4:** `npm test -- tests/game.test.js` → PASS (także istniejące symulacje na ostrzejszych torach).
- [ ] **Step 5: Commit** `Boty: but, klucz i omijanie oleju`.

### Task 6: Sieć — nowe pola w snapshocie, wersja

**Files:**
- Modify: `src/net/protocol.js`, `src/config.js` (`GAME_VERSION`)
- Test: `tests/net.test.js`

**Interfaces:**
- Produces: snapshot `items.projectiles: [[id, kind, x, z, heading]]`, `items.coins: [respawn]`, `items.coinTaken: [[indeks]]` (kolejność `race.racers`); `KART_FIELDS` + `knockTime, brokenTime, oilTime`; `RACER_FIELDS` + `coins`.

- [ ] **Step 1: Testy (failing):** `snapshot przenosi efekty, pociski, monety i coinTaken` (host-gra → `makeSnapshot` → `applyRaceAndItems`/`applyKart` na grze klienta → równe pola); `applyRaceAndItems pomija pocisk o nieznanym kind`; `sanitizeTourneyView: punkty mapy do points[0] + maxCoinPoints`.
- [ ] **Step 2:** `npm test -- tests/net.test.js` → FAIL.
- [ ] **Step 3: Implementacja** + `GAME_VERSION = '0.13.0'`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `Sieć: efekty, pociski i monety w snapshocie; wersja 0.13.0`.

### Task 7: Wygląd, HUD, dźwięk + sprawdzenie w przeglądarce

**Files:**
- Modify: `src/itemsMesh.js` (pociski wg `kind`, monety; półprzezroczyste dla `coinTaken` lokalnego gracza), `src/track/obstacleMesh.js` (plamy), `src/kartMesh.js` (chybotanie kół, `view.brokenTime`), `src/main.js` (`viewOf` + `brokenTime`, `USE_SOUND`, dźwięk `coin`, `itemsView.update(items, dt, localId)`), `src/ui/hud.js` + `index.html` + `style.css` (licznik „🪙 x/y”, kolumna „Monety” w wynikach, banery), `src/audio.js` (`boot`, `wrench`, `coin`)

- [ ] **Step 1:** implementacja widoku.
- [ ] **Step 2:** `npm test` → PASS (brak regresji).
- [ ] **Step 3:** przeglądarka (`python -m http.server 8080`, `http://127.0.0.1:8080/?debug`, odświeżenie modułów `fetch(..., {cache:'reload'})`): solo — olej, monety (licznik, półprzezroczystość), rzut buta i klucza (ustawienie slotu przez `bongo.game.items.slots`), wyniki z kolumną monet; host + klient w iframe — pociski i monety widoczne u klienta, brak błędów w konsoli.
- [ ] **Step 4: Commit** `Widok: but, klucz, monety, plamy oleju, HUD i dźwięki`.

### Task 8: Dokumentacja

**Files:** `README.md` (przedmioty, olej, monety i premia, sterowanie bez zmian), `CLAUDE.md` (stan)

- [ ] **Step 1:** aktualizacja; **Step 2:** `npm test` → PASS; **Step 3: Commit** `Dokumentacja: nowe przedmioty, olej, monety`.
