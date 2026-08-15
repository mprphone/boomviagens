// Cartao de uma oportunidade no quadro do Pipeline - so o essencial para
// perceber a oportunidade num relance (secao "Cartao da oportunidade"),
// arrastavel entre colunas (drag&drop nativo do browser).

import { esc, money } from '../utils.js';

const TEMPERATURE_ICON = { QUENTE: '🔥', MORNO: '🌤️', FRIO: '❄️' };
const TAG_LABEL = { VIP: 'VIP', FAMILIA: 'Família', LUA_DE_MEL: 'Lua de mel', GRUPO: 'Grupo', URGENTE: 'Urgente' };
const NEXT_ACTION_LABEL = {
  TELEFONAR: 'Telefonar', ENVIAR_EMAIL: 'Enviar email', ENVIAR_WHATSAPP: 'Enviar WhatsApp',
  ENVIAR_PROPOSTA: 'Enviar proposta', CONFIRMAR_DECISAO: 'Confirmar decisão', AGUARDAR_CLIENTE: 'Aguardar cliente', OUTRO: 'Outro'
};

function formatNextAction(o) {
  if (!o.nextActionDate) return '';
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const when = o.nextActionDate === today ? 'Hoje' : o.nextActionDate === tomorrow ? 'Amanhã' : o.nextActionDate;
  const label = NEXT_ACTION_LABEL[o.nextActionType] || o.nextActionType || 'Ação';
  return `${label} · ${when}`;
}

export function renderOpportunityCard(o, staffById) {
  const staff = staffById.get(o.commercialStaffId);
  const paxCount = (o.paxAdults || 0) + (o.paxChildren || 0);
  const nextAction = formatNextAction(o);
  const overdueMark = o.health?.nextActionOverdue ? ' ⚠' : '';

  const card = document.createElement('div');
  card.className = `pipeline-card health-${o.health?.color || 'blue'}`;
  card.draggable = true;
  card.dataset.id = o.id;
  card.innerHTML = `
    <div class="pipeline-card-name">${esc(o.customerName)}</div>
    <div class="pipeline-card-dest">${esc(o.destination || 'Destino por definir')}</div>
    ${o.dateStart ? `<div class="pipeline-card-dates">${esc(o.dateStart)} → ${esc(o.dateEnd || '')} · ${paxCount} passageiro${paxCount === 1 ? '' : 's'}</div>` : ''}
    ${o.tags?.length ? `<div class="pipeline-card-tags">${o.tags.map(t => `<span class="pill">${esc(TAG_LABEL[t] || t)}</span>`).join('')}</div>` : ''}
    <div class="pipeline-card-value">
      <strong>${o.estimatedValue ? money(o.estimatedValue) : '—'}</strong>
      <span>${TEMPERATURE_ICON[o.temperature] || ''}</span>
    </div>
    <div class="pipeline-card-foot">
      <span class="pipeline-card-staff">${staff ? `<span class="staff-color-dot" style="background:${esc(staff.color || '#94a3b8')}"></span>${esc(staff.name)}` : 'Sem responsável'}</span>
      ${nextAction ? `<span>📅 ${esc(nextAction)}${overdueMark}</span>` : ''}
    </div>
    ${o.health?.warnings?.length ? `<div class="pipeline-card-warnings">${o.health.warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}`;

  return card;
}
