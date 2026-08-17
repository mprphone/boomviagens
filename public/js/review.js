// Construtor/revisão da viagem. As APIs externas são chamadas apenas quando
// o cliente abre uma opção. Escolhas de voo/transfer/atividade são sempre
// reprecificadas no servidor através de tokens assinados — o browser nunca
// decide o NET nem o PVP.

import { $, esc, money, dateRange, api, safeImageUrl, safeExternalUrl, cssImageUrl, notify } from './utils.js';
import { applyRoomOption } from './offers.js';
import { getCurrentOffer, setCurrentOffer } from './state.js';
import { openPassportModal } from './checkout.js';

const GENERIC_TRAVEL_IMAGE = 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1400&q=82';
const DESTINATION_IMAGES = {
  'Punta Cana': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=82',
  'Riviera Maya': 'https://images.unsplash.com/photo-1510097467424-192d713fd8b2?auto=format&fit=crop&w=1400&q=82',
  'Sal': 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=82',
  'Maldivas': 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=1400&q=82',
  'Disneyland Paris': 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1400&q=82',
  'Madeira': 'https://images.unsplash.com/photo-1526392060635-9d6019884377?auto=format&fit=crop&w=1400&q=82',
  'Gran Canaria': 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1400&q=82',
  'Tenerife': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=82',
  'Atenas': 'https://images.unsplash.com/photo-1555993539-1732b0258235?auto=format&fit=crop&w=1400&q=82',
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1400&q=82',
  'Roma': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=1400&q=82'
};

const destinationContent = {
  'Punta Cana': 'Praias de areia branca e mar turquesa nas Caraíbas. Tudo incluído pensado para relaxar sem preocupações.',
  'Riviera Maya': 'Costa do México entre recifes de coral, cenotes e cultura maia. Praia e aventura no mesmo destino.',
  'Sal': 'Praias largas, clima ameno e ligação cultural a Portugal. Uma opção simples e muito procurada para famílias.',
  'Maldivas': 'Vilas sobre a água e snorkeling à porta do quarto. Um clássico de lua-de-mel e grandes viagens.',
  'Disneyland Paris': 'A magia Disney a poucas horas de avião, especialmente prática para famílias.',
  'Madeira': 'Natureza atlântica, levadas e gastronomia portuguesa num destino fácil de organizar.',
  'Atenas': 'História, bairros vivos e gastronomia mediterrânica. Compare hotel, voo, transfer e experiências antes de fechar a viagem.',
  'Paris': 'Bairros, cultura e gastronomia para uma escapadinha que pode ser construída à sua medida.',
  'Roma': 'Património, gastronomia e bairros históricos com várias combinações de voo e alojamento.'
};

let intelligenceRequestSeq = 0;
let configPromise = null;
let lastIntelligenceData = null;
let builderBusy = false;

function upgradeSuggestion(offer) {
  const options = offer.roomOptions;
  if (!options || options.length < 2) return null;
  const currentId = offer.tourdiez?.idDistributions;
  if (!currentId) return null;
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
function travellerCount(offer) { return Math.max(1, Number(offer.adults || 1) + Number(offer.children || 0) + Number(offer.infants || 0)); }
function durationText(minutes) { const n=Number(minutes); if(!Number.isFinite(n)) return ''; const h=Math.floor(n/60),m=n%60; return `${h?`${h}h`:''}${m?`${String(m).padStart(2,'0')}m`:''}`||'—'; }
function timeText(iso) { if(!iso)return'—'; const d=new Date(iso); return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}); }
function dateText(iso) { if(!iso)return''; const d=new Date(`${String(iso).slice(0,10)}T00:00:00`); return Number.isNaN(d.getTime())?'':d.toLocaleDateString('pt-PT',{day:'2-digit',month:'short'}); }
function externalMoney(amount,currency='EUR'){try{return Number(amount||0).toLocaleString('pt-PT',{style:'currency',currency});}catch{return`${Number(amount||0).toFixed(2)} ${currency}`;}}
function flightSummary(flight={}) { const out=flight.slices?.[0]||{}; const ret=flight.slices?.[1]||{}; return { out, ret, carriers: flight.carriers?.length ? flight.carriers.join(', ') : 'Companhia aérea' }; }

