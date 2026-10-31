// =====================================================================
// physics.js — arcade'owy model jazdy karta. Czysty JS (bez Three.js),
// wywoływany ze stałym krokiem PHYSICS.fixedDt.
//
// Model: kart ma kurs (heading) i wektor prędkości. Gaz/hamulec działa
// wzdłuż kursu, a prędkość boczna zanika z szybkością "grip" — mała
// przyczepność w dryfie daje naturalny poślizg.
// Układ: heading = 0 patrzy w +Z, forward = (sin h, cos h),
// right = (−cos h, sin h). Skręt w prawo zmniejsza heading.
// =====================================================================
import { KART, SPEED_CLASSES, TRACK } from './config.js';
import { nearestOnTrack, gridSlot } from './track/generator.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target));

// JEDYNE miejsce, gdzie klasa prędkości wpływa na fizykę.
export function kartStats(speedClass) {
  const c = SPEED_CLASSES[speedClass];
  return {
    maxSpeed: KART.baseMaxSpeed * c.speedMul,
    accel: KART.accel * c.accelMul,
    boostSpeed: KART.boostSpeed * c.speedMul,
    boostAccel: KART.boostAccel * c.accelMul,
    reverseMaxSpeed: KART.reverseMaxSpeed,
    // Szybsze klasy skręcają odrobinę mocniej, żeby dało się zmieścić w zakrętach.
    turnMul: Math.sqrt(c.speedMul),
  };
}

export function createKartState(track, slot) {
  const g = gridSlot(track, slot);
  return {
    x: g.x, z: g.z, heading: g.heading,
    vx: 0, vz: 0,
    speed: 0, // prędkość wzdłuż kursu (ujemna = cofanie)
    steer: 0, // wygładzony skręt −1..1 (+ = w prawo)
    drift: { active: false, dir: 0, charge: 0, level: 0, hop: 0 },
    boostTime: 0,
    surface: 'road', // road | kerb | offroad
    lateral: 0, // przesunięcie od środka toru (+ = w prawo)
    trackS: 0, // metr okrążenia
    wallHit: 0, // siła ostatniego uderzenia w bandę (dźwięk/efekty)
  };
}

// Dodaje turbo (mini-turbo, przedmiot). Czas się nie sumuje, bierzemy dłuższy.
export function applyBoost(kart, seconds) {
  kart.boostTime = Math.max(kart.boostTime, seconds);
}

// input: {throttle 0..1, brake 0..1, steer −1..1, drift bool}
export function stepKart(kart, input, track, stats, dt) {
  // --- Wygładzony skręt (gamepad analogowy też przechodzi, ale szybko).
  const steerRate = Math.abs(input.steer) > Math.abs(kart.steer) ? KART.steerRiseRate : KART.steerReturnRate;
  kart.steer = approach(kart.steer, input.steer, steerRate * dt);

  const fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
  const rx = -fz, rz = fx;
  let fwd = kart.vx * fx + kart.vz * fz;
  let lat = kart.vx * rx + kart.vz * rz;

  updateDrift(kart, input, fwd, dt);

  // --- Limit prędkości: turbo podnosi, pobocze obniża.
  const boosting = kart.boostTime > 0;
  kart.boostTime = Math.max(0, kart.boostTime - dt);
  let limit = stats.maxSpeed + (boosting ? stats.boostSpeed : 0);
  if (kart.surface === 'offroad' && !boosting) limit = stats.maxSpeed * KART.offroadSpeedFactor;

  // --- Wzdłużnie: gaz, hamulec/wsteczny, opór.
  if (boosting) {
    fwd = approach(fwd, limit, stats.boostAccel * dt);
  } else if (input.throttle > 0 && fwd < 0) {
    fwd = Math.min(0, fwd + KART.brakeDecel * input.throttle * dt); // gaz przy cofaniu = hamowanie
  } else if (input.throttle > 0) {
    const falloff = 1 - KART.accelFalloff * clamp(fwd / stats.maxSpeed, 0, 1);
    if (fwd < limit) fwd = Math.min(limit, fwd + stats.accel * falloff * input.throttle * dt);
  } else if (input.brake > 0) {
    if (fwd > 0) fwd = Math.max(0, fwd - KART.brakeDecel * input.brake * dt);
    else fwd = Math.max(-stats.reverseMaxSpeed, fwd - KART.reverseAccel * input.brake * dt);
  } else {
    fwd = approach(fwd, 0, KART.coastDrag * dt);
  }
  if (fwd > limit) {
    const drag = kart.surface === 'offroad' && !boosting ? KART.offroadDrag : KART.overSpeedDrag;
    fwd = Math.max(limit, fwd - drag * dt);
  }

  // --- Skręt zależny od prędkości.
  const speedFrac = clamp(Math.abs(fwd) / stats.maxSpeed, 0, 1);
  const ramp = clamp(Math.abs(fwd) / KART.turnRampSpeed, 0, 1);
  let yawRate;
  if (kart.drift.active) {
    // W dryfie kart zawsze skręca w stronę dryfu; gałka reguluje ciasność.
    const press = (kart.steer * kart.drift.dir + 1) / 2; // 0 = kontra, 1 = dociśnięcie
    yawRate = kart.drift.dir * KART.turnRateLow * (KART.drift.turnMin + (KART.drift.turnMax - KART.drift.turnMin) * press);
  } else {
    const rate = KART.turnRateLow + (KART.turnRateHigh - KART.turnRateLow) * speedFrac;
    yawRate = kart.steer * rate * ramp * Math.sign(fwd || 1);
  }
  kart.heading -= yawRate * stats.turnMul * dt;

  // --- Przyczepność boczna.
  lat *= Math.exp(-(kart.drift.active ? KART.driftGrip : KART.grip) * dt);

  // Nowe osie po obrocie: prędkość wzdłużna "obraca się" z kartem.
  const nfx = Math.sin(kart.heading), nfz = Math.cos(kart.heading);
  kart.vx = nfx * fwd + -nfz * lat;
  kart.vz = nfz * fwd + nfx * lat;
  kart.x += kart.vx * dt;
  kart.z += kart.vz * dt;
  kart.speed = fwd;

  collideWithTrack(kart, track);
}

