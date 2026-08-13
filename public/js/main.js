// Ponto de entrada: liga todos os modulos (o import por efeito lateral
// regista os listeners de cada area) e arranca as cargas iniciais.

import { $, api } from './utils.js';
import './nav.js';
import './heroSearch.js';
import { loadDeals } from './home.js';
import './results.js';
import './review.js';
import './checkout.js';
import { refreshCustomerArea } from './customerArea.js';
import { initAdminSession } from './admin.js';
import './chat.js';

api('/api/config').then(c => {
  $('#modeBadge').textContent = c.tourdiezConfigured ? 'TourDiez real configurado' : 'modo demo / mock';
  $('#rnavt').textContent = c.company.rnavt || 'INSERIR_RNAVT';
});

initAdminSession();
refreshCustomerArea();
loadDeals();
