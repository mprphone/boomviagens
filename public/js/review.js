// Pagina de construcao/revisao da viagem. Antes de pedir dados pessoais,
// o cliente deve perceber tudo o que escolheu, poder guardar/partilhar e
// alterar uma componente sem perder o contexto.

import { $, esc, money, dateRange, api } from './utils.js';
import { applyRoomOption } from './offers.js';
import { getCurrentOffer, setCurrentOffer } from './state.js';
import { openPassportModal } from './checkout.js';

const DESTINATION_IMAGES = {
  'Punta Cana': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=82',
  'Riviera Maya': 'https://images.unsplash.com/photo-1510097467424-192d713fd8b2?auto=format&fit=crop&w=1400&q=82',
  'Sal': 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=82',
  'Maldivas': 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=1400&q=82',
  'Disneyland Paris': 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1400&q=82',
  'Madeira': 'https://images.unsplash.com/photo-1526392060635-9d6019884377?auto=format&fit=crop&w=1400&q=82'
};

const destinationContent = {
  'Punta Cana': 'Praias de areia branca e mar turquesa nas Caraíbas. Tudo incluído pensado para relaxar sem preocupações.',
  'Riviera Maya': 'Costa do México entre recifes de coral, cenotes e cultura maia. Praia e aventura no mesmo destino.',
  'Sal': 'Praias largas, clima ameno e ligação cultural a Portugal. Uma opção simples e muito procurada para famílias.',
  'Maldivas': 'Vilas sobre a água e snorkeling à porta do quarto. Um clássico de lua-de-mel e grandes viagens.',
  'Disneyland Paris': 'A magia Disney a poucas horas de avião, especialmente prática para famílias.',
  'Madeira': 'Natureza atlântica, levadas e gastronomia portuguesa num destino fácil de organizar.'
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

function saveLocal(offer) {
  const key = 'boom_saved_trips_v1';
  const current = JSON.parse(localStorage.getItem(key) || '[]');
  const safe = {
    ...offer,
    costPrice: undefined,
    marginValue: undefined,
    marginPercent: undefined,
    trace: undefined,
    savedAt: new Date().toISOString()
  };
  const next = [safe, ...current.filter(x => x.id !== offer.id)].slice(0, 20);
  localStorage.setItem(key, JSON.stringify(next));
}

window.applyReviewSuggestion = function(idDistributions) {
  const offer = getCurrentOffer();
  const option = offer.roomOptions?.find(o => o.idDistributions === idDistributions);
  if (!option) return;
  applyRoomOption(offer, option);
  renderReview(offer);
};

async function shareTrip(offer) {
  const btn = $('#shareTripBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'A criar ligação...';
  try {
    const data = await api('/api/share-trip', { method: 'POST', body: JSON.stringify({ offer }) });
    if (navigator.share) {
      await navigator.share({ title: `Viagem a ${offer.destination}`, text: `${offer.hotel} · ${money(offer.finalPrice)}`, url: data.url });
    } else {
      await navigator.clipboard.writeText(data.url);
      btn.textContent = 'Ligação copiada ✓';
      setTimeout(() => { if (btn) btn.textContent = original; }, 2200);
      return;
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    if (btn.textContent === 'A criar ligação...') btn.textContent = original;
  }
}

function renderReview(offer) {
  const trip = dateRange(offer.checkin, offer.checkout);
  const suggestion = upgradeSuggestion(offer);
  const story = destinationContent[offer.destination] || 'Uma viagem preparada para poder comparar, guardar, partilhar e confirmar com clareza antes do pagamento.';
  const image = DESTINATION_IMAGES[offer.destination] || DESTINATION_IMAGES['Punta Cana'];
  const pax = `${offer.adults || 1} adulto${(offer.adults || 1) > 1 ? 's' : ''}${offer.children ? ` + ${offer.children} criança${offer.children > 1 ? 's' : ''}` : ''}`;
  const perPerson = Number(offer.finalPrice || 0) / Math.max(1, Number(offer.adults || 1) + Number(offer.children || 0));

  $('#reviewContent').innerHTML = `
    <div class="trip-builder-head">
      <div class="trip-builder-hero" style="background-image:url('${image}')">
        <div class="trip-builder-overlay">
          <span class="pill ${offer.live ? 'live' : ''}">${offer.live ? 'Preço do operador' : 'Proposta estimada'}</span>
          <h2>${esc(offer.destination)}</h2>
          <p>${esc(offer.hotel)} · ${trip || `${offer.nights} noites`}</p>
        </div>
      </div>
      <div class="trip-builder-actions">
        <button type="button" class="ghost" id="saveTripBtn">♡ Guardar viagem</button>
        <button type="button" class="ghost" id="shareTripBtn">↗ Partilhar</button>
      </div>
    </div>

    <div class="trip-builder-layout">
      <div class="trip-builder-main">
        <section class="trip-intro-card">
          <div>
            <p class="eyebrow">A sua viagem</p>
            <h3>${esc(offer.hotel)}</h3>
            <p class="muted">${story}</p>
          </div>
          <div class="trip-facts-inline">
            <span>📅 ${trip || '-'}</span><span>👥 ${esc(pax)}</span><span>🌙 ${offer.nights} noites</span><span>🍽️ ${esc(offer.board)}</span>
          </div>
        </section>

        <section class="trip-component-card">
          <div class="trip-component-icon">✈</div>
          <div class="trip-component-body">
            <div class="trip-component-title"><div><span class="eyebrow">Voo</span><h3>Transporte aéreo</h3></div><span class="status-chip neutral">A confirmar</span></div>
            <p class="muted">Saída indicada: <b>${esc(offer.origin || 'a confirmar')}</b>. A fonte de voos ainda não está ligada ao motor atual; a equipa pode completar esta componente sem perder o hotel escolhido.</p>
          </div>
          <button type="button" class="ghost mini-action" id="changeFlightBtn">Ver alternativas</button>
        </section>

        <section class="trip-component-card is-highlighted">
          <div class="trip-component-icon">▣</div>
          <div class="trip-component-body">
            <div class="trip-component-title"><div><span class="eyebrow">Hotel</span><h3>${esc(offer.hotel)}</h3></div><span class="status-chip success">Selecionado</span></div>
            <p><b>${esc(offer.board)}</b> · ${offer.nights} noites · ${offer.freeCancellation ? 'Cancelamento flexível' : 'Tarifa não reembolsável'}</p>
            ${suggestion ? `<div class="smart-suggestion"><b>✨ Sugestão inteligente</b><span>${esc(suggestion.text)}</span><button type="button" class="ghost mini-action" onclick="applyReviewSuggestion('${suggestion.option.idDistributions}')">Aplicar</button></div>` : ''}
          </div>
          <button type="button" class="ghost mini-action" id="changeHotelBtn">Ver outros hotéis</button>
        </section>

        <section class="trip-component-card addable">
          <div class="trip-component-icon">＋</div>
          <div class="trip-component-body"><span class="eyebrow">Melhore a viagem</span><h3>Transfer, seguro e atividades</h3><p class="muted">Pode acrescentar serviços agora ou mais tarde na sua área de cliente, sempre ligados ao mesmo processo de viagem.</p></div>
          <button type="button" class="ghost mini-action" id="extrasInfoBtn">Ver opções</button>
        </section>

        <section class="prebook-checks">
          <div class="prebook-checks-head"><div><p class="eyebrow">Antes de reservar</p><h3>O site vai verificar consigo</h3></div><span class="smart-badge">Assistência inteligente</span></div>
          <div class="prebook-check-grid">
            <div>✓ Nomes iguais aos documentos</div>
            <div>✓ Idades compatíveis com o tipo de passageiro</div>
            <div>✓ Validade dos documentos na data de regresso</div>
            <div>✓ Preço e disponibilidade revistos antes do pagamento</div>
          </div>
        </section>
      </div>

      <aside class="trip-price-card">
        <p class="eyebrow">Resumo</p>
        <div class="trip-price-route"><b>${esc(offer.destination)}</b><span>${esc(pax)}</span><span>${offer.nights} noites</span></div>
        <div class="trip-price-main"><span>Desde</span><strong>${money(offer.finalPrice)}</strong><small>${money(perPerson)} / pessoa</small></div>
        <div class="trip-price-note">${offer.freeCancellation ? '✓ Condições flexíveis nesta tarifa' : '⚠ Esta tarifa tem restrições de cancelamento'}</div>
        <button type="button" class="btn wide" id="continueToDataBtn">Continuar para a reserva</button>
        <button type="button" class="ghost wide" id="saveTripAsideBtn">Guardar e decidir mais tarde</button>
        <p class="muted small">Antes do pagamento voltamos a validar os dados essenciais e a disponibilidade.</p>
      </aside>
    </div>`;

  const save = () => {
    saveLocal(offer);
    ['saveTripBtn', 'saveTripAsideBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.textContent = '✓ Viagem guardada'; });
  };
  $('#saveTripBtn').onclick = save;
  $('#saveTripAsideBtn').onclick = save;
  $('#shareTripBtn').onclick = () => shareTrip(offer);
  $('#changeHotelBtn').onclick = () => $('#backToResultsBtn').click();
  $('#changeFlightBtn').onclick = () => alert('Quando o motor de voos estiver ligado, este botão substitui apenas o voo sem perder o resto da viagem.');
  $('#extrasInfoBtn').onclick = () => alert('Área preparada para transfer, seguro, bagagem, rent-a-car e atividades compatíveis com esta viagem.');
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
