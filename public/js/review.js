// Página de construção/revisão da viagem. O enriquecimento externo é LAZY:
// só acontece quando o cliente abre uma opção. A pesquisa de milhares de
// hotéis não dispara Duffel, OpenWeather, Ticketmaster ou Google Places.

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
  'Madeira': 'https://images.unsplash.com/photo-1526392060635-9d6019884377?auto=format&fit=crop&w=1400&q=82',
  'Gran Canaria': 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1400&q=82',
  'Tenerife': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=82'
};

const destinationContent = {
  'Punta Cana': 'Praias de areia branca e mar turquesa nas Caraíbas. Tudo incluído pensado para relaxar sem preocupações.',
  'Riviera Maya': 'Costa do México entre recifes de coral, cenotes e cultura maia. Praia e aventura no mesmo destino.',
  'Sal': 'Praias largas, clima ameno e ligação cultural a Portugal. Uma opção simples e muito procurada para famílias.',
  'Maldivas': 'Vilas sobre a água e snorkeling à porta do quarto. Um clássico de lua-de-mel e grandes viagens.',
  'Disneyland Paris': 'A magia Disney a poucas horas de avião, especialmente prática para famílias.',
  'Madeira': 'Natureza atlântica, levadas e gastronomia portuguesa num destino fácil de organizar.'
};

let intelligenceRequestSeq = 0;
let configPromise = null;

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
  const safe = { ...offer, costPrice: undefined, marginValue: undefined, marginPercent: undefined, trace: undefined, savedAt: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify([safe, ...current.filter(x => x.id !== offer.id)].slice(0, 20)));
}

function passengerSummary(offer) {
  const adults = Number(offer.adults || 1);
  const children = Number(offer.children || 0);
  const infants = Number(offer.infants || 0);
  return `${adults} adulto${adults === 1 ? '' : 's'}${children ? ` + ${children} criança${children === 1 ? '' : 's'}` : ''}${infants ? ` + ${infants} bebé${infants === 1 ? '' : 's'}` : ''}`;
}

function travellerCount(offer) {
  return Math.max(1, Number(offer.adults || 1) + Number(offer.children || 0) + Number(offer.infants || 0));
}

function durationText(minutes) {
  if (!Number.isFinite(Number(minutes))) return '';
  const h = Math.floor(Number(minutes) / 60); const m = Number(minutes) % 60;
  return `${h ? `${h}h` : ''}${m ? `${String(m).padStart(2, '0')}m` : ''}` || '—';
}

