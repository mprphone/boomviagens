// Pagina "Confirme a sua viagem": mostra o que foi escolhido antes de
// pedir dados pessoais - resumo, aviso honesto sobre voos e sugestao de
// upgrade de tarifa.

import { $, esc, money, dateRange } from './utils.js';
import { applyRoomOption } from './offers.js';
import { getCurrentOffer, setCurrentOffer } from './state.js';
import { openPassportModal } from './checkout.js';

const destinationContent = {
  'Punta Cana': 'Praias de areia branca e mar turquesa nas Caraibas. Tudo incluido pensado para relaxar sem preocupacoes, com voos diretos disponiveis.',
  'Riviera Maya': 'Costa do Mexico entre recifes de coral, cenotes e cultura maia. Ideal para quem quer praia e aventura no mesmo destino.',
  'Sal': 'Ilha de Cabo Verde com vento constante, praias quase desertas e ligacao cultural a Portugal. Otima opcao tudo incluido mais perto de casa.',
  'Maldivas': 'Vilas sobre a agua e snorkeling a porta do quarto. O destino de lua-de-mel e longo curso por excelencia.',
  'Disneyland Paris': 'A magia Disney a poucas horas de aviao, ideal para familias com criancas pequenas e fas de sempre.',
  'Madeira': 'Natureza atlantica, levadas e gastronomia portuguesa sem saida de euros nem de fronteiras.'
};

function upgradeSuggestion(offer) {
  const options = offer.roomOptions;
  if (!options || options.length < 2) return null;
  const currentId = offer.tourdiez?.idDistributions;
  const current = options.find(o => o.idDistributions === currentId);
  if (!current) return null;
  const sameRoom = options.filter(o => o.roomCode === current.roomCode).sort((a, b) => a.finalPrice - b.finalPrice);

  if (!current.freeCancellation) {
    const flexible = sameRoom.find(o => o.freeCancellation && o.mealPlan === current.mealPlan);
    if (flexible) return { option: flexible, text: `Cancelamento gratuito por mais ${money(flexible.finalPrice - current.finalPrice)}` };
  }
  const idx = sameRoom.findIndex(o => o.idDistributions === currentId);
  const next = sameRoom.slice(idx + 1).find(o => o.freeCancellation === current.freeCancellation);
  if (next) return { option: next, text: `${next.mealPlanLabel} por mais ${money(next.finalPrice - current.finalPrice)}` };
  return null;
}

window.applyReviewSuggestion = function(idDistributions) {
  const offer = getCurrentOffer();
  const option = offer.roomOptions.find(o => o.idDistributions === idDistributions);
  if (!option) return;
  applyRoomOption(offer, option);
  renderReview(offer);
};

function renderReview(offer) {
  const trip = dateRange(offer.checkin, offer.checkout);
  const suggestion = upgradeSuggestion(offer);
  const story = destinationContent[offer.destination];
  $('#reviewContent').innerHTML = `
    <div class="flight-card">
      <div class="flight-card-icon">✈️</div>
      <div class="flight-card-body">
        <b>Voos</b>
        <p>Voos não encontrados. Ainda não temos nenhuma fonte de voos ligada a este site - só reservamos alojamento através da TourDiez. Saída indicada: <b>${esc(offer.origin) || 'a confirmar'}</b>. Se precisar de voo, a nossa equipa trata disso separadamente depois de confirmar o hotel.</p>
      </div>
      <span class="pill">Não disponível</span>
    </div>
    <div class="review-grid">
      <div class="review-card">
        <div class="meta">${offer.live ? '<span class="pill live">Preço real</span>' : '<span class="pill">Simulação</span>'}</div>
        <h3>${esc(offer.hotel)}</h3>
        <p class="muted">${esc(offer.destination)}${offer.country ? `, ${esc(offer.country)}` : ''}</p>
        ${trip ? `<div class="summary-dates">${trip}</div>` : ''}
        <ul class="summary-facts">
          <li>${offer.board}</li>
          <li>${offer.nights} noites</li>
          <li>${offer.adults} adultos${offer.children ? ` + ${offer.children} criancas` : ''}</li>
          <li>${offer.freeCancellation ? 'Cancelamento flexível' : 'Tarifa não reembolsável'}</li>
        </ul>
        ${story ? `<p class="muted">${story}</p>` : ''}
        ${suggestion ? `
        <div class="upgrade-suggestion">
          <span class="upgrade-suggestion-icon">✨</span>
          <div class="upgrade-suggestion-body"><b>Sugestão</b><p>${suggestion.text}</p></div>
          <button type="button" class="ghost mini-action" onclick="applyReviewSuggestion('${suggestion.option.idDistributions}')">Aplicar</button>
        </div>` : ''}
      </div>
      <aside class="review-price">
        <span>Total</span>
        <strong>${money(offer.finalPrice)}</strong>
        <p class="muted small">${offer.live ? 'Preço obtido diretamente no operador.' : 'Preço demonstrativo - a equipa confirma disponibilidade real antes de emitir documentos.'}</p>
        <button type="button" class="btn wide" id="continueToDataBtn">Continuar reserva</button>
      </aside>
    </div>`;
  $('#continueToDataBtn').onclick = openPassportModal;
}

export function showReview(offer) {
  setCurrentOffer(offer);
  renderReview(offer);
  $('#reviewPage').hidden = false;
  $('#reviewPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#backToResultsBtn').onclick = () => {
  $('#reviewPage').hidden = true;
  $('#resultsPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
