// Navegação pública: cada produto abre a pesquisa já no modo correto.
// Não usamos alerts "ainda não disponível" — mesmo os cruzeiros têm um
// fluxo operacional de pedido assistido e ficam registados no backoffice.

import { $ } from './utils.js';
import { goHome } from './router.js';
import { setSearchType } from './heroSearch.js';

function focusSearch() {
  goHome();
  location.hash = '#pesquisa';
  setTimeout(() => $('#destinationInput')?.focus(), 60);
}

document.querySelectorAll('a[data-service]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    setSearchType(link.dataset.service || 'PACKAGE');
    focusSearch();
  });
});

document.querySelectorAll('a[data-destino]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const form = $('#searchForm');
    setSearchType(link.dataset.service || 'PACKAGE');
    form.destination.value = link.dataset.destino || '';
    form.prompt.value = link.dataset.prompt || link.dataset.destino || '';
    location.hash = '#pesquisa';
    form.requestSubmit();
  });
});

document.querySelectorAll('.main-nav a[href="#pesquisa"]:not([data-destino]):not([data-service])').forEach(link => {
  link.addEventListener('click', e => { e.preventDefault(); setSearchType('PACKAGE'); focusSearch(); });
});

const mobileMenuBtn=document.getElementById('mobileMenuBtn'); if(mobileMenuBtn) mobileMenuBtn.addEventListener('click',()=>document.querySelector('.main-nav')?.classList.toggle('is-open'));
