// Ponto de entrada: liga todos os modulos (o import por efeito lateral
// regista os listeners de cada area) e arranca as cargas iniciais.

import { $, api, notify } from './utils.js';
import './nav.js';
import './heroSearch.js';
import { loadDeals } from './home.js';
import './results.js';
import { showReview } from './review.js';
import './checkout.js';
import './chat.js';
import { initServices } from './services.js';
import { watchCustomerSessionChanges, clearCustomerScopedBrowserState } from './sessionGuard.js';

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

// Se outra janela trocar de cliente, este separador não pode continuar a
// mostrar um checkout/rascunho pertencente à identidade anterior.
watchCustomerSessionChanges(() => {
  clearCustomerScopedBrowserState();
  location.reload();
});

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

// Retoma de uma reserva guardada: a Área de Cliente já pediu nova
// disponibilidade/preço e deixou a oferta assinada neste separador. Se o
// separador foi recarregado, repetimos a validação no servidor.
const resumeReservationId = new URLSearchParams(location.search).get('resumeReservation');
if (resumeReservationId) {
  const openResumedOffer = offer => {
    document.getElementById('homeShowcase').hidden = true;
    showReview(offer);
    history.replaceState({}, '', '/');
  };
  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem('boom_resume_offer_v1') || 'null'); } catch {}
  if (cached?.reservationId === resumeReservationId && cached.offer && Date.now() - Number(cached.savedAt || 0) < 10 * 60 * 1000) {
    sessionStorage.removeItem('boom_resume_offer_v1');
    openResumedOffer(cached.offer);
  } else {
    api('/api/customer/reservations/resume', { method: 'POST', body: JSON.stringify({ reservationId: resumeReservationId }) })
      .then(data => openResumedOffer(data.offer))
      .catch(err => { notify(err.message); history.replaceState({}, '', '/'); });
  }
}

