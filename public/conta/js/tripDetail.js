// Pagina propria de uma viagem (separador "As minhas viagens" > clicar
// numa) - cabecalho + separadores Resumo/A minha viagem/Documentos/
// Pagamentos/Gerir viagem/Ajuda, tudo a partir de
// /api/customer/reservations/detail. "Gerir viagem" e "Ajuda" ficam
// propositadamente simples nesta fase - completam-se nas fases seguintes
// (comprar extras/alteracoes/cancelamento, reclamacoes do cliente).

import { $, esc, money, dateRange, shortDate, api } from './utils.js';
import { renderReservationDocuments } from './documents.js';

const TYPE_ICON = {
  VOO: 'VO', ALOJAMENTO: 'HT', TRANSFER: 'TR', CRUZEIRO: 'CR', RENT_A_CAR: 'RC',
  SEGURO: 'SG', VISTO: 'VS', RESTAURACAO: 'RG', TOUR: 'EX', DIVERSOS: 'SV'
};
const TYPE_LABEL = {
  VOO: 'Voo', ALOJAMENTO: 'Hotel', TRANSFER: 'Transfer', CRUZEIRO: 'Cruzeiro', RENT_A_CAR: 'Aluguer de carro',
  SEGURO: 'Seguro de viagem', VISTO: 'Visto', RESTAURACAO: 'Restauração', TOUR: 'Tour/Excursão', DIVERSOS: 'Outro serviço'
};

function serviceIsConfirmed(status) {
  return status !== 'NAO_CONFIRMADO';
}

const TABS = [
  { key: 'resumo', label: 'Resumo', render: renderResumoTab },
  { key: 'viagem', label: 'A minha viagem', render: renderTimelineTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentosTab },
  { key: 'pagamentos', label: 'Pagamentos', render: renderPagamentosTab },
  { key: 'gerir', label: 'Gerir viagem', render: renderGerirTab },
  { key: 'ajuda', label: 'Ajuda', render: renderAjudaTab }
];

export async function openTripDetail(reservationId, backView = 'viagens') {
  const tripViews = new Set(['viagens', 'guardadas', 'anteriores']);
  document.querySelectorAll('.nav-item[data-view], .sheet-link[data-view], .trip-hub-tab[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === backView);
  });
  document.querySelectorAll('.tab-item[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === backView || (btn.dataset.view === 'viagens' && tripViews.has(backView)));
  });
  const moreBtn = document.getElementById('moreMenuBtn');
  if (moreBtn) moreBtn.classList.toggle('is-active', false);
  const hub = document.getElementById('tripHub');
  if (hub) hub.hidden = true;
  document.querySelectorAll('.view').forEach(sec => { sec.hidden = sec.id !== 'view-viagem'; });
  const pageTitle = $('#pageTitle');

  const el = $('#view-viagem');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api(`/api/customer/reservations/detail?reservationId=${encodeURIComponent(reservationId)}`);
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const r = data.reservation;
  const offer = r.offer || {};
  if (pageTitle) pageTitle.textContent = offer.destination || 'A minha viagem';

  el.innerHTML = `
    <button type="button" class="back-link">← ${backView === 'guardadas' ? 'Viagens guardadas' : backView === 'anteriores' ? 'Reservas anteriores' : 'As minhas viagens'}</button>
    <div class="trip-header">
      <h2>${esc(offer.destination || '')}${offer.country ? `, ${esc(offer.country)}` : ''}</h2>
      <p class="muted">${esc(offer.hotel || '')}</p>
      <p class="trip-header-meta">${dateRange(offer.checkin, offer.checkout) || 'Datas a confirmar'} · ${r.passengers?.length || 0} passageiro${(r.passengers?.length || 0) === 1 ? '' : 's'} · Processo ${esc(r.processNumber)}</p>
    </div>
    <div class="trip-tabs" role="tablist">
      ${TABS.map((t, i) => `<button type="button" class="trip-tab ${i === 0 ? 'is-active' : ''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="trip-tab-panel"></div>`;

  el.querySelector('.back-link').onclick = () => document.querySelector(`.nav-item[data-view="${backView}"]`)?.click();

  const panel = el.querySelector('.trip-tab-panel');
  // Resumo/A minha viagem fazem um pedido extra (documentos) antes de
  // escrever o conteudo final no mesmo `panel` partilhado por todos os
  // separadores - sem isto, trocar de separador antes desse pedido
  // terminar deixava a resposta atrasada substituir o separador novo
  // pelo conteudo (desatualizado) do separador anterior.
  let activeTabKey = null;
  function showTab(key) {
    activeTabKey = key;
    el.querySelectorAll('.trip-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === key));
    TABS.find(t => t.key === key).render(panel, r, () => openTripDetail(reservationId), () => activeTabKey === key);
  }
  el.querySelectorAll('.trip-tab').forEach(btn => { btn.onclick = () => showTab(btn.dataset.tab); });
  showTab('resumo');
}

