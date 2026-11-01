# Turniej — projekt

Data: 2026-11-01 · Status: do przeglądu

## Cel

Tryb turniejowy: seria map (domyślnie 10), na każdej wyścig z liczbą okrążeń z ustawień (domyślnie 5).
Wyniki sumują się w tabeli turnieju, widocznej po każdej mapie i pod klawiszem `Tab` w trakcie wyścigu.
Między mapami każdy gracz klika „Gotowy”; host może wymusić start.

Kryteria sukcesu:
- turniej działa solo i w sieci (host autorytatywny), u wszystkich identyczna tabela;
- ten sam seed turnieju = te same tory;
- wyjście gracza w trakcie nie psuje tabeli ani składu;
- tryb „Pojedynczy wyścig” działa dokładnie jak dotąd.

Poza zakresem: trwała historia turniejów, dołączanie nowych graczy w trakcie turnieju, zmiana ustawień między mapami.

## Ustawienia (`SETTINGS_SCHEMA`)

- `gameMode`: select, „Tryb gry”, opcje `race` („Pojedynczy wyścig”) / `tournament` („Turniej”), domyślnie `race`.
- `mapCount`: int, „Liczba map (turniej)”, 2–15, krok 1, domyślnie 10.
- Okrążenia: istniejące `laps` (domyślnie 5) obowiązuje na każdej mapie.
- Presety nie zmieniają trybu (nie ustawiają `gameMode`/`mapCount`).

## Punktacja i ranking

- `TOURNAMENT.points = [15, 12, 10, 8, 6, 4, 2, 1]` w `config.js` — punkty za miejsca 1–8
  (miejsce = kolejność `standings(race)` po zakończeniu wyścigu, także dla DNF).
- Czas mapy: `finishTime`; DNF (brak `finishTime`) dostaje czas trwania wyścigu (`race.time` w chwili końca).
- Ranking: punkty malejąco; remis — mniejszy łączny czas; dalej — kolejność składu (stabilnie).

## Logika — `src/tournament.js` (czysty JS, bez DOM)

```js
createTournament({ seed, mapCount, roster })   // roster: [{id, name, color, isHuman}] zamrożony na starcie
tournament.mapSeed(i)                           // "<seed>-<i+1>" — seed toru mapy i (0..mapCount-1)
tournament.recordRace(race)                     // dopisuje wyniki bieżącej mapy, przechodzi do fazy 'between'
tournament.table()                              // [{id, name, color, points, time, lastPoints, left}] posortowane
tournament.setReady(id) / allReady()            // gotowość ludzi obecnych w turnieju; boty i nieobecni = gotowi
tournament.markLeft(id)                         // gracz wyszedł: zostaje w tabeli, dalej jedzie bot
tournament.nextMap()                            // index++, czyści gotowość; po ostatniej mapie phase = 'done'
// phase: 'racing' | 'between' | 'done'; index, count
```

Skład jest zamrożony: każda mapa startuje z tym samym rosterem (te same id botów i ludzi). Gracz, który wyszedł,
jest w kolejnych mapach prowadzony przez AI (jak dziś `takeOver`, z oznaczeniem 🤖), a jego punkty się sumują.
`createGame` dostaje roster turnieju zamiast liczyć go z `humans`/`minRacers` (nowy opcjonalny parametr).

## Sieć

- `start` zyskuje pole `tournament: {index, count, roster}` (roster zamrożony, by klient zbudował identyczną grę).
- Nowa wiadomość hosta `{t: 'tourney', index, count, phase, table, ready: [id]}` — wysyłana po zakończeniu mapy,
  przy każdej zmianie gotowości i przy wyjściu gracza. Klienci nie liczą tabeli sami.
- Klient wysyła `{t: 'ready'}`. Host przyjmuje ją tylko od gracza z turnieju, gdy `phase === 'between'`
  (walidacja w `session.js`).
- Gdy wszyscy ludzie gotowi → host startuje następną mapę automatycznie. Host może „Start mimo wszystko”.
- Przerwanie przez hosta (menu) kończy cały turniej (`abort`) i wszyscy wracają do lobby.
- Gracze dołączający w trakcie czekają w lobby (jak dziś w trakcie wyścigu) i grają od następnego turnieju.
- Podbić `GAME_VERSION`.

## Interfejs

- Ekran po mapie (rozszerzenie `showResults`): nagłówek „Mapa i / N”, wyniki wyścigu jak dotąd, pod nimi tabela
  turnieju (miejsce, gracz, punkty z „+N” za tę mapę, łączny czas), przy ludziach ✓/⏳ gotowości.
  Przyciski: „Gotowy” (każdy człowiek; po kliknięciu nieaktywny) i u hosta/solo „Start mimo wszystko”.
  Solo: jedyny człowiek klika „Gotowy” → następna mapa.
- Po ostatniej mapie: „Koniec turnieju”, tabela końcowa z wyróżnionym zwycięzcą, przycisk „Wróć do lobby”.
- `Tab` w trakcie wyścigu turniejowego: trzymany pokazuje tabelę turnieju (stan po poprzednich mapach),
  puszczony chowa; domyślne zachowanie Tab (fokus) zablokowane w trakcie gry. W pojedynczym wyścigu Tab nic nie robi.
- Lobby: przycisk startu „Start turnieju” w trybie turnieju; podgląd toru = mapa 1 (`mapSeed(0)`).

## Testy (Node)

- `tournament.test.js`: punktacja za miejsca (8 i mniej zawodników), DNF = czas trwania wyścigu,
  remis rozstrzyga czas, `mapSeed` deterministyczne i różne dla map, `markLeft` zachowuje punkty,
  gotowość (boty/nieobecni gotowi), przejście faz do `done`.
- `net.test.js`: `ready` od obcego / poza fazą `between` ignorowane; automatyczny start po gotowości
  wszystkich; force start; klient dostaje tę samą tabelę co host; start kolejnej mapy z tym samym rosterem.
- `game.test.js` / `tournament.test.js`: pełny turniej botów na 2–3 krótkich mapach (1 okrążenie) kończy się
  fazą `done` i tabelą z sumą punktów = suma punktów rozdanych.
- `settings.test.js`: nowe klucze mają poprawne domyślne wartości.
