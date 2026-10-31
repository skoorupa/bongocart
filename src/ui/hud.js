// =====================================================================
// hud.js — nakładka wyścigu: okrążenie, czasy, pozycja, slot przedmiotu,
// odliczanie, komunikaty, ostrzeżenie "pod prąd", tabela wyników.
// Tylko wyświetla stan z race.js — żadnej logiki wyścigu tutaj.
// =====================================================================
import { ITEMS, RACE } from '../config.js';
import { displayLap, estimatedFinish, formatTime, showWrongWay, standings } from '../race.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// Ukończony: czas; w trasie: szacunek "~"; bez postępu: "nie ukończył".
function finishLabel(race, r) {
  if (r.finishTime !== null) return formatTime(r.finishTime);
  const est = estimatedFinish(race, r);
  return est === null ? 'nie ukończył' : `~${formatTime(est)}`;
}

export function createHud() {
  const el = {
    root: $('hud'), lap: $('hudLap'), total: $('hudTotal'), lapTime: $('hudLapTime'), best: $('hudBest'),
    pos: $('hudPos'), posOf: $('hudPosOf'), countdown: $('countdown'), banner: $('banner'),
    wrongWay: $('wrongWay'), results: $('results'), resultsBody: $('resultsBody'),
    item: $('itemSlot'),
  };
  let shownIcon = null;
  let bannerLeft = 0;
  let lastCount = null;

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
        if (e.id !== localId) continue;
        if (e.type === 'finalLap') banner('OSTATNIE OKRĄŻENIE!', RACE.bannerSeconds, 'final');
        if (e.type === 'lap' && e.lap < race.laps) banner(`Okrążenie ${formatTime(e.time)}${e.best ? ' · najlepsze!' : ''}`);
        if (e.type === 'finish') banner(`META! ${e.place}. miejsce`, RACE.resultsDelaySeconds + 1, 'finish');
        if (e.type === 'hit') banner(e.what === 'rocket' ? 'Trafiony pociskiem!' : 'Poślizg na bananie!', RACE.hitBannerSeconds, 'hit');
        if (e.type === 'blocked') banner('Tarcza ochroniła!', RACE.hitBannerSeconds);
      }
    },

    update(race, localId, dt, items) {
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

    showResults(race, localId, onBack) {
      el.resultsBody.replaceChildren(...standings(race).map((r, i) => {
        const tr = document.createElement('tr');
        if (r.id === localId) tr.className = 'me';
        const cells = [
          `${i + 1}.`,
          r.name,
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
      btn.onclick = () => { el.results.hidden = true; onBack(); };
      btn.focus();
    },
    hideResults() { el.results.hidden = true; },
  };
}
