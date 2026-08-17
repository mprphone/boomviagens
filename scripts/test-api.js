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
  const publicConfig = await request('/api/config', 'GET', undefined, null);
  if (publicConfig.status !== 200) throw new Error('/api/config falhou');
  if (Object.prototype.hasOwnProperty.call(publicConfig.data.company || {}, 'defaultMarginPercent') || Object.prototype.hasOwnProperty.call(publicConfig.data.company || {}, 'confirmationMode') || Object.prototype.hasOwnProperty.call(publicConfig.data.company || {}, 'nif')) {
    throw new Error('/api/config esta a expor configuracao comercial/interna');
  }
  console.log('Config publica sanitizada: OK');

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
    prompt: '7 noites em Punta Cana para 2 adultos ate 2500 euros'
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

  const originalOffer = search.results[0];
  const tamperedOffer = { ...originalOffer, hotel: 'HOTEL MANIPULADO NO BROWSER', destination: 'Disneyland Paris', finalPrice: 1 };
  const checkout = await post('/api/checkout', {
    offer: tamperedOffer,
    customer: { name: 'Teste Cliente', email: customerEmail, phone: '910000000' },
    passengers: [
      { name: 'Teste', surname: 'Um', birthdate: '1980-01-01', gender: 'M', nationality: 'Portuguesa', documentType: 'CC', documentNumber: '11111111A', documentCountry: 'Portugal', documentExpiry: '2035-01-01' },
      { name: 'Teste', surname: 'Dois', birthdate: '1985-01-01', gender: 'F', nationality: 'Portuguesa', documentType: 'CC', documentNumber: '22222222B', documentCountry: 'Portugal', documentExpiry: '2035-01-01' }
    ],
    paymentMethod: 'MB WAY',
    idempotencyKey: `test-${Date.now()}`
  }, customerCookie);
  if (checkout.reservation.offer.hotel !== originalOffer.hotel || checkout.reservation.offer.destination !== originalOffer.destination || Number(checkout.reservation.offer.finalPrice) !== Number(originalOffer.finalPrice)) {
    throw new Error('Checkout confiou em identidade/preço manipulados no browser');
  }
  console.log('Oferta selada protege identidade e preço: OK');
  console.log('Reserva:', checkout.reservation.id, checkout.payment.reference);

  // Permissoes financeiras sao impostas na API: um perfil COMERCIAL pode
  // trabalhar o PVP/servico, mas nao pode ler nem alterar NET/IVA interno.
  const commercialUsername = `comercial_${Date.now()}`;
  const commercialPassword = 'Teste-Comercial-2026!';
  await post('/api/admin/staff', { name: 'Comercial Teste', username: commercialUsername, password: commercialPassword, role: 'COMERCIAL', active: true });
  const commercialLogin = await rawPost('/api/admin/login', { username: commercialUsername, password: commercialPassword }, null);
  const commercialCookie = commercialLogin.cookie;
  if (!commercialCookie) throw new Error('Login comercial falhou');

  const adminDetailBefore = await get(`/api/admin/reservations/detail?reservationId=${encodeURIComponent(checkout.reservation.id)}`, adminCookie);
  if (adminDetailBefore.status !== 200 || !adminDetailBefore.data.serviceLines?.length) throw new Error('Processo deveria ter linha de servico automatica');
  const originalLine = adminDetailBefore.data.serviceLines[0];
  const originalNet = Number(originalLine.netValue || 0);
  const commercialDetail = await get(`/api/admin/reservations/detail?reservationId=${encodeURIComponent(checkout.reservation.id)}`, commercialCookie);
  if (commercialDetail.status !== 200) throw new Error('Comercial deveria poder consultar processo');
  if (Object.prototype.hasOwnProperty.call(commercialDetail.data.serviceLines[0] || {}, 'netValue') || Object.prototype.hasOwnProperty.call(commercialDetail.data.serviceLines[0] || {}, 'vatRegime')) {
    throw new Error('Comercial conseguiu ler NET/IVA interno');
  }
  const commercialReservations = await get('/api/admin/reservations', commercialCookie);
  if (commercialReservations.status !== 200) throw new Error('Comercial deveria poder listar processos');
  const commercialPayload = JSON.stringify(commercialReservations.data.reservations || []);
  if (/\"(costPrice|netValue|marginValue|marginPercent|marginRule|expectedEconomicMargin)\"/.test(commercialPayload)) {
    throw new Error('Lista de processos expôs custo/margem a Comercial');
  }
  const commercialDashboard = await get('/api/admin/dashboard', commercialCookie);
  if (Object.prototype.hasOwnProperty.call(commercialDashboard.data.company || {}, 'defaultMarginPercent') || Object.prototype.hasOwnProperty.call(commercialDashboard.data.company || {}, 'confirmationMode')) {
    throw new Error('Dashboard Comercial expôs configuração interna da empresa');
  }
  const blockedCommercialConfirm = await request('/api/admin/reservations/update', 'POST', { reservationId: checkout.reservation.id, status: 'CONFIRMED', manualLocator: 'NAO-DEVE', manualConfirmationReason: 'teste' }, commercialCookie);
  if (blockedCommercialConfirm.status !== 403) throw new Error('Comercial não deveria confirmar operacionalmente uma reserva');

  // O custo interno de propostas comerciais também é protegido: a equipa
  // comercial vê PVP/serviços, mas não consegue ler ou adulterar costValue.
  const opportunity = await post('/api/admin/opportunities', { customerName: 'Cliente Proposta', customerEmail: 'proposta@boomviagens.pt', destination: 'Atenas', estimatedValue: 700 });
  const adminProposal = await post('/api/admin/proposals', { opportunityId: opportunity.opportunity.id, services: 'Hotel + voo', costValue: 500, saleValue: 700, status: 'RASCUNHO' });
  if (Number(adminProposal.proposal.costValue) !== 500) throw new Error('Admin deveria poder gravar custo da proposta');
  const commercialProposals = await get('/api/admin/proposals', commercialCookie);
  const commercialProposal = commercialProposals.data.proposals.find(p => p.id === adminProposal.proposal.id);
  if (!commercialProposal || Object.prototype.hasOwnProperty.call(commercialProposal, 'costValue')) throw new Error('Comercial conseguiu ler custo da proposta');
  await post('/api/admin/proposals', { id: adminProposal.proposal.id, opportunityId: opportunity.opportunity.id, services: 'Hotel + voo atualizado', costValue: 1, saleValue: 710, status: 'RASCUNHO' }, commercialCookie);
  const adminProposalsAfter = await get('/api/admin/proposals', adminCookie);
  const protectedProposal = adminProposalsAfter.data.proposals.find(p => p.id === adminProposal.proposal.id);
  if (Number(protectedProposal.costValue) !== 500) throw new Error('Comercial conseguiu alterar custo da proposta');
  console.log('Permissoes de custo nas propostas: OK');

  const commercialUpdate = await post('/api/admin/reservations/services', {
    reservationId: checkout.reservation.id, id: originalLine.id, type: originalLine.type, description: originalLine.description,
    status: originalLine.status, supplierName: originalLine.supplierName, reference: originalLine.reference, locator: originalLine.locator,
    quantity: originalLine.quantity, dateStart: originalLine.dateStart, dateEnd: originalLine.dateEnd,
    netValue: originalNet + 9999, vatRegime: 'M12', pvpValue: originalLine.pvpValue, notes: originalLine.notes
  }, commercialCookie);
  if (Object.prototype.hasOwnProperty.call(commercialUpdate.serviceLine || {}, 'netValue') || Object.prototype.hasOwnProperty.call(commercialUpdate.serviceLine || {}, 'vatRegime')) {
    throw new Error('Resposta de escrita comercial expôs NET/IVA');
  }
  const adminDetailAfter = await get(`/api/admin/reservations/detail?reservationId=${encodeURIComponent(checkout.reservation.id)}`, adminCookie);
  const protectedLine = adminDetailAfter.data.serviceLines.find(l => l.id === originalLine.id);
  if (Number(protectedLine.netValue || 0) !== originalNet) throw new Error('Comercial conseguiu alterar NET interno por API');
  console.log('Permissoes NET/IVA por perfil: OK');

  const paid = await post('/api/payment/confirm', { paymentId: checkout.payment.id }, customerCookie);
  if (!['IN_VALIDATION', 'HUMAN_REVIEW'].includes(paid.reservation.status)) throw new Error('Reserva deveria ficar pendente de aprovacao interna');
  console.log('Pagamento validado:', paid.reservation.status);

  // Esta oferta e demo (sem IdOperation/code/idDistributions reais da
  // TourDiez), por isso a aprovacao automatica agora tem de pedir revisao
  // humana em vez de inventar um localizador e confirmar sozinha (ver
  // auditoria) - so confirma de facto quando ha mesmo um localizador
  // vindo do operador.
  const approved = await post('/api/admin/reservations/approve', { reservationId: checkout.reservation.id });
  if (approved.reservation.status === 'CONFIRMED') throw new Error('Reserva demo (sem referencias reais TourDiez) nao deveria confirmar sozinha');
  if (!approved.needsHumanReview || approved.confirmation.locator) throw new Error('Aprovacao deveria pedir revisao humana, sem localizador inventado');
  console.log('Aprovacao pediu revisao humana (correto, sem localizador inventado):', approved.needsHumanReview);

  // A partir daqui e um humano a confirmar manualmente (ex.: verificou a
  // reserva por telefone/email com o operador) - o mesmo caminho que o
  // botao "Guardar estado" da ficha da reserva ja usa.
  const manualConfirm = await post('/api/admin/reservations/update', { reservationId: checkout.reservation.id, status: 'CONFIRMED', manualLocator: 'TEST-MANUAL-001', manualConfirmationReason: 'Teste automatizado - confirmado manualmente' });
  if (manualConfirm.reservation.status !== 'CONFIRMED') throw new Error('Confirmacao manual deveria funcionar');
  console.log('Confirmada manualmente:', manualConfirm.reservation.status);

  // Conhecer o email de um cliente existente nunca pode devolver o seu
  // perfil privado a um visitante sem sessao.
  const probeExisting = await request('/api/customer/register', 'POST', {
    name: 'Intruso', email: customerEmail, phone: '919999999', address: 'Rua indevida'
  }, null);
  if (probeExisting.status !== 200 || !probeExisting.data.existing) throw new Error('Registo de cliente existente deveria devolver resposta generica');
  if (probeExisting.data.customer || probeExisting.data.phone || probeExisting.data.address || probeExisting.data.passengers) {
    throw new Error('PII de cliente existente foi exposta no registo publico');
  }
  console.log('Registo existente sem fuga de PII: OK');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
