// Separador "Reservas": onde estao os voos, hoteis, seguros, transfers...
// desta viagem. A tabela e so um resumo - clicar numa linha abre a ficha
// lateral com o detalhe completo (localizador, fornecedor, condicoes de
// cancelamento, anexos) em vez de encher o ecra principal com um
// formulario permanente - ver ./reservationLineDrawer.js.

import { esc, money } from '../utils.js';
import { lineTotal } from './serviceCalc.js';
import { openLineDrawer } from './reservationLineDrawer.js';

export function renderServicesTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const types = data.serviceTypes || [];
  const statuses = data.serviceStatuses || [];
  const totals = data.serviceTotals || { netTotal: 0, pvpTotal: 0, margin: 0 };

  const typeLabel = value => types.find(t => t.value === value)?.label || value;
  const statusLabel = value => statuses.find(s => s.value === value)?.label || value;

  panel.innerHTML = `
    <div class="tab-toolbar">
      <button type="button" class="btn mini-action reservation-line-add">+ Adicionar reserva</button>
    </div>
    <div class="bo-table-wrap">
      <table class="bo-table service-lines-table">
        <thead>
          <tr>
            <th>Tipo</th><th>Descrição</th><th>Fornecedor</th><th>Localizador</th><th>Datas</th>
            <th>Estado</th><th>A Faturar</th><th>Pago forn.</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map(l => `
            <tr data-line="${esc(l.id)}">
              <td>${esc(typeLabel(l.type))}</td>
              <td>${esc(l.description)}</td>
              <td class="muted small">${esc(l.supplierName || '')}</td>
              <td class="muted small">${esc(l.locator || '')}</td>
              <td class="muted small">${esc(l.dateStart || '')}${l.dateEnd ? ` → ${esc(l.dateEnd)}` : ''}</td>
              <td class="service-line-status"><span class="pill ${l.status === 'CANCELADO' ? 'pill-warning' : l.status === 'OK' ? 'pill-ok' : ''}">${esc(statusLabel(l.status))}</span></td>
              <td class="service-line-total"><b>${money(lineTotal(l))}</b></td>
              <td>${l.paid ? '<span class="pill pill-ok">Pago</span>' : '<span class="pill pill-warning">Pendente</span>'}</td>
            </tr>`).join('') || `<tr><td colspan="8" class="empty-note">Ainda sem reservas registadas neste processo.</td></tr>`}
        </tbody>
        ${lines.length ? `
          <tfoot>
            <tr>
              <td colspan="6"></td>
              <td><b>${money(totals.pvpTotal)}</b></td>
              <td></td>
            </tr>
          </tfoot>` : ''}
      </table>
    </div>`;

  panel.querySelector('.reservation-line-add').onclick = () => openLineDrawer(reservation, null, data, reload);
  panel.querySelectorAll('.service-lines-table tbody tr[data-line]').forEach(row => {
    row.onclick = () => {
      const line = lines.find(l => l.id === row.dataset.line);
      if (line) openLineDrawer(reservation, line, data, reload);
    };
  });
}
