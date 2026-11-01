// Testy walidacji ustawień względem schematu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, applySettingChange, sanitizeSettings, randomSeed } from '../src/settings.js';
import { SETTINGS_SCHEMA } from '../src/config.js';

test('domyślnie 5 okrążeń i wszystkie klucze schematu', () => {
  const s = defaultSettings();
  assert.equal(s.laps, 5);
  assert.deepEqual(Object.keys(s), SETTINGS_SCHEMA.map((e) => e.key));
});

test('domyślne wartości przechodzą własną walidację', () => {
  const s = defaultSettings();
  for (const e of SETTINGS_SCHEMA) assert.ok(applySettingChange(s, e.key, s[e.key]), e.key);
});

test('odrzuca złe wartości', () => {
  const s = defaultSettings();
  const bad = [['laps', 0], ['laps', 16], ['laps', 2.5], ['laps', '5'], ['speedClass', '500cc'],
    ['kartCollisions', 'tak'], ['enabledItems', ['banana', 'banana']], ['enabledItems', ['laser']],
    ['trackSeed', 'a b'], ['trackSeed', 'x'.repeat(25)], ['nieistnieje', 1], ['__proto__', {}]];
  for (const [k, v] of bad) assert.equal(applySettingChange(s, k, v), null, `${k}=${JSON.stringify(v)}`);
});

test('przyjmuje poprawne wartości i nie mutuje wejścia', () => {
  const s = defaultSettings();
  const n = applySettingChange(s, 'laps', 15);
  assert.equal(n.laps, 15);
  assert.equal(s.laps, 5);
  assert.deepEqual(applySettingChange(s, 'enabledItems', []).enabledItems, []);
});

test('sanitizeSettings podmienia złe pola na domyślne', () => {
  const s = sanitizeSettings({ laps: 99, theme: 'neon', extra: 1 });
  assert.equal(s.laps, 5);
  assert.equal(s.theme, 'neon');
  assert.equal('extra' in s, false);
});

test('losowy seed spełnia wzorzec pola seeda', () => {
  for (let i = 0; i < 100; i++) assert.ok(applySettingChange(defaultSettings(), 'trackSeed', randomSeed()));
});

test('presety: każda wartość przechodzi walidację schematu', async () => {
  const { PRESETS } = await import('../src/config.js');
  const { applySettingChange, defaultSettings } = await import('../src/settings.js');
  for (const [name, p] of Object.entries(PRESETS)) {
    for (const [key, value] of Object.entries(p.values)) {
      assert.ok(applySettingChange(defaultSettings(), key, value), `${name}.${key}`);
    }
  }
});

test('przeszkody: domyślnie "Mało", presety wg spec', async () => {
  const { PRESETS } = await import('../src/config.js');
  assert.equal(defaultSettings().obstacles, 'few');
  assert.equal(PRESETS.standard.values.obstacles, 'few');
  assert.equal(PRESETS.chaos.values.obstacles, 'many');
  assert.equal(PRESETS.clean.values.obstacles, 'none');
});
