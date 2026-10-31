// =====================================================================
// camera.js — kamera trzecioosobowa (chase cam).
// Pozycja podąża płynnie, obrót z lekkim opóźnieniem, FOV rośnie
// z prędkością i przy turbo, pochylenie przy dryfie, C = widok do tyłu.
// =====================================================================
import * as THREE from 'three';
import { CAMERA, RENDER } from './config.js';

// Współczynnik wygładzania niezależny od liczby klatek.
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createChaseCamera() {
  const camera = new THREE.PerspectiveCamera(CAMERA.fovBase, 1, RENDER.near, RENDER.far);
  let yaw = 0, roll = 0, lastLookBack = false;
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
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
  };
}