window.applyReviewSuggestion = function(idDistributions) {
  const offer = getCurrentOffer();
  const option = offer.roomOptions?.find(o => o.idDistributions === idDistributions);
  if (!option) return;
  applyRoomOption(offer, option); renderReview(offer); loadTravelIntelligence(offer);
};

async function shareTrip(offer) {
  const btn=$('#shareTripBtn'); if(!btn)return; btn.disabled=true; const original=btn.textContent; btn.textContent='A criar ligação...';
  try { const data=await api('/api/share-trip',{method:'POST',body:JSON.stringify({offer})}); if(navigator.share) await navigator.share({title:`Viagem a ${offer.destination}`,text:`${offer.hotel} · ${money(offer.finalPrice)}`,url:data.url}); else {await navigator.clipboard.writeText(data.url);btn.textContent='Ligação copiada ✓';setTimeout(()=>{if(btn)btn.textContent=original;},2200);return;} }
  catch(err){notify(err.message);} finally{btn.disabled=false;if(btn.textContent==='A criar ligação...')btn.textContent=original;}
}

function renderSelectedFlightCard(offer) {
  if (!offer.flight || !['DYNAMIC_PACKAGE','FLIGHT'].includes(offer.productType)) return '';
  const { out, ret, carriers } = flightSummary(offer.flight);
  return `<section class="trip-component-card is-highlighted selected-flight-summary">
    <div class="trip-component-icon">VO</div><div class="trip-component-body"><div class="trip-component-title"><div><span class="eyebrow">Voo</span><h3>${esc(carriers)}</h3></div><span class="status-chip success">Incluído</span></div>
    <div class="selected-flight-legs"><span><b>${esc(out.origin||offer.origin||'')}</b> ${timeText(out.departureAt)} → <b>${esc(out.destination||'')}</b> ${timeText(out.arrivalAt)} · ${out.stops ? `${out.stops} escala${out.stops>1?'s':''}`:'Direto'}</span>${ret.origin?`<span><b>${esc(ret.origin)}</b> ${timeText(ret.departureAt)} → <b>${esc(ret.destination)}</b> ${timeText(ret.arrivalAt)} · ${ret.stops ? `${ret.stops} escala${ret.stops>1?'s':''}`:'Direto'}</span>`:''}</div></div>
    <button type="button" class="ghost mini-action" id="changeFlightBtn">Alterar voo</button></section>`;
}

function renderFlightPanel(provider, offer) {
  const el=$('#flightIntelligence'); if(!el)return;
  if(!provider){el.innerHTML='<div class="intel-empty"><b>Voos</b><span>Não existe ligação aérea disponível para consultar neste destino.</span></div>';return;}
  if(!provider.ok){el.innerHTML=`<div class="intel-empty"><b>Voos temporariamente indisponíveis</b><span>${esc(provider.error||'Pode continuar e tentar novamente mais tarde.')}</span></div>`;return;}
  const offers=provider.data?.offers||[];
  if(!offers.length){el.innerHTML='<div class="intel-empty"><b>Sem voos para mostrar</b><span>Experimente outras datas ou origem.</span></div>';return;}
  const buildable=offers.some(f=>f.componentToken);
  const currentFlightPrice=Number(offer.selectedExtras?.flight?.finalPrice||0);
  el.innerHTML=`<div class="intel-section-head"><div><p class="eyebrow">Voo</p><h3>${offer.productType==='DYNAMIC_PACKAGE'?'Escolha o horário que prefere':'Adicione um voo ao alojamento'}</h3></div><span class="intel-note">Preço revalidado ao selecionar</span></div>
    <p class="muted small">${buildable?'Ao trocar ou adicionar um voo, o total da viagem é recalculado no servidor.':'Esta é apenas uma comparação informativa para este produto; o pacote do operador não permite substituir o voo individualmente.'}</p>
    <div class="flight-option-list">${offers.slice(0,6).map((f,i)=>{const {out,ret,carriers}=flightSummary(f);const selected=offer.selectedFlightComponentId ? offer.selectedFlightComponentId===f.componentId : Boolean(f.selected);const delta=currentFlightPrice&&f.finalPrice?Number(f.finalPrice)-currentFlightPrice:null;return `<article class="flight-option ${selected?'is-best is-selected':''}"><div class="flight-carrier"><span>${selected?'Selecionado':i===0?'Melhor preço':'Alternativa'}</span><b>${esc(carriers)}</b></div><div class="flight-legs"><div><span>${esc(out.origin||'')}</span><strong>${timeText(out.departureAt)}</strong><small>${out.stops?`${out.stops} escala${out.stops>1?'s':''}`:'Direto'} · ${durationText(out.durationMinutes)}</small><span>${esc(out.destination||'')} ${timeText(out.arrivalAt)}</span></div>${ret.origin?`<div><span>${esc(ret.origin)}</span><strong>${timeText(ret.departureAt)}</strong><small>${ret.stops?`${ret.stops} escala${ret.stops>1?'s':''}`:'Direto'} · ${durationText(ret.durationMinutes)}</small><span>${esc(ret.destination||'')} ${timeText(ret.arrivalAt)}</span></div>`:''}</div><div class="flight-price"><strong>${externalMoney(f.finalPrice,f.currency)}</strong>${delta!=null&&!selected?`<small>${delta>=0?'+':''}${money(delta)} face ao voo atual</small>`:'<small>total do voo</small>'}${f.componentToken?`<button type="button" class="btn mini-action" ${selected?'disabled':''} data-builder-action="add" data-kind="flight" data-component-id="${esc(f.componentId)}" data-component-token="${esc(f.componentToken)}">${selected?'Selecionado':'Escolher voo'}</button>`:''}</div></article>`;}).join('')}</div>`;
}

