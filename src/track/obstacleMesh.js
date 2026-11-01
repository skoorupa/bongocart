// =====================================================================
// track/obstacleMesh.js — wygląd przeszkód z track.obstacles: pomarańczowe
// pachołki z białą opaską i progi zwalniające w żółto-czarne pasy.
// InstancedMesh: jedno wywołanie rysowania na rodzaj. Sprzątanie przez
// disposeObject (trackMesh.js) razem z resztą toru.
// =====================================================================
import * as THREE from 'three';
import { OBSTACLES, RENDER } from '../config.js';

export function buildObstaclesVisual(track) {
  const group = new THREE.Group();
  const P = OBSTACLES.post, B = OBSTACLES.bump, C = OBSTACLES.colors;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);

  // --- Pachołki: stożek + opaska (krótki walec).
  const posts = track.posts;
  if (posts.length) {
    const coneGeo = new THREE.ConeGeometry(P.radius, P.height, 10);
    coneGeo.translate(0, P.height / 2 + RENDER.roadY, 0);
    const bandR = P.radius * (1 - OBSTACLES.postBandAt) * 1.08; // promień stożka na wysokości opaski + odrobina
    const bandGeo = new THREE.CylinderGeometry(bandR * 0.92, bandR * 1.08, OBSTACLES.postBandHeight, 10);
    bandGeo.translate(0, P.height * OBSTACLES.postBandAt + RENDER.roadY, 0);
    const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: C.post, flatShading: true }), posts.length);
    const bands = new THREE.InstancedMesh(bandGeo, new THREE.MeshLambertMaterial({ color: C.postBand, flatShading: true }), posts.length);
    posts.forEach((o, i) => {
      m.makeTranslation(o.x, 0, o.z);
      cones.setMatrixAt(i, m);
      bands.setMatrixAt(i, m);
    });
    group.add(cones, bands);
  }

  // --- Progi: rząd prostopadłościanów na przemian żółty/czarny w poprzek toru.
  const stripes = [[], []];
  for (const o of track.obstacles) {
    if (o.type !== 'bump') continue;
    const p = track.points[o.index];
    const count = Math.max(1, Math.round((o.latTo - o.latFrom) / B.stripeWidth));
    const w = (o.latTo - o.latFrom) / count;
    q.setFromAxisAngle(up, o.heading);
    const scale = new THREE.Vector3(w / B.stripeWidth, 1, 1);
    for (let k = 0; k < count; k++) {
      const lat = o.latFrom + w * (k + 0.5);
      stripes[k % 2].push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + p.nx * lat, RENDER.roadY, p.z + p.nz * lat), q, scale));
    }
  }
  const bumpGeo = new THREE.BoxGeometry(B.stripeWidth, B.height * 2, B.depth); // połowa pod jezdnią
  [C.bumpA, C.bumpB].forEach((color, c) => {
    if (!stripes[c].length) return;
    const mesh = new THREE.InstancedMesh(bumpGeo, new THREE.MeshLambertMaterial({ color, flatShading: true }), stripes[c].length);
    stripes[c].forEach((mm, i) => mesh.setMatrixAt(i, mm));
    group.add(mesh);
  });
  return group;
}
