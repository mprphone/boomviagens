// Ponto de entrada: liga todos os modulos (o import por efeito lateral
// regista os listeners de cada area) e arranca as cargas iniciais.

import { $, api } from './utils.js';
import './nav.js';
import './heroSearch.js';
import { loadDeals } from './home.js';
import './results.js';
import { showReview } from './review.js';
import './checkout.js';
import './chat.js';
import { initServices } from './services.js';

// #modeBadge existia para o programador ver de relance se a TourDiez real
// estava configurada - informacao interna, sem interesse para quem
// visita o site, por isso deixou de ter elemento correspondente no HTML.
api('/api/config').then(c => {
  $('#rnavt').textContent = c.company.rnavt || 'INSERIR_RNAVT';
  const phone = String(c.company.phone || '').trim();
  if (phone) {
    $('#topbarPhoneNumber').textContent = phone;
    $('#topbarPhone').href = `tel:${phone.replace(/[^+\d]/g, '')}`;
  } else {
    $('#topbarPhone').hidden = true;
  }
  initServices(c);
}).catch(() => initServices());

loadDeals();

// Abrir uma viagem recebida por link partilhado sem obrigar a repetir a
// pesquisa. O preco continua sujeito a revalidacao no checkout atraves do
// offerToken assinado pelo servidor.
const sharedToken = new URLSearchParams(location.search).get('trip');
if (sharedToken) {
  api(`/api/share-trip?token=${encodeURIComponent(sharedToken)}`).then(data => {
    document.getElementById('pesquisa').hidden = true;
    document.getElementById('homeShowcase').hidden = true;
    document.getElementById('resultsPage').hidden = true;
    showReview(data.offer);
  }).catch(err => {
    console.warn('Viagem partilhada indisponivel:', err.message);
  });
}

