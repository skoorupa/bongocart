# BongoCart — kontekst dla Claude

Przeglądarkowe wyścigi kartingowe dla 2–8 znajomych + boty. Three.js 0.170 (importmap z CDN), czyste moduły ES bez bundlera, PeerJS 1.5.4 (globalny `Peer` ze skryptu w `index.html`), hosting statyczny. Użytkownik pisze po polsku — odpowiadaj po polsku. Instrukcja dla graczy, wdrożenie i tabela architektury: `README.md`.

## Komendy

- Serwer: `python -m http.server 8080` → http://localhost:8080 (`?debug` wystawia `window.bongo`: game, kart, track, race, mode, localId, host).
- Testy: `npm test` (`node --test tests/`, ~70 s; najdłużej trwają symulacje wyścigów botów i walidacja torów na wielu seedach).

## Konwencje (trzymaj się ich)

- **Komentarze po polsku. Żadnych magicznych liczb** — wszystkie stałe w `src/config.js` (z komentarzem i jednostką).
- **Ustawienia lobby generują się z `SETTINGS_SCHEMA`** (config.js): nowe ustawienie = jeden wpis; UI (`ui/settingsForm.js`) i walidacja (`settings.js`) same się dostosują. Presety (`PRESETS`) przechodzą tę samą walidację (test).
- **Klasa prędkości działa tylko w `kartStats()`** (physics.js) — nigdzie indziej.
- **Determinizm:** logika gry nigdy nie używa `Math.random` — tylko `createRng(deriveSeed(seed, ...))` z `rng.js` (osobny strumień na zastosowanie). `Math.random` wolno w czysto wizualnych efektach i w `randomSeed()`/kodzie pokoju.
- **Logika bez DOM/Three.js** (testowalna w Node): `physics`, `race`, `ai`, `items`, `game`, `track/generator`, `net/{lobby,protocol,session,clientSim}`. Rysowanie i UI tylko w `main.js`, `*Mesh.js`, `camera.js`, `ui/*`, `audio.js`.
- Fizyka: stały krok `PHYSICS.fixedDt` (120 Hz) + interpolacja rysowania. Akcje jednorazowe (przedmiot, reset) czekają w `pending` na pierwszy krok fizyki — klatka może nie mieć kroku.
- Układ współrzędnych: heading = 0 patrzy w +Z, forward = (sin h, cos h); normalna toru i `lateral > 0` = w PRAWO od kierowcy; steer +1 = w prawo (zmniejsza heading).
- **Po zmianie rozgrywki/protokołu podbij `GAME_VERSION`** (config.js) — host odrzuca klientów z inną wersją.
- Commity po polsku, z prefiksem etapu/funkcji w tytule.

## Sieć (net/*)

Gwiazda, host autorytatywny. Klient wysyła sterowanie z numerami kroków (`seq`), host zużywa je z kolejki (`createInputQueue`) i w snapshotach (20 Hz) potwierdza ostatni `ack`. Klient przewiduje własny kart i po snapshocie powtarza niepotwierdzone kroki (`clientSim.js`); inne karty interpoluje z opóźnieniem `NET.interpDelaySeconds`. Kolejność kartów w snapshocie = kolejność `race.racers`, więc klient musi zbudować grę z tym samym `humans` i ustawieniami (wiadomość `start`). Wszystko od klientów jest niezaufane — walidacja w `session.js`/`protocol.js`/`lobby.js`.

## Testowanie w przeglądarce — pułapki

- **Cache modułów:** `http.server` nie wysyła nagłówków cache, przeglądarka trzyma stare `src/*.js`, a `?v=` w adresie strony NIE odświeża importów. Przed testem: `fetch('/src/plik.js', {cache: 'reload'})` dla zmienionych plików, potem przeładowanie strony.
- **Multiplayer w jednej karcie:** karta w tle zatrzymuje `requestAnimationFrame`, więc dwie karty nie działają. Klient jako `<iframe src="/?debug&room=KOD">` na stronie hosta — oba widoczne, prawdziwy PeerJS. Sterowanie: `iframe.contentWindow.dispatchEvent(new KeyboardEvent(...))`.
- Autopilot do testów: pętla rAF wysyłająca `KeyW/KeyA/KeyD` w stronę punktu `track.points[(i+8)%n]`.
- `RTCDataChannel.prototype.send` nie da się podmienić (webrtc-adapter w PeerJS łata instancje) — heartbeat jest testowany w Node (`tests/heartbeat.test.js`).
- Błędy `bootstrap-autofill-overlay.js` w konsoli pochodzą z rozszerzenia przeglądarki, nie z gry.
- Dźwięku nie da się odsłuchać — jakość brzmienia ocenia użytkownik; testy sprawdzają tylko model (`engineRpm`).

## Stan (2026-11-01)

Zrobione etapy 1–8 ze specyfikacji (generator torów, fizyka+kamera, okrążenia/HUD, boty, przedmioty, multiplayer PeerJS, przejęcie rozłączonego gracza przez bota, dźwięk/efekty/presety) oraz: nicki nad kartami, tabela pozycji na żywo, tory z wcięciami (płaty — `TRACK.lobeHarmonics`), silnik z biegami.

Znane ograniczenia (świadome, opisane w README): wyjście hosta kończy grę; karta hosta musi być na wierzchu; brak serwera TURN; powracający gracz nie odzyskuje karta.

Otwarte / do potwierdzenia z użytkownikiem:
- czy nowy dźwięk silnika brzmi dobrze (parametry w `AUDIO.engine`);
- ewentualna trwała tablica rekordów (najlepsze czasy na torze) — „leaderboard” zrobiony jako tabela na żywo w wyścigu;
- czy „Średni” tor ma mieć mocniejsze wcięcia (obecnie najwyraźniejsze kształty B/koniczynka na „Trudnym”);
- repo jest tylko lokalne (nie wypchnięte na GitHuba / nie wdrożone).
