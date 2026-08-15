// Separador "Resumo": o dashboard do processo - deve ser o ecra mais
// simples de todos, dando para perceber em segundos se ha algo a tratar.
// Dados da viagem, resumo financeiro (estimado vs real), situacao
// operacional e as proximas tarefas pendentes. Nada de detalhe aqui - isso
// fica nos separadores especificos.

import { esc, money, api } from '../utils.js';
import { computeServiceTotals } from './serviceCalc.js';

// Mesma formula de src/pricing.js#marginSchemeVat - duplicada aqui de
// proposito (o backoffice nao importa ficheiros do servidor).
function marginSchemeVat(marginValue, vatRate = 23) {
  const margin = Number(marginValue) || 0;
  const vatAmount = Number((margin - margin / (1 + vatRate / 100)).toFixed(2));
  return { vatAmount, netMargin: Number((margin - vatAmount).toFixed(2)) };
}

const SEVERITY_ICON = { critical: '🔴', warning: '🟡' };

export function renderSummaryTab(panel, reservation, reload, data = {}) {
  const statuses = data.statuses || [];
  const serviceLines = data.serviceLines || [];
  const payments = data.payments || [];
  const tasks = data.tasks || [];
  const alerts = data.alerts || [];
  const offer = reservation.offer || {};
  const costPrice = Number(offer.costPrice) || 0;
  const finalPrice = Number(offer.finalPrice) || 0;
  const hasRealValues = serviceLines.length > 0;
  const totals = computeServiceTotals(serviceLines);
  const margin = hasRealValues ? totals.margin : Number(offer.marginValue ?? (finalPrice - costPrice));
  const vatRegime = reservation.vatRegime || 'MARGEM';
  const { vatAmount, netMargin } = marginSchemeVat(margin);

  const totalPaid = payments.filter(p => p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
  const dueFromCustomer = Math.max(0, finalPrice - totalPaid);
  const totalPaidToSuppliers = serviceLines.filter(l => l.paid).reduce((sum, l) => sum + (l.netValue || 0) * (l.quantity || 1), 0);
  const dueToSuppliers = Math.max(0, totals.netTotal - totalPaidToSuppliers);

  const confirmedLines = serviceLines.filter(l => l.status === 'OK').length;
  const pendingTasks = tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const openComplaints = (data.complaints || []).filter(c => !['RESOLVED', 'CLOSED'].includes(c.status));
  const tripEnded = offer.checkout && offer.checkout < new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <div class="reservation-status-row">
      <label>Estado do processo
        <select class="summary-status-select">
          ${statuses.map(s => `<option value="${s.value}" ${s.value === reservation.status ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn mini-action summary-status-save">Guardar estado</button>
      <p class="customer-form-message"></p>
    </div>

    <p class="summary-block-label">Dados da viagem</p>
    <div class="summary-detail-line"><b>Cliente:</b> ${esc(reservation.customer?.name || '')} · ${esc(reservation.customer?.email || '')}</div>
    <div class="summary-detail-line"><b>Hotel:</b> ${esc(offer.hotel || '')} · ${esc(offer.destination || '')}${offer.country ? `, ${esc(offer.country)}` : ''}</div>
    <div class="summary-detail-line"><b>Datas:</b> ${esc(offer.checkin || '')} → ${esc(offer.checkout || '')} (${offer.nights || 0} noites)</div>
    <div class="summary-detail-line"><b>Operador principal:</b> ${esc(reservation.operator || 'não definido')}</div>
    ${reservation.notes ? `<div class="summary-detail-line"><b>Notas:</b> ${esc(reservation.notes)}</div>` : ''}

    <p class="summary-block-label">Resumo financeiro</p>
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Venda</span><strong>${money(finalPrice)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Compras${hasRealValues ? ' (real)' : ' (estimado)'}</span><strong>${money(hasRealValues ? totals.netTotal : costPrice)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Margem</span><strong>${money(margin)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Recebido</span><strong>${money(totalPaid)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Por receber</span><strong>${money(dueFromCustomer)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Pago a fornecedores</span><strong>${money(totalPaidToSuppliers)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Por pagar a fornecedores</span><strong>${money(dueToSuppliers)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Regime de IVA</span><strong>${vatRegime === 'MARGEM' ? 'Regime da margem' : vatRegime === 'ISENTO' ? 'Isento' : vatRegime === 'REDUZIDA' ? 'Taxa reduzida' : 'Normal'}</strong></div>
    </div>
    ${vatRegime === 'MARGEM' ? `
      <div class="summary-vat-note">
        <p><b>Estimativa - regime da margem (Art. 308º CIVA):</b> o IVA incide só sobre a margem, à taxa normal (23%), já incluído no seu valor.</p>
        <div class="summary-financial-grid">
          <div class="summary-financial-block"><span class="muted small">IVA sobre a margem (estimado)</span><strong>${money(vatAmount)}</strong></div>
          <div class="summary-financial-block"><span class="muted small">Margem líquida (estimada)</span><strong>${money(netMargin)}</strong></div>
        </div>
        <p class="muted small">Valor indicativo para gestão interna - a fatura oficial é sempre emitida em software certificado pela AT.</p>
      </div>` : ''}

    <p class="summary-block-label">Situação operacional</p>
    <div class="summary-status-grid">
      <div class="summary-status-item">Serviços: <b>${confirmedLines}/${serviceLines.length || 0} confirmados</b></div>
      <div class="summary-status-item">Documentação: <b>${reservation.missingDocuments?.length ? `${reservation.missingDocuments.length} em falta` : 'completa'}</b></div>
      <div class="summary-status-item">Pagamentos cliente: <b>${dueFromCustomer > 0 ? 'pendente' : 'em dia'}</b></div>
      <div class="summary-status-item">Pagamentos fornecedores: <b>${dueToSuppliers > 0 ? 'pendente' : 'em dia'}</b></div>
      <div class="summary-status-item">Reclamações: <b>${openComplaints.length || 'nenhuma'}</b></div>
    </div>

    ${alerts.length ? `
      <p class="summary-block-label">Alertas</p>
      <div class="summary-alerts-list">
        ${alerts.map(a => `<div class="summary-alert summary-alert-${a.severity}">${SEVERITY_ICON[a.severity] || ''} ${esc(a.message)}</div>`).join('')}
      </div>` : ''}

    <p class="summary-block-label">Próximas ações</p>
    ${pendingTasks.length ? `
      <div class="summary-task-list">
        ${pendingTasks.slice(0, 6).map(t => `<div class="summary-task-item"><span>${esc(t.description)}</span>${t.dueDate ? `<span class="muted small">${esc(t.dueDate)}</span>` : ''}</div>`).join('')}
      </div>` : '<p class="empty-note">Sem tarefas pendentes.</p>'}

    ${tripEnded || reservation.postTripOk !== undefined ? `
      <p class="summary-block-label">Pós-viagem</p>
      <form class="posttrip-form">
        <label class="service-line-checkbox"><input type="radio" name="postTripOk" value="true" ${reservation.postTripOk === true ? 'checked' : ''} /> A viagem correu normalmente</label>
        <label class="service-line-checkbox"><input type="radio" name="postTripOk" value="false" ${reservation.postTripOk === false ? 'checked' : ''} /> Houve problemas</label>
        <textarea name="postTripNotes" rows="2" placeholder="Notas (se houve problemas, registe também uma ocorrência ou reclamação)">${esc(reservation.postTripNotes || '')}</textarea>
        <button class="btn mini-action" type="submit">Guardar</button>
        <p class="customer-form-message posttrip-message"></p>
      </form>` : ''}
  `;

  panel.querySelector('.summary-status-save').onclick = async () => {
    const btn = panel.querySelector('.summary-status-save');
    const msg = panel.querySelector('.customer-form-message');
    const status = panel.querySelector('.summary-status-select').value;
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/reservations/update', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, status }) });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar estado';
    }
  };

  panel.querySelector('.posttrip-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.posttrip-message');
    const checked = f.querySelector('input[name=postTripOk]:checked');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/reservations/posttrip', {
        method: 'POST',
        body: JSON.stringify({ reservationId: reservation.id, postTripOk: checked ? checked.value === 'true' : null, postTripNotes: f.postTripNotes.value })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
