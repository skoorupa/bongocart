// =====================================================================
// ui/tournamentView.js — tabela turnieju (po mapie i pod klawiszem Tab).
// Rysuje gotowy widok z tournament.view() / wiadomości "tourney":
// miejsce, kierowca, (pkt, czas) dla każdej mapy, suma pkt, suma czasu.
// =====================================================================
import { formatTime } from '../race.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const cell = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });

// table: element <table>; view: {table, ready, count};
// showReady: kolumna gotowości (✓/⏳) ludzi.
export function renderTournamentTable(table, view, { localId, showReady }) {
  const maps = Array.from({ length: view.count }, (_, i) => i);

  // Nagłówek w dwóch wierszach: "Mapa N" nad parą kolumn pkt / czas.
  const top = document.createElement('tr');
  const sub = document.createElement('tr');
  top.append(cell('th', '', { rowSpan: 2, className: 'pin pin1' }), cell('th', 'Kierowca', { rowSpan: 2, className: 'pin pin2' }));
  for (const i of maps) {
    top.append(cell('th', `Mapa ${i + 1}`, { colSpan: 2, className: 'map' }));
    sub.append(cell('th', 'pkt', { className: 'map' }), cell('th', 'czas'));
  }
  top.append(cell('th', 'Suma pkt', { rowSpan: 2, className: 'map' }), cell('th', 'Suma czasu', { rowSpan: 2 }), cell('th', '', { rowSpan: 2 }));
  const thead = document.createElement('thead');
  thead.append(top, sub);

  const ready = new Set(view.ready);
  const tbody = document.createElement('tbody');
  tbody.append(...view.table.map((r, i) => {
    const tr = document.createElement('tr');
    if (r.id === localId) tr.className = 'me';
    const name = cell('td', '', { className: 'pin pin2' });
    const dot = Object.assign(document.createElement('span'), { className: 'dot' });
    dot.style.background = hex(r.color);
    name.append(dot, r.left ? `${r.name} 🤖` : r.name);
    const readyMark = !showReady || !r.isHuman || r.left ? '' : ready.has(r.id) ? '✓' : '⏳';
    tr.append(cell('td', `${i + 1}.`, { className: 'pin pin1' }), name);
    for (const m of maps) {
      const res = r.maps[m]; // brak = mapa jeszcze nierozegrana
      tr.append(cell('td', res ? String(res.points) : '—', { className: 'map' }), cell('td', res ? formatTime(res.time) : '—'));
    }
    tr.append(cell('td', String(r.points), { className: 'map total' }), cell('td', formatTime(r.time)), cell('td', readyMark));
    return tr;
  }));
  table.replaceChildren(thead, tbody);
}
