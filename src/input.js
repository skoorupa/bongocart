// =====================================================================
// input.js — klawiatura + Gamepad API -> jeden obiekt sterowania.
// Mapowanie klawiszy i przycisków w CONTROLS (config.js).
// =====================================================================
import { CONTROLS } from './config.js';

const GAME_CODES = new Set(Object.values(CONTROLS.keys).flat());

// Nie przechwytujemy klawiszy, gdy użytkownik pisze w polu formularza.
const isTyping = (e) => {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));
};

export function createInput(target = window) {
  const down = new Set();
  const pressedOnce = new Set(); // akcje "jednorazowe" (wciśnięcie, nie trzymanie)
  let prevPad = new Set();

  target.addEventListener('keydown', (e) => {
    if (!GAME_CODES.has(e.code)) return;
    // W polu formularza działa tylko klawisz menu (zamknięcie panelu).
    if (isTyping(e)) {
      if (CONTROLS.keys.menu.includes(e.code) && !e.repeat) pressedOnce.add('menu');
      return;
    }
    e.preventDefault(); // spacja/strzałki nie przewijają strony
    if (!e.repeat) {
      for (const [action, codes] of Object.entries(CONTROLS.keys)) if (codes.includes(e.code)) pressedOnce.add(action);
    }
    down.add(e.code);
  });
  target.addEventListener('keyup', (e) => down.delete(e.code));
  // Utrata fokusu = puszczenie wszystkiego (inaczej kart "jedzie sam").
  window.addEventListener('blur', () => down.clear());

  const key = (action) => CONTROLS.keys[action].some((c) => down.has(c));

  function readGamepad() {
    const pad = navigator.getGamepads?.().find((g) => g && g.mapping === 'standard');
    if (!pad) return null;
    const g = CONTROLS.gamepad;
    const btn = (list) => Math.max(0, ...list.map((i) => pad.buttons[i]?.value ?? 0));
    const raw = pad.axes[g.steerAxis] ?? 0;
    const steer = Math.abs(raw) < g.deadzone ? 0 : Math.sign(raw) * (Math.abs(raw) - g.deadzone) / (1 - g.deadzone);
    const held = new Set();
    for (const action of ['drift', 'item', 'lookBack', 'menu']) if (btn(g[action]) > 0.5) held.add(action);
    for (const a of held) if (!prevPad.has(a)) pressedOnce.add(a);
    prevPad = held;
    return { throttle: btn(g.accelerate), brake: btn(g.brake), steer, held };
  }

  return {
    // Wywoływane raz na klatkę. steer: + = w prawo.
    read() {
      const pad = readGamepad();
      const kSteer = (key('right') ? 1 : 0) - (key('left') ? 1 : 0);
      const state = {
        throttle: Math.max(key('accelerate') ? 1 : 0, pad?.throttle ?? 0),
        brake: Math.max(key('brake') ? 1 : 0, pad?.brake ?? 0),
        steer: kSteer || pad?.steer || 0,
        drift: key('drift') || !!pad?.held.has('drift'),
        lookBack: key('lookBack') || !!pad?.held.has('lookBack'),
        itemPressed: pressedOnce.has('item'),
        resetPressed: pressedOnce.has('reset'),
        menuPressed: pressedOnce.has('menu'),
      };
      pressedOnce.clear();
      return state;
    },
  };
}
