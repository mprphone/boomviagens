// Separador "Propostas": varias versoes possiveis por oportunidade
// (V1/V2/V3...), cada uma com servicos, custo, venda e estado - secao
// "Propostas". "+ Nova proposta" abre a gaveta; clicar numa proposta edita.

import { esc, money, api } from '../../utils.js';
import { openDrawer, closeDrawer } from '../../drawer.js';

const STATUS_META = {
  RASCUNHO: { label: 'Rascunho', pill: '' },
  ENVIADA: { label: 'Enviada', pill: '' },
  VISTA: { label: 'Vista', pill: '' },
  ACEITE: { label: 'Aceite', pill: 'pill-ok' },
  REJEITADA: { label: 'Rejeitada', pill: 'pill-warning' },
  EXPIRADA: { label: 'Expirada', pill: 'pill-warning' }
};
const STATUSES = Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }));

export function renderPropostasTab(panel, data, opportunityId, reload) {
  const proposals = data.proposals || [];
  const canSeeFinance = Boolean(data.permissions?.canSeeFinance);

  panel.innerHTML = `
    <div class="tab-toolbar">
      <button type="button" class="btn mini-action proposal-add">+ Nova proposta</button>
    </div>
    <div class="complaint-list">
      ${proposals.map(p => {
        const meta = STATUS_META[p.status] || STATUS_META.RASCUNHO;
        const margin = (p.saleValue ?? 0) - (p.costValue ?? 0);
        return `
        <div class="complaint-item" data-proposal="${esc(p.id)}">
          <div class="complaint-head">
            <b>V${p.version}</b>
            <span class="pill ${meta.pill}">${meta.label}</span>
          </div>
          ${p.services ? `<p>${esc(p.services)}</p>` : ''}
          <div class="summary-financial-grid complaint-amounts">
            ${canSeeFinance ? `<div class="summary-financial-block"><span class="muted small">Custo</span><strong>${money(p.costValue)}</strong></div>` : ''}
            <div class="summary-financial-block"><span class="muted small">Venda</span><strong>${money(p.saleValue)}</strong></div>
            ${canSeeFinance ? `<div class="summary-financial-block"><span class="muted small">Margem</span><strong>${money(margin)}</strong></div>` : ''}
          </div>
        </div>`;
      }).join('') || '<p class="empty-note">Ainda sem propostas.</p>'}
    </div>`;

  panel.querySelector('.proposal-add').onclick = () => openProposalDrawer(null);
  panel.querySelectorAll('.complaint-item').forEach(item => {
    item.onclick = () => openProposalDrawer(proposals.find(p => p.id === item.dataset.proposal));
  });

  function openProposalDrawer(proposal) {
    const body = openDrawer(proposal ? `Proposta V${proposal.version}` : 'Nova proposta');
    body.innerHTML = `
      <form class="proposal-form">
        <label class="service-line-notes">Serviços incluídos <textarea name="services" rows="3">${esc(proposal?.services || '')}</textarea></label>
        <div class="drawer-form-fields">
          ${canSeeFinance ? `<label>Custo (€) <input type="number" name="costValue" min="0" step="0.01" value="${proposal?.costValue ?? ''}" /></label>` : ''}
          <label>Venda (€) <input type="number" name="saleValue" min="0" step="0.01" value="${proposal?.saleValue ?? ''}" /></label>
          <label>Estado <select name="status">${STATUSES.map(s => `<option value="${s.value}" ${(proposal?.status || 'RASCUNHO') === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
        </div>
        <label class="service-line-notes">Notas <textarea name="notes" rows="2">${esc(proposal?.notes || '')}</textarea></label>
        <div class="service-line-form-actions">
          <button class="btn mini-action" type="submit">${proposal ? 'Guardar alterações' : 'Criar proposta'}</button>
        </div>
        <p class="customer-form-message"></p>
      </form>`;

    body.querySelector('.proposal-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = ev.target;
      const btn = f.querySelector('button[type=submit]');
      const msg = body.querySelector('.customer-form-message');
      btn.disabled = true;
      try {
        await api('/api/admin/proposals', {
          method: 'POST',
          body: JSON.stringify({
            id: proposal?.id, opportunityId, services: f.services.value,
            costValue: f.querySelector('[name=costValue]')?.value || undefined, saleValue: f.saleValue.value || undefined,
            status: f.status.value, notes: f.notes.value
          })
        });
        await reload();
        closeDrawer();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    };
  }
}
