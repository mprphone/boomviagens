// Vista "Follow-ups": lista global de proximas acoes de todas as
// oportunidades ativas, agrupada por Atrasadas/Hoje/Proximas - substitui o
// antigo placeholder "em breve" do menu (secao "Oportunidades sem
// atividade" / "Follow-ups"). Reaproveita o mesmo /api/admin/opportunities
// que alimenta o Pipeline, so filtra/agrupa de outra forma.

import { $, esc, api } from './utils.js';
import { openOpportunityPage } from './pipeline.js';

const NEXT_ACTION_LABEL = {
  TELEFONAR: 'Telefonar', ENVIAR_EMAIL: 'Enviar email', ENVIAR_WHATSAPP: 'Enviar WhatsApp',
  ENVIAR_PROPOSTA: 'Enviar proposta', CONFIRMAR_DECISAO: 'Confirmar decisão', AGUARDAR_CLIENTE: 'Aguardar cliente', OUTRO: 'Outro'
};

export async function renderFollowups() {
  const el = $('#view-followups');
  el.innerHTML = `<div class="panel" id="followupsPanel"><p class="muted">A carregar...</p></div>`;
  try {
    const data = await api('/api/admin/opportunities');
    const staffById = new Map((data.staff || []).map(s => [s.id, s]));
    const active = data.opportunities.filter(o => o.stage !== 'GANHO' && o.stage !== 'PERDIDO' && o.nextActionDate);
    const today = new Date().toISOString().slice(0, 10);

    const overdue = active.filter(o => o.nextActionDate < today).sort((a, b) => a.nextActionDate.localeCompare(b.nextActionDate));
    const dueToday = active.filter(o => o.nextActionDate === today);
    const upcoming = active.filter(o => o.nextActionDate > today).sort((a, b) => a.nextActionDate.localeCompare(b.nextActionDate));
    const withoutAction = data.opportunities.filter(o => o.stage !== 'GANHO' && o.stage !== 'PERDIDO' && !o.nextActionDate);

    function group(title, list, pillClass) {
      if (!list.length) return '';
      return `
        <p class="summary-block-label">${title} (${list.length})</p>
        <div class="customer-trip-list">
          ${list.map(o => `
            <div class="customer-trip-row" data-opportunity="${esc(o.id)}" style="cursor:pointer">
              <div>
                <b>${esc(o.customerName)}</b>
                <span class="muted">${esc(o.destination || '')}</span>
                <div class="muted small">${esc(NEXT_ACTION_LABEL[o.nextActionType] || o.nextActionType || 'Ação')}${o.nextActionNotes ? ` · ${esc(o.nextActionNotes)}` : ''}</div>
              </div>
              <div class="customer-trip-side">
                <span class="pill ${pillClass}">${esc(o.nextActionDate)}</span>
                ${staffById.get(o.commercialStaffId) ? `<span class="muted small">${esc(staffById.get(o.commercialStaffId).name)}</span>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
    }

    $('#followupsPanel').innerHTML = `
      ${group('Atrasadas', overdue, 'pill-warning')}
      ${group('Hoje', dueToday, '')}
      ${group('Próximas', upcoming, 'pill-ok')}
      ${withoutAction.length ? `
        <p class="summary-block-label">Sem próxima ação definida (${withoutAction.length})</p>
        <div class="customer-trip-list">
          ${withoutAction.map(o => `
            <div class="customer-trip-row" data-opportunity="${esc(o.id)}" style="cursor:pointer">
              <div><b>${esc(o.customerName)}</b> <span class="muted">${esc(o.destination || '')}</span></div>
            </div>`).join('')}
        </div>` : ''}
      ${!overdue.length && !dueToday.length && !upcoming.length && !withoutAction.length ? '<p class="empty-note">Sem oportunidades ativas.</p>' : ''}`;

    document.querySelectorAll('#followupsPanel [data-opportunity]').forEach(row => {
      row.onclick = () => openOpportunityPage(row.dataset.opportunity);
    });
  } catch (err) {
    $('#followupsPanel').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}