function renderTransfers(provider, offer) {
  const el=$('#transfersIntelligence'); if(!el)return;
  if(!provider){el.innerHTML='<div class="intel-empty"><b>Transfer</b><span>Selecione um alojamento HBX para podermos procurar transporte aeroporto ↔ hotel.</span></div>';return;}
  if(!provider.ok){el.innerHTML=`<div class="intel-empty"><b>Transfers indisponíveis</b><span>${esc(provider.error||'Não foi possível consultar transfers agora.')}</span></div>`;return;}
  const services=provider.data?.services||[];
  if(!services.length){el.innerHTML=`<div class="intel-empty"><b>Transfer</b><span>${esc(provider.data?.unavailableReason||'Não encontrámos transfer disponível para esta combinação. Pode pedir ajuda à agência se quiser acrescentar transporte.')}</span></div>`;return;}
  const selected=offer.selectedExtras?.transfer;
  el.innerHTML=`<div class="intel-section-head"><div><p class="eyebrow">Transfer</p><h3>Do aeroporto ao hotel sem complicações</h3></div>${selected?`<button type="button" class="ghost mini-action" data-builder-action="remove" data-kind="transfer" data-component-id="${esc(selected.componentId||'')}">Remover transfer</button>`:''}</div><div class="extra-option-grid">${services.map((s,i)=>{const isSelected=selected?.componentId===s.componentId;return `<article class="extra-option-card ${isSelected?'is-selected':''}"><div class="extra-option-icon">TR</div><div><span class="extra-kicker">${isSelected?'Selecionado':i===0?'Recomendado':'Alternativa'}</span><h4>${esc(s.title)}</h4><p>${esc(s.subtitle||'Aeroporto ↔ hotel')}</p>${s.maxPax?`<small>Até ${s.maxPax} passageiros</small>`:''}</div><div class="extra-option-price"><strong>${money(s.finalPrice)}</strong><button type="button" class="btn mini-action" ${isSelected?'disabled':''} data-builder-action="add" data-kind="transfer" data-component-id="${esc(s.componentId)}" data-component-token="${esc(s.componentToken)}">${isSelected?'Adicionado':'Adicionar'}</button></div></article>`;}).join('')}</div>`;
}

