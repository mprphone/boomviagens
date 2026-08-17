import { $, esc, money, shortDate, api } from './utils.js';

export async function renderOnline() {
  const el = $('#view-online');
  el.innerHTML = '<p class="muted">A carregar vendas online...</p>';
  try {
    const data = await api('/api/admin/reservations');
    const online = (data.reservations || []).filter(r => r.origin === 'WEBSITE' || r.source === 'site');
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = online.filter(r => r.createdAt?.slice(0,10) === today);
    const pending = online.filter(r => ['PENDING_PAYMENT','IN_VALIDATION','HUMAN_REVIEW'].includes(r.status));
    const paid = online.filter(r => Number(r.paidAmount || 0) > 0);
    const review = online.filter(r => r.status === 'HUMAN_REVIEW');
    el.innerHTML = `
      <div class="online-headline">
        <div><p class="eyebrow">Canal online</p><h2>O que entrou pelo site</h2><p class="muted">Vendas, pagamentos e processos que precisam de intervenção.</p></div>
      </div>
      <div class="kpi-row compact-kpis">
        ${kpi('Novas hoje', todaySales.length, 'Vendas/processos criados hoje', 'blue')}
        ${kpi('Em curso', pending.length, 'A pagamento / validação', 'amber')}
        ${kpi('Com pagamento', paid.length, 'Já têm valor recebido', 'green')}
        ${kpi('Revisão manual', review.length, 'Precisam da equipa', 'red')}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Caixa de entrada online</h2><p class="muted">As entradas mais recentes ficam visíveis até serem tratadas no processo.</p></div></div>
        ${online.length ? online.slice(0,12).map(r => `
          <div class="online-inbox-row ${r.status === 'HUMAN_REVIEW' ? 'needs-attention' : ''}">
            <div class="online-inbox-main">
              <span class="online-type">${r.status === 'HUMAN_REVIEW' ? '⚠' : '●'}</span>
              <div><b>${esc(r.processNumber || r.id)}</b><span>${esc(r.customer?.name || 'Cliente')} · ${esc(r.offer?.destination || '')}</span></div>
            </div>
            <div class="online-inbox-meta"><span>${shortDate(r.createdAt?.slice(0,10))}</span><strong>${money(r.offer?.finalPrice || 0)}</strong><span class="badge">${esc(r.status)}</span></div>
          </div>`).join('') : '<p class="empty-note">Ainda não existem vendas online.</p>'}
      </div>`;
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function kpi(label, value, sub, color) {
  return `<div class="kpi-card"><div class="kpi-icon ${color}">●</div><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div><div class="kpi-sub">${sub}</div></div>`;
}
