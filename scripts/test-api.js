const http = require('http');

// Admin e cliente usam cookies de sessao distintos (auth.js) - guardar os
// dois separadamente, para o checkout/pagamento (sessao de cliente, desde
// que /api/payment/confirm passou a exigir o dono da reserva) e a
// aprovacao final (sessao de admin) nao pisarem um ao outro.
let adminCookie = '';
let customerCookie = '';

function request(path, method = 'GET', body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (cookie) headers.Cookie = cookie;

    const req = http.request(
      { hostname: 'localhost', port: process.env.PORT || 3000, path, method, headers },
      res => {
        let out = '';
        res.on('data', c => out += c);
        res.on('end', () => {
          const setCookie = res.headers['set-cookie']?.[0]?.split(';')[0];
          let parsed;
          try {
            parsed = JSON.parse(out);
          } catch {
            parsed = { ok: false, error: out || `Resposta invalida (${res.statusCode})` };
          }
          resolve({ status: res.statusCode, data: parsed, cookie: setCookie });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function get(path, cookie = adminCookie) {
  return request(path, 'GET', undefined, cookie);
}

// Devolve so o corpo (uso normal); guarda o cookie de resposta em rawPost
// quando quem chama precisa dele explicitamente (logins).
async function rawPost(path, body, cookie = adminCookie) {
  const response = await request(path, 'POST', body, cookie);
  if (response.status >= 400 || response.data?.ok === false) {
    throw new Error(`${path} falhou (${response.status}): ${response.data?.error || JSON.stringify(response.data)}`);
  }
  return response;
}

async function post(path, body, cookie = adminCookie) {
  return (await rawPost(path, body, cookie)).data;
}

(async () => {
  const blocked = await get('/api/admin/dashboard');
  if (blocked.status !== 401) throw new Error('Backoffice deveria exigir autenticacao');

  const adminLogin = await rawPost('/api/admin/login', {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  });
  if (!adminLogin.data.ok || !adminLogin.cookie) throw new Error('Login admin falhou');
  adminCookie = adminLogin.cookie;

  const dashboard = await get('/api/admin/dashboard');
  if (dashboard.status !== 200) throw new Error('Dashboard admin autenticado falhou');
  console.log('Admin protegido:', blocked.status, '->', dashboard.status);

  const search = await post('/api/search', {
    prompt: '7 noites nas Caraibas para 2 adultos ate 2500 euros'
  }, null);
  console.log('Pesquisa:', search.results[0].hotel, search.results[0].finalPrice);

  // /api/payment/confirm exige a sessao do cliente dono da reserva (ver
  // src/routes/checkoutRoutes.js) - autentica como cliente antes do
  // checkout, tal como o formulario de faturacao ja obriga hoje.
  const customerEmail = 'teste@boomviagens.pt';
  const codeRequest = await post('/api/customer/login/request', { email: customerEmail }, null);
  const customerVerify = await rawPost('/api/customer/login/verify', { email: customerEmail, code: codeRequest.demoCode, challenge: codeRequest.challenge }, null);
  customerCookie = customerVerify.cookie;
  if (!customerCookie) throw new Error('Login de cliente falhou');

  const checkout = await post('/api/checkout', {
    offer: search.results[0],
    customer: { name: 'Teste', email: customerEmail },
    paymentMethod: 'MB WAY',
    idempotencyKey: `test-${Date.now()}`
  }, customerCookie);
  console.log('Reserva:', checkout.reservation.id, checkout.payment.reference);

  const paid = await post('/api/payment/confirm', { paymentId: checkout.payment.id }, customerCookie);
  if (!['IN_VALIDATION', 'HUMAN_REVIEW'].includes(paid.reservation.status)) throw new Error('Reserva deveria ficar pendente de aprovacao interna');
  console.log('Pagamento validado:', paid.reservation.status);

  const approved = await post('/api/admin/reservations/approve', { reservationId: checkout.reservation.id });
  if (approved.reservation.status !== 'CONFIRMED') throw new Error('Aprovacao admin deveria confirmar a reserva');
  console.log('Confirmada:', approved.reservation.status, approved.reservation.operatorLocator);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
