// Heartbeat: cisza dłuższa niż NET.heartbeatTimeoutSeconds = rozłączenie.
// (Prawdziwe zegary — test trwa ~heartbeatTimeoutSeconds.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat } from '../src/net/peer.js';
import { NET } from '../src/config.js';

test('heartbeat: pinguje żywych, rozłącza milczących', async () => {
  const now = () => performance.now() / 1000;
  const pings = { alive: 0, silent: 0 };
  const entries = new Map([
    ['alive', { conn: { open: true, send: () => pings.alive++ }, last: now() }],
    ['silent', { conn: { open: true, send: () => pings.silent++ }, last: now() }],
  ]);
  const dropped = [];
  const keepAlive = setInterval(() => { entries.get('alive').last = now(); }, 200); // "żywy" coś wysyła
  const hb = heartbeat(entries, (key) => { dropped.push(key); entries.delete(key); });
  await new Promise((r) => setTimeout(r, (NET.heartbeatTimeoutSeconds + NET.heartbeatSeconds * 1.5) * 1000));
  clearInterval(hb);
  clearInterval(keepAlive);
  assert.deepEqual(dropped, ['silent']);
  assert.ok(pings.alive >= NET.heartbeatTimeoutSeconds);
});
