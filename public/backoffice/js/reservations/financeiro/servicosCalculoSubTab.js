// Sub-separador "Serviços e Cálculo": tabela unica com custo, venda,
// margem e IVA de cada reserva (voo, hotel, seguro...) - o equivalente
// moderno ao "Serviços/Cálculos" do OptiTravel. Clicar numa linha abre a
// mesma gaveta lateral do separador "Reservas" (ver
// ../reservationLineDrawer.js) - o detalhe completo (localizador, datas,
// condições de cancelamento, anexos) já existe ali, não faz sentido
// duplicar.

import { esc, money } from '../../utils.js';
import { lineTotal, serviceStatusPillClass } from '../serviceCalc.js';
import { openLineDrawer } from '../reservationLineDrawer.js';

const TYPE_ICON = {
  VOO: '✈️', ALOJAMENTO: '🏨', TRANSFER: '🚌', CRUZEIRO: '🚢', RENT_A_CAR: '🚗',
  SEGURO: '🛡️', VISTO: '📄', RESTAURACAO: '🍽️', TOUR: '🎟️', DIVERSOS: '📦'
};
const VAT_ABBR = { MARGEM: 'RM', ISENTO: 'Isento', REDUZIDA: 'Red.', NORMAL: 'Normal' };

// Seguro de viagem e tipicamente isento de IVA (intermediacao de seguros,
// Art. 9º CIVA), independentemente do regime aplicado ao resto do pacote -
// so apresentacao, nao um campo gravado por linha.
function vatBadge(line, reservationVatRegime) {
  if (line.type === 'SEGURO') return 'Isento';
  return VAT_ABBR[reservationVatRegime] || reservationVatRegime;
}

export function renderServicosCalculoSubTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const types = data.serviceTypes || [];
  const statuses = data.serviceStatuses || [];
  const typeLabel = value => types.find(t => t.value === value)?.label || value;
  const statusLabel = value => statuses.find(s => s.value === value)?.label || value;

  const active = lines.filter(l => l.status !== 'CANCELADO');
  const totalNet = active.reduce((sum, l) => sum + (Number(l.netValue) || 0) * (Number(l.quantity) || 1), 0);
  const totalPvp = active.reduce((sum, l) => sum + lineTotal(l), 0);
  const totalMargin = Number((totalPvp - totalNet).toFixed(2));
  const marginPercent = totalPvp ? (totalMargin / totalPvp) * 100 : 0;

  panel.innerHTML = `
    <div class="tab-toolbar">
      <p class="summary-block-label" style="margin:0">Serviços e cálculo</p>
      <button type="button" class="btn mini-action reservation-line-add">+ Adicionar serviço</button>
    </div>
    <div class="bo-table-wrap">
      <table class="bo-table service-lines-table">
        <thead>
          <tr>
            <th></th><th>Serviço</th><th>Fornecedor</th><th>Ref./Localizador</th>
            <th>Custo (NET)</th><th>PVP</th><th>Margem</th><th>IVA</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${lines.map(l => {
            const net = (Number(l.netValue) || 0) * (Number(l.quantity) || 1);
            const pvp = lineTotal(l);
            const margin = Number((pvp - net).toFixed(2));
            const marginPct = pvp ? (margin / pvp) * 100 : 0;
            return `
            <tr data-line="${esc(l.id)}">
              <td>${TYPE_ICON[l.type] || '•'}</td>
              <td>${esc(typeLabel(l.type))}${l.description ? `<div class="muted small">${esc(l.description)}</div>` : ''}</td>
              <td class="muted small">${esc(l.supplierName || '')}</td>
              <td class="muted small">${esc(l.locator || l.reference || '')}</td>
              <td>${money(net)}</td>
              <td>${money(pvp)}</td>
              <td><b>${money(margin)}</b><div class="muted small">${marginPct.toFixed(2)}%</div></td>
              <td class="muted small">${esc(vatBadge(l, reservation.vatRegime))}</td>
              <td><span class="pill ${serviceStatusPillClass(l.status)}">${esc(statusLabel(l.status))}</span></td>
              <td class="service-line-actions"><button type="button" class="icon-action service-line-row-edit" title="Ver/editar">✎</button></td>
            </tr>`;
          }).join('') || `<tr><td colspan="10" class="empty-note">Ainda sem serviços registados neste processo.</td></tr>`}
        </tbody>
        ${lines.length ? `
          <tfoot>
            <tr>
              <td colspan="4"></td>
              <td><b>${money(totalNet)}</b></td>
              <td><b>${money(totalPvp)}</b></td>
              <td><b>${money(totalMargin)}</b><div class="muted small">${marginPercent.toFixed(2)}%</div></td>
              <td colspan="3"></td>
            </tr>
          </tfoot>` : ''}
      </table>
    </div>`;

  panel.querySelector('.reservation-line-add').onclick = () => openLineDrawer(reservation, null, data, reload);
  panel.querySelectorAll('.service-lines-table tbody tr[data-line]').forEach(row => {
    const openThis = () => {
      const line = lines.find(l => l.id === row.dataset.line);
      if (line) openLineDrawer(reservation, line, data, reload);
    };
    row.onclick = openThis;
    row.querySelector('.service-line-row-edit').onclick = ev => { ev.stopPropagation(); openThis(); };
  });
}
