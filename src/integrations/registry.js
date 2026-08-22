// Registo central de fornecedores externos, importado uma vez pelo
// server.js. Adicionar uma nova integracao = acrescentar um bloco
// defineProvider aqui (ou exportar o provider do proprio cliente, como
// fazem openWeatherClient/ticketmasterClient/googlePlacesClient) e junta-lo
// a lista no fim. Guia completo em docs/INTEGRACOES.md.
const { defineProvider, providerRegistry } = require('./providerKit');
const { openWeatherProvider } = require('./openWeatherClient');
const { ticketmasterProvider } = require('./ticketmasterClient');
const { googlePlacesProvider } = require('./googlePlacesClient');

// Fornecedores grandes ja existentes: so metadados - os clientes
// (tourdiezClient, hbxClient, duffelClient, paymentGatewayAdapters,
// facturalusaClient, mailer) continuam exatamente como estao. Os hooks
// `configured`/`mode` replicam o isConfigured() real de cada cliente.

const tourdiezProvider = defineProvider({
  id: 'tourdiez',
  label: 'TourDiez',
  kind: 'operator',
  envPrefix: 'TOURDIEZ',
  requiredEnv: ['TOURDIEZ_BASE_URL', 'TOURDIEZ_USER', 'TOURDIEZ_PASSWORD'],
  optionalEnv: ['TOURDIEZ_AGENCY_CODE', 'TOURDIEZ_DEFAULT_CITY', 'TOURDIEZ_DEFAULT_ACCOMMODATIONS'],
  baseUrlEnv: 'TOURDIEZ_BASE_URL',
  // Tal como tourdiezClient.isConfigured(): so conta em modo real.
  configured: env => String(env.TOURDIEZ_MODE || 'mock') === 'real'
    && Boolean(env.TOURDIEZ_BASE_URL && env.TOURDIEZ_USER && env.TOURDIEZ_PASSWORD)
});

const hbxProvider = defineProvider({
  id: 'hbx',
  label: 'HBX / Hotelbeds',
  kind: 'operator',
  envPrefix: 'HBX',
  optionalEnv: [
    'HBX_BASE_URL', 'HBX_ALLOW_LAZY_CONTENT', 'HBX_AUTO_CONFIRM_ENABLED',
    'HBX_HOTELS_API_KEY', 'HBX_HOTELS_SECRET',
    'HBX_ACTIVITIES_API_KEY', 'HBX_ACTIVITIES_SECRET',
    'HBX_TRANSFERS_API_KEY', 'HBX_TRANSFERS_SECRET'
  ],
  baseUrlEnv: 'HBX_BASE_URL',
  // Basta uma suite completa (hotels/activities/transfers) para estar ativo.
  configured: env => ['HOTELS', 'ACTIVITIES', 'TRANSFERS']
    .some(suite => env[`HBX_${suite}_API_KEY`] && env[`HBX_${suite}_SECRET`])
});

const duffelProvider = defineProvider({
  id: 'duffel',
  label: 'Duffel',
  kind: 'operator',
  envPrefix: 'DUFFEL',
  requiredEnv: ['DUFFEL_API_TOKEN'],
  optionalEnv: ['DUFFEL_BASE_URL'],
  baseUrlEnv: 'DUFFEL_BASE_URL',
  // O modo da Duffel deriva do prefixo do token, nao de DUFFEL_MODE.
  configured: env => /^duffel_(test|live)_/i.test(String(env.DUFFEL_API_TOKEN || '').trim()),
  mode: env => {
    const token = String(env.DUFFEL_API_TOKEN || '').trim();
    if (token.startsWith('duffel_test_')) return 'test';
    if (/^duffel_live_/i.test(token)) return 'live';
    return 'off';
  }
});

const stripeProvider = defineProvider({
  id: 'stripe',
  label: 'Stripe',
  kind: 'payment',
  envPrefix: 'STRIPE',
  requiredEnv: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  optionalEnv: ['STRIPE_PUBLISHABLE_KEY']
});

const easypayProvider = defineProvider({
  id: 'easypay',
  label: 'Easypay',
  kind: 'payment',
  envPrefix: 'EASYPAY',
  requiredEnv: ['EASYPAY_ACCOUNT_ID', 'EASYPAY_API_KEY'],
  baseUrlEnv: 'EASYPAY_BASE_URL'
});

const facturalusaProvider = defineProvider({
  id: 'facturalusa',
  label: 'Facturalusa',
  kind: 'invoicing',
  envPrefix: 'FACTURALUSA',
  requiredEnv: ['FACTURALUSA_API_KEY'],
  optionalEnv: ['FACTURALUSA_BASE_URL'],
  baseUrlEnv: 'FACTURALUSA_BASE_URL',
  // Tal como facturalusaClient.isConfigured(): so conta em modo real.
  configured: env => String(env.FACTURALUSA_MODE || 'mock') === 'real' && Boolean(env.FACTURALUSA_API_KEY)
});

const emailProvider = defineProvider({
  id: 'email',
  label: 'Email (SMTP)',
  kind: 'email',
  envPrefix: 'EMAIL',
  requiredEnv: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'],
  optionalEnv: ['SMTP_PORT'],
  // Tal como mailer.isConfigured(): so conta com EMAIL_MODE=smtp.
  configured: env => String(env.EMAIL_MODE || 'mock') === 'smtp'
    && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD)
});

// Cruzeiros: ainda nao existe API ligada. O produto funciona como pedido
// assistido (formulario proprio no frontoffice, entra no CRM com tipo
// CRUISE), por isso o stub regista o modo comercial "assisted" em vez de
// um modo vazio. Para ligar uma futura API de cruzeiros basta criar
// cruiseClient.js com o provider kit e substituir este bloco pelo provider
// exportado - ver docs/INTEGRACOES.md, seccao "Cruzeiros".
const cruiseProvider = defineProvider({
  id: 'cruise',
  label: 'Cruzeiros (pedido assistido)',
  kind: 'operator',
  envPrefix: 'CRUISE',
  requiredEnv: ['CRUISE_API_KEY'],
  optionalEnv: ['CRUISE_API_BASE_URL'],
  baseUrlEnv: 'CRUISE_API_BASE_URL',
  mode: env => String(env.CRUISE_MODE || '').trim() || 'assisted'
});

// Placeholders de futuras integracoes (convencao ja existente em
// .env.example e docs/SERVICE_INTEGRATIONS.md): aparecem desde ja no estado
// do backoffice como "por configurar", sem cliente associado.
const futureProviders = [
  ['car', 'Rent-a-car', 'CAR'],
  ['train', 'Comboios', 'TRAIN'],
  ['ferry', 'Ferries', 'FERRY'],
  ['insurance', 'Seguros de viagem', 'INSURANCE']
].map(([id, label, prefix]) => defineProvider({
  id,
  label,
  kind: 'operator',
  envPrefix: prefix,
  requiredEnv: [`${prefix}_API_KEY`],
  optionalEnv: [`${prefix}_API_BASE_URL`],
  baseUrlEnv: `${prefix}_API_BASE_URL`
}));

[
  tourdiezProvider,
  hbxProvider,
  duffelProvider,
  stripeProvider,
  easypayProvider,
  facturalusaProvider,
  emailProvider,
  openWeatherProvider,
  ticketmasterProvider,
  googlePlacesProvider,
  cruiseProvider,
  ...futureProviders
].forEach(provider => providerRegistry.register(provider));

module.exports = { providerRegistry };
