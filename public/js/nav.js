// Cabecalho: dropdowns de "Mais servicos/Mais viagens/Informacoes",
// atalhos de destino/servico ainda nao disponivel, e o link simples
// "Pesquisar" que volta a homepage.

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

document.querySelectorAll('.nav-dropdown-trigger').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const parent = btn.closest('.nav-dropdown');
    const wasOpen = parent.classList.contains('open');
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) parent.classList.add('open');
  });
});

document.querySelectorAll('.nav-dropdown-panel a').forEach(link => {
  link.addEventListener('click', () => {
    link.closest('.nav-dropdown')?.classList.remove('open');
  });
});

document.addEventListener('click', e => {
  if (!e.target.closest('.nav-dropdown')) {
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

document.querySelectorAll('.main-nav a[href="#pesquisa"]:not([data-destino]):not([data-soon])').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    goHome();
  });
});
