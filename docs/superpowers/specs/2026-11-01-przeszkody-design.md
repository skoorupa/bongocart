# Przeszkody na torze — projekt

Data: 2026-11-01 · Status: do przeglądu

## Cel

Urozmaicić tor statycznymi przeszkodami: **szykanami ze słupków** i **progami zwalniającymi**.
Przeszkody mają być urozmaiceniem, nie wyzwaniem (wariant A): kara jest lekka, ominąć je łatwo,
a wolny przejazd jest zawsze szeroki.

Kryteria sukcesu:
- przeszkody są deterministyczne z seeda: host i klient mają identyczne bez żadnej wymiany w sieci;
- zderzenie ze słupkiem spowalnia, ale nigdy nie zatrzymuje karta w miejscu ani go nie obraca;
- boty omijają słupki, nie zakleszczają się, a czas wyścigu botów rośnie najwyżej o kilka procent;
- ustawienie „Przeszkody” w lobby: Brak / Mało / Dużo.

Poza zakresem: przeszkody ruchome lub niszczalne, błoto/olej, przeszkody zależne od „Trudności toru”.

## Architektura

Przeszkody są **częścią toru**, tak jak `itemBoxes`:

- `generator.js`: `placeObstacles(seed, points, step, length, itemBoxes, density)` → `track.obstacles`,
  ze strumienia `createRng(deriveSeed(seed, 'obstacles'))`. `generateTrack` przyjmuje nowy parametr `obstacles`
  (gęstość), a `trackParamsFromSettings` przekazuje `settings.obstacles`.
- `physics.js`: `stepKart` po ruchu i kolizji z bandą sprawdza przeszkody z `track.obstacles`
  (osobna funkcja `collideObstacles(kart, track)`). Klasa prędkości nie wpływa na przeszkody.
- `clientSim.js` woła `stepKart`, więc predykcja klienta uwzględnia przeszkody bez zmian.
- Sieć: brak zmian w protokole. **Podbić `GAME_VERSION`** (zmiana rozgrywki i generatora).

Kształt danych (wszystko, czego potrzebuje fizyka i rysowanie):

```js
track.obstacles = [
  { type: 'post', x, z, radius },                        // pojedynczy słupek
  { type: 'bump', index, s, latFrom, latTo, heading },   // próg: pas w poprzek toru
];
```

Szykana to kilka wpisów `post` (słupki są niezależne dla fizyki). Próg jest opisany odcinkiem
w układzie toru (`s` wzdłuż, `lateral` od `latFrom` do `latTo`). Kart sprawdza go przez swoje `trackS`/`lateral`.

## Zachowanie

**Słupek:** kolizja okrąg–okrąg (`KART.radius` + `OBSTACLES.post.radius`). Kart jest wypychany na zewnątrz,
składowa prędkości w stronę słupka zostaje odbita ze współczynnikiem `post.restitution`, a przy uderzeniu
powyżej `post.hitMinSpeed` cała prędkość jest mnożona przez `post.speedKeep` (≈ 0,7). Ustawia też `kart.wallHit`
(istniejący dźwięk/efekt uderzenia). Bez `spinOut`, dryf nie jest przerywany.

**Próg:** kart wjeżdża na próg, gdy jego `trackS` przechodzi przez `s` progu (w danym kroku), a `lateral`
mieści się w `[latFrom − KART.radius, latTo + KART.radius]`. Jeśli `|speed| > bump.minSpeed`, prędkość
(vx, vz, speed) jest mnożona przez `bump.speedKeep` (≈ 0,85). Przejście przez `s` zdarza się raz na przejazd,
więc kara nie powtarza się w kolejnych krokach. Wizualnie: krótki podskok karta. Liczy go rysowanie z pola stanu
`kart.bumpHit` (siła, zanika jak `wallHit`), żeby `main.js`/`kartMesh.js` mogły dodać podskok i dźwięk.

## Rozmieszczenie

