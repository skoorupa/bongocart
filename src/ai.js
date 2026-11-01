// =====================================================================
// ai.js — kierowca AI. Zwraca to samo sterowanie co input.js, więc ten
// sam model jazdy obsługuje boty, gracza po mecie i (etap 7) gracza,
// który się rozłączył.
//
//  - Kierownica: "pure pursuit" — celuje w punkt linii jazdy przed sobą.
//  - Gaz/hamulec: prędkość docelowa z nadchodzących zakrętów
//    (v w zakręcie ≈ promień × maks. prędkość obrotu) i drogi hamowania.
//  - Dryf (średni/trudny): w długich, ciasnych zakrętach — mini-turbo.
//  - Omijanie kart z przodu, wychodzenie z zakleszczenia.
//  - Przedmioty: po krótkiej zwłoce, w sensownym momencie.
// =====================================================================
import { AI, BOT_DIFFICULTIES, ITEMS, KART } from './config.js';
import { createRng } from './rng.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function createDriver(track, difficulty, seed) {
  const skill = BOT_DIFFICULTIES[difficulty];
  const rng = createRng(seed);
  const n = track.points.length;
  const phases = AI.noisePeriods.map(() => rng.range(0, Math.PI * 2));
  let t = 0;
  let avoidOffset = 0;
  let postSide = 0; // strona objazdu grupy słupków (+1 prawa, −1 lewa, 0 = brak grupy)
  let drifting = false;
  let stuckTime = 0;
  let reverseLeft = 0;
  let holdLeft = null; // zwłoka przed użyciem przedmiotu (null = brak przedmiotu)
  let held = 0;

  const indexOf = (s) => Math.round(s / track.step) % n;

  // Najmniejszy promień zakrętu w oknie [od, do] metrów przed kartem.
  function minRadiusAhead(i, fromM, toM) {
    let r = Infinity;
    for (let m = fromM; m <= toM; m += track.step) r = Math.min(r, track.points[(i + Math.round(m / track.step)) % n].radius);
    return r;
  }

  // Prędkość, z jaką kart może jechać teraz, żeby zdążyć wyhamować
  // przed każdym zakrętem w zasięgu drogi hamowania.
  function targetSpeed(i, speed, stats) {
    const cornerK = KART.turnRateHigh * stats.turnMul * skill.cornerFactor;
    const scan = (speed * speed) / (2 * KART.brakeDecel) + AI.brakeScanExtra;
    let v = Infinity;
    for (let m = 0; m <= scan; m += track.step) {
      const vCorner = track.points[(i + Math.round(m / track.step)) % n].radius * cornerK;
      v = Math.min(v, Math.sqrt(vCorner * vCorner + 2 * KART.brakeDecel * m));
    }
    return v;
  }

  // Przesunięcie, żeby nie wjechać w kart przed sobą (+ = w prawo).
  // Banany omija tylko bot z skill.dodge, słupki toru — każdy. Słupki
  // sprawdzamy najpierw: unik przed kartem nie może wepchnąć w słupek.
  function avoidance(kart, others, hazards, obstacles, aimLine) {
    const fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
    // Słupki w zasięgu (dopóki nie minięte całym kartem) objeżdżamy całą
    // grupą z jednej strony: z prawej na wysokości >= max(oś + zapas), z lewej
    // <= min(oś − zapas). Jeśli linia jazdy przy słupkach sama je omija —
    // nic nie robimy; inaczej trzymamy bliższą kartowi stronę (wybraną raz), dopóki grupa
    // jest w zasięgu. Wynik względem linii w punkcie celowania (aimLine).
    let right = -Infinity, left = Infinity, first = null, firstAhead = Infinity;
    for (const o of obstacles) {
      const ahead = (o.x - kart.x) * fx + (o.z - kart.z) * fz;
      if (ahead <= -(KART.radius + o.radius) || ahead > AI.avoidPost.ahead) continue;
      const clear = KART.radius + o.radius + AI.avoidPost.margin;
      right = Math.max(right, o.lateral + clear);
      left = Math.min(left, o.lateral - clear);
      if (ahead < firstAhead) { first = o; firstAhead = ahead; }
    }
    if (!first) postSide = 0;
    else {
      const lineAtPosts = track.racingLine[first.index].offset;
      if (lineAtPosts >= right || lineAtPosts <= left) return 0;
      // Stronę wybieramy raz na grupę (bez przeskakiwania w trakcie objazdu).
      if (!postSide) postSide = right - kart.lateral <= kart.lateral - left ? 1 : -1;
      return (postSide > 0 ? right : left) - aimLine;
    }
    for (const o of [...others, ...(skill.dodge ? hazards : [])]) {
      const dx = o.x - kart.x, dz = o.z - kart.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * -fz + dz * fx;
      const speed = o.speed ?? 0; // przeszkody (banany, słupki) stoją
      if (ahead > 0 && ahead < AI.avoid.ahead && Math.abs(side) < AI.avoid.width && speed < kart.speed + 1) {
        return side > 0 ? -AI.avoid.shift : AI.avoid.shift;
      }
    }
    return 0;
  }

  // Czy użyć trzymanego przedmiotu.
  function wantsItem(i, ctx, dt) {
    const slot = ctx.slot;
    if (!slot?.item || slot.roll > 0) {
      holdLeft = null;
      return false;
    }
    const a = ITEMS.ai;
    if (holdLeft === null) {
      holdLeft = rng.range(a.holdSeconds[0], a.holdSeconds[1]);
      held = 0;
    }
    holdLeft -= dt;
    held += dt;
    if (holdLeft > 0) return false;
    if (held > a.maxHoldSeconds) return true;
    switch (slot.item) {
      case 'rocket': return ctx.gapAhead !== null && ctx.gapAhead < a.rocketRange;
      case 'banana': return ctx.gapBehind !== null && ctx.gapBehind < a.bananaBehind;
      case 'boost': return minRadiusAhead(i, 0, a.boostLookMeters) > a.boostStraightRadius;
      default: return true; // tarcza: od razu
    }
  }

  return {
    // ctx: {others: [stany innych kartów], stats, speedMul (gumka 0..1+),
    //       slot {item, roll}, gapAhead, gapBehind [m], hazards [{x, z}] (banany),
    //       obstacles [{x, z}] (słupki toru)}
    control(kart, ctx, dt) {
      t += dt;
      const i = indexOf(kart.trackS);
      const speed = kart.speed;

      // --- Cel na linii jazdy + "pływanie" + omijanie.
      const noise = skill.lineNoise * AI.noisePeriods.reduce((sum, p, k) => sum + Math.sin(phases[k] + (t * Math.PI * 2) / p), 0) / AI.noisePeriods.length;
      const look = AI.lookAheadMin + Math.max(0, speed) * AI.lookAheadTime;
      const j = (i + Math.round(look / track.step)) % n;
      const line = track.racingLine[j], p = track.points[j];
      avoidOffset = approach(avoidOffset, avoidance(kart, ctx.others, ctx.hazards ?? [], ctx.obstacles ?? [], line.offset), AI.avoid.rate * dt);
      const maxOff = track.halfWidth - KART.radius;
      // Przy objeździe słupków bez "pływania" — inaczej zjada zapas.
      const off = clamp(line.offset + (postSide ? 0 : noise) + avoidOffset, -maxOff, maxOff) - line.offset;
      const tx = line.x + p.nx * off, tz = line.z + p.nz * off;
      const err = angleDiff(Math.atan2(tx - kart.x, tz - kart.z), kart.heading);
      let steer = clamp(-err * skill.steerGain, -1, 1);

      // --- Zakleszczenie: chwila na wstecznym z odwrotnym skrętem, potem reset.
      if (reverseLeft > 0) {
        reverseLeft -= dt;
        stuckTime += dt;
        return { throttle: 0, brake: 1, steer: -steer, drift: false };
      }
      stuckTime = Math.abs(speed) < AI.stuck.speed ? stuckTime + dt : 0;
      if (stuckTime > AI.stuck.resetTime) {
        stuckTime = 0;
        return { throttle: 0, brake: 0, steer: 0, drift: false, reset: true };
      }
      if (stuckTime > AI.stuck.time && stuckTime - dt <= AI.stuck.time) reverseLeft = AI.stuck.reverseTime;

      // --- Gaz / hamulec.
      const cap = ctx.stats.maxSpeed * Math.min(1, skill.speedFactor * ctx.speedMul);
      const target = Math.min(cap, targetSpeed(i, speed, ctx.stats));
      const throttle = speed < target ? 1 : 0;
      const brake = speed > target + AI.brakeHysteresis ? 1 : 0;

      // --- Dryf w długich, ciasnych zakrętach (puszczenie = mini-turbo).
      const d = AI.drift;
      if (!skill.drift || kart.surface === 'offroad') {
        drifting = false;
      } else if (!drifting) {
        const tight = minRadiusAhead(i, 0, d.lookMeters) < d.enterRadius;
        const long = minRadiusAhead(i, d.minArcMeters, d.minArcMeters) < d.exitRadius;
        drifting = tight && long && speed > KART.drift.minSpeed && Math.abs(steer) > KART.drift.minSteer;
      } else if (minRadiusAhead(i, 0, d.lookMeters) > d.exitRadius || Math.abs(err) > d.maxHeadingError) {
        drifting = false;
      }

      return { throttle, brake, steer, drift: drifting, item: wantsItem(i, ctx, dt) };
    },
  };
}
