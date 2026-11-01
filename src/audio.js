// =====================================================================
// audio.js — wszystkie dźwięki generowane w Web Audio (bez plików).
//  - Silnik: obroty z biegami (engineRpm), piła + pod-harmoniczna + 2×
//    przez miękkie przesterowanie i filtr; "pykanie" jednocylindrowca
//    to modulacja głośności z częstotliwością zapłonów; szum wydechu.
//  - Dryf: szum przez filtr pasmowy; ton rośnie z poziomem mini-turbo.
//  - Krótkie efekty (play): tony, przejścia częstotliwości, wybuchy szumu.
// AudioContext startuje dopiero po geście użytkownika (wymóg przeglądarek).
// =====================================================================
import { AUDIO } from './config.js';

// Krzywa miękkiego przesterowania (tanh) dla WaveShaper.
function softClipCurve(drive, samples = 1024) {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

// Obroty 0..1 z prędkości: biegi — w każdym obroty rosną od shiftDropRpm
// do 1, przy zmianie biegu spadają. W miejscu gaz "kręci" silnik.
export function engineRpm(speedFrac, throttle, boosting) {
  const e = AUDIO.engine;
  const f = Math.min(Math.max(speedFrac, 0), 1);
  const pos = f * e.gears;
  const gear = Math.min(e.gears - 1, Math.floor(pos));
  const within = pos - gear;
  let rpm = gear === 0 ? within : e.shiftDropRpm + (1 - e.shiftDropRpm) * within;
  rpm = Math.max(rpm, throttle * e.revInPlace * (1 - f)); // gaz w miejscu
  return Math.min(1, rpm + (boosting ? e.boostRpm : 0));
}

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

    // Silnik: źródła -> przesterowanie -> filtr -> "pykanie" (AM) -> głośność.
    const e = AUDIO.engine;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(e.drive);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = e.filterHz;
    filter.Q.value = 1.5;
    const pulse = ctx.createGain(); // gain = 1 ± pulseDepth (z LFO)
    pulse.gain.value = 1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const oscs = [['sawtooth', 1, 0.6], ['square', 0.5, 0.35], ['sawtooth', 2, 0.25]].map(([type, ratio, level]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = e.idleHz * ratio;
      if (ratio === 2) o.detune.value = 8; // lekkie rozstrojenie = "żywszy" dźwięk
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(shaper);
      o.start();
      return { o, ratio };
    });
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = e.pulseDepth;
    lfo.connect(lfoDepth).connect(pulse.gain);
    lfo.start();
    // Wydech: szum przez filtr pasmowy na wyższej harmonicznej.
    const rasp = ctx.createBufferSource();
    rasp.buffer = noise;
    rasp.loop = true;
    const raspBand = ctx.createBiquadFilter();
    raspBand.type = 'bandpass';
    raspBand.Q.value = e.raspQ;
    const raspGain = ctx.createGain();
    raspGain.gain.value = e.raspVolume;
    rasp.connect(raspBand).connect(raspGain).connect(filter);
    rasp.start();
    shaper.connect(filter).connect(pulse).connect(gain).connect(master);
    engine = { oscs, gain, filter, lfo, raspBand, raspGain };

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
      const rpm = on ? engineRpm(view.speedFrac, throttle, view.boosting) : 0;
      const hz = e.idleHz + rpm * e.rangeHz;
      for (const { o, ratio } of engine.oscs) o.frequency.setTargetAtTime(hz * ratio, t, e.rpmSmoothing);
      engine.lfo.frequency.setTargetAtTime(hz / 2, t, e.rpmSmoothing); // zapłon co drugi obrót
      engine.raspBand.frequency.setTargetAtTime(hz * e.raspHarmonic, t, e.rpmSmoothing);
      const load = on ? Math.max(throttle, view.boosting ? 1 : 0) : 0;
      engine.filter.frequency.setTargetAtTime(e.filterHz + rpm * e.filterRpmHz + load * e.filterThrottleHz, t, e.toneSmoothing);
      engine.raspGain.gain.setTargetAtTime(e.raspVolume * (0.3 + 0.7 * load), t, e.toneSmoothing);
      const level = e.idleLevel + (1 - e.idleLevel) * rpm;
      const vol = on ? e.volume * level * (load > 0 ? 1 : e.offThrottleLevel) : 0;
      engine.gain.gain.setTargetAtTime(vol, t, e.toneSmoothing);

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