function updateDrift(kart, input, fwd, dt) {
  const d = kart.drift, cfg = KART.drift;
  d.hop = Math.max(0, d.hop - dt);
  if (!d.active) {
    if (input.drift && fwd > cfg.minSpeed && Math.abs(input.steer) > cfg.minSteer && kart.surface !== 'offroad') {
      d.active = true;
      d.dir = Math.sign(input.steer);
      d.charge = 0;
      d.level = 0;
      d.hop = cfg.hopTime;
    }
    return;
  }
  // Puszczenie spacji = wyjście z dryfu i mini-turbo zależne od poziomu.
  if (!input.drift) {
    if (d.level > 0) applyBoost(kart, cfg.boostTimes[d.level - 1]);
    endDrift(d);
    return;
  }
  if (fwd < cfg.minSpeed * cfg.cancelSpeedFactor) {
    endDrift(d);
    return;
  }
  if (kart.surface !== 'offroad') {
    const press = (kart.steer * d.dir + 1) / 2;
    d.charge += (cfg.chargeBase + cfg.chargeSteer * press) * dt;
  }
  d.level = cfg.levels.filter((t) => d.charge >= t).length;
}

function endDrift(d) {
  d.active = false;
  d.dir = 0;
  d.charge = 0;
  d.level = 0;
}

// Nawierzchnia i bandy na podstawie najbliższego punktu linii środkowej.
function collideWithTrack(kart, track) {
  const q = nearestOnTrack(track, kart.x, kart.z);
  kart.trackS = q.s;
  kart.lateral = q.lateral;
  const abs = Math.abs(q.lateral);
  const kerbEdge = track.halfWidth + TRACK.kerbWidth;
  kart.surface = abs <= track.halfWidth ? 'road' : abs <= kerbEdge ? 'kerb' : 'offroad';
  kart.wallHit = 0;

  const wall = kerbEdge + TRACK.runoffWidth - KART.radius;
  if (abs <= wall) return;

  // Normalna na zewnątrz (w stronę bandy) z odcinka, na który rzutowaliśmy.
  const p = track.points[q.index];
  const side = Math.sign(q.lateral);
  const nx = p.nx * side, nz = p.nz * side;
  const pen = abs - wall;
  kart.x -= nx * pen;
  kart.z -= nz * pen;

  // Obrót wzdłuż bandy (w stronę tego kierunku stycznej, który jest bliżej kursu).
  const fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
  if (fx * nx + fz * nz > 0) {
    const sgn = fx * p.tx + fz * p.tz >= 0 ? 1 : -1;
    const along = Math.atan2(p.tx * sgn, p.tz * sgn);
    kart.heading += Math.atan2(Math.sin(along - kart.heading), Math.cos(along - kart.heading)) * KART.wallAlign;
  }

  const vn = kart.vx * nx + kart.vz * nz;
  if (vn <= 0) return;
  kart.vx -= nx * vn * (1 + KART.wallRestitution);
  kart.vz -= nz * vn * (1 + KART.wallRestitution);
  if (vn > KART.wallHitMinSpeed) {
    kart.vx *= KART.wallSpeedKeep;
    kart.vz *= KART.wallSpeedKeep;
    kart.wallHit = vn;
  }
  kart.speed = kart.vx * Math.sin(kart.heading) + kart.vz * Math.cos(kart.heading);
}

// Ustawienie karta z powrotem na środku toru (klawisz R / zablokowanie).
export function resetKartToTrack(kart, track) {
  const q = nearestOnTrack(track, kart.x, kart.z);
  const p = track.points[q.index];
  Object.assign(kart, { x: p.x, z: p.z, heading: p.heading, vx: 0, vz: 0, speed: 0, steer: 0, boostTime: 0 });
  endDrift(kart.drift);
}
