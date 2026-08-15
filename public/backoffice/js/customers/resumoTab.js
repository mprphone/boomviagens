// Separador "Resumo": dados-base editaveis + alertas permanentes + conta
// corrente do cliente (agregada de todas as reservas). Os indicadores
// (cliente desde, nº viagens, faturado, ultima/proxima viagem, estado) ja
// aparecem no cabecalho fixo da ficha - aqui nao se repetem.

import { esc, money, api } from '../utils.js';

export function renderResumoTab(panel, data, email, reload) {
  const c = data.customer;
  const stmt = data.accountStatement || { vendaTotal: 0, faturado: 0, recebido: 0, porReceber: 0, movements: [] };
  const nextTrip = data.indicators?.nextTrip;

  panel.innerHTML = `
    ${nextTrip ? `
      <p class="summary-block-label" style="margin-top:0">Próxima viagem</p>
      <div class="next-trip-block">
        <b>${esc(nextTrip.hotel || nextTrip.destination || nextTrip.processNumber)}</b>
        <span class="muted">${esc(nextTrip.destination || '')}</span>
        <span class="muted small">${esc(nextTrip.processNumber)} · ${esc(nextTrip.checkin || '')}</span>
      </div>` : ''}

    <p class="summary-block-label">Alertas do cliente</p>
    <div class="customer-alert-list">
      ${(c.alerts || []).map((a, i) => `
        <div class="customer-alert-item">
          <span>⚠ ${esc(a)}</span>
          <button type="button" class="ghost mini-action alert-remove" data-index="${i}">Remover</button>
        </div>`).join('') || '<p class="empty-note">Sem alertas registados.</p>'}
    </div>
    <form class="alert-add-form">
      <input type="text" name="alertText" placeholder="ex.: Necessita assistência no aeroporto" maxlength="200" required />
      <button class="ghost mini-action" type="submit">Adicionar alerta</button>
    </form>

    <p class="summary-block-label">Dados principais</p>
    <form class="customer-profile-form">
      <div class="customer-profile-grid">
        <label>Nome <input name="name" value="${esc(c.name || '')}" required /></label>
        <label>Email <input value="${esc(c.email)}" disabled /></label>
        <label>Telefone <input name="phone" value="${esc(c.phone || '')}" /></label>
        <label>Telefone alternativo <input name="phone2" value="${esc(c.phone2 || '')}" /></label>
        <label>NIF <input name="nif" value="${esc(c.nif || '')}" maxlength="9" /></label>
        <label>Data de nascimento <input name="birthdate" type="date" value="${esc(c.birthdate || '')}" /></label>
        <label>Morada <input name="address" value="${esc(c.address || '')}" /></label>
        <label>Código postal <input name="postalCode" value="${esc(c.postalCode || '')}" placeholder="0000-000" /></label>
        <label>Localidade <input name="city" value="${esc(c.city || '')}" /></label>
      </div>
      <label>Notas internas <textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
      <button class="btn mini-action" type="submit">Guardar</button>
      <p class="customer-form-message"></p>
    </form>

    <p class="summary-block-label">Conta corrente</p>
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Venda total</span><strong>${money(stmt.vendaTotal)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Faturado</span><strong>${money(stmt.faturado)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Recebido</span><strong>${money(stmt.recebido)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Por receber</span><strong>${money(stmt.porReceber)}</strong></div>
    </div>
    <div class="account-movements">
      ${stmt.movements.map(m => `
        <div class="account-movement-row">
          <span class="muted small">${m.date ? new Date(m.date).toLocaleDateString('pt-PT') : ''}</span>
          <span>${esc(m.label)}</span>
          <b class="${m.amount < 0 ? 'margin-diff-negative' : 'margin-diff-positive'}">${m.amount >= 0 ? '+' : ''}${money(m.amount)}</b>
        </div>`).join('') || '<p class="empty-note">Sem movimentos registados.</p>'}
    </div>`;

  panel.querySelectorAll('.alert-remove').forEach(btn => {
    btn.onclick = async () => {
      const alerts = (c.alerts || []).filter((_, i) => i !== Number(btn.dataset.index));
      try {
        await api('/api/admin/customers/alerts', { method: 'POST', body: JSON.stringify({ email, alerts }) });
        await reload();
      } catch (err) { alert(err.message); }
    };
  });

  panel.querySelector('.alert-add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const text = e.target.alertText.value.trim();
    if (!text) return;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const alerts = [...(c.alerts || []), text];
      await api('/api/admin/customers/alerts', { method: 'POST', body: JSON.stringify({ email, alerts }) });
      await reload();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  });

  panel.querySelector('.customer-profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    const f = e.target;
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/customers/update', {
        method: 'POST',
        body: JSON.stringify({
          email: c.email,
          name: f.name.value,
          phone: f.phone.value,
          phone2: f.phone2.value,
          nif: f.nif.value,
          birthdate: f.birthdate.value,
          address: f.address.value,
          postalCode: f.postalCode.value,
          city: f.city.value,
          notes: f.notes.value
        })
      });
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { btn.textContent = 'Guardar'; btn.disabled = false; }, 1500);
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
