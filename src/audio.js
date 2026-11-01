// =====================================================================
// audio.js — wszystkie dźwięki generowane w Web Audio (bez plików).
//  - Silnik: dwa oscylatory przez filtr; wysokość = prędkość, turbo wyżej.
//  - Dryf: szum przez filtr pasmowy; ton rośnie z poziomem mini-turbo.
//  - Krótkie efekty (play): tony, przejścia częstotliwości, wybuchy szumu.
// AudioContext startuje dopiero po geście użytkownika (wymóg przeglądarek).
// =====================================================================
import { AUDIO } from './config.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null; // bufor białego szumu (wspólny)
  let engine = null;
  let drift = null;
  let muted = loadMuted();

  function loadMuted() {
    try { return localStorage.getItem(AUDIO.storageKey) === 'muted'; } catch { return false; }
  }

  // Pierwszy gest (klawisz, klik) — tworzymy kontekst i stałe źródła.
  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : AUDIO.masterVolume;
    master.connect(ctx.destination);

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Silnik.
    const e = AUDIO.engine;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = e.filterHz;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const oscs = [['sawtooth', 1], ['square', e.subRatio]].map(([type, ratio]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = e.idleHz * ratio;
      o.connect(filter);
      o.start();
      return { o, ratio };
    });
    filter.connect(gain).connect(master);
    engine = { oscs, gain, filter };

    // Pisk dryfu.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = AUDIO.drift.q;
    const dg = ctx.createGain();
    dg.gain.value = 0;
    src.connect(band).connect(dg).connect(master);
    src.start();
    drift = { band, gain: dg };
  }
  for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, unlock);

  const at = () => ctx.currentTime;

  // Ton z obwiednią: [częstotliwość od, do], czas, typ fali, głośność.
  function tone(f0, f1, dur, type = 'square', vol = AUDIO.sfxVolume, delay = 0) {
    const t = at() + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + AUDIO.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Szum przez filtr (uderzenia, świst).
  function burst(dur, f0, f1, vol = AUDIO.sfxVolume, type = 'lowpass') {
    const t = at();
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  const arp = (notes, step, type, vol) => notes.forEach((f, i) => tone(f, f, step * 1.6, type, vol, i * step));

  // Krótkie efekty po nazwie.
  const SFX = {
    tick: () => tone(440, 440, 0.18, 'square'),
    go: () => tone(880, 880, 0.45, 'square'),
    pickup: () => arp([660, 880, 1100], 0.05, 'triangle'),
    ready: () => tone(1320, 1320, 0.08, 'triangle'),
    boost: () => { burst(0.6, 400, 4000, AUDIO.sfxVolume, 'bandpass'); tone(200, 600, 0.5, 'sawtooth', AUDIO.sfxVolume * 0.5); },
    rocket: () => { tone(300, 1200, 0.35, 'sawtooth'); burst(0.4, 3000, 500); },
    banana: () => tone(300, 150, 0.15, 'triangle'),
    shield: () => arp([523, 659, 784, 1047], 0.04, 'sine', AUDIO.sfxVolume * 1.2),
    hit: () => { burst(0.35, 2000, 200); tone(600, 120, 0.6, 'sawtooth'); },
    blocked: () => tone(1500, 900, 0.25, 'sine'),
    wall: (strength = 1) => burst(0.18, 900, 120, AUDIO.sfxVolume * Math.min(1, strength)),
    lap: () => arp([784, 1047], 0.09, 'square'),
    finalLap: () => arp([523, 659, 784, 1047], 0.1, 'square'),
    finish: () => arp([523, 659, 784, 1047, 784, 1047], 0.12, 'square'),
  };

  return {
    play(name, arg) {
      if (ctx && !muted && SFX[name]) SFX[name](arg);
    },

    // Raz na klatkę: dźwięk własnego karta (null = cisza, np. w lobby).
    update(view, throttle) {
      if (!ctx) return;
      const t = at(), e = AUDIO.engine, d = AUDIO.drift;
      const on = view !== null;
      const frac = on ? Math.min(1, view.speedFrac) : 0;
      const hz = e.idleHz + frac * e.rangeHz + (on && view.boosting ? e.boostHz : 0);
      for (const { o, ratio } of engine.oscs) o.frequency.setTargetAtTime(hz * ratio, t, e.smoothing);
      engine.filter.frequency.setTargetAtTime(e.filterHz + frac * e.filterRangeHz, t, e.smoothing);
      const vol = on ? e.volume * (e.idleLevel + (1 - e.idleLevel) * Math.max(frac, throttle * e.throttleLevel)) : 0;
      engine.gain.gain.setTargetAtTime(vol, t, e.smoothing);

      const drifting = on && view.drift.active && view.drift.hop === 0;
      drift.band.frequency.setTargetAtTime(d.baseHz + (on ? view.drift.level : 0) * d.levelHz, t, d.smoothing);
      drift.gain.gain.setTargetAtTime(drifting ? d.volume : 0, t, d.smoothing);
    },

    get muted() { return muted; },
    toggleMuted() {
      muted = !muted;
      try { localStorage.setItem(AUDIO.storageKey, muted ? 'muted' : 'on'); } catch { /* bez pamięci */ }
      if (master) master.gain.setTargetAtTime(muted ? 0 : AUDIO.masterVolume, at(), AUDIO.attack);
      return muted;
    },
  };
}
