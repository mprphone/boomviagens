require('dotenv').config();
const http = require('http');
const path = require('path');

const { createRouter } = require('./src/http/router');
const { createStaticServer } = require('./src/staticServer');
const { json, unauthorized, parseBody, readRawBody } = require('./src/httpUtils');
const auth = require('./src/auth');
const domain = require('./src/domain');
const { readDb, updateDb } = require('./src/storage');
const { baseOffers, searchOffers, getOfferById } = require('./src/mockOperators');
const { proposalEmail, reservationEmail, loginCodeEmail } = require('./src/emailTemplates');
const { OperatorRegistry, TourDiezAdapter } = require('./src/operatorAdapters');
const { HotelbedsAdapter } = require('./src/hotelbedsAdapter');
const { cleanText, searchPayload, customerPayload, passengerPayload, validatePassengerForTrip, paymentMethod, numberInRange, email: validateEmail, password: validatePassword } = require('./src/validation');
const fileStorage = require('./src/fileStorage');
const mailer = require('./src/mailer');
const { normalize, applyMargin } = require('./src/pricing');
const { FacturalusaClient } = require('./src/facturalusaClient');
const createInvoicing = require('./src/invoicing');
const createVoucherIssuing = require('./src/voucherIssuing');
const createPaymentConfirmation = require('./src/paymentConfirmation');
const { StripeGatewayAdapter, EasyPayGatewayAdapter, PaymentGatewayRegistry } = require('./src/paymentGatewayAdapters');
const { DuffelClient } = require('./src/integrations/duffelClient');
const { HbxClient } = require('./src/integrations/hbxClient');
const { OpenWeatherClient } = require('./src/integrations/openWeatherClient');
const { TicketmasterClient } = require('./src/integrations/ticketmasterClient');
const { GooglePlacesClient } = require('./src/integrations/googlePlacesClient');
const { TravelIntelligenceService } = require('./src/integrations/travelIntelligence');
const { ServiceCatalog } = require('./src/integrations/serviceCatalog');
const createOfferTokenService = require('./src/offerTokenService');
const createOfferRevalidation = require('./src/offerRevalidation');

const registerPublicRoutes = require('./src/routes/publicRoutes');
const registerCustomerRoutes = require('./src/routes/customerRoutes');
const registerCheckoutRoutes = require('./src/routes/checkoutRoutes');
const registerAdminRoutes = require('./src/routes/adminRoutes');
const registerStaffRoutes = require('./src/routes/staffRoutes');
const registerOpportunitiesRoutes = require('./src/routes/opportunitiesRoutes');
const registerTeamRoutes = require('./src/routes/teamRoutes');
const registerBranchesRoutes = require('./src/routes/branchesRoutes');
const registerPaymentsRoutes = require('./src/routes/paymentsRoutes');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const tourdiezAdapter = new TourDiezAdapter(process.env);
const facturalusa = new FacturalusaClient(process.env);
const paymentGateways = new PaymentGatewayRegistry([new StripeGatewayAdapter(process.env), new EasyPayGatewayAdapter(process.env)]);
const duffel = new DuffelClient(process.env);
const hbx = new HbxClient(process.env);
const hotelbedsAdapter = new HotelbedsAdapter(hbx);
const operators = new OperatorRegistry([tourdiezAdapter, hotelbedsAdapter]);
const weather = new OpenWeatherClient(process.env);
const ticketmaster = new TicketmasterClient(process.env);
const googlePlaces = new GooglePlacesClient(process.env);
const travelIntelligence = new TravelIntelligenceService({ duffel, hbx, weather, ticketmaster, googlePlaces });
const serviceCatalog = new ServiceCatalog({ env: process.env, tourdiezAdapter, duffel, hbx, ticketmaster });
const offerTokens = createOfferTokenService(auth);
const offerRevalidation = createOfferRevalidation({ duffel, hbx, applyMargin, env: process.env });