function timeText(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

function dateText(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
}

function externalMoney(amount, currency = 'EUR') {
  try { return Number(amount || 0).toLocaleString('pt-PT', { style: 'currency', currency }); }
  catch { return `${Number(amount || 0).toFixed(2)} ${currency}`; }
}

window.applyReviewSuggestion = function(idDistributions) {
  const offer = getCurrentOffer();
  const option = offer.roomOptions?.find(o => o.idDistributions === idDistributions);
  if (!option) return;
  applyRoomOption(offer, option);
  renderReview(offer);
  loadTravelIntelligence(offer);
};

async function shareTrip(offer) {
  const btn = $('#shareTripBtn');
  if (!btn) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'A criar ligação...';
  try {
    const data = await api('/api/share-trip', { method: 'POST', body: JSON.stringify({ offer }) });
    if (navigator.share) await navigator.share({ title: `Viagem a ${offer.destination}`, text: `${offer.hotel} · ${money(offer.finalPrice)}`, url: data.url });
    else { await navigator.clipboard.writeText(data.url); btn.textContent = 'Ligação copiada ✓'; setTimeout(() => { if (btn) btn.textContent = original; }, 2200); return; }
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; if (btn.textContent === 'A criar ligação...') btn.textContent = original; }
}

function renderFlightPanel(provider) {
  const el = $('#flightIntelligence');
  if (!el) return;
  if (!provider) {
    el.innerHTML = '<div class="intel-empty"><b>Alternativas de voo</b><span>Esta ligação ainda não está disponível para este destino.</span></div>';
    return;
  }
  if (!provider.ok) {
    el.innerHTML = `<div class="intel-empty"><b>Alternativas de voo temporariamente indisponíveis</b><span>${esc(provider.error || 'Pode continuar com a viagem e voltar a consultar mais tarde.')}</span></div>`;
    return;
  }
  const offers = provider.data?.offers || [];
  if (!offers.length) {
    el.innerHTML = '<div class="intel-empty"><b>Sem alternativas de voo para mostrar</b><span>O hotel continua guardado e pode alterar as datas/origem sem perder a pesquisa.</span></div>';
    return;
  }
  el.innerHTML = `
    <div class="intel-section-head"><div><p class="eyebrow">Voos disponíveis</p><h3>Compare horários antes de decidir</h3></div><span class="intel-note">Cotação independente</span></div>
    <p class="muted small">Estes voos são uma comparação adicional e <b>não estão somados ao total desta oferta</b>. A reserva aérea só será integrada depois de validar a tarifa e a lógica do pacote.</p>
    <div class="flight-option-list">${offers.slice(0, 4).map((f, i) => {
      const out = f.slices?.[0] || {}; const ret = f.slices?.[1] || {};
      const carriers = f.carriers?.length ? f.carriers.join(', ') : 'Companhia aérea';
      return `<article class="flight-option ${i === 0 ? 'is-best' : ''}">
        <div class="flight-carrier"><span>${i === 0 ? 'Melhor preço' : 'Alternativa'}</span><b>${esc(carriers)}</b></div>
        <div class="flight-legs">
          <div><span>${esc(out.origin || '')}</span><strong>${timeText(out.departureAt)}</strong><small>${out.stops ? `${out.stops} escala${out.stops > 1 ? 's' : ''}` : 'Direto'} · ${durationText(out.durationMinutes)}</small><span>${esc(out.destination || '')} ${timeText(out.arrivalAt)}</span></div>
          ${ret.origin ? `<div><span>${esc(ret.origin)}</span><strong>${timeText(ret.departureAt)}</strong><small>${ret.stops ? `${ret.stops} escala${ret.stops > 1 ? 's' : ''}` : 'Direto'} · ${durationText(ret.durationMinutes)}</small><span>${esc(ret.destination || '')} ${timeText(ret.arrivalAt)}</span></div>` : ''}
        </div>
        <div class="flight-price"><strong>${externalMoney(f.totalAmount, f.totalCurrency)}</strong><small>total da cotação aérea</small></div>
      </article>`;
    }).join('')}</div>`;
}

function renderWeather(provider, destination) {
  const el = $('#weatherIntelligence');
  if (!el) return;
  if (!provider?.ok) {
    el.innerHTML = '<div class="intel-empty compact"><b>Clima no destino</b><span>Condições atuais não disponíveis neste momento.</span></div>';
    return;
  }
  const w = provider.data || {};
  el.innerHTML = `<div class="weather-card"><div class="weather-main"><span class="weather-icon">${Number(w.temperature) >= 24 ? '☀️' : Number(w.temperature) >= 16 ? '🌤️' : '🌥️'}</span><div><p class="eyebrow">Condições atuais${destination ? ` · ${esc(destination)}` : ''}</p><strong>${Number(w.temperature)}°C</strong><span>${esc(w.description || '')}</span></div></div><div class="weather-facts"><span>Sensação ${Number(w.feelsLike)}°C</span><span>Humidade ${Number(w.humidity)}%</span><span>Vento ${Number(w.windSpeed || 0).toFixed(1)} m/s</span></div><small>Informação atual do destino; não é uma previsão para datas distantes.</small></div>`;
}

function renderEvents(provider) {
  const el = $('#eventsIntelligence');
  if (!el) return;
  if (!provider?.ok || !(provider.data?.events || []).length) {
    el.innerHTML = '<div class="intel-empty"><b>Durante a sua estadia</b><span>Ainda não encontrámos eventos relevantes para estas datas.</span></div>';
    return;
  }
  const events = provider.data.events.slice(0, 6);
  el.innerHTML = `<div class="intel-section-head"><div><p class="eyebrow">Durante a sua estadia</p><h3>Há mais para descobrir no destino</h3></div></div><div class="event-grid">${events.map(ev => `<article class="event-card">${ev.image ? `<img src="${esc(ev.image)}" alt="" loading="lazy"/>` : '<div class="event-image-placeholder">🎟️</div>'}<div><span class="event-date">${esc(dateText(ev.date))}${ev.time ? ` · ${esc(ev.time.slice(0,5))}` : ''}</span><h4>${esc(ev.name)}</h4><p>${esc([ev.venue, ev.city].filter(Boolean).join(' · '))}</p>${ev.url ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">Ver evento ↗</a>` : ''}</div></article>`).join('')}</div><p class="muted tiny">Informação de eventos apresentada para inspiração. A compra de bilhetes é externa enquanto não existir integração comercial própria.</p>`;
}

async function setupExploreZone(offer) {
  const box = $('#exploreZoneBox');
  if (!box) return;
  try {
    configPromise ||= api('/api/config');
    const cfg = await configPromise;
    const enabled = Boolean(cfg.features?.exploreZone);
    if (!enabled) { box.hidden = true; return; }
    box.hidden = false;
    const btn = $('#exploreZoneBtn');
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'A explorar…';
      try {
        const data = await api('/api/explore-zone', { method: 'POST', body: JSON.stringify({ offerToken: offer.offerToken }) });
        const list = $('#exploreZoneResults');
        list.innerHTML = (data.places || []).length ? `<div class="place-chips">${data.places.map(p => `<span><b>${esc(p.displayName?.text || p.displayName || 'Local')}</b><small>${esc(p.formattedAddress || '')}</small></span>`).join('')}</div>` : '<p class="muted small">Sem locais para mostrar.</p>';
      } catch (err) { $('#exploreZoneResults').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      finally { btn.disabled = false; btn.textContent = 'Explorar a zona'; }
    };
  } catch { box.hidden = true; }
}

async function loadTravelIntelligence(offer) {
  const seq = ++intelligenceRequestSeq;
  $('#flightIntelligence').innerHTML = '<div class="intel-loading"><span></span><b>A procurar alternativas de voo…</b></div>';
  $('#weatherIntelligence').innerHTML = '<div class="intel-loading compact"><span></span><b>A consultar o destino…</b></div>';
  $('#eventsIntelligence').innerHTML = '<div class="intel-loading"><span></span><b>A ver o que acontece durante a viagem…</b></div>';
  setupExploreZone(offer);
  try {
    const data = await api('/api/travel-intelligence', { method: 'POST', body: JSON.stringify({ offer }) });
    if (seq !== intelligenceRequestSeq) return;
    renderFlightPanel(data.providers?.flights);
    renderWeather(data.providers?.weather, data.destination?.name || offer.destination);
    renderEvents(data.providers?.events);
  } catch (err) {
    if (seq !== intelligenceRequestSeq) return;
    renderFlightPanel({ ok: false, error: err.message });
    renderWeather(null, offer.destination);
    renderEvents(null);
  }
}

function renderReview(offer) {
  const trip = dateRange(offer.checkin, offer.checkout);
  const suggestion = upgradeSuggestion(offer);
  const story = destinationContent[offer.destination] || 'Uma viagem preparada para poder comparar, guardar, partilhar e confirmar com clareza antes do pagamento.';
  const image = DESTINATION_IMAGES[offer.destination] || DESTINATION_IMAGES['Punta Cana'];
  const pax = passengerSummary(offer);
  const perPerson = Number(offer.finalPrice || 0) / travellerCount(offer);

  $('#reviewContent').innerHTML = `
    <div class="trip-builder-head">
      <div class="trip-builder-hero" style="background-image:url('${image}')">
        <div class="trip-builder-overlay">
          <span class="pill ${offer.live ? 'live' : ''}">${offer.live ? 'Preço atualizado' : 'Proposta estimada'}</span>
          <h2>${esc(offer.destination)}</h2>
          <p>${esc(offer.hotel)} · ${trip || `${offer.nights} noites`}</p>
        </div>
      </div>
      <div class="trip-builder-actions"><button type="button" class="ghost" id="saveTripBtn">♡ Guardar viagem</button><button type="button" class="ghost" id="shareTripBtn">↗ Partilhar</button></div>
    </div>

    <div class="trip-builder-layout">
      <div class="trip-builder-main">
        <section class="trip-intro-card">
          <div><p class="eyebrow">A sua viagem</p><h3>${esc(offer.hotel)}</h3><p class="muted">${story}</p></div>
          <div class="trip-facts-inline"><span>📅 ${trip || '-'}</span><span>👥 ${esc(pax)}</span><span>🌙 ${offer.nights} noites</span><span>🍽️ ${esc(offer.board)}</span></div>
        </section>

        <section class="trip-component-card is-highlighted">
          <div class="trip-component-icon">▣</div>
          <div class="trip-component-body"><div class="trip-component-title"><div><span class="eyebrow">Hotel</span><h3>${esc(offer.hotel)}</h3></div><span class="status-chip success">Selecionado</span></div><p><b>${esc(offer.board)}</b> · ${offer.nights} noites · ${offer.freeCancellation ? 'Cancelamento flexível' : 'Tarifa com restrições de cancelamento'}</p>${suggestion ? `<div class="smart-suggestion"><b>✨ Sugestão útil</b><span>${esc(suggestion.text)}</span><button type="button" class="ghost mini-action" onclick="applyReviewSuggestion('${suggestion.option.idDistributions}')">Aplicar</button></div>` : ''}</div>
          <button type="button" class="ghost mini-action" id="changeHotelBtn">Ver outros hotéis</button>
        </section>

        <section class="travel-intelligence-block" id="flightIntelligence"></section>

        <section class="destination-intelligence-grid">
          <div id="weatherIntelligence"></div>
          <div class="trip-component-card addable compact-card"><div class="trip-component-icon">＋</div><div class="trip-component-body"><span class="eyebrow">Personalizar</span><h3>Transfer, seguro e atividades</h3><p class="muted">Estamos a preparar atividades e transfers ligados ao destino. Só mostramos extras quando o preço, a disponibilidade e as condições estiverem devidamente validados.</p></div><button type="button" class="ghost mini-action" id="extrasInfoBtn">Ver possibilidades</button></div>
        </section>

        <section class="travel-intelligence-block" id="eventsIntelligence"></section>

        <section class="travel-intelligence-block explore-zone-box" id="exploreZoneBox" hidden>
          <div class="intel-section-head"><div><p class="eyebrow">Explorar a zona</p><h3>Veja pontos de interesse quando quiser</h3></div><button type="button" class="ghost mini-action" id="exploreZoneBtn">Explorar a zona</button></div>
          <p class="muted small">Esta pesquisa só é feita quando pede explicitamente — não é executada para cada hotel dos resultados.</p><div id="exploreZoneResults"></div>
        </section>

        <section class="prebook-checks">
          <div class="prebook-checks-head"><div><p class="eyebrow">Antes de reservar</p><h3>O site vai verificar consigo</h3></div><span class="smart-badge">Assistência inteligente</span></div>
          <div class="prebook-check-grid"><div>✓ Passageiros e idades coerentes</div><div>✓ Nomes iguais aos documentos</div><div>✓ Validade dos documentos no regresso</div><div>✓ Preço e disponibilidade revistos antes do pagamento</div><div>✓ Documentos duplicados bloqueados</div><div>✓ Campos obrigatórios validados à medida que preenche</div></div>
        </section>
      </div>

      <aside class="trip-price-card">
        <p class="eyebrow">Resumo</p>
        <div class="trip-price-route"><b>${esc(offer.destination)}</b><span>${esc(pax)}</span><span>${offer.nights} noites</span></div>
        <div class="trip-price-main"><span>Desde</span><strong>${money(offer.finalPrice)}</strong><small>${money(perPerson)} / passageiro</small></div>
        <div class="trip-price-note">${offer.freeCancellation ? '✓ Condições flexíveis nesta tarifa' : '⚠ Esta tarifa tem restrições de cancelamento'}</div>
        <button type="button" class="btn wide" id="continueToDataBtn">Continuar para a reserva</button>
        <button type="button" class="ghost wide" id="saveTripAsideBtn">Guardar e decidir mais tarde</button>
        <div class="sticky-trust"><span>✓ Dados validados</span><span>✓ Pagamento em etapa própria</span><span>✓ Apoio humano quando necessário</span></div>
        <p class="muted small">Antes do pagamento voltamos a validar os dados essenciais e a disponibilidade.</p>
      </aside>
    </div>`;

  const save = () => { saveLocal(offer); ['saveTripBtn', 'saveTripAsideBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.textContent = '✓ Viagem guardada'; }); };
  $('#saveTripBtn').onclick = save;
  $('#saveTripAsideBtn').onclick = save;
  $('#shareTripBtn').onclick = () => shareTrip(offer);
  $('#changeHotelBtn').onclick = () => $('#backToResultsBtn').click();
  $('#extrasInfoBtn').onclick = () => $('#eventsIntelligence')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#continueToDataBtn').onclick = openPassportModal;
}

export function showReview(offer) {
  setCurrentOffer(offer);
  renderReview(offer);
  $('#reviewPage').hidden = false;
  $('#reviewPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadTravelIntelligence(offer);
}

$('#backToResultsBtn').onclick = () => {
  intelligenceRequestSeq++;
  $('#reviewPage').hidden = true;
  $('#resultsPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
