// Separador "Financeiro": tres sub-separadores - Servicos e Calculo
// (custo/venda/margem/IVA de cada reserva, ao estilo OptiTravel mas mais
// limpo), Faturas e Documentos (o que foi emitido ao cliente e pelos
// fornecedores, com anexo) e Conta do Processo (a conta-corrente da
// viagem: vendeu/recebeu/comprou/pagou/margem/IVA).

import { esc } from '../utils.js';
import { renderServicosCalculoSubTab } from './financeiro/servicosCalculoSubTab.js';
import { renderFaturasDocumentosSubTab } from './financeiro/faturasDocumentosSubTab.js';
import { renderContaProcessoSubTab } from './financeiro/contaProcessoSubTab.js';

const SUBTABS = [
  { key: 'servicos', label: 'Serviços e Cálculo', render: renderServicosCalculoSubTab },
  { key: 'faturas', label: 'Faturas e Documentos', render: renderFaturasDocumentosSubTab },
  { key: 'conta', label: 'Conta do Processo', render: renderContaProcessoSubTab }
];

export function renderFinanceiroTab(panel, reservation, reload, data = {}, initialSubTab = 'servicos') {
  panel.innerHTML = `
    <div class="bo-subtabs">
      ${SUBTABS.map(t => `<button type="button" class="bo-subtab ${t.key === initialSubTab ? 'is-active' : ''}" data-subtab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="bo-subtab-panel"></div>`;

  const subPanel = panel.querySelector('.bo-subtab-panel');

  function showSub(key) {
    panel.querySelectorAll('.bo-subtab').forEach(b => b.classList.toggle('is-active', b.dataset.subtab === key));
    const subReload = () => reload(key);
    SUBTABS.find(t => t.key === key).render(subPanel, reservation, subReload, data);
  }

  panel.querySelectorAll('.bo-subtab').forEach(b => {
    b.onclick = () => showSub(b.dataset.subtab);
  });

  showSub(initialSubTab);
}
