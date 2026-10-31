// =====================================================================
// ui/lobbyPanel.js — część lobby nad ustawieniami: profil gracza (imię,
// kolor), tworzenie/dołączanie do pokoju, lista graczy, status sieci.
// Tylko widok: zmiany zgłasza callbackami, stan dostaje przez set*().
// =====================================================================
import { KART_COLORS, NET } from '../config.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// on: {profile(p), create(), join(code), leave(), copyLink()}
export function createLobbyPanel(on) {
  const name = $('playerName');
  name.maxLength = NET.nameMaxLength;
  let profile = { name: '', color: KART_COLORS[0] };
  let taken = new Set();

  const swatches = KART_COLORS.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = hex(c);
    b.setAttribute('aria-label', `Kolor ${hex(c)}`);
    b.addEventListener('click', () => {
      profile = { ...profile, color: c };
      render();
      on.profile(profile);
    });
    $('colorPicker').append(b);
    return b;
  });

  function render() {
    swatches.forEach((b, i) => {
      const c = KART_COLORS[i];
      b.setAttribute('aria-pressed', String(c === profile.color));
      b.disabled = taken.has(c) && c !== profile.color;
    });
  }

  name.addEventListener('change', () => {
    profile = { ...profile, name: name.value };
    on.profile(profile);
  });
  $('createRoom').addEventListener('click', () => on.create());
  $('joinRoom').addEventListener('click', () => on.join($('roomCode').value));
  $('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') on.join($('roomCode').value); });
  $('leaveRoom').addEventListener('click', () => on.leave());
  $('copyLink').addEventListener('click', () => on.copyLink());

  return {
    setProfile(p) {
      profile = { ...p };
      name.value = p.name;
      render();
    },
    // mode: 'solo' | 'connecting' | 'host' | 'client'
    setMode(mode, code = '') {
      $('roomSolo').hidden = mode === 'host' || mode === 'client';
      $('roomInfo').hidden = !$('roomSolo').hidden;
      $('createRoom').disabled = $('joinRoom').disabled = mode === 'connecting';
      $('roomCodeLabel').textContent = code;
    },
    // players: [{id, name, color, isHost}] — kolory innych są zajęte.
    setPlayers(players, localId) {
      taken = new Set(players.filter((p) => p.id !== localId).map((p) => p.color));
      render();
      $('players').replaceChildren(...players.map((p) => {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = hex(p.color);
        li.append(dot, p.name + (p.isHost ? ' 👑' : '') + (p.id === localId ? ' (ty)' : ''));
        return li;
      }));
    },
    setStatus(text) { $('netStatus').textContent = text; },
  };
}
