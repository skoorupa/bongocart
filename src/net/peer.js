// =====================================================================
// net/peer.js — transport PeerJS (WebRTC DataChannel, serializacja JSON).
// Host ma stałe id = NET.peerPrefix + kod pokoju; klienci łączą się
// do niego (gwiazda). Rozłączenie wykrywamy z close/error PeerJS ORAZ
// heartbeatem: brak jakiejkolwiek wiadomości przez
// NET.heartbeatTimeoutSeconds = rozłączenie (np. zamknięta karta,
// zerwany internet — WebRTC potrafi o tym "nie wiedzieć" długo).
//
// PeerJS (globalne `Peer`) ładuje index.html. Sygnalizacja: publiczny
// serwer PeerJS (0.peerjs.com) — po zestawieniu połączenia dane idą
// bezpośrednio między przeglądarkami.
// =====================================================================
import { NET } from '../config.js';

const PING = { t: 'ping' };
const now = () => performance.now() / 1000;

export function randomRoomCode() {
  let code = '';
  for (let i = 0; i < NET.codeLength; i++) code += NET.codeAlphabet[Math.floor(Math.random() * NET.codeAlphabet.length)];
  return code;
}

export const normalizeRoomCode = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NET.codeLength);

// Heartbeat dla zbioru połączeń {klucz: {conn, last}}: ping + wykrywanie
// ciszy. Zwraca id interwału (clearInterval).
export function heartbeat(entries, onTimeout) {
  return setInterval(() => {
    const t = now();
    for (const [key, e] of entries) {
      if (t - e.last > NET.heartbeatTimeoutSeconds) onTimeout(key);
      else if (e.conn.open) e.conn.send(PING);
    }
  }, NET.heartbeatSeconds * 1000);
}

// Host. handlers: onReady(code), onJoin(peerId), onLeave(peerId),
// onMessage(peerId, msg), onError(text).
export function hostRoom(handlers) {
  const conns = new Map(); // peerId -> {conn, last}
  let peer = null;
  let closed = false;

  const leave = (id) => {
    const e = conns.get(id);
    if (!e) return;
    conns.delete(id);
    e.conn.close();
    handlers.onLeave(id);
  };

  function open(code) {
    peer = new Peer(NET.peerPrefix + code);
    peer.on('open', () => handlers.onReady(code));
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conns.set(conn.peer, { conn, last: now() });
        handlers.onJoin(conn.peer);
      });
      conn.on('data', (msg) => {
        const e = conns.get(conn.peer);
        if (!e) return;
        e.last = now();
        if (msg?.t !== 'ping') handlers.onMessage(conn.peer, msg);
      });
      conn.on('close', () => leave(conn.peer));
      conn.on('error', () => leave(conn.peer));
    });
    // Utrata serwera sygnalizacji: istniejące połączenia działają dalej,
    // wracamy, żeby dało się dołączać.
    peer.on('disconnected', () => { if (!closed) peer.reconnect(); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        open(randomRoomCode()); // kod zajęty — losujemy inny
      } else if (err.type !== 'peer-unavailable') handlers.onError(err.type);
    });
  }
  open(randomRoomCode());
  const hb = heartbeat(conns, leave);

  return {
    send(id, msg) { const e = conns.get(id); if (e?.conn.open) e.conn.send(msg); },
    broadcast(msg) { for (const e of conns.values()) if (e.conn.open) e.conn.send(msg); },
    disconnect(id) { setTimeout(() => leave(id), 200); }, // chwila na doręczenie powodu
    close() {
      closed = true;
      clearInterval(hb);
      for (const id of [...conns.keys()]) leave(id);
      peer?.destroy();
    },
  };
}

// Klient. handlers: onOpen(), onMessage(msg), onClose(reason)
// reason: 'notfound' | 'timeout' | 'closed' | 'error'.
export function joinRoom(code, handlers) {
  const peer = new Peer();
  const entries = new Map();
  let done = false;

  const finish = (reason) => {
    if (done) return;
    done = true;
    clearInterval(hb);
    clearTimeout(connectTimer);
    peer.destroy();
    handlers.onClose(reason);
  };

  const connectTimer = setTimeout(() => finish('timeout'), NET.connectTimeoutSeconds * 1000);
  peer.on('open', () => {
    const conn = peer.connect(NET.peerPrefix + code, { serialization: 'json', reliable: true });
    conn.on('open', () => {
      clearTimeout(connectTimer);
      entries.set('host', { conn, last: now() });
      handlers.onOpen();
    });
    conn.on('data', (msg) => {
      const e = entries.get('host');
      if (e) e.last = now();
      if (msg?.t !== 'ping') handlers.onMessage(msg);
    });
    conn.on('close', () => finish('closed'));
    conn.on('error', () => finish('error'));
  });
  peer.on('error', (err) => finish(err.type === 'peer-unavailable' ? 'notfound' : 'error'));
  const hb = heartbeat(entries, () => finish('timeout'));

  return {
    send(msg) { const e = entries.get('host'); if (e?.conn.open) e.conn.send(msg); },
    close() { finish('closed'); },
  };
}
