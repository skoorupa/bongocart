// =====================================================================
// hud.js — nakładka wyścigu: okrążenie, czasy, pozycja, slot przedmiotu,
// odliczanie, komunikaty, ostrzeżenie "pod prąd", tabela wyników.
// Tylko wyświetla stan z race.js — żadnej logiki wyścigu tutaj.
// =====================================================================
import { ITEMS, RACE } from '../config.js';
import { displayLap, estimatedFinish, formatTime, gapToLeader, showWrongWay, standings } from '../race.js';
import { renderTournamentTable } from './tournamentView.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// Ukończony: czas; w trasie: szacunek "~"; bez postępu: "nie ukończył".
function finishLabel(race, r) {
  if (r.finishTime !== null) return formatTime(r.finishTime);
  const est = estimatedFinish(race, r);
  return est === null ? 'nie ukończył' : `~${formatTime(est)}`;
}

// Tabela pozycji na żywo: miejsce, kolor, nick, strata do lidera.
function renderBoard(race, localId) {
  const order = standings(race);
  const rows = order.map((r, i) => {
    const li = document.createElement('li');
    if (r.id === localId) li.className = 'me';
    const pos = Object.assign(document.createElement('span'), { className: 'pos', textContent: `${i + 1}.` });
    const dot = Object.assign(document.createElement('span'), { className: 'dot' });
    dot.style.background = hex(r.color);
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: r.takenOver ? `${r.name} 🤖` : r.name });
    const gap = race.time > 0 ? gapToLeader(race, order, r) : null; // w odliczaniu bez strat
    const g = Object.assign(document.createElement('span'), {
      className: 'gap',
      textContent: r.finishTime !== null && i === 0 ? '🏁' : gap === null ? '' : `+${gap.toFixed(1)}s`,
    });
    li.append(pos, dot, name, g);
    return li;
  });
  document.getElementById('leaderboard').replaceChildren(...rows);
}

