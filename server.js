require('dotenv').config();
const http = require('http');
const path = require('path');

const { createRouter } = require('./src/http/router');
const { createStaticServer } = require('./src/staticServer');
const { json, unauthorized, parseBody } = require('./src/httpUtils');
const auth = require('./src/auth');
const domain = require('./src/domain');
const { readDb, updateDb } = require('./src/storage');
const { baseOffers, searchOffers, getOfferById } = require('./src/mockOperators');
const { proposalEmail, reservationEmail, loginCodeEmail } = require('./src/emailTemplates');
const { OperatorRegistry, TourDiezAdapter } = require('./src/operatorAdapters');
const { cleanText, searchPayload, customerPayload, paymentMethod, numberInRange, email: validateEmail, password: validatePassword } = require('./src/validation');
const fileStorage = require('./src/fileStorage');
const mailer = require('./src/mailer');
const { normalize } = require('./src/pricing');

const registerPublicRoutes = require('./src/routes/publicRoutes');
const registerCustomerRoutes = require('./src/routes/customerRoutes');
const registerCheckoutRoutes = require('./src/routes/checkoutRoutes');
const registerAdminRoutes = require('./src/routes/adminRoutes');
const registerStaffRoutes = require('./src/routes/staffRoutes');
const registerOpportunitiesRoutes = require('./src/routes/opportunitiesRoutes');
const registerTeamRoutes = require('./src/routes/teamRoutes');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const tourdiezAdapter = new TourDiezAdapter(process.env);
const operators = new OperatorRegistry([tourdiezAdapter]);

// Contexto partilhado por todas as rotas: cada modulo em src/routes/ so
// pede o que precisa daqui, em vez de cada rota ter de repetir os mesmos
// require() de dependencias.
const ctx = {
  json,
  unauthorized,
  parseBody,
  readDb,
  updateDb,
  operators,
  tourdiezAdapter,
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
  paymentMethod,
  numberInRange,
  validateEmail,
  validatePassword,
  normalize,
  rateLimit: auth.rateLimit
};

const router = createRouter();
registerPublicRoutes(router, ctx);
registerCustomerRoutes(router, ctx);
registerCheckoutRoutes(router, ctx);
registerAdminRoutes(router, ctx);
registerStaffRoutes(router, ctx);
registerOpportunitiesRoutes(router, ctx);
registerTeamRoutes(router, ctx);

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
      if (staff && staff.role !== 'ADMIN' && !route.roles.includes(staff.role)) {
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
