// Mostrar/esconder as grandes seccoes da pagina (homepage, resultados,
// revisao). A pagina de resultados/revisao deve aparecer sozinha, sem a
// homepage por baixo a fazer ruido visual - por isso hero/novidades/
// inspiracoes ficam escondidos enquanto se navega na pesquisa, e voltam
// quando se sai dela.

import { $ } from './utils.js';

const HOME_SECTIONS = ['pesquisa', 'novidades', 'inspiracoes'];

export function goHome() {
  HOME_SECTIONS.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = false; });
  $('#resultsPage').hidden = true;
  $('#reviewPage').hidden = true;
  document.querySelector('.hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function goToResults() {
  HOME_SECTIONS.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  $('#reviewPage').hidden = true;
  $('#resultsPage').hidden = false;
  $('#resultsPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
