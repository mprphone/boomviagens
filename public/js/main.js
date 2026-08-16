// Ponto de entrada: liga todos os modulos (o import por efeito lateral
// regista os listeners de cada area) e arranca as cargas iniciais.

import { $, api } from './utils.js';
import './nav.js';
import './heroSearch.js';
import { loadDeals } from './home.js';
import './results.js';
import './review.js';
import './checkout.js';
import './chat.js';

// #modeBadge existia para o programador ver de relance se a TourDiez real
// estava configurada - informacao interna, sem interesse para quem
// visita o site, por isso deixou de ter elemento correspondente no HTML.
api('/api/config').then(c => {
  $('#rnavt').textContent = c.company.rnavt || 'INSERIR_RNAVT';
});

loadDeals();