Gęstość: `OBSTACLES.densities = { none: {label: 'Brak', spacing: 0}, few: {label: 'Mało', spacing: …}, many: {label: 'Dużo', spacing: …} }`
(odstęp w metrach między kolejnymi przeszkodami, z losowym rozrzutem `OBSTACLES.jitter`).

Dla każdej pozycji `s`:
1. Pomiń, jeśli jest w strefie startu/mety (`OBSTACLES.afterStart`, `OBSTACLES.beforeFinish`).
2. Pomiń, jeśli w odległości `OBSTACLES.boxClearance` od rzędu skrzynek.
3. Pomiń, jeśli promień toru w oknie ±`OBSTACLES.cornerWindow` metrów jest mniejszy niż `OBSTACLES.minCornerRadius`
   (przeszkody tylko na prostych i łagodnych łukach).
4. Wylosuj typ (`OBSTACLES.bumpChance`) i stronę toru (lewa/prawa).
   - **Szykana:** `post.count` słupków (2–3) w jednej linii wzdłuż toru, co `post.spacing` m, w pasie od krawędzi
     do co najwyżej `maxBlockFraction` szerokości jezdni.
   - **Próg:** od krawędzi do `bump.widthFraction` szerokości jezdni (≈ 0,5).

Niezmiennik: wolny przejazd przy każdej przeszkodzie ma co najmniej `OBSTACLES.minFreeFraction` (0,6) szerokości jezdni.

## Boty (`ai.js`)

`game.js` przekazuje słupki botom jako przeszkody do omijania: `hazards: [...items.bananas, ...track.posts]`.
`track.posts` to lista słupków wyliczona raz w generatorze, żeby nie filtrować `obstacles` co krok.
Słupki omija każdy bot, niezależnie od `skill.dodge` (który dalej dotyczy bananów), więc `avoidance()` dostaje
słupki osobnym argumentem. Progów boty nie omijają.

## Ustawienia i presety

`SETTINGS_SCHEMA`: `{ key: 'obstacles', type: 'select', label: 'Przeszkody na torze', options: optionsOf(OBSTACLES.densities), default: 'few' }`.
Presety: `standard` = `few`, `chaos` = `many`, `clean` = `none`.

## Rysowanie

Nowy `src/track/obstacleMesh.js` (trackMesh.js zostaje przy jezdni):
- słupek: pomarańczowy stożek/walec z białym paskiem, wymiary z `OBSTACLES.post`;
- próg: niski, zaokrąglony prostopadłościan w żółto-czarne pasy, ułożony w poprzek toru (`heading`).

`main.js` dodaje te obiekty do sceny obok skrzynek oraz podskok karta i dźwięk na `bumpHit`.

## Testy (Node)

- `track.test.js`, wiele seedów i gęstości: przeszkody leżą na jezdni, poza strefami wykluczonymi,
  z wolnym przejazdem ≥ `minFreeFraction`; `none` daje pustą listę; ten sam seed daje te same przeszkody.
- `physics.test.js`: kart jadący w słupek zostaje odbity i spowolniony (`0 < speed_po < speed_przed`),
  nie przenika słupka i nie obraca się; próg przy dużej prędkości zwalnia o `speedKeep`, przy małej wcale;
  stojąc/jadąc dalej za progiem nie dostaje drugiej kary.
- `game.test.js`: wyścig botów z `obstacles: 'many'` kończy się, boty się nie zakleszczają (brak resetów
  z powodu przeszkód), czas mieści się w limicie podobnym do obecnego.
- `settings.test.js`: presety z nowym kluczem przechodzą walidację (istniejący test).

## Ryzyka

- Słupek tuż za łukiem może zaskoczyć gracza. Łagodzą to strefa wykluczonych zakrętów i szeroki wolny przejazd.
- Bot omija słupek przesunięciem `AI.avoid.shift`. Jeśli wolny pas jest po drugiej stronie, przesunięcie musi iść
  w stronę wolnego przejazdu; obecna logika (odsuń się od przeszkody) już to robi.
