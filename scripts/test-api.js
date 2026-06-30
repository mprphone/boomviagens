const http = require('http');

let adminCookie = '';

function request(path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (adminCookie) headers.Cookie = adminCookie;

    const req = http.request(
      { hostname: 'localhost', port: process.env.PORT || 3000, path, method, headers },
      res => {
        let out = '';
        res.on('data', c => out += c);
        res.on('end', () => {
          const cookie = res.headers['set-cookie']?.[0]?.split(';')[0];
          if (cookie) adminCookie = cookie;
          let parsed;
          try {
            parsed = JSON.parse(out);
          } catch {
            parsed = { ok: false, error: out || `Resposta invalida (${res.statusCode})` };
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function get(path) {
  return request(path, 'GET');
}

async function post(path, body) {
  const response = await request(path, 'POST', body);
  if (response.status >= 400 || response.data?.ok === false) {
    throw new Error(`${path} falhou (${response.status}): ${response.data?.error || JSON.stringify(response.data)}`);
  }
  return response.data;
}

(async () => {
  const blocked = await get('/api/admin/dashboard');
  if (blocked.status !== 401) throw new Error('Backoffice deveria exigir autenticacao');

  const login = await post('/api/admin/login', {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  });
  if (!login.ok || !adminCookie) throw new Error('Login admin falhou');

  const dashboard = await get('/api/admin/dashboard');
  if (dashboard.status !== 200) throw new Error('Dashboard admin autenticado falhou');
  console.log('Admin protegido:', blocked.status, '->', dashboard.status);

  const search = await post('/api/search', {
    prompt: '7 noites nas Caraibas para 2 adultos ate 2500 euros',
    email: 'teste@boomviagens.pt'
  });
  console.log('Pesquisa:', search.results[0].hotel, search.results[0].finalPrice);

  const checkout = await post('/api/checkout', {
    offer: search.results[0],
    customer: { name: 'Teste', email: 'teste@boomviagens.pt' },
    paymentMethod: 'MB WAY',
    idempotencyKey: `test-${Date.now()}`
  });
  console.log('Reserva:', checkout.reservation.id, checkout.payment.reference);

  const paid = await post('/api/payment/confirm', { paymentId: checkout.payment.id });
  if (!['IN_VALIDATION', 'HUMAN_REVIEW'].includes(paid.reservation.status)) throw new Error('Reserva deveria ficar pendente de aprovacao interna');
  console.log('Pagamento validado:', paid.reservation.status);

  const approved = await post('/api/admin/reservations/approve', { reservationId: checkout.reservation.id });
  if (approved.reservation.status !== 'CONFIRMED') throw new Error('Aprovacao admin deveria confirmar a reserva');
  console.log('Confirmada:', approved.reservation.status, approved.reservation.operatorLocator);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
