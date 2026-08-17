// Separador "Resumo": o mais curto de todos, orientado a excecoes e
// pendencias - o cabecalho fixo (ver ./reservationDetail.js) ja mostra
// destino/datas/pax/estado/alertas/financeiro resumido, por isso aqui nao
// se repete nada disso. So o que precisa de acao ("A tratar"), o estado
// da documentacao, um resumo financeiro previsto-vs-real e o essencial da
// viagem. Detalhe fica sempre no separador proprio.

import { esc, money, api } from '../utils.js';
import { computeServiceTotals } from './serviceCalc.js';

const SEVERITY_ICON = { critical: '🔴', warning: '🟡' };
const VAT_LABEL = { MARGEM: 'Regime da margem', ISENTO: 'Isento', REDUZIDA: 'Taxa reduzida', NORMAL: 'Normal' };

function docStatus(documents, passengers) {
  const passportCount = (passengers?.length ? passengers : [{}]).filter(p =>
    documents.some(d => d.type === 'PASSPORT' && (!p.name || d.passengerName === p.name))
  ).length;
  const totalPax = passengers?.length || 1;
  const hasInsurance = documents.some(d => d.type === 'INSURANCE');
  const hasTicket = documents.some(d => d.type === 'TICKET');
  const hasVoucher = documents.some(d => d.type === 'VOUCHER');
  return [
    { label: `Passaportes ${passportCount}/${totalPax}`, ok: passportCount === totalPax },
    { label: hasTicket ? 'Bilhetes' : 'Bilhetes pendentes', ok: hasTicket },
    { label: hasInsurance ? 'Seguro' : 'Seguro pendente', ok: hasInsurance },
    { label: hasVoucher ? 'Vouchers' : 'Vouchers pendentes', ok: hasVoucher }
  ];
}

function manualConfirmationDetails() {
  const manualLocator = prompt('Localizador real do operador (obrigatório para confirmação manual):')?.trim() || '';
  if (!manualLocator) throw new Error('Confirmação cancelada: falta o localizador real do operador.');
  const manualConfirmationReason = prompt('Como foi confirmada? Ex.: portal do operador, telefone, email:')?.trim() || '';
  if (!manualConfirmationReason) throw new Error('Confirmação cancelada: indique como verificou a reserva.');
  return { manualLocator, manualConfirmationReason };
}

export function renderSummaryTab(panel, reservation, reload, data = {}) {
  const statuses = data.statuses || [];
  const serviceLines = data.serviceLines || [];
  const tasks = data.tasks || [];
  const alerts = data.alerts || [];
  const documents = data.documents || [];
  const offer = reservation.offer || {};
  const costPrice = Number(offer.costPrice) || 0;
  const hasRealValues = serviceLines.length > 0;
  const totals = computeServiceTotals(serviceLines);
  const deviation = hasRealValues ? Number((totals.netTotal - costPrice).toFixed(2)) : 0;
  const vatRegime = reservation.vatRegime || 'MARGEM';

  const pendingTasks = tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const toHandle = [
    ...alerts.map(a => ({ icon: SEVERITY_ICON[a.severity] || '•', text: a.message })),
    ...pendingTasks.slice(0, 4).map(t => ({ icon: '📋', text: t.dueDate ? `${t.description} · até ${t.dueDate}` : t.description }))
  ];

  const docs = docStatus(documents, reservation.passengers);
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

    <p class="summary-block-label">A tratar neste processo</p>
    ${toHandle.length ? `
      <div class="to-handle-list">
        ${toHandle.map(t => `<div class="to-handle-item">${t.icon} ${esc(t.text)}</div>`).join('')}
      </div>` : '<p class="empty-note">Nada pendente - o processo está em dia.</p>'}

    <p class="summary-block-label">Documentação</p>
    <div class="doc-status-row">
      ${docs.map(d => `<span class="doc-status-chip ${d.ok ? 'doc-status-ok' : 'doc-status-pending'}">${d.ok ? '✓' : '○'} ${esc(d.label)}</span>`).join('')}
    </div>

    <p class="summary-block-label">Financeiro</p>
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Custo previsto</span><strong>${money(costPrice)}</strong></div>
      ${hasRealValues ? `
        <div class="summary-financial-block"><span class="muted small">Custo real</span><strong>${money(totals.netTotal)}</strong></div>
        <div class="summary-financial-block"><span class="muted small">Desvio</span><strong class="${deviation > 0 ? 'margin-diff-negative' : deviation < 0 ? 'margin-diff-positive' : ''}">${deviation >= 0 ? '+' : ''}${money(deviation)}</strong></div>
      ` : `<div class="summary-financial-block"><span class="muted small">Custo real</span><strong class="muted">ainda sem reservas lançadas</strong></div>`}
    </div>
    <p class="summary-detail-line">IVA: ${esc(VAT_LABEL[vatRegime] || vatRegime)} <span class="muted small">— ver separador Financeiro › IVA</span></p>

    <p class="summary-block-label">Viagem</p>
    <div class="summary-detail-line"><b>Hotel:</b> ${esc(offer.hotel || '')}${offer.country ? ` · ${esc(offer.country)}` : ''}</div>
    <div class="summary-detail-line"><b>Operador principal:</b> ${esc(reservation.operator || 'não definido')}</div>
    ${reservation.notes ? `<div class="summary-detail-line"><b>Notas:</b> ${esc(reservation.notes)}</div>` : ''}

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
      await api('/api/admin/reservations/update', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, status, ...(status === 'CONFIRMED' ? manualConfirmationDetails() : {}) }) });
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
