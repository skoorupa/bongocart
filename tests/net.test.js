// Testy sieci na sztucznym łączu (opóźnienie + serializacja JSON jak w PeerJS):
// lobby, start wyścigu, predykcja klienta, interpolacja, potwierdzenia sterowania.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostSession, createClientSession } from '../src/net/session.js';
import { createClientSim } from '../src/net/clientSim.js';
import { createInputQueue, encodeInput, decodeInput } from '../src/net/protocol.js';
import { sanitizeName, HOST_ID } from '../src/net/lobby.js';
import { createGame } from '../src/game.js';
import { generateTrack, trackParamsFromSettings } from '../src/track/generator.js';
import { defaultSettings } from '../src/settings.js';
import { PHYSICS, MAX_RACERS, KART_COLORS, NET } from '../src/config.js';

const DT = PHYSICS.fixedDt;

// Sieć: wiadomości dochodzą po `latency` sekundach, w kolejności, jako kopia JSON.
function createNet(latency) {
  let now = 0;
  const inflight = [];
  return {
    send(deliver, msg) { inflight.push({ at: now + latency, deliver, data: JSON.stringify(msg) }); },
    advance(dt) {
      // Małymi krokami, żeby odpowiedzi wysłane w trakcie też dochodziły.
      for (let left = dt; left > 1e-9; left -= DT) {
        now += Math.min(DT, left);
        while (inflight.length && inflight[0].at <= now + 1e-9) {
          const m = inflight.shift();
          m.deliver(JSON.parse(m.data));
        }
      }
    },
  };
}

// Host + klienci połączeni sztuczną siecią.
function setupRoom({ clients = 1, latency = 0.04, settings = {} } = {}) {
  const net = createNet(latency);
  const room = { settings: { ...defaultSettings(), ...settings }, seed: 'netseed' };
  const peers = new Map(); // peerId -> klient
  const toClient = (peer, msg) => net.send((m) => peers.get(peer)?.session.handleMessage(m), msg);
  const host = createHostSession({
    profile: { name: 'Gospodarz', color: KART_COLORS[0] },
    room,
    send: toClient,
    broadcast: (msg) => { for (const peer of peers.keys()) toClient(peer, msg); },
    disconnect: (peer) => { peers.get(peer).closed = true; },
  });
  const list = [];
  for (let i = 0; i < clients; i++) {
    const peer = `peer${i}`;
    const c = { peer, id: null, inbox: [], closed: false };
    c.session = createClientSession({
      send: (msg) => net.send((m) => host.handleMessage(peer, m), msg),
      profile: { name: `Klient ${i}`, color: KART_COLORS[0] }, // ten sam kolor co host — host musi zmienić
      on: {
        welcome: (m) => { c.id = m.id; },
        lobby: (m) => { c.lobby = m; },
        start: (m) => c.inbox.push(m),
        snapshot: (m) => c.inbox.push(m),
        reject: (m) => { c.rejected = m.reason; },
      },
    });
    peers.set(peer, c);
    c.session.handleOpen();
    list.push(c);
  }
  net.advance(latency * 3);
  return { net, host, clients: list, room };
}

// Kierowca testowy: wzdłuż linii środkowej.
const follow = (k, track) => {
  const i = Math.round(k.trackS / track.step) % track.points.length;
  const p = track.points[(i + 8) % track.points.length];
  const want = Math.atan2(p.x - k.x, p.z - k.z);
  const err = Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading));
  return { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -err * 3)), drift: false, item: false, reset: false };
};

// Pętla wyścigu: host liczy grę, klienci przewidują i interpolują.
// hooks.beforeSnapshot(c, snap) — podgląd stanu przed wczytaniem u klienta.
function runRace(env, { seconds, hooks = {} }) {
  const { net, host, clients, room } = env;
  const humans = host.lobby.players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
  const start = { settings: room.settings, seed: room.seed, gameSeed: 'g', humans };
  const game = createGame({ track: generateTrack(trackParamsFromSettings(room.settings, room.seed)), settings: room.settings, humans, seed: start.gameSeed });
  host.startRace(start);
  let tick = 0;
  const pending = [];
  for (let step = 0; step < seconds / DT; step++) {
    for (const c of clients) {
      for (const m of c.inbox.splice(0)) {
        if (m.t === 'start') {
          const track = generateTrack(trackParamsFromSettings(m.settings, m.seed));
          c.game = createGame({ track, settings: m.settings, humans: m.humans, seed: m.gameSeed });
          c.sim = createClientSim(c.game, c.id);
        } else if (m.t === 'snap' && c.sim) {
          hooks.beforeSnapshot?.(c, m);
          c.sim.onSnapshot(m);
        }
      }
      if (!c.sim) continue;
      c.sim.stepLocal(follow(c.game.karts.get(c.id), c.game.track));
      hooks.afterLocalStep?.(c);
      c.session.sendInput(c.sim.takeOutgoing());
      c.sim.updateRemote(DT);
    }
    const events = game.step(DT, host.remoteInputs(game, new Map()));
    pending.push(...events);
    if (++tick % NET.snapshotEverySteps === 0) host.sendSnapshot(game, tick * DT, pending.splice(0));
    hooks.afterHostStep?.(game);
    net.advance(DT);
  }
  return game;
}

