// =====================================================================
// rng.js — deterministyczne liczby losowe. W logice gry, która musi być
// identyczna u wszystkich klientów, NIGDY nie używamy Math.random.
// =====================================================================

// Hash tekstu do 32-bitowej liczby (FNV-1a + końcowe mieszanie).
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Seed pochodny — osobny strumień losowości dla każdego zastosowania
// (kształt, skrzynki, dekoracje...), żeby zmiana jednego nie ruszała reszty.
export function deriveSeed(seed, ...parts) {
  return hashString([String(seed), ...parts].join('|'));
}

// mulberry32: szybki PRNG z 32-bitowym stanem. Zwraca obiekt z pomocnikami.
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next, // [0, 1)
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)), // włącznie
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