async function renderResumoTab(panel, r, reload, isActive) {
  panel.innerHTML = '<p class="muted">A carregar...</p>';
  const offer = r.offer || {};
  const paid = (r.payments || []).filter(p => p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
  const due = Math.max(0, (offer.finalPrice || 0) - paid);

  // Voucher do hotel: verificacao leve so para a checklist (a lista
  // completa de documentos ja fica no separador Documentos).
  let hasVoucher = false;
  try {
    const docs = await api(`/api/customer/documents?reservationId=${encodeURIComponent(r.id)}`);
    hasVoucher = docs.documents.some(d => d.type === 'VOUCHER');
  } catch { /* checklist so fica sem este item - nao bloqueia o resto */ }

  const insuranceLine = (r.serviceLines || []).find(l => l.type === 'SEGURO');
  const checklist = [
    { ok: r.status === 'CONFIRMED', label: r.status === 'CONFIRMED' ? 'Reserva confirmada' : 'Reserva a aguardar confirmação' },
    ...(insuranceLine ? [{ ok: serviceIsConfirmed(insuranceLine.status), label: serviceIsConfirmed(insuranceLine.status) ? 'Seguro emitido' : 'Seguro ainda não confirmado' }] : []),
    { ok: !r.missingDocuments?.length, label: r.missingDocuments?.length ? `Documentação em falta: ${r.missingDocuments.join(', ')}` : 'Documentação completa' },
    { ok: hasVoucher, label: hasVoucher ? 'Voucher do hotel disponível' : 'Voucher do hotel ainda não disponível' },
    { ok: due <= 0, label: due <= 0 ? 'Pagamento efetuado' : `Saldo por pagar: ${money(due)}` }
  ];

  if (isActive && !isActive()) return;
  panel.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Viagem</h2></div>
      <div class="trip-summary-grid">
        <div><span class="muted small">Destino</span><div>${esc(offer.destination || '—')}</div></div>
        <div><span class="muted small">Hotel</span><div>${esc(offer.hotel || '—')}</div></div>
        <div><span class="muted small">Datas</span><div>${dateRange(offer.checkin, offer.checkout) || '—'}</div></div>
        <div><span class="muted small">Noites</span><div>${offer.nights ?? '—'}</div></div>
        <div><span class="muted small">Regime</span><div>${esc(offer.board || '—')}</div></div>
        <div><span class="muted small">Passageiros</span><div>${r.passengers?.length || 0}</div></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Financeiro</h2></div>
      <div class="trip-summary-grid">
        <div><span class="muted small">Valor total</span><div><strong>${money(offer.finalPrice)}</strong></div></div>
        <div><span class="muted small">Já pago</span><div><strong>${money(paid)}</strong></div></div>
        <div><span class="muted small">Por pagar</span><div><strong>${money(due)}</strong></div></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Preparação da sua viagem</h2></div>
      <div class="checklist">
        ${checklist.map(c => `<div class="checklist-item ${c.ok ? 'is-ok' : 'is-pending'}"><span class="checklist-icon">${c.ok ? '✅' : '⏳'}</span>${esc(c.label)}</div>`).join('')}
      </div>
    </div>`;
}

const LINE_DOC_LINK_LABEL = { VOUCHER: 'Ver voucher', TICKET: 'Ver bilhete' };

async function renderTimelineTab(panel, r, reload, isActive) {
  const lines = [...(r.serviceLines || [])].sort((a, b) => (a.dateStart || '').localeCompare(b.dateStart || ''));
  panel.innerHTML = '<p class="muted">A carregar...</p>';

  // Voucher/bilhete de cada linha (mesmo documento que ja aparece no
  // separador Documentos - so um pedido, so uma leitura, aqui filtrada
  // por serviceLineId para o mostrar tambem junto ao servico certo).
  let docsByLine = {};
  try {
    const docsData = await api(`/api/customer/documents?reservationId=${encodeURIComponent(r.id)}`);
    docsData.documents.forEach(d => {
      if (!d.serviceLineId || !LINE_DOC_LINK_LABEL[d.type]) return;
      (docsByLine[d.serviceLineId] ||= []).push(d);
    });
  } catch { /* timeline continua a mostrar-se sem os links de documento */ }

  if (isActive && !isActive()) return;
  panel.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>A minha viagem</h2></div>
      ${lines.length ? `<div class="trip-timeline">${lines.map(l => `
        <div class="timeline-item">
          <div class="timeline-date">${shortDate(l.dateStart) || ''}</div>
          <div class="timeline-icon">${TYPE_ICON[l.type] || '•'}</div>
          <div class="timeline-body">
            <b>${esc(TYPE_LABEL[l.type] || l.type)}</b>
            <span>${esc(l.description || '')}</span>
            ${l.supplierName ? `<span class="muted small">${esc(l.supplierName)}</span>` : ''}
            ${l.locator ? `<span class="muted small">Localizador: ${esc(l.locator)}</span>` : ''}
            ${(docsByLine[l.id] || []).map(d => `<a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">${esc(LINE_DOC_LINK_LABEL[d.type])}</a>`).join('')}
          </div>
          <span class="pill ${serviceIsConfirmed(l.status) ? 'ok' : 'warn'}">${serviceIsConfirmed(l.status) ? 'Confirmado' : 'Pendente'}</span>
        </div>`).join('')}</div>` : '<p class="empty-note">Ainda não há serviços associados a esta viagem.</p>'}
    </div>`;
}

async function renderDocumentosTab(panel, r) {
  await renderReservationDocuments(panel, r.id);
}

function renderPagamentosTab(panel, r) {
  const payments = r.payments || [];
  panel.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Histórico de pagamentos</h2></div>
      ${payments.length ? payments.map(p => `
        <div class="payment-row">
          <div class="payment-row-main"><b>${esc(p.method || 'Pagamento')}</b><span>${p.paidAt ? shortDate(p.paidAt) : ''}${p.reference ? ` · ref. ${esc(p.reference)}` : ''}</span></div>
          <div class="payment-row-side"><strong>${money(p.amount)}</strong><span class="pill ${p.status === 'PAID' ? 'ok' : 'warn'}">${p.status === 'PAID' ? 'Pago' : 'Pendente'}</span></div>
        </div>`).join('') : '<p class="empty-note">Ainda não há pagamentos registados.</p>'}
    </div>`;
}

function renderGerirTab(panel) {
  panel.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Gerir a minha viagem</h2></div>
      <p class="muted">Em breve vai poder comprar extras, pedir alterações e consultar condições de cancelamento diretamente aqui.</p>
      <p>Por agora, contacte a nossa equipa - veja os contactos no separador Ajuda.</p>
    </div>`;
}

async function renderAjudaTab(panel, r, reload, isActive) {
  panel.innerHTML = '<p class="muted">A carregar...</p>';
  let company = {};
  try {
    const cfg = await api('/api/config');
    company = cfg.company || {};
  } catch { /* painel de ajuda so nao mostra contactos - nao e critico */ }
  if (isActive && !isActive()) return;
  panel.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Precisa de ajuda?</h2></div>
      <p class="muted">A nossa equipa responde por email ou telefone.</p>
      ${company.phone ? `<p><a href="tel:${esc(company.phone)}">${esc(company.phone)}</a></p>` : ''}
      ${company.email ? `<p><a href="mailto:${esc(company.email)}">✉️ ${esc(company.email)}</a></p>` : ''}
      <p class="muted">Pedidos e reclamações vão poder ser abertos e acompanhados diretamente aqui numa próxima fase.</p>
    </div>`;
}
