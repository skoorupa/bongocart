// =====================================================================
// track/obstacleMesh.js — wygląd przeszkód z track.obstacles: pomarańczowe
// słupki drogowe z białymi pasami, progi zwalniające w żółto-czarne pasy i plamy
// oleju (track.oils).
// InstancedMesh: jedno wywołanie rysowania na rodzaj. Sprzątanie przez
// disposeObject (trackMesh.js) razem z resztą toru.
// =====================================================================
import * as THREE from 'three';
import { OBSTACLES, RENDER } from '../config.js';

export function buildObstaclesVisual(track) {
  const group = new THREE.Group();
  const P = OBSTACLES.post, B = OBSTACLES.bump, C = OBSTACLES.colors;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);

  // --- Słupki drogowe: walec z zaokrąglonym czubkiem, ciemna podstawa,
  // białe pasy odblaskowe.
  const posts = track.posts;
  if (posts.length) {
    const seg = OBSTACLES.postSegments, y0 = RENDER.roadY;
    const body = new THREE.CylinderGeometry(P.radius, P.radius, P.height, seg);
    body.translate(0, y0 + P.height / 2, 0);
    const cap = new THREE.SphereGeometry(P.radius, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, OBSTACLES.postCapFlatten, 1);
    cap.translate(0, y0 + P.height, 0);
    const bodyGeo = mergeInto(body, cap);
    const bandR = P.radius + OBSTACLES.postBandBulge;
    const bands = OBSTACLES.postBands.map((f) => {
      const g = new THREE.CylinderGeometry(bandR, bandR, OBSTACLES.postBandHeight, seg);
      return g.translate(0, y0 + P.height * f, 0);
    });
    const bandGeo = mergeInto(...bands);
    const baseR = P.radius + OBSTACLES.postBaseBulge;
    const baseGeo = new THREE.CylinderGeometry(baseR, baseR, OBSTACLES.postBaseHeight, seg);
    baseGeo.translate(0, y0 + OBSTACLES.postBaseHeight / 2, 0);
    const parts = [[bodyGeo, C.post], [bandGeo, C.postBand], [baseGeo, C.postBase]].map(([geo, color]) =>
      new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), posts.length));
    posts.forEach((o, i) => {
      m.makeTranslation(o.x, 0, o.z);
      parts.forEach((mesh) => mesh.setMatrixAt(i, m));
    });
    group.add(...parts);
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
  // --- Plamy oleju: ciemna, okrągła kałuża (jak obszar działania) z fioletowym połyskiem.
  const O = OBSTACLES.oil;
  if (track.oils?.length) {
    const disc = new THREE.CircleGeometry(1, 20);
    disc.rotateX(-Math.PI / 2);
    const layers = [
      [O.color, 1, O.y, 0.92],
      [O.sheen, O.sheenScale, O.y + O.sheenLift, 0.45],
    ].map(([color, s, y, opacity]) => {
      const mesh = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), track.oils.length);
      track.oils.forEach((o, i) => {
        q.setFromAxisAngle(up, track.points[o.index].heading);
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(o.x, y, o.z), q, new THREE.Vector3(o.radius * s, 1, o.radius * s)));
      });
      return mesh;
    });
    group.add(...layers);
  }
  return group;
}

// Łączy kilka geometrii (bez indeksów) w jedną — jedno InstancedMesh na kolor.
function mergeInto(...geos) {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const pos = [], nor = [];
  for (const g of flat) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  geos.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
