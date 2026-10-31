// =====================================================================
// settings.js — walidacja ustawień względem SETTINGS_SCHEMA.
// Host używa applySettingChange() dla każdej zmiany; klienci nigdy nie
// ustawiają globalnych opcji samodzielnie.
// =====================================================================
import { SETTINGS_SCHEMA, RANDOM_SEED_LENGTH } from './config.js';

const SCHEMA_BY_KEY = new Map(SETTINGS_SCHEMA.map((e) => [e.key, e]));

// Kopia wartości (tablice nie mogą być współdzielone z domyślnymi).
const clone = (v) => (Array.isArray(v) ? [...v] : v);

export function defaultSettings() {
  const out = {};
  for (const e of SETTINGS_SCHEMA) out[e.key] = clone(e.default);
  return out;
}

// Zwraca true, jeśli wartość jest poprawna dla danego wpisu schematu.
export function isValidValue(entry, value) {
  switch (entry.type) {
    case 'int':
      return Number.isInteger(value) && value >= entry.min && value <= entry.max
        && (value - entry.min) % (entry.step ?? 1) === 0;
    case 'select':
      return entry.options.some((o) => o.value === value);
    case 'bool':
      return typeof value === 'boolean';
    case 'multiselect':
      return Array.isArray(value)
        && new Set(value).size === value.length
        && value.every((v) => entry.options.some((o) => o.value === v));
    case 'text':
      return typeof value === 'string' && value.length <= entry.maxLength
        && (!entry.pattern || entry.pattern.test(value));
    default:
      return false;
  }
}

// Próba zmiany jednego ustawienia. Zwraca NOWY obiekt ustawień albo
// null, gdy klucz nie istnieje lub wartość jest nieprawidłowa.
export function applySettingChange(settings, key, value) {
  const entry = SCHEMA_BY_KEY.get(key);
  if (!entry || !isValidValue(entry, value)) return null;
  return { ...settings, [key]: clone(value) };
}

// Pełny obiekt z sieci/zewnątrz -> poprawny obiekt (złe pola = domyślne).
export function sanitizeSettings(raw) {
  const out = defaultSettings();
  if (!raw || typeof raw !== 'object') return out;
  for (const e of SETTINGS_SCHEMA) {
    if (isValidValue(e, raw[e.key])) out[e.key] = clone(raw[e.key]);
  }
  return out;
}

// Losowy seed dla hosta. Math.random jest tu w porządku: wynik i tak
// trafia do wszystkich przez sieć, a tor generuje się już z seeda.
export function randomSeed() {
  let s = '';
  while (s.length < RANDOM_SEED_LENGTH) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}
