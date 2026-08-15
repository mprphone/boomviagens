// Separador "Resumo": so o essencial para perceber a oportunidade num
// relance (secao "Resumo da oportunidade") + o bloco "A tratar" sempre
// visivel. GANHO/PERDIDO so se mudam a partir do quadro do Pipeline
// (arrasto), que tem os fluxos dedicados (motivo da perda, conversao em
// processo) - aqui so as fases intermedias.

import { esc, money, api } from '../../utils.js';
import { openReservationPage } from '../../reservations.js';
import { openDrawer, closeDrawer } from '../../drawer.js';

const TEMPERATURE_ICON = { QUENTE: '🔥 Quente', MORNO: '🌤️ Morno', FRIO: '❄️ Frio' };
const INTERMEDIATE_STAGES = ['NOVO_INTERESSE', 'CONTACTADO', 'A_PREPARAR_PROPOSTA', 'PROPOSTA_ENVIADA', 'FOLLOW_UP', 'NEGOCIACAO'];

export function renderResumoTab(panel, data, opportunityId, reload) {
  const o = data.opportunity;
  const staffById = new Map((data.staff || []).map(s => [s.id, s]));
  const commercial = staffById.get(o.commercialStaffId);
  const paxCount = (o.paxAdults || 0) + (o.paxChildren || 0);
  const stages = (data.stages || []).filter(s => INTERMEDIATE_STAGES.includes(s.value));
  const originLabel = (data.origins || []).find(x => x.value === o.origin)?.label || o.origin || '—';
  const stageLabel = (data.stages || []).find(x => x.value === o.stage)?.label || o.stage;

  panel.innerHTML = `
    ${o.health?.warnings?.length ? `
      <p class="summary-block-label" style="margin-top:0">A tratar</p>
      <div class="to-handle-list">
        ${o.health.warnings.map(w => `<div class="to-handle-item">⚠ ${esc(w)}</div>`).join('')}
      </div>` : ''}

    <div class="summary-card">
      <div class="drawer-field-grid">
        <div><span class="muted small">Cliente</span><div>${esc(o.customerName)}</div></div>
        <div><span class="muted small">Contactos</span><div>${esc(o.customerEmail || '—')}${o.customerPhone ? ` · ${esc(o.customerPhone)}` : ''}</div></div>
        <div><span class="muted small">Destino</span><div>${esc(o.destination || '—')}</div></div>
        <div><span class="muted small">Datas</span><div>${o.dateStart ? `${esc(o.dateStart)} → ${esc(o.dateEnd || '')}` : '—'}</div></div>
        <div><span class="muted small">Passageiros</span><div>${paxCount || '—'}</div></div>
        <div><span class="muted small">Valor potencial</span><div><b>${o.estimatedValue ? money(o.estimatedValue) : '—'}</b></div></div>
        <div><span class="muted small">Probabilidade</span><div>${o.probability != null ? `${o.probability}%` : '—'}</div></div>
        <div><span class="muted small">Responsável</span><div>${commercial ? esc(commercial.name) : 'Por atribuir'}</div></div>
        <div><span class="muted small">Temperatura</span><div>${TEMPERATURE_ICON[o.temperature] || o.temperature}</div></div>
        <div><span class="muted small">Origem</span><div>${esc(originLabel)}</div></div>
        <div><span class="muted small">Próxima ação</span><div>${o.nextActionDate ? `${esc(o.nextActionType || '')} · ${esc(o.nextActionDate)}` : '—'}</div></div>
      </div>
    </div>

    ${o.reservationId ? `
      <div class="summary-card">
        <p class="summary-block-label" style="margin-top:0">Processo de viagem</p>
        <button type="button" class="btn mini-action open-reservation">Abrir processo ${esc(data.reservation?.processNumber || '')}</button>
      </div>` : o.stage === 'GANHO' ? `
      <div class="summary-card">
        <p class="summary-block-label" style="margin-top:0">Oportunidade ganha</p>
        <p class="muted">Ainda não foi criado o processo de viagem.</p>
        <button type="button" class="btn mini-action convert-btn">Converter em processo</button>
      </div>` : ''}

    ${INTERMEDIATE_STAGES.includes(o.stage) ? `
      <div class="summary-card">
        <p class="summary-block-label" style="margin-top:0">Estado do processo comercial</p>
        <form class="stage-form">
          <select name="stage">${stages.map(s => `<option value="${s.value}" ${s.value === o.stage ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
          <button class="btn mini-action" type="submit">Guardar</button>
        </form>
        <p class="muted small">Para marcar como Ganho ou Perdido, arraste o cartão desta oportunidade no Pipeline.</p>
      </div>` : `<p class="muted">Estado atual: <b>${esc(stageLabel)}</b>${o.stage === 'PERDIDO' && o.lossReason ? ` · Motivo: ${esc(o.lossReason)}` : ''}</p>`}`;

  panel.querySelector('.open-reservation')?.addEventListener('click', () => openReservationPage(o.reservationId));

  panel.querySelector('.convert-btn')?.addEventListener('click', () => {
    const operationalStaff = (data.staff || []).filter(s => s.role === 'OPERACIONAL' || s.role === 'ADMIN');
    const body = openDrawer('Converter em processo');
    body.innerHTML = `
      <form class="convert-form">
        <label>Responsável operacional
          <select name="operationalStaffId">
            <option value="">Por definir</option>
            ${operationalStaff.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
          </select>
        </label>
        <div class="service-line-form-actions"><button class="btn mini-action" type="submit">Criar processo</button></div>
        <p class="customer-form-message"></p>
      </form>`;
    body.querySelector('.convert-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = ev.target;
      const btn = f.querySelector('button[type=submit]');
      const msg = body.querySelector('.customer-form-message');
      btn.disabled = true;
      try {
        await api('/api/admin/opportunities/convert', { method: 'POST', body: JSON.stringify({ id: opportunityId, operationalStaffId: f.operationalStaffId.value }) });
        closeDrawer();
        await reload();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    };
  });

  panel.querySelector('.stage-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/admin/opportunities/stage', { method: 'POST', body: JSON.stringify({ id: opportunityId, stage: e.target.stage.value }) });
      await reload();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  });
}