function renderActivities(provider, offer) {
  const el=$('#activitiesIntelligence'); if(!el)return;
  if(!provider){el.innerHTML='<div class="intel-empty"><b>Experiências</b><span>Não há atividades ligadas a este destino nesta pesquisa.</span></div>';return;}
  if(!provider.ok){el.innerHTML=`<div class="intel-empty"><b>Experiências temporariamente indisponíveis</b><span>${esc(provider.error||'Pode voltar a consultar depois.')}</span></div>`;return;}
  const items=provider.data?.activities||[];
  if(!items.length){el.innerHTML='<div class="intel-empty"><b>Experiências</b><span>Ainda não encontrámos atividades para estas datas.</span></div>';return;}
  const selectedIds=new Set((offer.selectedExtras?.activities||[]).map(x=>x.componentId));
  el.innerHTML=`<div class="intel-section-head"><div><p class="eyebrow">Experiências</p><h3>Complete a viagem sem sair da reserva</h3></div><span class="intel-note">Pode adicionar várias</span></div><div class="activity-option-grid">${items.map(a=>{const selected=selectedIds.has(a.componentId);return `<article class="activity-option-card ${selected?'is-selected':''}">${a.image?`<img src="${esc(safeImageUrl(a.image))}" alt="" loading="lazy"/>`:'<div class="activity-placeholder"></div>'}<div class="activity-option-body"><span class="extra-kicker">${selected?'Adicionada':'Experiência'}</span><h4>${esc(a.name)}</h4><p>${esc(a.description||'')}</p><div><strong>${a.finalPrice>0?`${a.priceLabel==='desde'?'desde ':''}${money(a.finalPrice)}`:'Sob consulta'}</strong>${a.componentToken?(selected?`<button type="button" class="ghost mini-action" data-builder-action="remove" data-kind="activity" data-component-id="${esc(a.componentId)}">Remover</button>`:`<button type="button" class="btn mini-action" data-builder-action="add" data-kind="activity" data-component-id="${esc(a.componentId)}" data-component-token="${esc(a.componentToken)}">Adicionar</button>`):''}</div></div></article>`;}).join('')}</div>`;
}

function renderWeather(provider,destination){const el=$('#weatherIntelligence');if(!el)return;if(!provider?.ok){el.innerHTML='<div class="intel-empty compact"><b>Clima no destino</b><span>Condições atuais não disponíveis neste momento.</span></div>';return;}const w=provider.data||{};el.innerHTML=`<div class="weather-card"><div class="weather-main"><span class="weather-icon">CL</span><div><p class="eyebrow">Condições atuais${destination?` · ${esc(destination)}`:''}</p><strong>${Number(w.temperature)}°C</strong><span>${esc(w.description||'')}</span></div></div><div class="weather-facts"><span>Sensação ${Number(w.feelsLike)}°C</span><span>Humidade ${Number(w.humidity)}%</span><span>Vento ${Number(w.windSpeed||0).toFixed(1)} m/s</span></div><small>Informação atual do destino; não é uma previsão para datas distantes.</small></div>`;}
function renderEvents(provider){const el=$('#eventsIntelligence');if(!el)return;if(!provider?.ok||!(provider.data?.events||[]).length){el.innerHTML='<div class="intel-empty"><b>Durante a sua estadia</b><span>Ainda não encontrámos eventos relevantes para estas datas.</span></div>';return;}const events=provider.data.events.slice(0,6);el.innerHTML=`<div class="intel-section-head"><div><p class="eyebrow">Durante a sua estadia</p><h3>Há mais para descobrir no destino</h3></div></div><div class="event-grid">${events.map(ev=>`<article class="event-card">${ev.image?`<img src="${esc(safeImageUrl(ev.image))}" alt="" loading="lazy"/>`:'<div class="event-image-placeholder"></div>'}<div><span class="event-date">${esc(dateText(ev.date))}${ev.time?` · ${esc(ev.time.slice(0,5))}`:''}</span><h4>${esc(ev.name)}</h4><p>${esc([ev.venue,ev.city].filter(Boolean).join(' · '))}</p>${safeExternalUrl(ev.url)?`<a href="${esc(safeExternalUrl(ev.url))}" target="_blank" rel="noopener noreferrer">Ver evento</a>`:''}</div></article>`).join('')}</div><p class="muted tiny">Informação de eventos apresentada para inspiração. A compra de bilhetes é externa enquanto não existir integração comercial própria.</p>`;}

