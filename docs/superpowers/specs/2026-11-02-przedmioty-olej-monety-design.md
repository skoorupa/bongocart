# Nowe przedmioty, plamy oleju, ostrzejsze zakręty i monety — projekt

Data: 2026-11-02. Status: zatwierdzony w rozmowie (brainstorming), do przeglądu.

## Cel

Więcej urozmaicenia w wyścigu i turnieju:

1. dwa nowe przedmioty: **but** (odpycha przeciwnika z przodu) i **zepsute koła** (trafiony nie hamuje i ma gaz do dechy),
2. **maksymalny dystans i czas trwania** dla wszystkich pocisków (także istniejącego) i bananów,
3. **plamy oleju** na torze,
4. **ostrzejsze zakręty** na wszystkich poziomach trudności toru,
5. **monety** dające punkty w turnieju — proporcjonalnie, z maksimum, tak żeby zbieranie monet nie dało ostatniemu wygranej.

Sukces: wszystko działa w solo i w multiplayerze (host autorytatywny, predykcja klienta bez szarpania), boty używają nowych przedmiotów i omijają olej, `npm test` przechodzi, gra sprawdzona ręcznie w przeglądarce.

## Decyzje (z rozmowy)

| Temat | Decyzja |
|---|---|
| But | rzut prosto przed siebie (bez naprowadzania), trafia pierwszego karta na linii; trafiony dostaje pchnięcie w bok i ślizga się bez kontroli |
| Zepsute koła | pocisk naprowadzany jak rakieta na kierowcę przed strzelającym; trafiony przez kilka sekund: brak hamulca + gaz do dechy (skręt działa) |
| Plama oleju | poślizg: niska przyczepność boczna i słabszy skręt przez chwilę; może leżeć w zakręcie |
| Zakręty | zaostrzyć wszystkie poziomy (bez nowego poziomu); seedy dadzą inne tory |
| Monety | znikają na 1 s po zebraniu (dla wszystkich); kart zbiera tę samą monetę maks. raz na okrążenie; premia w turnieju proporcjonalna: `round(6 × zebrane / możliwe)` |
| Architektura | wspólny mechanizm pocisków (`kind`) + efekty jako pola karta w fizyce + monety obok skrzynek w `items.js` |

## Architektura

### Pociski — jeden mechanizm (`items.js`)

`items.rockets` → `items.projectiles`: `{id, kind, owner, target, s, lateral, x, z, heading, age, dist, homing}`.
`kind ∈ {rocket, boot, wrench}`; parametry w `ITEMS[kind]` (config.js):

- `guided: true` (rocket, wrench) — obecna logika rakiety: leci wzdłuż toru, dopasowuje się bokiem do celu, z bliska (`homingRange`) leci wprost. Cel = najbliższy jadący przed strzelającym (prowadzący strzela przed siebie, `target = null`).
- `guided: false` (boot) — leci prosto kursem karta z chwili rzutu (`x += sin(h)·v·dt`), bez celu; trafia pierwszego karta w promieniu.
- Każdy pocisk znika, gdy `age > lifetime` albo `dist > maxDistance` (dist = przebyta droga).
- `armSeconds` — nie trafia strzelającego tuż po starcie (jak dziś).

Wartości startowe (do strojenia):

| | speed [m/s] | maxDistance [m] | lifetime [s] | efekt |
|---|---|---|---|---|
| rocket | 55 | 220 | 5 | obrót (`spinOut`) |
| boot | 45 | 35 | 1.2 | kopniak: pchnięcie 16 m/s w bok + `knockTime` 0.7 s |
| wrench | 48 | 160 | 4 | `brokenTime` 4 s |

Banan: `ITEMS.banana.lifetime = 45` s na torze (potem znika); `maxOnTrack` bez zmian.

Trafienie (`hit(id, by, what)`): tarcza blokuje wszystko (zdarzenie `blocked`); inaczej efekt wg `what`:
- rocket, banana → `spinOut(k)` (bez zmian),
- boot → `knockOut(k, dirX, dirZ)`: do prędkości dodane `push` w kierunku „w bok od karta, w stronę bliższej krawędzi toru” (znak `k.lateral`; dla 0 — w prawo), `knockTime = KART.knock.seconds`, koniec dryfu i turbo,
- wrench → `breakWheels(k)`: `brokenTime = ITEMS.wrench.brokenSeconds`.

Funkcje efektów (`knockOut`, `breakWheels`) w `physics.js` obok `spinOut`.

### Efekty na karcie (`physics.js`)

Nowe pola stanu karta (licznik w sekundach, zmniejszany w `stepKart`):

