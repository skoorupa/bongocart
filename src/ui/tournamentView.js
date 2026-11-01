// =====================================================================
// ui/tournamentView.js — tabela turnieju (po mapie i pod klawiszem Tab).
// Rysuje gotowy widok z tournament.view() / wiadomości "tourney".
// =====================================================================
import { formatTime } from '../race.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// view: {table, ready, phase}; showReady: kolumna gotowości (✓/⏳) ludzi.
export function renderTournamentTable(tbody, view, { localId, showReady }) {
  const ready = new Set(view.ready);
  tbody.replaceChildren(...view.table.map((r, i) => {
    const tr = document.createElement('tr');
    if (r.id === localId) tr.className = 'me';
    const name = document.createElement('td');
    const dot = Object.assign(document.createElement('span'), { className: 'dot' });
    dot.style.background = hex(r.color);
    name.append(dot, r.left ? `${r.name} 🤖` : r.name);
    const readyMark = !showReady || !r.isHuman || r.left ? '' : ready.has(r.id) ? '✓' : '⏳';
    const cells = [`${i + 1}.`, name, r.lastPoints ? `+${r.lastPoints}` : '', String(r.points), formatTime(r.time), readyMark];
    tr.append(...cells.map((c) => (c instanceof HTMLElement ? c : Object.assign(document.createElement('td'), { textContent: c }))));
    return tr;
  }));
}
