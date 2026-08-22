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

function closeSiteSheet() {
  const sheet = document.getElementById('siteSheet');
  const btn = document.getElementById('siteServicesBtn');
  if (sheet) sheet.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleSiteSheet() {
  const sheet = document.getElementById('siteSheet');
  if (!sheet) return;
  if (sheet.hidden) {
    sheet.hidden = false;
    document.getElementById('siteServicesBtn')?.setAttribute('aria-expanded', 'true');
  } else closeSiteSheet();
}

document.getElementById('siteServicesBtn')?.addEventListener('click', toggleSiteSheet);
document.getElementById('siteSheetBackdrop')?.addEventListener('click', closeSiteSheet);
document.getElementById('siteSheet')?.addEventListener('click', event => {
  if (event.target.closest('[data-service], [data-catalog-service]')) closeSiteSheet();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeSiteSheet();
});
document.querySelectorAll('.site-tab[href="#pesquisa"]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    closeSiteSheet();
    setSearchType('PACKAGE');
    focusSearch();
  });
});
