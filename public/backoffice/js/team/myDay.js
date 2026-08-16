// Separador "O Meu Dia" (secao "Gestão diária do colaborador"): o que o
// colaborador com sessão iniciada tem para tratar hoje - follow-ups,
// tarefas, documentação em falta, viagens próximas e reclamações abertas
// dos processos onde é o responsável operacional.

import { $, esc, api } from '../utils.js';

const NEXT_ACTION_LABEL = {
  TELEFONAR: 'Telefonar', ENVIAR_EMAIL: 'Enviar email', ENVIAR_WHATSAPP: 'Enviar WhatsApp',
  ENVIAR_PROPOSTA: 'Enviar proposta', CONFIRMAR_DECISAO: 'Confirmar decisão', AGUARDAR_CLIENTE: 'Aguardar cliente', OUTRO: 'Outro'
};

export async function renderMeuDia() {
  const el = $('#view-meu-dia');
  el.innerHTML = `<div class="panel" id="myDayPanel"><p class="muted">A carregar...</p></div>`;
  try {
    const session = await api('/api/admin/session');
    if (!session.staff) { $('#myDayPanel').innerHTML = '<p class="empty-note">Sessão sem colaborador associado.</p>'; return; }
    const data = await api(`/api/admin/team/my-day?staffId=${encodeURIComponent(session.staff.id)}`);
    renderDay(data);
  } catch (err) {
    $('#myDayPanel').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function section(title, count, bodyHtml) {
  return `
    <p class="summary-block-label">${esc(title)} (${count})</p>
    ${bodyHtml}`;
}

function renderDay(data) {
  const followUpsHtml = data.followUpsToday.length ? `
    <div class="customer-trip-list">
      ${data.followUpsToday.map(f => `
        <div class="customer-trip-row">
          <div><b>${esc(f.customerName)}</b><div class="muted small">${esc(NEXT_ACTION_LABEL[f.nextActionType] || f.nextActionType || 'Ação')}${f.nextActionNotes ? ` · ${esc(f.nextActionNotes)}` : ''}</div></div>
        </div>`).join('')}
    </div>` : '<p class="empty-note">Sem follow-ups para hoje.</p>';

  const tasksHtml = data.tasks.length ? `
    <div class="complaint-list">
      ${data.tasks.map(t => `
        <div class="complaint-item">
          <div class="complaint-head"><b>${esc(t.description)}</b>${t.overdue ? '<span class="pill pill-warning">Atrasada</span>' : ''}</div>
          <p class="muted small">${t.dueDate ? `prazo ${esc(t.dueDate)}` : 'sem prazo'}</p>
        </div>`).join('')}
    </div>` : '<p class="empty-note">Sem tarefas pendentes.</p>';

  const docsHtml = data.missingDocs.length ? `
    <div class="customer-trip-list">
      ${data.missingDocs.map(d => `
        <div class="customer-trip-row">
          <div><b>${esc(d.processNumber)}</b> <span class="muted">${esc(d.customerName || '')}</span>
            <div class="muted small">${esc(d.missing.join(', '))}</div>
          </div>
        </div>`).join('')}
    </div>` : '<p class="empty-note">Sem documentação em falta.</p>';

  const tripsHtml = data.upcomingTrips.length ? `
    <div class="customer-trip-list">
      ${data.upcomingTrips.map(t => `
        <div class="customer-trip-row">
          <div><b>${esc(t.processNumber)}</b> <span class="muted">${esc(t.customerName || '')} · ${esc(t.destination || '')}</span></div>
          <div class="customer-trip-side"><span class="pill">${esc(t.checkin || '')}</span></div>
        </div>`).join('')}
    </div>` : '<p class="empty-note">Sem viagens próximas.</p>';

  const complaintsHtml = data.openComplaints.length ? `
    <div class="complaint-list">
      ${data.openComplaints.map(c => `
        <div class="complaint-item">
          <div class="complaint-head"><b>${esc(c.subject)}</b><span class="pill pill-warning">${esc(c.processNumber)}</span></div>
        </div>`).join('')}
    </div>` : '<p class="empty-note">Sem reclamações abertas.</p>';

  $('#myDayPanel').innerHTML = `
    <p class="process-header-title" style="margin-bottom:16px"><b>${esc(data.staff.name)}</b> · hoje</p>
    ${section('Follow-ups', data.followUpsToday.length, followUpsHtml)}
    ${section('Tarefas', data.tasks.length, tasksHtml)}
    ${section('Documentação em falta', data.missingDocs.length, docsHtml)}
    ${section('Viagens próximas (14 dias)', data.upcomingTrips.length, tripsHtml)}
    ${section('Reclamações abertas', data.openComplaints.length, complaintsHtml)}`;
}
