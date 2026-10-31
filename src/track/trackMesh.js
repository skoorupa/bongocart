// =====================================================================
// track/trackMesh.js — budowa siatek Three.js z danych generatora.
// Wszystko proceduralne, low-poly, z kolorami wierzchołków.
// =====================================================================
import * as THREE from 'three';
import { TRACK, RENDER, MAX_RACERS } from '../config.js';
import { gridSlot } from './generator.js';

// Pas wzdłuż całej (zamkniętej) linii toru. edgeA/edgeB(i) -> [x,y,z],
// colorOf(i) -> 0xRRGGBB. Materiał DoubleSide, więc kolejność wierzchołków
// nie ma znaczenia dla oświetlenia.
function stripGeometry(n, edgeA, edgeB, colorOf) {
  const pos = new Float32Array(n * 18);
  const col = new Float32Array(n * 18);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = edgeA(i), b0 = edgeB(i), a1 = edgeA(j), b1 = edgeB(j);
    c.setHex(colorOf(i));
    [a0, b0, a1, b0, b1, a1].forEach((v, k) => {
      const o = (i * 6 + k) * 3;
      pos[o] = v[0]; pos[o + 1] = v[1]; pos[o + 2] = v[2];
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const stripMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });

export function buildTrackVisual(track) {
  const { points, theme, halfWidth } = track;
  const n = points.length;
  const group = new THREE.Group();
  const debug = new THREE.Group();
  group.add(debug);

  // Punkt przesunięty w bok od linii środkowej.
  const at = (i, offset, y) => {
    const p = points[i];
    return [p.x + p.nx * offset, y, p.z + p.nz * offset];
  };
  const mat = stripMaterial();

  // --- Jezdnia
  group.add(new THREE.Mesh(
    stripGeometry(n, (i) => at(i, halfWidth, RENDER.roadY), (i) => at(i, -halfWidth, RENDER.roadY), () => theme.road), mat));

  // --- Krawężniki (biało-czerwone pasy)
  const kerbColor = (i) => (Math.floor(i / RENDER.kerbStripeSamples) % 2 ? theme.kerbA : theme.kerbB);
  for (const side of [1, -1]) {
    group.add(new THREE.Mesh(stripGeometry(n,
      (i) => at(i, side * halfWidth, RENDER.kerbY),
      (i) => at(i, side * (halfWidth + TRACK.kerbWidth), RENDER.kerbY), kerbColor), mat));
  }

  // --- Bandy: ściana wewnętrzna, zewnętrzna i góra
  const barrierColor = (i) => (Math.floor(i / RENDER.barrierStripeSamples) % 2 ? theme.barrierA : theme.barrierB);
  const inner = halfWidth + TRACK.kerbWidth + TRACK.runoffWidth;
  const outer = inner + TRACK.barrierThickness;
  const h = TRACK.barrierHeight;
  for (const side of [1, -1]) {
    for (const o of [inner, outer]) {
      group.add(new THREE.Mesh(stripGeometry(n, (i) => at(i, side * o, 0), (i) => at(i, side * o, h), barrierColor), mat));
    }
    group.add(new THREE.Mesh(stripGeometry(n, (i) => at(i, side * inner, h), (i) => at(i, side * outer, h), barrierColor), mat));
  }

  group.add(buildStartLine(points[0], halfWidth));
  group.add(buildGround(track));
  buildDecorations(track).forEach((m) => group.add(m));
  if (track.itemBoxes.length) group.add(buildItemBoxPreview(track));

  // --- Oświetlenie z motywu
  group.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity));
  const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  sun.position.set(...RENDER.sunOffset);
  group.add(sun);

  buildDebug(track, debug);
  return { group, debug };
}

// Tło i mgła sceny z motywu toru.
export function applyThemeToScene(scene, theme, useFog) {
  scene.background = new THREE.Color(theme.sky);
  scene.fog = useFog ? new THREE.Fog(theme.fog, RENDER.fogNear, RENDER.fogFar) : null;
}

