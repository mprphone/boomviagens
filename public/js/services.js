import { $, api, esc, formToJson } from './utils.js';
import { goHome } from './router.js';
import { setSearchType } from './heroSearch.js';

const PRIMARY_SEARCH = new Set(['PACKAGE', 'HOTEL', 'FLIGHT', 'CRUISE', 'EXPERIENCE']);
const SERVICE_MARKS = {
  PACKAGE: 'V+H', HOTEL: 'HT', FLIGHT: 'VO', CRUISE: 'CR', EXPERIENCE: 'EX',
  TRANSFER: 'TR', CAR: 'RC', TRAIN: 'CO', FERRY: 'FE', CIRCUIT: 'CI', INSURANCE: 'SG', GIFT: 'CP'
};
const SERVICE_REQUEST_COPY = {
  TRANSFER: 'Indique aeroporto, hotel, horários e número de passageiros.',
  CAR: 'Indique local de levantamento, datas e tipo de viatura.',
  TRAIN: 'Indique origem, destino, datas e passageiros.',
  FERRY: 'Indique portos, datas, passageiros e se viaja com viatura.',
  CIRCUIT: 'Conte-nos os destinos, duração e estilo de viagem que procura.',
  INSURANCE: 'Indique destino, datas, idades e tipo de proteção pretendida.',
  GIFT: 'Indique o valor, a ocasião e a quem pretende oferecer.'
};

const FALLBACK_SERVICES = [
  ['PACKAGE', 'Pacotes', 'Voo e hotel numa só viagem.'], ['HOTEL', 'Hotéis', 'Estadias em Portugal e no mundo.'],
  ['FLIGHT', 'Voos', 'Pesquisa aérea mundial.'], ['CRUISE', 'Cruzeiros', 'Propostas ajustadas ao itinerário.'],
  ['EXPERIENCE', 'Experiências', 'Tours, atividades e bilhetes de eventos.'], ['TRANSFER', 'Transfers', 'Ligações entre aeroporto, hotel e porto.'],
  ['CAR', 'Rent-a-car', 'Viaturas para cada tipo de viagem.'], ['TRAIN', 'Comboios', 'Ligações ferroviárias nacionais e internacionais.'],
  ['FERRY', 'Ferries', 'Travessias para passageiros e viaturas.'], ['CIRCUIT', 'Circuitos', 'Programas acompanhados e à medida.'],
  ['INSURANCE', 'Seguros', 'Proteção adequada à sua viagem.'], ['GIFT', 'Cheque-viagem', 'Uma viagem para oferecer.']
].map(([id, label, description]) => ({ id, label, description, availability: 'ASSISTED' }));

let services = [];

function serviceById(id) { return services.find(item => item.id === id) || { id, label: id, availability: 'ASSISTED' }; }

function openSearch(type) {
  setSearchType(type);
  goHome();
  location.hash = '#pesquisa';
  setTimeout(() => type === 'FLIGHT' ? $('#flightOriginText')?.focus() : $('#destinationInput')?.focus(), 80);
}

function openServiceRequest(id) {
  const service = serviceById(id);
  $('#serviceRequestKind').value = id;
  $('#serviceRequestTitle').textContent = service.label || 'Pedido personalizado';
  $('#serviceRequestIntro').textContent = SERVICE_REQUEST_COPY[id] || 'Diga-nos o que procura. O pedido entra diretamente no nosso processo comercial.';
  $('#serviceRequestFeedback').textContent = '';
  $('#serviceRequestModal').hidden = false;
  document.body.classList.add('modal-open');
  setTimeout(() => $('#serviceRequestForm input[name="destination"]')?.focus(), 60);
}

function closeServiceRequest() {
  $('#serviceRequestModal').hidden = true;
  document.body.classList.remove('modal-open');
}

function activateService(id) {
  if (PRIMARY_SEARCH.has(id)) openSearch(id);
  else if (id === 'TRANSFER' && serviceById(id).availability === 'BUILDER') openSearch('PACKAGE');
  else openServiceRequest(id);
}

function renderCatalog(items) {
  services = items || [];
  const grid = $('#serviceCatalogGrid');
  if (!grid) return;
  grid.innerHTML = services.map(service => `<button type="button" class="service-card" data-service-card="${esc(service.id)}">
    <span class="service-card-mark" aria-hidden="true">${esc(SERVICE_MARKS[service.id] || service.label.slice(0,2).toUpperCase())}</span>
    <h3>${esc(service.label)}</h3>
    <p>${esc(service.description)}</p>
    <span class="service-availability ${service.availability !== 'ASSISTED' ? 'online' : ''}">${service.availability === 'ONLINE' ? 'Disponível online' : service.availability === 'BUILDER' ? 'Adicionar à viagem' : 'Pedido personalizado'}</span>
  </button>`).join('');
}

export function initServices(config = {}) {
  renderCatalog(config.services?.length ? config.services : FALLBACK_SERVICES);
}

document.addEventListener('click', event => {
  const serviceCard = event.target.closest('[data-service-card]');
  if (serviceCard) activateService(serviceCard.dataset.serviceCard);

  const catalogButton = event.target.closest('[data-catalog-service]');
  if (catalogButton) {
    event.preventDefault();
    $('#servicesMenu').hidden = true;
    const siteSheet = $('#siteSheet');
    if (siteSheet) siteSheet.hidden = true;
    document.getElementById('siteServicesBtn')?.setAttribute('aria-expanded', 'false');
    activateService(catalogButton.dataset.catalogService);
  }

  if (event.target.closest('[data-close-service-modal]') || event.target.id === 'serviceRequestModal') closeServiceRequest();
});

$('.more-services-trigger')?.addEventListener('click', event => {
  const menu = $('#servicesMenu');
  const open = menu.hidden;
  menu.hidden = !open;
  event.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
});

document.addEventListener('click', event => {
  const menu = $('#servicesMenu');
  if (menu && !menu.hidden && !event.target.closest('.more-services-trigger') && !event.target.closest('#servicesMenu')) menu.hidden = true;
});

$('#serviceRequestForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = $('#serviceRequestFeedback');
  const button = form.querySelector('button[type="submit"]');
  const payload = formToJson(form);
  if (!payload.email && !payload.phone) {
    feedback.textContent = 'Indique pelo menos um email ou telefone.';
    return;
  }
  button.disabled = true;
  button.textContent = 'A registar o pedido…';
  feedback.textContent = '';
  try {
    const data = await api('/api/assisted-request', { method: 'POST', body: JSON.stringify(payload) });
    feedback.textContent = `Pedido registado com a referência ${data.requestId}. Vamos entrar em contacto consigo.`;
    form.reset();
    $('#serviceRequestKind').value = payload.kind;
    button.textContent = 'Pedido enviado';
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
    button.textContent = 'Enviar pedido à Boomviagens';
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#serviceRequestModal')?.hidden) closeServiceRequest();
});
