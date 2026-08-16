// Criacao rapida de uma oportunidade a partir de outra vista (por agora,
// a ficha do cliente) - para quando a equipa ja identificou uma situacao
// que pode ser uma venda (cliente teve duvidas, ficou indeciso, nao
// terminou no site) e quer registar isso no Pipeline sem reescrever os
// dados do cliente. So os campos essenciais (o resto edita-se depois na
// propria ficha da oportunidade) - a criacao completa com todos os campos
// continua no botao "+ Nova oportunidade" do Pipeline (ver pipeline.js).

import { esc, api } from '../utils.js';
import { openDrawer, closeDrawer } from '../drawer.js';

// prefill: { customerName, customerEmail, customerPhone }. onCreated(opportunity)
// e chamado apos criar com sucesso, antes de fechar a gaveta.
export async function openOpportunityQuickCreate(prefill = {}, onCreated) {
  const body = openDrawer('Criar oportunidade');
  body.innerHTML = '<p class="muted">A carregar...</p>';

  let staffList = [];
  try {
    const data = await api('/api/admin/opportunities');
    staffList = data.staff || [];
  } catch (err) {
    body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  body.innerHTML = `
    <form class="opportunity-quick-form">
      <div class="drawer-form-fields">
        <label>Nome do cliente <input name="customerName" required value="${esc(prefill.customerName || '')}" /></label>
        <label>Email <input name="customerEmail" type="email" value="${esc(prefill.customerEmail || '')}" /></label>
        <label>Telefone <input name="customerPhone" value="${esc(prefill.customerPhone || '')}" /></label>
        <label>Destino <input name="destination" placeholder="ex.: Punta Cana" /></label>
        <label>Responsável comercial <select name="commercialStaffId"><option value="">Por atribuir</option>${staffList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
      </div>
      <label>Notas <textarea name="notes" rows="2" placeholder="ex.: Cliente teve dúvidas sobre o preço, ficou de pensar"></textarea></label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">Criar oportunidade</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;

  body.querySelector('.opportunity-quick-form').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = body.querySelector('.customer-form-message');
    btn.disabled = true;
    try {
      const result = await api('/api/admin/opportunities', {
        method: 'POST',
        body: JSON.stringify({
          customerName: f.customerName.value, customerEmail: f.customerEmail.value, customerPhone: f.customerPhone.value,
          destination: f.destination.value, commercialStaffId: f.commercialStaffId.value || undefined,
          // Ligada a um cliente ja existente - "cliente antigo" e uma origem
          // mais util do que deixar em branco (ver secao "Origem dos interesses").
          origin: 'CLIENTE_ANTIGO', notes: f.notes.value
        })
      });
      closeDrawer();
      onCreated?.(result.opportunity);
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  };
}
