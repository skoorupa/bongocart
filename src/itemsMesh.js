// =====================================================================
// itemsMesh.js — wygląd skrzynek, bananów i pocisków (stan z items.js).
// Wszystko jako InstancedMesh: jedno wywołanie rysowania na rodzaj.
// =====================================================================
import * as THREE from 'three';
import { ITEMS } from './config.js';

const MAX_ROCKETS = 32;
// Odłamki rozbitej skrzynki (czysto wizualne, Math.random jest OK).
const SHARDS = { max: 96, perBox: 12, speed: 7, up: 6, gravity: 18, life: 0.8, size: 0.28 };
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export function createItemsView(track) {
  const group = new THREE.Group();
  const B = ITEMS.box;
  const nBoxes = Math.max(1, track.itemBoxes.length);

  // Skrzynka: półprzezroczysta kostka w kolorze akcentu motywu + jasny rdzeń.
  const boxShell = new THREE.InstancedMesh(
    new THREE.BoxGeometry(B.size, B.size, B.size),
    new THREE.MeshLambertMaterial({ color: track.theme.accent, transparent: true, opacity: 0.55, depthWrite: false }),
    nBoxes);
  const boxCore = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(B.size * 0.32, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    nBoxes);

  // Banan: łuk torusa.
  const banGeo = new THREE.TorusGeometry(0.6, 0.19, 6, 10, Math.PI * 0.8);
  banGeo.rotateZ(Math.PI * 0.6);
  const bananas = new THREE.InstancedMesh(banGeo, new THREE.MeshLambertMaterial({ color: 0xffe135, flatShading: true }), ITEMS.banana.maxOnTrack);

  // Pocisk: czerwony stożek + płomień.
  const rocketGeo = new THREE.ConeGeometry(0.28, 1.3, 8);
  rocketGeo.rotateX(Math.PI / 2); // czubek w +Z
  const rockets = new THREE.InstancedMesh(rocketGeo, new THREE.MeshLambertMaterial({ color: 0xe53935, flatShading: true }), MAX_ROCKETS);
  const flameGeo = new THREE.ConeGeometry(0.2, 0.9, 6);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0, -1.0);
  const flames = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffa62b }), MAX_ROCKETS);

  const shardMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(SHARDS.size, SHARDS.size, SHARDS.size),
    new THREE.MeshBasicMaterial({ color: track.theme.accent }),
    SHARDS.max);
  const shards = []; // {x, y, z, vx, vy, vz, age}
  let lastRespawn = track.itemBoxes.map(() => 0);

  for (const m of [boxShell, boxCore, bananas, rockets, flames, shardMesh]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // instancje rozrzucone po całym torze
    group.add(m);
  }

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  let t = 0;

  const put = (mesh, i, x, y, z, rx, ry, rz, s = 1) => {
    euler.set(rx, ry, rz);
    mesh.setMatrixAt(i, m4.compose(pos.set(x, y, z), quat.setFromEuler(euler), scale.set(s, s, s)));
  };

  return {
    group,
    // items: stan z items.js (albo null — wtedy tylko skrzynki bez stanu).
    update(items, dt) {
      t += dt;
      const spin = t * B.spinSpeed;
      track.itemBoxes.forEach((b, i) => {
        const respawn = items ? items.boxes[i].respawn : 0;
        if (respawn > 0) {
          boxShell.setMatrixAt(i, HIDDEN);
          boxCore.setMatrixAt(i, HIDDEN);
          return;
        }
        const y = B.height + Math.sin(t * 2 + i) * 0.15;
        put(boxShell, i, b.x, y, b.z, Math.PI / 4, spin, Math.PI / 4);
        put(boxCore, i, b.x, y, b.z, 0, -spin * 2, 0);
      });
      boxShell.count = boxCore.count = track.itemBoxes.length;

      // Skrzynka właśnie pękła -> odłamki.
      if (items) {
        items.boxes.forEach((b, i) => {
          if (b.respawn > 0 && lastRespawn[i] === 0) {
            for (let k = 0; k < SHARDS.perBox; k++) {
              const a = Math.random() * Math.PI * 2, v = SHARDS.speed * (0.5 + Math.random() * 0.5);
              shards.push({ x: b.x, y: B.height, z: b.z, vx: Math.cos(a) * v, vy: SHARDS.up * Math.random(), vz: Math.sin(a) * v, age: 0 });
            }
            while (shards.length > SHARDS.max) shards.shift();
          }
          lastRespawn[i] = b.respawn;
        });
      }
      for (let i = shards.length - 1; i >= 0; i--) {
        const p = shards[i];
        p.age += dt;
        if (p.age > SHARDS.life) { shards.splice(i, 1); continue; }
        p.vy -= SHARDS.gravity * dt;
        p.x += p.vx * dt; p.y = Math.max(0.1, p.y + p.vy * dt); p.z += p.vz * dt;
      }
      shards.forEach((p, i) => put(shardMesh, i, p.x, p.y, p.z, p.age * 9, p.age * 7, 0, 1 - p.age / SHARDS.life));
      shardMesh.count = shards.length;

      const bs = items?.bananas ?? [];
      bs.forEach((b, i) => put(bananas, i, b.x, 0.3, b.z, 0, b.id, 0));
      bananas.count = bs.length;

      const rs = (items?.projectiles ?? []).slice(0, MAX_ROCKETS);
      rs.forEach((r, i) => {
        put(rockets, i, r.x, 0.8, r.z, 0, r.heading, t * 12);
        put(flames, i, r.x, 0.8, r.z, 0, r.heading, 0, 0.8 + Math.abs(Math.sin(t * 40 + i)) * 0.5);
      });
      rockets.count = flames.count = rs.length;

      for (const m of [boxShell, boxCore, bananas, rockets, flames, shardMesh]) m.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    },
  };
}