- `knockTime` — sterowanie ignorowane (jak przy obrocie), przyczepność boczna `KART.knock.grip` (1.5/s) zamiast `grip` → kart zsuwa się w bok.
- `brokenTime` — wejście nadpisane: `throttle = 1, brake = 0` (skręt i dryf bez zmian). Cofanie niemożliwe.
- `oilTime` — przyczepność boczna `OBSTACLES.oil.grip` (2.2/s), skręt × `OBSTACLES.oil.steerMul` (0.45). Ustawiane na `OBSTACLES.oil.seconds` (1.3 s) w każdym kroku, gdy środek karta jest w plamie (`dist < oil.radius`).

Przy jednoczesnych efektach: obrót > kopniak (oba ignorują sterowanie); przyczepność = minimum z aktywnych; zepsute koła działają tylko, gdy kart ma kontrolę. `resetKartToTrack` zeruje wszystkie trzy.

Wygląd (`kartMesh.js`): przy `brokenTime > 0` koła chybotają się (`KART.brokenWobble`).

### Plamy oleju (`track/generator.js`, `track/obstacleMesh.js`)

- `placeOilSlicks(seed, points, step, length, itemBoxes, obstacles, density)` — osobny strumień `createRng(deriveSeed(seed, 'oil'))`, więc słupki i progi z danego seeda się nie zmieniają.
- Odstęp wg `OBSTACLES.oil.spacing[density]` (none 0, few 260 m, many 140 m) z jitterem, bez plam w `afterStart`/`beforeFinish`; odstęp `oil.clearance` (18 m wzdłuż toru) od skrzynek i przeszkód. Zakręty dozwolone.
- Położenie boczne losowe w `[-half + r + edgeMargin, half − r − edgeMargin]` → obok plamy zawsze ≥ 14 − 2·2.3 ≈ 9 m wolnej jezdni.
- `track.oils = [{x, z, s, index, lateral, radius}]`.
- Ustawienie: istniejące „Przeszkody na torze” (etykieta: „… (z plamami oleju)”).
- Wygląd: płaska ciemna elipsa z połyskiem (`oil.color`, `oil.sheen`) tuż nad jezdnią.
- Boty z `skill.dodge` omijają plamy (dołączone do `hazards` obok bananów).

### Ostrzejsze zakręty (`config.js` → `TRACK.difficulties`)

| | minTurnRadius | metersPerPoint | radiusVariance | angleJitter |
|---|---|---|---|---|
| Łatwy | 30 → 26 | bez zmian | bez zmian | bez zmian |
| Średni | 22 → 15 | 65–80 → 60–75 | 0.35 → 0.4 | 0.4 → 0.45 |
| Trudny | 16 → 10 | 48–60 → 44–56 | 0.4 → 0.45 | 0.45 → 0.5 |

Walidacja generatora (promień, prześwit band, długość) bez zmian i musi przechodzić na wielu seedach (istniejący test). Jeśli rośnie liczba odrzuconych prób albo boty przestają kończyć — łagodzimy wartości.

### Monety

**Rozmieszczenie** (`generator.js`, `placeCoins`, strumień `'coins'`, tylko gdy parametr `coins` = true):
rzędy co `COINS.rowSpacing` (130 m, jitter), 3–5 monet co 4 m wzdłuż toru, rząd przesunięty bocznie (do ±4.5 m) i po skosie; z dala (`COINS.clearance`) od skrzynek, przeszkód i plam; nie tuż za startem / przed metą. `track.coins = [{x, z, s, index}]`.

**Ustawienie lobby**: `{ key: 'coins', type: 'bool', label: 'Monety na torze (punkty)', default: true }`; presety: standard/chaos `true`, czysty wyścig `false`. Przekazywane przez `trackParamsFromSettings` do `generateTrack` (domyślnie `false` w API generatora).

**Logika** (`items.js`, obok skrzynek):
- `items.coins = track.coins.map(() => ({respawn: 0}))`, `items.coinTaken = Map id → Set(indeks monety)` (zebrane na bieżącym okrążeniu) + zapamiętane okrążenie zawodnika.
- Kart w promieniu `COINS.pickupRadius + KART.radius` od widocznej monety, której nie ma w swoim `coinTaken` → moneta `respawn = 1 s`, indeks do `coinTaken`, zdarzenie `{type: 'coin', id}`.
- Zbiór `coinTaken` zawodnika jest czyszczony, gdy zmieni się jego `lap` (stepItems dostaje okrążenia w `ctx`).
- Ukończeni (poza symulacją) nie zbierają.
- `game.step`: zdarzenie `coin` → `racer.coins += 1` (`race.js`: nowe pole `coins: 0`).

