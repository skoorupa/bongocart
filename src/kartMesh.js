// =====================================================================
// kartMesh.js — proceduralny low-poly kart z kierowcą (własny projekt:
// "bongo" — okrągła postać w kasku). Brak zewnętrznych modeli.
// =====================================================================
import * as THREE from 'three';
import { KART } from './config.js';

const DRIFT_SPARK_COLORS = [0xffffff, 0x4fc3ff, 0xff9f1c]; // poziom 0, 1, 2

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

export function createKartMesh(color) {
  const root = new THREE.Group(); // pozycja i kurs
  const body = new THREE.Group(); // przechył, podskok, obrót w dryfie
  root.add(body);
  const L = KART.length, W = KART.width, R = KART.wheelRadius;

  const paint = lambert(color);
  const dark = lambert(0x222228);
  const chrome = lambert(0xc8c8d0);

  // Podwozie i nadwozie
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, 0.22, L), dark);
  chassis.position.y = R * 0.8;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 0.75, 0.35, L * 0.62), paint);
  shell.position.set(0, R + 0.25, -L * 0.08);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.08, W * 0.38, L * 0.42, 4, 1), paint);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.scale.set(1, 1, 0.45);
  nose.position.set(0, R + 0.18, L * 0.36);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, 0.16, 0.18), dark);
  bumper.position.set(0, R * 0.7, L * 0.5);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, 0.06, 0.32), paint);
  spoiler.position.set(0, R + 0.75, -L * 0.48);
  const spoilerPosts = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.4, 0.06), dark);
  spoilerPosts.position.set(0, R + 0.53, -L * 0.46);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 6), chrome);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0, R + 0.25, -L * 0.52);
  body.add(chassis, shell, nose, bumper, spoiler, spoilerPosts, exhaust);

  // Kierowca: okrągły "bongo" w kasku w kolorze karta.
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), lambert(0xf4f1de));
  torso.scale.set(1, 1.1, 0.9);
  torso.position.set(0, R + 0.72, -L * 0.12);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), paint);
  helmet.position.set(0, R + 1.18, -L * 0.1);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.12), lambert(0x1a1a2e));
  visor.position.set(0, R + 1.2, -L * 0.1 + 0.25);
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 4, 10), dark);
  wheelRing.position.set(0, R + 0.72, L * 0.1);
  wheelRing.rotation.x = -Math.PI / 3;
  body.add(torso, helmet, visor, wheelRing);

  // Koła: przednie skręcają, wszystkie się kręcą.
  const wheelGeo = new THREE.CylinderGeometry(R, R, 0.34, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(R * 0.45, R * 0.45, 0.36, 6);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const frontPivots = [];
  for (const [sx, sz, front] of [[1, 1, true], [-1, 1, true], [1, -1, false], [-1, -1, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * W * 0.52, R, sz * L * 0.36);
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(wheelGeo, dark), new THREE.Mesh(hubGeo, chrome));
    pivot.add(wheel);
    root.add(pivot); // koła nie przechylają się z nadwoziem
    wheels.push(wheel);
    if (front) frontPivots.push(pivot);
  }

  // Iskry dryfu przy tylnych kołach (kolor = poziom mini-turbo).
  const sparkMat = new THREE.MeshBasicMaterial({ color: DRIFT_SPARK_COLORS[0], transparent: true, opacity: 0.9 });
  const sparks = [1, -1].map((sx) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), sparkMat);
    m.position.set(sx * W * 0.55, 0.2, -L * 0.48);
    root.add(m);
    return m;
  });

  // Płomień turbo z rury wydechowej.
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true, opacity: 0.85 }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, R + 0.25, -L * 0.52 - 0.6);
  body.add(flame);

  // Cień "kropla" pod kartem — tańszy niż shadow mapy.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(W * 0.75, L * 0.6, 1);
  shadow.position.y = 0.06;
  root.add(shadow);

  let wheelSpin = 0, t = 0;

  return {
    object: root,
    // view: interpolowany stan karta (patrz main.js), dt: czas klatki.
    update(view, dt) {
      t += dt;
      root.position.set(view.x, 0, view.z);
      root.rotation.y = view.heading;

      wheelSpin += (view.speed / R) * dt;
      wheels.forEach((w) => { w.rotation.x = wheelSpin; });
      frontPivots.forEach((p) => { p.rotation.y = -view.steer * 0.45; });

      const d = view.drift;
      const hop = d.hop > 0 ? Math.sin((d.hop / KART.drift.hopTime) * Math.PI) * 0.35 : 0;
      body.position.y = hop;
      body.rotation.y = -d.dir * KART.driftBodyYaw;
      body.rotation.z = (d.active ? -d.dir : -view.steer * Math.min(Math.abs(view.speed) / KART.baseMaxSpeed, 1)) * KART.maxBodyRoll;

      const showSparks = d.active && d.hop === 0;
      sparkMat.color.setHex(DRIFT_SPARK_COLORS[d.level]);
      sparks.forEach((s, i) => {
        s.visible = showSparks;
        s.rotation.set(t * 17 + i, t * 23, 0);
        s.scale.setScalar(0.6 + 0.6 * Math.abs(Math.sin(t * 40 + i * 2)) + d.level * 0.4);
      });

      flame.visible = view.boostTime > 0;
      flame.scale.set(1, 0.8 + Math.abs(Math.sin(t * 50)) * 0.8, 1);
    },
    dispose() {
      root.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    },
  };
}