test('lobby: dołączenie, poprawka koloru, pełny pokój, wyjście', () => {
  const env = setupRoom({ clients: MAX_RACERS });
  const { host, clients } = env;
  assert.equal(host.lobby.players.length, MAX_RACERS);
  assert.equal(new Set(host.lobby.players.map((p) => p.color)).size, MAX_RACERS);
  assert.ok(clients.slice(0, MAX_RACERS - 1).every((c) => c.id && !c.rejected));
  const last = clients[MAX_RACERS - 1];
  assert.equal(last.rejected, 'full');
  assert.ok(last.closed);
  assert.equal(clients[0].lobby.lobby.players.length, MAX_RACERS);

  host.handleLeave('peer0');
  env.net.advance(0.2);
  assert.equal(host.lobby.players.length, MAX_RACERS - 1);
  assert.ok(!clients[1].lobby.lobby.players.some((p) => p.id === clients[0].id));
  assert.equal(host.lobby.players[0].id, HOST_ID);
});

test('klient zmienia tylko swój profil; ustawień nie może ruszyć', () => {
  const env = setupRoom({ clients: 1 });
  const c = env.clients[0];
  c.session.setProfile({ name: 'Nowe', color: KART_COLORS[3] });
  env.host.handleMessage('peer0', { t: 'settings', settings: { laps: 15 } }); // nie ma takiej wiadomości
  env.net.advance(0.2);
  const me = env.host.lobby.players.find((p) => p.id === c.id);
  assert.deepEqual([me.name, me.color], ['Nowe', KART_COLORS[3]]);
  assert.equal(c.lobby.room.settings.laps, defaultSettings().laps);
});

test('nazwy: bez znaków sterujących, przycięte, puste -> zastępcze', () => {
  assert.equal(sanitizeName('  Ala\u0007 ', 'x'), 'Ala');
  assert.equal(sanitizeName('a'.repeat(50), 'x').length, NET.nameMaxLength);
  assert.equal(sanitizeName('   ', 'Gracz 2'), 'Gracz 2');
  assert.equal(sanitizeName(42, 'Gracz 2'), 'Gracz 2');
});

test('sterowanie od klienta jest przycinane; śmieci = neutralne', () => {
  assert.deepEqual(decodeInput([5, -3, 9, 1, 0, 'x']), { throttle: 1, brake: 0, steer: 1, drift: true, item: false, reset: false });
  assert.equal(decodeInput('zło').throttle, 0);
  assert.equal(decodeInput([NaN, Infinity]).throttle, 0);
});

test('kolejka sterowania: bufor startowy, potwierdzenia, duplikaty, przepełnienie', () => {
  const q = createInputQueue();
  const gas = encodeInput({ throttle: 1, brake: 0, steer: 0, drift: false, item: false, reset: false });
  q.push({ from: 1, list: [gas] });
  assert.equal(q.next().throttle, 0); // czeka na inputBufferMin
  q.push({ from: 1, list: [gas, gas, gas] }); // seq 1 to duplikat
  assert.equal(q.next().throttle, 1);
  assert.equal(q.ack, 1);
  q.next(); q.next();
  assert.equal(q.ack, 3);
  assert.equal(q.next().throttle, 1); // pusto: powtarza ostatnie
  assert.equal(q.ack, 3);
  const item = encodeInput({ throttle: 1, brake: 0, steer: 0, drift: false, item: true, reset: false });
  q.push({ from: 4, list: [item, ...Array(NET.inputBufferMax + 5).fill(gas)] });
  assert.ok(q.next().item); // jednorazowa akcja przetrwała wyrzucenie
});

test('predykcja klienta = stan u hosta dla potwierdzonego kroku (bez kolizji)', () => {
  const env = setupRoom({ clients: 1, latency: 0.05, settings: { minRacers: 1, kartCollisions: false, itemFrequency: 'none' } });
  const c = env.clients[0];
  const predicted = new Map(); // seq -> [x, z]
  let seq = 0, maxErr = 0, compared = 0;
  runRace(env, {
    seconds: 15,
    hooks: {
      afterLocalStep(cl) {
        if (!cl.sim.predicting()) return;
        const k = cl.game.karts.get(cl.id);
        predicted.set(++seq, [k.x, k.z]);
      },
      beforeSnapshot(cl, snap) {
        const p = predicted.get(snap.acks[cl.id]);
        if (!p) return;
        const s = snap.karts[snap.racers.length - 1]; // klient jest ostatni w składzie
        maxErr = Math.max(maxErr, Math.hypot(p[0] - s[0], p[1] - s[1]));
        compared++;
      },
    },
  });
  assert.ok(compared > 100, `porównań: ${compared}`);
  assert.ok(maxErr < 0.05, `maks. rozjazd ${maxErr} m`);
});

test('pełny wyścig przez sieć: klient dojeżdża, inne karty interpolowane blisko hosta', () => {
  const env = setupRoom({ clients: 2, latency: 0.04, settings: { minRacers: 4, laps: 1 } });
  const [c1] = env.clients;
  let maxGap = 0;
  const game = runRace(env, {
    seconds: 75,
    hooks: {
      afterHostStep(g) {
        if (!c1.game || g.race.phase !== 'racing') return;
        const bot = g.karts.get('bot0'), seen = c1.game.karts.get('bot0');
        maxGap = Math.max(maxGap, Math.hypot(bot.x - seen.x, bot.z - seen.z));
      },
    },
  });
  for (const c of env.clients) {
    assert.notEqual(game.race.racers.find((r) => r.id === c.id).finishTime, null, `${c.id} u hosta`);
    assert.notEqual(c.game.race.racers.find((r) => r.id === c.id).finishTime, null, `${c.id} u siebie`);
  }
  // Opóźnienie widoku = łącze + bufor interpolacji + odstęp stanów; przy ~37 m/s to kilka metrów.
  const lag = 0.04 + NET.interpDelaySeconds + NET.snapshotEverySteps * DT;
  assert.ok(maxGap < 40 * lag + 1, `rozjazd bota ${maxGap} m`);
});
