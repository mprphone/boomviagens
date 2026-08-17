const fs = require('fs');
const assert = require('assert');
const { ServiceCatalog, SERVICE_DEFINITIONS } = require('../src/integrations/serviceCatalog');

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/css/app.css', 'utf8');
const servicesJs = fs.readFileSync('public/js/services.js', 'utf8');
const routerJs = fs.readFileSync('public/js/router.js', 'utf8');
const extrasJs = fs.readFileSync('public/js/checkout/extrasStep.js', 'utf8');
const accountHtml = fs.readFileSync('public/conta/index.html', 'utf8');
const customerRoutes = fs.readFileSync('src/routes/customerRoutes.js', 'utf8');
const customerJs = fs.readdirSync('public/conta/js').filter(name => name.endsWith('.js')).map(name => fs.readFileSync(`public/conta/js/${name}`, 'utf8')).join('\n');
const publicJs = fs.readdirSync('public/js', { withFileTypes: true }).flatMap(entry => {
  if (entry.isFile() && entry.name.endsWith('.js')) return [fs.readFileSync(`public/js/${entry.name}`, 'utf8')];
  if (entry.isDirectory() && entry.name === 'checkout') return fs.readdirSync(`public/js/${entry.name}`).filter(name => name.endsWith('.js')).map(name => fs.readFileSync(`public/js/${entry.name}/${name}`, 'utf8'));
  return [];
}).join('\n');

assert(html.includes('/css/app.css'), 'O frontoffice novo deve usar o sistema visual unificado');
assert(html.includes('id="serviceCatalogGrid"'), 'Catálogo de serviços em falta');
assert(html.includes('id="tripSummary"'), 'Resumo sticky da pesquisa em falta');
assert(html.includes('id="serviceRequestModal"'), 'Fluxo assistido para serviços sem API em falta');
assert(html.includes('data-trip-type="MULTI_CITY"'), 'Pesquisa multi-cidade em falta');
assert(html.includes('data-step="5"') && html.includes('>Extras</li>'), 'Checkout deve ter cinco etapas reais');
assert(css.includes('.results-layout') && css.includes('.service-grid') && css.includes('@media (max-width: 620px)'), 'Layout responsivo incompleto');
assert(servicesJs.includes("api('/api/assisted-request'"), 'Serviços assistidos não estão ligados ao CRM');
assert(extrasJs.includes('Promise.allSettled') && extrasJs.includes("api('/api/assisted-request'"), 'Extras devem ser independentes e ligados ao CRM');
assert(accountHtml.includes('data-view="mensagens"') && accountHtml.includes('id="view-mensagens"'), 'Pedidos e mensagens devem estar ativos na área de cliente');
assert(customerRoutes.includes("'/api/customer/support-request'") && customerRoutes.includes("'/api/customer/support-requests'"), 'Pedidos autenticados devem ficar ligados ao CRM');
assert(!/\balert\s*\(/.test(`${publicJs}\n${customerJs}`), 'Frontoffice e área de cliente não podem usar alert()');
assert(routerJs.includes("classList.add('is-results')"), 'Resultados devem manter pesquisa compacta no topo');
assert(SERVICE_DEFINITIONS.length >= 12, 'Catálogo não cobre todos os serviços planeados');

const configured = { isConfigured: () => true };
const hbx = { isConfigured: product => ['hotels', 'activities', 'transfers'].includes(product) };
const catalog = new ServiceCatalog({ env: {}, tourdiezAdapter: configured, duffel: configured, hbx, ticketmaster: configured });
const publicServices = catalog.publicServices();
assert(publicServices.find(s => s.id === 'FLIGHT').availability === 'ONLINE', 'Voos configurados devem aparecer online');
assert(publicServices.find(s => s.id === 'TRANSFER').availability === 'BUILDER', 'Transfers HBX devem aparecer no construtor');
assert(publicServices.find(s => s.id === 'FERRY').availability === 'ASSISTED', 'Serviço sem API deve continuar operacional por pedido assistido');
assert(!JSON.stringify(publicServices).match(/secret|apiKey|token/i), 'Catálogo público não pode expor segredos');

console.log('OK - V8 frontoffice: arquitetura multiproduto, serviços extensíveis, resumo de pesquisa e CRM assistido');