// Szachownica startu z kolorowych quadów (bez tekstur).
function buildStartLine(p, halfWidth) {
  const cols = RENDER.startLineColumns, rows = RENDER.startLineRows;
  const cell = (2 * halfWidth) / cols;
  const pos = [], col = [];
  const white = new THREE.Color(0xffffff), black = new THREE.Color(0x111111);
  const pt = (lat, along) => [p.x + p.nx * lat + p.tx * along, RENDER.startLineY, p.z + p.nz * lat + p.tz * along];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const l0 = -halfWidth + c * cell, l1 = l0 + cell;
      const s0 = (r - rows / 2) * cell, s1 = s0 + cell;
      const q = [pt(l0, s0), pt(l1, s0), pt(l1, s1), pt(l0, s0), pt(l1, s1), pt(l0, s1)];
      const color = (r + c) % 2 ? black : white;
      q.forEach((v) => { pos.push(...v); col.push(color.r, color.g, color.b); });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, stripMaterial());
}

function buildGround(track) {
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const m = TRACK.groundMargin;
  const geo = new THREE.PlaneGeometry(maxX - minX + 2 * m, maxZ - minZ + 2 * m);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: track.theme.ground }));
  mesh.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  return mesh;
}

// Drzewa i skały jako InstancedMesh — jeden draw call na rodzaj.
function buildDecorations(track) {
  const { theme, decorations } = track;
  const trees = decorations.filter((d) => d.type === 'tree');
  const rocks = decorations.filter((d) => d.type === 'rock');
  const make = (geo, color, list, yOffset) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), Math.max(list.length, 1));
    mesh.count = list.length;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    list.forEach((d, i) => {
      q.setFromAxisAngle(up, d.rot);
      s.setScalar(d.scale);
      p.set(d.x, yOffset * d.scale, d.z);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    return mesh;
  };
  return [
    make(new THREE.CylinderGeometry(0.35, 0.5, 2, 6), theme.trunk, trees, 1),
    make(new THREE.ConeGeometry(2.2, 5, 7), theme.foliage, trees, 4.4),
    make(new THREE.DodecahedronGeometry(1.6, 0), theme.rock, rocks, 0.8),
  ];
}

// Podgląd rozmieszczenia skrzynek (właściwa logika w etapie 5).
function buildItemBoxPreview(track) {
  const boxes = track.itemBoxes;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshLambertMaterial({ color: track.theme.accent, transparent: true, opacity: 0.85 }),
    boxes.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 4, Math.PI / 4, 0));
  const s = new THREE.Vector3(1, 1, 1);
  boxes.forEach((b, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, 1.4, b.z), q, s)));
  return mesh;
}

// Nakładki debug: linia jazdy botów, checkpointy, pola startowe.
function buildDebug(track, debug) {
  const y = RENDER.debugLineY;
  const rl = track.racingLine.map((p) => new THREE.Vector3(p.x, y, p.z));
  rl.push(rl[0].clone());
  debug.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rl), new THREE.LineBasicMaterial({ color: 0xffee00 })));

  const ck = [], ckStart = [];
  track.checkpoints.forEach((c, k) => {
    const p = track.points[c.index];
    const w = track.outerHalf;
    const seg = [new THREE.Vector3(p.x + p.nx * w, y, p.z + p.nz * w), new THREE.Vector3(p.x - p.nx * w, y, p.z - p.nz * w)];
    (k === 0 ? ckStart : ck).push(...seg);
  });
  debug.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ck), new THREE.LineBasicMaterial({ color: 0x00e5ff })));
  debug.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ckStart), new THREE.LineBasicMaterial({ color: 0xff1744 })));

  const slotGeo = new THREE.BoxGeometry(1.4, 0.3, 2.4);
  const slotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
  for (let i = 0; i < MAX_RACERS; i++) {
    const g = gridSlot(track, i);
    const mesh = new THREE.Mesh(slotGeo, slotMat);
    mesh.position.set(g.x, 0.3, g.z);
    mesh.rotation.y = g.heading;
    debug.add(mesh);
  }
}

// Zwalnia geometrie i materiały (przy ponownej generacji toru).
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}