// Contexto partilhado por todas as rotas: cada modulo em src/routes/ so
// pede o que precisa daqui, em vez de cada rota ter de repetir os mesmos
// require() de dependencias.
const ctx = {
  json,
  unauthorized,
  parseBody,
  readRawBody,
  readDb,
  updateDb,
  operators,
  tourdiezAdapter,
  hotelbedsAdapter,
  auth,
  domain,
  fileStorage,
  mailer,
  baseOffers,
  searchOffers,
  getOfferById,
  proposalEmail,
  reservationEmail,
  loginCodeEmail,
  cleanText,
  searchPayload,
  customerPayload,
  passengerPayload,
  validatePassengerForTrip,
  paymentMethod,
  numberInRange,
  validateEmail,
  validatePassword,
  normalize,
  applyMargin,
  rateLimit: auth.rateLimit,
  facturalusa,
  paymentGateways,
  duffel,
  hbx,
  weather,
  ticketmaster,
  googlePlaces,
  travelIntelligence,
  serviceCatalog,
  offerTokens,
  offerRevalidation
};
ctx.invoicing = createInvoicing(ctx);
ctx.voucherIssuing = createVoucherIssuing(ctx);
ctx.paymentConfirmation = createPaymentConfirmation(ctx);

const router = createRouter();
registerPublicRoutes(router, ctx);
registerCustomerRoutes(router, ctx);
registerCheckoutRoutes(router, ctx);
registerAdminRoutes(router, ctx);
registerStaffRoutes(router, ctx);
registerOpportunitiesRoutes(router, ctx);
registerTeamRoutes(router, ctx);
registerBranchesRoutes(router, ctx);
registerPaymentsRoutes(router, ctx);

const serveStatic = createStaticServer(PUBLIC);

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  try {
    const route = router.find(method, url.pathname);
    if (!route) return json(res, 404, { ok: false, error: 'Endpoint não encontrado' });
    if (route.admin && !auth.sessionUser(req)) return json(res, 401, { ok: false, error: 'Autenticação necessária' });
    // ADMIN passa sempre, mesmo que nao esteja explicitamente na lista -
    // e o perfil "faz tudo" (ver domain.js#STAFF_ROLES).
    if (route.admin && route.roles) {
      const staff = auth.sessionStaff(req);
      if (!staff) return json(res, 403, { ok: false, error: 'Sessão sem perfil de colaborador válido' });
      if (staff.role !== 'ADMIN' && !route.roles.includes(staff.role)) {
        return json(res, 403, { ok: false, error: 'Sem permissão para esta ação' });
      }
    }
    return await route.handler(req, res, url);
  } catch (e) {
    // Se a resposta ja foi enviada (ex.: um bug que tenta responder duas
    // vezes), escrever aqui outra vez rebenta com ERR_HTTP_HEADERS_SENT -
    // e esse erro, por nao ter mais nenhum try/catch a apanha-lo, derruba
    // o processo Node inteiro. Isto ja aconteceu na pratica (ver o bug do
    // rateLimit corrigido em src/auth.js/httpUtils.js) - esta guarda fica
    // como rede de seguranca para qualquer bug semelhante no futuro.
    if (res.headersSent) { console.error('Erro depois da resposta ja enviada:', e); return; }
    return json(res, 500, { ok: false, error: e.message, stack: process.env.NODE_ENV === 'development' ? e.stack : undefined });
  }
}

function appHandler(req, res) {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
}

if (require.main === module) {
  const server = http.createServer(appHandler);
  server.listen(PORT, () => {
    console.log(`Boomviagens operacional em http://localhost:${PORT}`);
    console.log(`Modo TourDiez: ${process.env.TOURDIEZ_MODE || 'mock'}`);
    console.log(`Modo base de dados: ${require('./src/storage').mode}`);
  });
}

module.exports = { appHandler, handleApi };
