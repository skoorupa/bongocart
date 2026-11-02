# BongoCart

Przeglądarkowe wyścigi kartingowe dla 2–8 znajomych (plus boty). Three.js, czysty JavaScript (moduły ES, bez bundlera), multiplayer przez WebRTC (PeerJS). Wszystko generowane proceduralnie: tory z seeda, modele, dźwięki.

## Uruchomienie lokalne

Moduły ES wymagają serwera HTTP (nie `file://`):

```sh
python -m http.server 8080
# albo: npx serve .
```

Potem otwórz http://localhost:8080. Testy (Node 20+): `npm test`.

## Wdrożenie (hosting statyczny)

Wystarczy wrzucić cały katalog — nie ma kroku budowania.

- **GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main`, folder `/ (root)`.
- **Netlify:** przeciągnij folder na app.netlify.com/drop albo podłącz repo (build command pusty, publish directory `.`).

Po zmianie gry podbij `GAME_VERSION` w `src/config.js` — gracz ze starą wersją z pamięci przeglądarki nie dołączy do pokoju i dostanie prośbę o odświeżenie (Ctrl+Shift+R).

## Jak grać ze znajomymi

1. Wpisz imię, wybierz kolor.
2. **Utwórz pokój** → dostaniesz kod (np. `DH6P4`) i link do skopiowania.
3. Znajomi otwierają link albo wpisują kod → **Dołącz**.
4. Host wybiera ustawienia (albo preset: Standard / Chaos / Czysty wyścig) i klika **Start**.

Na torze mogą stać przeszkody (ustawienie „Przeszkody na torze”: Brak / Mało / Dużo): grupy słupków na środku jezdni (slalom albo rządek; uderzenie zabiera ok. 30% prędkości, kart prześlizguje się obok) — oraz szerokie progi zwalniające (ok. 70% szerokości toru, z wolnym pasem z boku) (−15% przy szybkiej jeździe). Zawsze zostaje szeroki wolny przejazd.

## Przedmioty, olej i monety

Skrzynki dają losowy przedmiot (prowadzący częściej obronę, ostatni — atak):

| Przedmiot | Działanie |
|---|---|
| 🚀 Pocisk | leci do kierowcy przed Tobą, trafiony się obraca (zasięg 220 m / 5 s) |
| 🍌 Banan | zostaje za kartem; kto wjedzie, ten się obraca (znika po 45 s) |
| ⚡ Turbo | chwilowe przyspieszenie |
| 🛡️ Tarcza | blokuje jedno trafienie (8 s) |
| 👢 But | rzut prosto przed siebie (35 m) — kto oberwie, dostaje kopniaka w bok i ślizga się |
| 🔧 Zepsute koła | leci do kierowcy przed Tobą (160 m); trafiony przez 4 s ma gaz do dechy i nie może hamować |

**Plamy oleju** (ustawienie „Przeszkody na torze”) — kto w nie wjedzie, przez chwilę ma poślizg i słabszy skręt. Obok plamy zawsze jest wolny przejazd.

**Monety** (ustawienie „Monety na torze”) — rzędy złotych monet. Zebrana moneta znika na 1 s; tę samą monetę można wziąć raz na okrążenie (już zebrane widać półprzezroczyste). Licznik w HUD: zebrane / możliwe. W turnieju monety dają premię proporcjonalną: komplet = +6 pkt, połowa = +3 pkt — ostatni nie przeskoczy czołówki samymi monetami.

## Turniej

W lobby ustaw **Tryb gry: Turniej** i **Liczbę map** (domyślnie 10; okrążenia z ustawienia „Liczba okrążeń”, domyślnie 5).
Tory turnieju generują się z seeda (ten sam seed = te same mapy). Za miejsce na każdej mapie są punkty
15-12-10-8-6-4-2-1 plus premia za monety (do +6); przy remisie wygrywa mniejszy łączny czas (kto nie dojechał, dostaje czas trwania wyścigu).
Po każdej mapie widać wyniki mapy (punkty za miejsce, za monety i sumę) oraz tabelę turnieju z punktami i czasem z każdej mapy; każdy klika **Gotowy**, a host może **Start mimo wszystko**.
W turnieju wyścig trwa, aż dojadą wszyscy (także boty; limit 30 s od pierwszego na mecie). W trakcie wyścigu tabela jest pod klawiszem **Tab**. Gracz, który wyjdzie, zostaje w tabeli — dalej jedzie za niego bot.

## Sterowanie

| Klawisz | Gamepad | Akcja |
|---|---|---|
| W / ↑ | RT, A | gaz |
| S / ↓ | LT, B | hamulec / wsteczny |
| A D / ← → | lewa gałka | skręt |
| Spacja | RB | dryf (mini-turbo: niebieskie, potem pomarańczowe iskry) |
| Shift / E | LB, X | przedmiot |
| C | Y | widok do tyłu |
| R | — | powrót na tor |
| M | — | dźwięk wł./wył. |
| Esc | Start | menu (solo: pauza) |
| Tab (trzymany) | — | tabela turnieju (w trybie turnieju) |
| ← / → (A / D) po mecie | — | zmiana oglądanego zawodnika (po mecie kart znika z toru) |

## Architektura

| Plik | Rola |
|---|---|
| `src/config.js` | wszystkie stałe i schemat ustawień lobby (UI i walidacja generują się z niego) |
| `src/track/generator.js` | deterministyczny generator toru z seeda (mulberry32) |
| `src/physics.js` | arcade'owy model jazdy (stały krok 120 Hz) |
| `src/race.js` | okrążenia, checkpointy, kolejność, meta |
| `src/ai.js` | kierowca AI (boty, gracz po mecie, rozłączony gracz) |
| `src/items.js` | skrzynki i przedmioty |
| `src/track/obstacleMesh.js` | wygląd przeszkód (słupki, progi); rozmieszczenie w generatorze, kolizje w fizyce |
| `src/game.js` | symulacja całego wyścigu (liczy ją host) |
| `src/tournament.js` | turniej: mapy, punkty, gotowość (stan trzyma host/solo) |
| `src/net/*` | lobby, protokół, predykcja klienta, transport PeerJS |
| `src/main.js` | wejście, rysowanie, UI |

Sieć: gwiazda z hostem jako autorytetem. Klienci wysyłają sterowanie (numerowane kroki), host liczy grę i 20× na sekundę rozsyła stan. Klient od razu przewiduje własny kart i po każdym stanie od hosta powtarza niepotwierdzone kroki; pozostałe karty interpoluje z opóźnieniem 0,1 s.

## Znane ograniczenia

- **Wyjście hosta kończy grę** u wszystkich (brak migracji hosta).
- Host powinien mieć kartę gry **na wierzchu** — przeglądarka zatrzymuje animację w tle, a z nią symulację.
- Połączenia zestawia publiczny serwer sygnalizacji PeerJS; w bardzo restrykcyjnych sieciach (podwójny NAT, firmowe firewalle) może być potrzebny serwer TURN (nieskonfigurowany).
- Gracz, który wróci w trakcie wyścigu, nie odzyskuje karta (jedzie nim bot) — dołącza do następnego wyścigu.
- Różne silniki JS mogą minimalnie inaczej liczyć tor; klient dostaje wtedy ostrzeżenie.