async function setupExploreZone(offer){const box=$('#exploreZoneBox');if(!box)return;try{configPromise||=api('/api/config');const cfg=await configPromise;const enabled=Boolean(cfg.features?.exploreZone);if(!enabled){box.hidden=true;return;}box.hidden=false;const btn=$('#exploreZoneBtn');btn.onclick=async()=>{btn.disabled=true;btn.textContent='A explorar…';try{const data=await api('/api/explore-zone',{method:'POST',body:JSON.stringify({offerToken:offer.offerToken})});const list=$('#exploreZoneResults');list.innerHTML=(data.places||[]).length?`<div class="place-chips">${data.places.map(p=>`<span><b>${esc(p.displayName?.text||p.displayName||'Local')}</b><small>${esc(p.formattedAddress||'')}</small></span>`).join('')}</div>`:'<p class="muted small">Sem locais para mostrar.</p>';}catch(err){$('#exploreZoneResults').innerHTML=`<p class="error">${esc(err.message)}</p>`;}finally{btn.disabled=false;btn.textContent='Explorar a zona';}};}catch{box.hidden=true;}}

function renderIntelligenceData(data, offer) {
  if (!data) return;
  renderFlightPanel(data.providers?.flights, offer);
  renderTransfers(data.providers?.transfers, offer);
  renderActivities(data.providers?.activities, offer);
  renderWeather(data.providers?.weather, data.destination?.name || offer.destination);
  renderEvents(data.providers?.events);
  setupExploreZone(offer);
}

async function loadTravelIntelligence(offer) {
  const seq=++intelligenceRequestSeq; lastIntelligenceData=null;
  $('#flightIntelligence').innerHTML='<div class="intel-loading"><span></span><b>A procurar voos e horários…</b></div>';
  if ($('#transfersIntelligence')) $('#transfersIntelligence').innerHTML='<div class="intel-loading"><span></span><b>A procurar transfers…</b></div>';
  $('#activitiesIntelligence').innerHTML='<div class="intel-loading"><span></span><b>A procurar experiências…</b></div>';
  $('#weatherIntelligence').innerHTML='<div class="intel-loading compact"><span></span><b>A consultar o destino…</b></div>';
  $('#eventsIntelligence').innerHTML='<div class="intel-loading"><span></span><b>A ver o que acontece durante a viagem…</b></div>';
  setupExploreZone(offer);
  try { const data=await api('/api/travel-intelligence',{method:'POST',body:JSON.stringify({offer})}); if(seq!==intelligenceRequestSeq)return; lastIntelligenceData=data; offer.selectedExtras=data.selectedExtras||offer.selectedExtras||{}; setCurrentOffer(offer); renderIntelligenceData(data,offer); }
  catch(err){if(seq!==intelligenceRequestSeq)return;renderFlightPanel({ok:false,error:err.message},offer);renderTransfers({ok:false,error:err.message},offer);renderActivities({ok:false,error:err.message},offer);renderWeather(null,offer.destination);renderEvents(null);}
}

async function updateTripComponent(payload, localSelection={}) {
  if(builderBusy)return; const offer=getCurrentOffer(); if(!offer?.offerToken)return;
  builderBusy=true;
  try { const result=await api('/api/trip-builder/update',{method:'POST',body:JSON.stringify({offerToken:offer.offerToken,...payload})});
    Object.assign(offer,result.offer||{});
    if(localSelection.kind==='flight') offer.selectedFlightComponentId=localSelection.componentId||'';
    setCurrentOffer(offer); renderReview(offer); if(lastIntelligenceData) renderIntelligenceData(lastIntelligenceData,offer);
  } catch(err){notify(err.message);} finally{builderBusy=false;}
}
window.selectTripComponent=(kind,componentId,componentToken)=>updateTripComponent({action:'add',componentToken},{kind,componentId});
window.removeTripComponent=(kind,componentId)=>updateTripComponent({action:'remove',kind,componentId},{kind,componentId:''});

// Event delegation: IDs/tokens de fornecedores vivem em data-* e nunca são
// interpolados dentro de JavaScript inline. Além de facilitar uma CSP futura,
// evita que uma string externa consiga quebrar o contexto JS de onclick.
$('#reviewContent')?.addEventListener('click', event => {
  const builder = event.target.closest('[data-builder-action]');
  if (builder) {
    const action = builder.dataset.builderAction;
    const kind = builder.dataset.kind || '';
    const componentId = builder.dataset.componentId || '';
    if (action === 'add') window.selectTripComponent(kind, componentId, builder.dataset.componentToken || '');
    else if (action === 'remove') window.removeTripComponent(kind, componentId);
    return;
  }
  const suggestion = event.target.closest('[data-review-suggestion]');
  if (suggestion) window.applyReviewSuggestion(suggestion.dataset.reviewSuggestion || '');
});

