// =====================================================================
// net/clientSim.js — gra po stronie klienta.
//
//  - Własny kart: predykcja. Klient od razu liczy swój ruch tym samym
//    modelem jazdy, numeruje kroki (seq) i wysyła sterowanie hostowi.
//    Gdy przyjdzie stan od hosta, przyjmuje go i powtarza kroki, których
//    host jeszcze nie potwierdził. Różnicę pozycji wygładza wizualnie.
//  - Inne karty: interpolacja między stanami hosta, z małym opóźnieniem.
//  - Przebieg wyścigu i przedmioty: wprost od hosta.
// =====================================================================
import { NET, PHYSICS } from '../config.js';
import { stepKart } from '../physics.js';
import { applyKart, applyRaceAndItems, encodeInput } from './protocol.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export function createClientSim(game, localId) {
  const { race, track, stats } = game;
  const me = race.racers.find((r) => r.id === localId);
  const own = game.karts.get(localId);
  const buffer = []; // [{ht, karts: [tablice stanu w kolejności race.racers]}]
  let renderTime = null;
  let seq = 0;
  let history = []; // [{seq, input}] niepotwierdzone przez hosta
  let outgoing = [];
  let outgoingFrom = 1;
  const correction = { x: 0, z: 0 };

  const predicting = () => race.phase === 'racing' && me.finishTime === null;

  return {
    predicting,

    // Jeden krok fizyki (PHYSICS.fixedDt) własnego karta — tylko w jeździe.
    stepLocal(input) {
      if (!predicting()) return;
      seq++;
      history.push({ seq, input });
      if (history.length > NET.inputHistoryMax) history.shift();
      if (!outgoing.length) outgoingFrom = seq;
      outgoing.push(encodeInput(input));
      stepKart(own, input, track, stats, PHYSICS.fixedDt);
    },

    // Wiadomość ze sterowaniem do wysłania (raz na klatkę) albo null.
    takeOutgoing() {
      if (!outgoing.length) return null;
      const msg = { t: 'input', from: outgoingFrom, list: outgoing };
      outgoing = [];
      return msg;
    },

    // Stan od hosta. Zwraca zdarzenia wyścigu (HUD).
    onSnapshot(snap) {
      applyRaceAndItems(game, snap);
      buffer.push({ ht: snap.ht, karts: snap.karts });
      while (buffer.length > 2 && buffer[0].ht < snap.ht - NET.snapshotBufferSeconds) buffer.shift();

      // Zegar interpolacji: goni (czas hosta − opóźnienie).
      const target = snap.ht - NET.interpDelaySeconds;
      if (renderTime === null || Math.abs(renderTime - target) > NET.interpResyncSeconds) renderTime = target;
      else renderTime += (target - renderTime) * NET.interpCorrection;

      if (predicting()) {
        const bx = own.x, bz = own.z;
        applyKart(own, snap.karts[race.racers.indexOf(me)]);
        const ack = snap.acks?.[localId] ?? 0;
        history = history.filter((h) => h.seq > ack);
        for (const h of history) stepKart(own, h.input, track, stats, PHYSICS.fixedDt);
        correction.x += bx - own.x;
        correction.z += bz - own.z;
        if (Math.hypot(correction.x, correction.z) > NET.correctionTeleport) correction.x = correction.z = 0;
      } else {
        history = [];
        outgoing = [];
      }
      return snap.events ?? [];
    },

    // Raz na klatkę: interpolowane pozycje innych kartów (i własnego, gdy
    // nie jedzie sam — odliczanie, po mecie).
    updateRemote(dt) {
      if (renderTime === null || !buffer.length) return;
      renderTime += dt;
      if (race.phase !== 'finished') race.time += dt; // płynny zegar w HUD między stanami
      let a = buffer[0], b = buffer[buffer.length - 1];
      for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i].ht <= renderTime && buffer[i + 1].ht >= renderTime) { a = buffer[i]; b = buffer[i + 1]; break; }
      }
      const t = b.ht > a.ht ? Math.min(1, Math.max(0, (renderTime - a.ht) / (b.ht - a.ht))) : 1;
      const skipOwn = predicting();
      race.racers.forEach((r, i) => {
        if (skipOwn && r.id === localId) return;
        const k = game.karts.get(r.id);
        applyKart(k, b.karts[i]);
        k.x = lerp(a.karts[i][0], b.karts[i][0], t);
        k.z = lerp(a.karts[i][1], b.karts[i][1], t);
        k.heading = lerpAngle(a.karts[i][2], b.karts[i][2], t);
      });
    },

    // Wizualne przesunięcie własnego karta (zanikająca korekta).
    ownOffset(dt) {
      const f = Math.exp(-NET.correctionDecay * dt);
      correction.x *= f;
      correction.z *= f;
      return correction;
    },
  };
}
