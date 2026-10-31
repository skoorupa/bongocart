// =====================================================================
// ui/minimap.js — minimapa 2D na <canvas>. Tor rysowany raz do bufora,
// co klatkę tylko kropki kartów.
// =====================================================================
import { RENDER } from '../config.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

export function createMinimap(canvas) {
  const size = RENDER.minimapSize;
  const dpr = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio);
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  base.width = base.height = size * dpr;
  let toMap = null;

  return {
    setTrack(track) {
      const { minX, maxX, minZ, maxZ } = track.bounds;
      const pad = RENDER.minimapPadding;
      const scale = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
      const ox = pad + ((size - 2 * pad) - (maxX - minX) * scale) / 2;
      const oz = pad + ((size - 2 * pad) - (maxZ - minZ) * scale) / 2;
      toMap = (x, z) => [(ox + (x - minX) * scale) * dpr, (oz + (z - minZ) * scale) * dpr];

      const b = base.getContext('2d');
      b.clearRect(0, 0, base.width, base.height);
      const path = new Path2D();
      track.points.forEach((p, i) => { const [x, y] = toMap(p.x, p.z); i ? path.lineTo(x, y) : path.moveTo(x, y); });
      path.closePath();
      b.lineJoin = 'round';
      b.strokeStyle = 'rgba(0,0,0,0.55)';
      b.lineWidth = Math.max(6, track.width * scale + 4) * dpr;
      b.stroke(path);
      b.strokeStyle = '#e8e8e8';
      b.lineWidth = Math.max(3, track.width * scale) * dpr;
      b.stroke(path);

      // Linia startu
      const p = track.points[0], w = track.halfWidth * 1.6;
      const [x1, y1] = toMap(p.x + p.nx * w, p.z + p.nz * w);
      const [x2, y2] = toMap(p.x - p.nx * w, p.z - p.nz * w);
      b.strokeStyle = '#ff1744';
      b.lineWidth = 3 * dpr;
      b.beginPath(); b.moveTo(x1, y1); b.lineTo(x2, y2); b.stroke();
    },

    // karts: [{x, z, color (0xRRGGBB), isLocal}]
    draw(karts = []) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      if (!toMap) return;
      for (const k of karts) {
        const [x, y] = toMap(k.x, k.z);
        ctx.fillStyle = hex(k.color);
        ctx.strokeStyle = k.isLocal ? '#fff' : '#000';
        ctx.lineWidth = (k.isLocal ? 2.5 : 1.5) * dpr;
        ctx.beginPath(); ctx.arc(x, y, (k.isLocal ? 6 : 4.5) * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    },
  };
}
