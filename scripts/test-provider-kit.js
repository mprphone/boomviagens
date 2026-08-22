/* Testes do provider kit: sem rede e sem credenciais reais. */
const assert = require('assert');
const { defineProvider, providerRegistry } = require('../src/integrations/providerKit');
const { OpenWeatherClient, openWeatherProvider } = require('../src/integrations/openWeatherClient');
const { TicketmasterClient, ticketmasterProvider } = require('../src/integrations/ticketmasterClient');
const { GooglePlacesClient, googlePlacesProvider } = require('../src/integrations/googlePlacesClient');

function testDefineProviderValidation() {
  assert.throws(() => defineProvider(), /id/i);
  assert.throws(() => defineProvider({ id: '' }), /id/i);
  assert.throws(() => defineProvider({ id: 'x', create: 'nao-e-funcao' }), /create/i);
  assert.throws(() => defineProvider({ id: 'x', healthCheck: 42 }), /healthCheck/i);
  const fallback = defineProvider({ id: 'sem-tipo', env: {} });
  assert.equal(fallback.kind, 'other', 'kind desconhecido/omisso cai em "other"');
  assert.equal(fallback.envPrefix, 'SEM_TIPO', 'envPrefix deriva do id por omissão');
}

function testConfigAndMissingEnv() {
  const provider = defineProvider({
    id: 'demo',
    label: 'Demo',
    kind: 'enrichment',
    envPrefix: 'DEMO',
    requiredEnv: ['DEMO_API_KEY', 'DEMO_USER'],
    optionalEnv: ['DEMO_EXTRA'],
    baseUrlEnv: 'DEMO_BASE_URL',
    timeoutMs: 5000,
    cacheTtlMs: 60000,
    env: { DEMO_API_KEY: 'chave', DEMO_MODE: 'test', DEMO_BASE_URL: 'https://demo.example' }
  });
  assert.equal(provider.isConfigured(), false);
  assert.deepEqual(provider.missingEnv(), ['DEMO_USER']);
  const cfg = provider.config();
  assert.equal(cfg.DEMO_API_KEY, 'chave');
  assert.equal(cfg.mode, 'test', 'modo vem de <PREFIXO>_MODE');
  assert.equal(cfg.baseUrl, 'https://demo.example');
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(cfg.cacheTtlMs, 60000);

  const completo = defineProvider({
    id: 'demo2', envPrefix: 'DEMO', requiredEnv: ['DEMO_API_KEY'],
    env: { DEMO_API_KEY: 'chave' }
  });
  assert.equal(completo.isConfigured(), true);
  assert.deepEqual(completo.missingEnv(), []);

  // Hook `configured` sobrepoe-se a presenca simples das variaveis.
  const comHook = defineProvider({
    id: 'demo3', envPrefix: 'DEMO', requiredEnv: ['DEMO_API_KEY'],
    configured: env => env.DEMO_MODE === 'real' && Boolean(env.DEMO_API_KEY),
    env: { DEMO_API_KEY: 'chave', DEMO_MODE: 'mock' }
  });
  assert.equal(comHook.isConfigured(), false, 'hook configured() manda quando existe');
}

function testLazyClient() {
  let created = 0;
  const provider = defineProvider({
    id: 'lazy',
    env: { LAZY_API_KEY: 'k' },
    requiredEnv: ['LAZY_API_KEY'],
    create: (config, http) => {
      created += 1;
      assert.equal(config.LAZY_API_KEY, 'k');
      assert.equal(typeof http.fetchJson, 'function', 'create recebe o httpClient partilhado');
      return { chave: config.LAZY_API_KEY };
    }
  });
  const primeiro = provider.client();
  const segundo = provider.client();
  assert.equal(created, 1, 'cliente é singleton lazy - create corre uma só vez');
  assert.equal(primeiro, segundo);

  const semCliente = defineProvider({ id: 'so-metadados', env: {} });
  assert.throws(() => semCliente.client(), /metadados/i);
}

function testRegistry() {
  const antes = providerRegistry.list().length;
  const provider = defineProvider({ id: 'teste-registo', label: 'Teste', kind: 'other', env: {} });
  providerRegistry.register(provider);
  assert.equal(providerRegistry.get('teste-registo'), provider);
  assert.equal(providerRegistry.get('nao-existe'), null);
  assert.throws(() => providerRegistry.register(provider), /duplicado/i);
  const entry = providerRegistry.list().find(p => p.id === 'teste-registo');
  assert(entry, 'list() inclui o fornecedor registado');
  assert.deepEqual(Object.keys(entry).sort(), ['configured', 'id', 'kind', 'label', 'missing', 'mode'].sort());
  assert.equal(entry.configured, true, 'sem requiredEnv fica configurado');
  assert.equal(providerRegistry.list().length, antes + 1);
}

function testMigratedClientsConstructSemEnv() {
  // Construção direta (assinatura antiga preservada) sem credenciais.
  for (const Client of [OpenWeatherClient, TicketmasterClient, GooglePlacesClient]) {
    const client = new Client({});
    assert.equal(client.isConfigured(), false);
  }
  const google = new GooglePlacesClient({});
  assert.equal(google.isEnabled(), false);

  // E via provider do kit, também sem env: create não pode rebentar.
  for (const provider of [openWeatherProvider, ticketmasterProvider, googlePlacesProvider]) {
    assert.equal(provider.isConfigured(), false);
    assert(provider.missingEnv().length >= 1);
    const client = provider.client();
    assert(client, `provider.client() de ${provider.id} constrói sem env`);
    assert.equal(provider.client(), client, 'cliente do provider é singleton');
  }
  assert.equal(googlePlacesProvider.id, 'google-places', 'id alinhado com o Travel Intelligence');
}

function testCentralRegistry() {
  const { providerRegistry: central } = require('../src/integrations/registry');
  assert.equal(central, providerRegistry, 'registry.js usa o mesmo registo partilhado');
  const ids = central.list().map(p => p.id);
  for (const esperado of ['tourdiez', 'hbx', 'duffel', 'stripe', 'easypay', 'facturalusa', 'email', 'openweather', 'ticketmaster', 'google-places', 'cruise', 'car', 'train', 'ferry', 'insurance']) {
    assert(ids.includes(esperado), `registo central inclui "${esperado}"`);
  }
  const duffel = central.get('duffel');
  assert.equal(duffel.isConfigured(), false, 'sem DUFFEL_API_TOKEN a Duffel não está configurada');
  assert.deepEqual(duffel.missingEnv(), ['DUFFEL_API_TOKEN']);
  const cruise = central.get('cruise');
  assert(cruise.missingEnv().includes('CRUISE_API_KEY'));
  assert.throws(() => cruise.client(), /metadados/i, 'stubs futuros não têm cliente');
}

function run() {
  testDefineProviderValidation();
  testConfigAndMissingEnv();
  testLazyClient();
  testRegistry();
  testMigratedClientsConstructSemEnv();
  testCentralRegistry();
  console.log('OK - provider kit, registo central e clientes migrados');
}

run();
