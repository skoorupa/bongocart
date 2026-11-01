// Model obrotów silnika (dźwięk): biegi, spadek przy zmianie, gaz w miejscu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRpm } from '../src/audio.js';
import { AUDIO } from '../src/config.js';

test('obroty: rosną w biegu, spadają przy zmianie biegu, zawsze 0..1', () => {
  const g = AUDIO.engine.gears;
  const eps = 1e-3;
  for (let k = 1; k < g; k++) {
    const shift = k / g;
    assert.ok(engineRpm(shift - eps, 0, false) > engineRpm(shift + eps, 0, false) + 0.3, `bieg ${k}`);
  }
  for (let f = 0; f <= 1.2; f += 0.01) {
    const r = engineRpm(f, 1, true);
    assert.ok(r >= 0 && r <= 1, `f=${f} rpm=${r}`);
  }
  assert.ok(engineRpm(0.1, 0, false) < engineRpm(0.2, 0, false)); // w biegu rośnie
});

test('gaz w miejscu kręci silnik; turbo podbija obroty', () => {
  assert.equal(engineRpm(0, 0, false), 0);
  assert.ok(engineRpm(0, 1, false) >= AUDIO.engine.revInPlace - 1e-9);
  assert.ok(engineRpm(0.6, 1, true) > engineRpm(0.6, 1, false));
});
