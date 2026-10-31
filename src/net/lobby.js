// =====================================================================
// net/lobby.js — lista graczy w pokoju. Prowadzi ją host i waliduje
// wszystko, co przychodzi od klientów (imię, kolor, limit miejsc).
// =====================================================================
import { KART_COLORS, MAX_RACERS, NET } from '../config.js';

export const HOST_ID = 'host';

// Imię: tekst bez znaków sterujących, przycięty; puste -> zastępcze.
export function sanitizeName(raw, fallback) {
  const name = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NET.nameMaxLength)
    : '';
  return name || fallback;
}

// Kolor: chciany, jeśli poprawny i wolny; inaczej pierwszy wolny.
export function pickColor(lobby, wanted, forId) {
  const taken = new Set(lobby.players.filter((p) => p.id !== forId).map((p) => p.color));
  if (KART_COLORS.includes(wanted) && !taken.has(wanted)) return wanted;
  return KART_COLORS.find((c) => !taken.has(c));
}

export function createLobby(hostProfile) {
  const lobby = { players: [] };
  lobby.players.push({
    id: HOST_ID,
    isHost: true,
    name: sanitizeName(hostProfile.name, 'Host'),
    color: pickColor(lobby, hostProfile.color, HOST_ID),
  });
  return lobby;
}

// Zwraca dodanego gracza albo null, gdy pokój jest pełny.
export function addPlayer(lobby, id, profile) {
  if (lobby.players.length >= MAX_RACERS) return null;
  const player = { id, isHost: false, name: '', color: null };
  lobby.players.push(player);
  updatePlayer(lobby, id, profile);
  return player;
}

export function updatePlayer(lobby, id, profile) {
  const p = lobby.players.find((x) => x.id === id);
  if (!p) return null;
  p.name = sanitizeName(profile?.name, `Gracz ${lobby.players.indexOf(p) + 1}`);
  p.color = pickColor(lobby, profile?.color, id);
  return p;
}

export function removePlayer(lobby, id) {
  lobby.players = lobby.players.filter((p) => p.id !== id);
}
