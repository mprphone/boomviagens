// Separador "Financeiro": agrupa Vendas, Compras, Recebimentos,
// Pagamentos, Margem e IVA em sub-separadores, para nao sobrecarregar a
// barra principal de separadores com uma aba por cada area financeira.

import { esc } from '../utils.js';
import { renderVendasSubTab } from './financeiro/vendasSubTab.js';
import { renderComprasSubTab } from './financeiro/comprasSubTab.js';
import { renderRecebimentosSubTab } from './financeiro/recebimentosSubTab.js';
import { renderPagamentosSubTab } from './financeiro/pagamentosSubTab.js';
import { renderMargemSubTab } from './financeiro/margemSubTab.js';
import { renderIvaSubTab } from './financeiro/ivaSubTab.js';

const SUBTABS = [
  { key: 'vendas', label: 'Vendas', render: renderVendasSubTab },
  { key: 'compras', label: 'Compras', render: renderComprasSubTab },
  { key: 'recebimentos', label: 'Recebimentos', render: renderRecebimentosSubTab },
  { key: 'pagamentos', label: 'Pagamentos', render: renderPagamentosSubTab },
  { key: 'margem', label: 'Margem', render: renderMargemSubTab },
  { key: 'iva', label: 'IVA', render: renderIvaSubTab }
];

export function renderFinanceiroTab(panel, reservation, reload, data = {}, initialSubTab = 'vendas') {
  panel.innerHTML = `
    <div class="bo-subtabs">
      ${SUBTABS.map(t => `<button type="button" class="bo-subtab ${t.key === initialSubTab ? 'is-active' : ''}" data-subtab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="bo-subtab-panel"></div>`;

  const subPanel = panel.querySelector('.bo-subtab-panel');

  function showSub(key) {
    panel.querySelectorAll('.bo-subtab').forEach(b => b.classList.toggle('is-active', b.dataset.subtab === key));
    const subReload = () => reload('financeiro');
    SUBTABS.find(t => t.key === key).render(subPanel, reservation, subReload, data);
  }

  panel.querySelectorAll('.bo-subtab').forEach(b => {
    b.onclick = () => showSub(b.dataset.subtab);
  });

  showSub(initialSubTab);
}
