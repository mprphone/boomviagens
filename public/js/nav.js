// Cabecalho: atalhos de destino/servico ainda nao disponivel, e os links
// simples que voltam a homepage (nav plana, sem dropdowns).

import { $ } from './utils.js';
import { goHome } from './router.js';

document.querySelectorAll('a[data-destino], a[data-soon]').forEach(link => {
  link.addEventListener('click', e => {
    if (link.dataset.soon) {
      e.preventDefault();
      alert(`${link.dataset.soon}: ainda nao disponivel no Boomviagens. Contacte-nos enquanto isso para tratarmos do pedido a sua medida.`);
      return;
    }
    if (!link.dataset.destino) return;
    e.preventDefault();
    const form = $('#searchForm');
    form.destination.value = link.dataset.destino;
    form.prompt.value = link.dataset.prompt || link.dataset.destino;
    location.hash = '#pesquisa';
    form.requestSubmit();
  });
});

document.querySelectorAll('.main-nav a[href="#pesquisa"]:not([data-destino]):not([data-soon])').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    goHome();
  });
});