function renderReview(offer) {
  const flightOnly = offer.productType === 'FLIGHT';
  const trip=dateRange(offer.checkin,offer.checkout); const suggestion=flightOnly ? null : upgradeSuggestion(offer);
  const story=destinationContent[offer.destination]||'Compare as peças da viagem, escolha o que prefere e confirme tudo antes do pagamento.';
  const image=safeImageUrl(offer.image, DESTINATION_IMAGES[offer.destination]||GENERIC_TRAVEL_IMAGE)||GENERIC_TRAVEL_IMAGE; const pax=passengerSummary(offer); const perPerson=Number(offer.finalPrice||0)/travellerCount(offer);
  const selectedTransfer=offer.selectedExtras?.transfer; const activityCount=(offer.selectedExtras?.activities||[]).length;
  $('#reviewContent').innerHTML=`<div class="trip-builder-head"><div class="trip-builder-hero" style="background-image:url('${cssImageUrl(image)}')"><div class="trip-builder-overlay"><span class="pill ${offer.live?'live':''}">${offer.live?'Disponibilidade consultada':'Proposta'}</span><h2>${esc(offer.destination)}</h2><p>${flightOnly ? `Voo ${esc(offer.origin||'')} → ${esc(offer.destination)}` : esc(offer.hotel)} · ${trip||`${offer.nights} noites`}</p></div></div><div class="trip-builder-actions"><button type="button" class="ghost" id="saveTripBtn">Guardar viagem</button><button type="button" class="ghost" id="shareTripBtn">Partilhar</button></div></div>
  <div class="trip-builder-layout"><div class="trip-builder-main">
    <section class="trip-intro-card"><div><p class="eyebrow">A sua viagem</p><h3>Construa a combinação que faz sentido para si</h3><p class="muted">${esc(story)}</p></div><div class="trip-facts-inline"><span>${trip||'-'}</span><span>${esc(pax)}</span>${flightOnly?'':`<span>${offer.nights} noites</span><span>${esc(offer.board)}</span>`}</div></section>
    <div class="builder-progress">${flightOnly?'<span class="is-done">✓ Voo</span><span class="is-active">2 Dados</span><span>3 Pagamento</span>':`<span class="is-done">✓ Alojamento</span><span class="${offer.productType==='DYNAMIC_PACKAGE'?'is-done':'is-active'}">${offer.productType==='DYNAMIC_PACKAGE'?'✓':'2'} Voo</span><span class="${selectedTransfer?'is-done':''}">${selectedTransfer?'✓':'3'} Transfer</span><span class="${activityCount?'is-done':''}">${activityCount?'✓':'4'} Experiências</span><span>5 Seguro</span>`}</div>
    ${renderSelectedFlightCard(offer)}
    ${flightOnly?'':`<section class="trip-component-card is-highlighted"><div class="trip-component-icon">▣</div><div class="trip-component-body"><div class="trip-component-title"><div><span class="eyebrow">Hotel</span><h3>${esc(offer.hotel)}</h3></div><span class="status-chip success">Selecionado</span></div><p><b>${esc(offer.board)}</b> · ${offer.nights} noites · ${offer.freeCancellation?'Cancelamento flexível':'Tarifa com restrições de cancelamento'}</p>${suggestion?`<div class="smart-suggestion"><b>✨ Sugestão útil</b><span>${esc(suggestion.text)}</span><button type="button" class="ghost mini-action" data-review-suggestion="${esc(suggestion.option.idDistributions)}">Aplicar</button></div>`:''}</div><button type="button" class="ghost mini-action" id="changeHotelBtn">Ver outros hotéis</button></section>`}
    <section class="travel-intelligence-block" id="flightIntelligence"></section>
    ${flightOnly?'':`<section class="travel-intelligence-block" id="transfersIntelligence"></section>`}
    <section class="travel-intelligence-block" id="activitiesIntelligence"></section>
    <section class="destination-intelligence-grid"><div id="weatherIntelligence"></div><div class="trip-component-card addable compact-card"><div class="trip-component-icon">SG</div><div class="trip-component-body"><span class="eyebrow">Seguro de viagem</span><h3>Proteção adequada à viagem</h3><p class="muted">O seguro só será apresentado com preço e coberturas quando existir produto comercial configurado. Não inventamos uma cobertura automática.</p></div><span class="status-chip neutral">A configurar</span></div></section>
    <section class="travel-intelligence-block" id="eventsIntelligence"></section>
    <section class="travel-intelligence-block explore-zone-box" id="exploreZoneBox" hidden><div class="intel-section-head"><div><p class="eyebrow">Explorar a zona</p><h3>Veja pontos de interesse quando quiser</h3></div><button type="button" class="ghost mini-action" id="exploreZoneBtn">Explorar a zona</button></div><p class="muted small">Esta pesquisa só é feita quando pede explicitamente — não é executada para cada hotel dos resultados.</p><div id="exploreZoneResults"></div></section>
    <section class="prebook-checks"><div class="prebook-checks-head"><div><p class="eyebrow">Antes de reservar</p><h3>O site vai verificar consigo</h3></div><span class="smart-badge">Assistência inteligente</span></div><div class="prebook-check-grid"><div>✓ Passageiros e idades coerentes</div><div>✓ Nomes iguais aos documentos</div><div>✓ Validade dos documentos no regresso</div><div>✓ Preço e disponibilidade revistos antes do pagamento</div><div>✓ Documentos duplicados bloqueados</div><div>✓ Campos obrigatórios validados à medida que preenche</div></div></section>
  </div><aside class="trip-price-card"><p class="eyebrow">Resumo da viagem</p><div class="trip-price-route"><b>${esc(offer.destination)}</b><span>${esc(pax)}</span><span>${offer.nights} noites</span>${offer.productType==='FLIGHT'?'<span>Voo</span>':offer.productType==='DYNAMIC_PACKAGE'?'<span>Voo + hotel</span>':'<span>Alojamento</span>'}${selectedTransfer?`<span>Transfer adicionado · ${money(selectedTransfer.finalPrice)}</span>`:''}${activityCount?`<span>${activityCount} experiência${activityCount===1?'':'s'} adicionada${activityCount===1?'':'s'}</span>`:''}</div><div class="trip-price-main"><span>Preço total da viagem</span><strong>${money(offer.finalPrice)}</strong><small>${money(perPerson)} / passageiro</small></div><div class="trip-price-note">${offer.freeCancellation?'Condições flexíveis no alojamento':'Confirme as condições de cancelamento de cada componente'}</div><button type="button" class="btn wide" id="continueToDataBtn">Continuar para a reserva</button><button type="button" class="ghost wide" id="saveTripAsideBtn">Guardar e decidir mais tarde</button><div class="sticky-trust"><span>Total recalculado no servidor</span><span>Pagamento em etapa própria</span><span>Componentes revalidados antes de confirmar</span></div><p class="muted small">Voos, quartos e extras podem mudar de disponibilidade. Voltamos a validar antes do pagamento.</p></aside></div>`;

  const save=()=>{saveLocal(offer);['saveTripBtn','saveTripAsideBtn'].forEach(id=>{const b=document.getElementById(id);if(b)b.textContent='✓ Viagem guardada';});};
  $('#saveTripBtn').onclick=save;$('#saveTripAsideBtn').onclick=save;$('#shareTripBtn').onclick=()=>shareTrip(offer);const changeHotel=$('#changeHotelBtn'); if(changeHotel) changeHotel.onclick=()=>$('#backToResultsBtn').click();
  const changeFlight=$('#changeFlightBtn'); if(changeFlight) changeFlight.onclick=()=>$('#flightIntelligence')?.scrollIntoView({behavior:'smooth',block:'center'});
  $('#continueToDataBtn').onclick=openPassportModal;
}

export function showReview(offer){setCurrentOffer(offer);lastIntelligenceData=null;renderReview(offer);$('#resultsPage').hidden=true;$('#pesquisa').hidden=true;document.body.classList.remove('is-results');document.body.classList.add('is-review');$('#reviewPage').hidden=false;$('#reviewPage').scrollIntoView({behavior:'smooth',block:'start'});loadTravelIntelligence(offer);}
$('#backToResultsBtn').onclick=()=>{intelligenceRequestSeq++;lastIntelligenceData=null;$('#reviewPage').hidden=true;$('#pesquisa').hidden=false;$('#resultsPage').hidden=false;document.body.classList.remove('is-review');document.body.classList.add('is-results');$('#resultsPage').scrollIntoView({behavior:'smooth',block:'start'});};