**Punkty** (`tournament.js`):
- możliwe = `track.coins.length × laps` (każda moneta raz na okrążenie),
- `coinBonus = possible ? Math.round(TOURNAMENT.maxCoinPoints × coins / possible) : 0`, `maxCoinPoints = 6` — czysta funkcja eksportowana (testowalna, używana też przez HUD),
- `recordRace(race, coinsPossible)`: `lastPoints = punkty za miejsce + coinBonus`.
- Gwarancja: ostatni z kompletem monet (≤ 0 + 6 lub 1 + 6) ma mniej niż 4. miejsce bez monet (8).

**UI**: HUD — licznik „🪙 zebrane/możliwe”; wyniki wyścigu — kolumna „Monety” („🪙 37/125 (+2)”); w tabeli turnieju „+X” = suma (miejsce + monety). Moneta zebrana przez lokalnego gracza na tym okrążeniu rysowana półprzezroczysto (u niego). Dźwięk `coin`.

## Sieć (`net/protocol.js`)

- `KART_FIELDS` += `knockTime`, `brokenTime`, `oilTime` (predykcja klienta liczy je tym samym `stepKart`).
- `RACER_FIELDS` += `coins`.
- Snapshot `items`: `rockets` → `projectiles: [id, kind, x, z, heading]`; nowe `coins: [respawn…]` (jak `boxes`); nowe `coinTaken: [[indeksy]…]` w kolejności `race.racers`.
- Klient: `applyRaceAndItems` ustawia te pola; rysuje pociski wg `kind`.
- `sanitizeTourneyView`: limit punktów za mapę = `TOURNAMENT.points[0] + TOURNAMENT.maxCoinPoints` (punkty i `lastPoints`).
- Pozycje plam i monet nie są przesyłane — wynikają z seeda i ustawień (klient buduje ten sam tor).
- `GAME_VERSION` 0.12.0 → 0.13.0.

## AI (`ai.js`)

`wantsItem`: `boot` — gdy `gapAhead < ITEMS.ai.bootRange` (20 m); `wrench` — gdy `gapAhead < ITEMS.ai.wrenchRange` (110 m); jak dotąd po `maxHoldSeconds` używa i tak. Omijanie: `hazards` = banany + plamy oleju (tylko `skill.dodge`).

## Wygląd i dźwięk

- `itemsMesh.js`: but (brązowy klocek z podeszwą, obrót w locie), klucz (szary, wirujący), rakieta bez zmian; monety — złote spłaszczone walce, obrót; InstancedMesh jak reszta.
- `obstacleMesh.js`: plamy oleju.
- `audio.js`: `boot` (świst + plask), `wrench` (metaliczny brzęk), `coin` (krótki dzwonek).
- `hud.js`: banery „Kopniak z buta!”, „Zepsute koła — brak hamulca!”; licznik monet; kolumna w wynikach.

## Testy

- **items**: but leci prosto i trafia pierwszego na linii, odpycha w bok (rośnie |lateral|); rocket/boot/wrench znikają po `maxDistance` i po `lifetime`; wrench ustawia `brokenTime`; tarcza blokuje but i klucz; banan znika po `lifetime`; monety: +1, znika na 1 s, drugi raz na tym samym okrążeniu nic, na następnym znowu; ukończony nie zbiera.
- **physics**: `brokenTime` — kart przyspiesza bez gazu, hamulec nie zwalnia; `knockTime` — sterowanie ignorowane, zsuw w bok; plama — `oilTime` ustawione, skręt słabszy niż bez plamy; reset zeruje efekty.
- **track**: plamy i monety deterministyczne; odstępy od skrzynek/przeszkód; wolny przejazd obok plamy; `coins: false` / `obstacles: 'none'` → brak; słupki/progi danego seeda niezmienione przez plamy; zaostrzone poziomy przechodzą walidację (istniejący test na wielu seedach).
- **tournament**: `coinBonus` 0 / połowa / komplet → 0 / 3 / 6; ostatni z kompletem < 4. miejsce bez monet.
- **net**: snapshot → apply odtwarza pola karta, pociski (z `kind`), monety, `coinTaken`, `coins` zawodnika; sanityzacja limitu punktów.
- **settings**: presety przechodzą walidację (istniejący test) z nowym kluczem.
- **game** (symulacje botów): na ostrzejszych torach boty kończą wyścig; wyścig z przedmiotami (w tym nowymi) się kończy.
- Ręcznie w przeglądarce: solo + host z klientem w iframe — rzut buta, klucz, olej, monety, tabela turnieju.

## Poza zakresem

- Utrata monet po trafieniu (jak w klasycznych kartingach) — możliwe później.
- Trwała tablica rekordów.
- Nowy poziom trudności toru.