export function createHud() {
  const el = {
    root: $('hud'), lap: $('hudLap'), total: $('hudTotal'), lapTime: $('hudLapTime'), best: $('hudBest'),
    pos: $('hudPos'), posOf: $('hudPosOf'), countdown: $('countdown'), banner: $('banner'),
    wrongWay: $('wrongWay'), results: $('results'), resultsBody: $('resultsBody'),
    item: $('itemSlot'),
    board: $('leaderboard'),
  };
  let boardIn = 0;
  let shownIcon = null;
  let bannerLeft = 0;
  let lastCount = null;
  let currentTour = null; // turniej pokazany w wynikach (null = pojedynczy wyścig)
  let resultsLocalId = null;

  // Sekcja turnieju w oknie wyników: tabela, gotowość, przyciski.
  function renderTour() {
    const back = $('backToLobby');
    $('tourneySection').hidden = !currentTour;
    if (!currentTour) {
      back.hidden = false;
      back.textContent = 'Wróć do lobby';
      return;
    }
    const { view, isHost } = currentTour;
    const between = view.phase === 'between';
    const done = view.phase === 'done';
    $('tourneyTitle').textContent = done
      ? `Koniec turnieju — wygrywa ${view.table[0]?.name ?? '?'} 🏆`
      : `Turniej po mapie ${view.index + 1} / ${view.count}`;
    renderTournamentTable($('tourneyBody'), view, { localId: resultsLocalId, showReady: between });
    const ready = $('readyBtn');
    ready.hidden = !between;
    ready.disabled = view.ready.includes(resultsLocalId);
    ready.textContent = ready.disabled ? '✓ Gotowy — czekamy na resztę' : '✓ Gotowy';
    ready.onclick = () => currentTour?.onReady();
    const force = $('forceStart');
    force.hidden = !(between && isHost);
    force.onclick = () => currentTour?.onForce();
    // Host przerywa turniej (wszyscy do lobby); klient może opuścić pokój.
    back.hidden = false;
    back.textContent = done ? 'Wróć do lobby' : isHost ? 'Przerwij turniej' : 'Opuść pokój';
  }

  function banner(text, seconds = RACE.bannerSeconds, kind = '') {
    el.banner.textContent = text;
    el.banner.dataset.kind = kind;
    el.banner.hidden = false;
    // Restart animacji pojawienia się.
    el.banner.classList.remove('pop');
    void el.banner.offsetWidth;
    el.banner.classList.add('pop');
    bannerLeft = seconds;
  }

  return {
    // Brak wyścigu (lobby) — chowamy elementy wyścigowe.
    setRaceVisible(v) {
      el.root.dataset.race = v ? 'on' : 'off';
      if (!v) {
        el.countdown.hidden = true;
        el.banner.hidden = true;
        el.wrongWay.hidden = true;
        lastCount = null;
      }
    },

    // Zdarzenia z updateRace dotyczące gracza lokalnego.
    handleEvents(events, localId, race) {
      for (const e of events) {
        if (e.type === 'go') {
          el.countdown.textContent = 'START!';
          el.countdown.dataset.go = '1';
        }
        if (e.type === 'takeover') banner(`${e.name} rozłączył(a) się — jedzie bot`, RACE.bannerSeconds);
        if (e.id !== localId) continue;
        if (e.type === 'finalLap') banner('OSTATNIE OKRĄŻENIE!', RACE.bannerSeconds, 'final');
        if (e.type === 'lap' && e.lap < race.laps) banner(`Okrążenie ${formatTime(e.time)}${e.best ? ' · najlepsze!' : ''}`);
        if (e.type === 'finish') banner(`META! ${e.place}. miejsce`, RACE.resultsDelaySeconds + 1, 'finish');
        if (e.type === 'hit') banner(e.what === 'rocket' ? 'Trafiony pociskiem!' : 'Poślizg na bananie!', RACE.hitBannerSeconds, 'hit');
        if (e.type === 'blocked') banner('Tarcza ochroniła!', RACE.hitBannerSeconds);
      }
    },

    update(race, localId, dt, items) {
      boardIn -= dt;
      if (boardIn <= 0) {
        boardIn = RACE.leaderboardRefreshSeconds;
        renderBoard(race, localId);
      }
      const me = race.racers.find((r) => r.id === localId);
      const order = standings(race);
      const place = order.indexOf(me) + 1;

      el.lap.textContent = `${displayLap(race, me)}/${race.laps}`;
      const running = me.finishTime === null;
      el.total.textContent = formatTime(running ? Math.max(0, race.time) : me.finishTime);
      el.lapTime.textContent = running ? formatTime(Math.max(0, race.time - me.lapStartTime)) : '—';
      el.best.textContent = formatTime(me.bestLap);
      el.pos.textContent = place;
      el.posOf.textContent = `/${race.racers.length}`;

      // Odliczanie 3-2-1, potem "START!" przez chwilę.
      if (race.time < 0) {
        const n = Math.ceil(-race.time);
        if (n !== lastCount) {
          lastCount = n;
          el.countdown.textContent = n;
          el.countdown.dataset.go = '';
          el.countdown.classList.remove('pop');
          void el.countdown.offsetWidth;
          el.countdown.classList.add('pop');
        }
        el.countdown.hidden = false;
      } else {
        el.countdown.hidden = race.time > RACE.goBannerSeconds;
      }

      if (bannerLeft > 0) {
        bannerLeft -= dt;
        if (bannerLeft <= 0) el.banner.hidden = true;
      }
      el.wrongWay.hidden = !(running && race.phase === 'racing' && showWrongWay(me));

      // Slot przedmiotu: w ruletce ikony się przewijają, potem stała ikona.
      const slot = items.slots.get(localId);
      let icon = '';
      if (slot.item && slot.roll > 0) {
        const k = Math.floor(slot.roll / ITEMS.rollIconSeconds) % items.enabled.length;
        icon = ITEMS.types[items.enabled[k]].icon;
      } else if (slot.item) icon = ITEMS.types[slot.item].icon;
      if (icon !== shownIcon) {
        shownIcon = icon;
        el.item.textContent = icon;
        el.item.dataset.state = slot.item ? (slot.roll > 0 ? 'rolling' : 'ready') : 'empty';
      }
    },

    // tour (turniej, opcjonalnie): {view, isHost, onReady(), onForce(), onQuit()}.
    showResults(race, localId, onBack, tour = null) {
      currentTour = tour;
      resultsLocalId = localId;
      $('resultsTitle').textContent = tour ? `Mapa ${tour.view.index + 1} / ${tour.view.count} — wyniki` : 'Wyniki';
      el.resultsBody.replaceChildren(...standings(race).map((r, i) => {
        const tr = document.createElement('tr');
        if (r.id === localId) tr.className = 'me';
        const cells = [
          `${i + 1}.`,
          r.takenOver ? `${r.name} 🤖` : r.name,
          finishLabel(race, r),
          formatTime(r.bestLap),
        ];
        cells.forEach((text, c) => {
          const td = document.createElement('td');
          if (c === 1) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.style.background = hex(r.color);
            td.append(dot);
          }
          td.append(text);
          tr.append(td);
        });
        return tr;
      }));
      el.results.hidden = false;
      const btn = $('backToLobby');
      btn.onclick = () => { el.results.hidden = true; (currentTour ? currentTour.onQuit : onBack)(); };
      renderTour();
      (tour?.view.phase === 'between' ? $('readyBtn') : btn).focus();
    },
    hideResults() {
      el.results.hidden = true;
      currentTour = null;
    },
    // Nowy widok turnieju (gotowość, tabela) przy otwartych wynikach.
    updateTournament(view) {
      if (!currentTour) return;
      currentTour.view = view;
      renderTour();
    },
    showTabBoard(view, localId) {
      $('tabBoardTitle').textContent = `Turniej — mapa ${view.index + 1} / ${view.count}`;
      renderTournamentTable($('tabBoardBody'), view, { localId, showReady: false });
      $('tabBoard').hidden = false;
    },
    hideTabBoard() { $('tabBoard').hidden = true; },
  };
}
