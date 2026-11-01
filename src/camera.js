// =====================================================================
// camera.js — kamera trzecioosobowa (chase cam).
// Pozycja podąża płynnie, obrót z lekkim opóźnieniem, FOV rośnie
// z prędkością i przy turbo, pochylenie przy dryfie, C = widok do tyłu,
// wstrząs przy uderzeniach.
// =====================================================================
import * as THREE from 'three';
import { CAMERA, RENDER } from './config.js';

// Współczynnik wygładzania niezależny od liczby klatek.
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createChaseCamera() {
  const camera = new THREE.PerspectiveCamera(CAMERA.fovBase, 1, RENDER.near, RENDER.far);
  let yaw = 0, roll = 0, lastLookBack = false;
  let shake = 0, shakeT = 0;
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const target = new THREE.Vector3();

  // view: {x, z, heading, speedFrac 0..1+, boosting, driftDir, lookBack}
  function place(view, snap, dt) {
    if (snap) yaw = view.heading;
    else yaw += wrapAngle(view.heading - yaw) * smooth(CAMERA.yawLerp, dt);

    const dirYaw = view.lookBack ? yaw + Math.PI : yaw;
    const fx = Math.sin(dirYaw), fz = Math.cos(dirYaw);
    target.set(view.x - fx * CAMERA.distance, CAMERA.height, view.z - fz * CAMERA.distance);
    // Widok do tyłu przełącza się natychmiast — inaczej kamera "przelatuje" przez kart.
    if (snap || view.lookBack !== lastLookBack) pos.copy(target);
    else pos.lerp(target, smooth(CAMERA.posLerp, dt));
    lastLookBack = view.lookBack;

    look.set(view.x + fx * CAMERA.lookAhead, CAMERA.lookHeight, view.z + fz * CAMERA.lookAhead);
    camera.position.copy(pos);
    // Wstrząs: drgania zanikające wykładniczo (nie ruszają pozycji bazowej).
    shake *= Math.exp(-CAMERA.shake.decay * dt);
    shakeT += dt;
    if (shake > 1e-3) {
      const w = shakeT * CAMERA.shake.frequency;
      camera.position.x += Math.sin(w * 1.3) * shake;
      camera.position.y += Math.sin(w * 1.7 + 1) * shake * 0.5;
      camera.position.z += Math.sin(w * 1.1 + 2) * shake;
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(look);

    const rollTarget = -view.driftDir * CAMERA.driftRoll * (view.lookBack ? -1 : 1);
    roll = snap ? rollTarget : roll + (rollTarget - roll) * smooth(CAMERA.rollLerp, dt);
    camera.rotateZ(roll);

    const fovTarget = CAMERA.fovBase + CAMERA.fovSpeedAdd * Math.min(view.speedFrac, 1) + (view.boosting ? CAMERA.fovBoostAdd : 0);
    const fov = snap ? fovTarget : camera.fov + (fovTarget - camera.fov) * smooth(CAMERA.fovLerp, dt);
    if (Math.abs(fov - camera.fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    camera,
    update: (view, dt) => place(view, false, dt),
    snap: (view) => place(view, true, 0),
    shake(amount) { shake = Math.min(CAMERA.shake.maxAmplitude, shake + amount); },
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
  };
}
