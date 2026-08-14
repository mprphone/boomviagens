// Backoffice: login/sessao (publicas, e como se entra) e todas as rotas de
// gestao (marcadas admin:true - o dispatcher central em server.js exige
// sessao valida antes de chamar o handler, sem repetir a verificacao em
// cada rota).

module.exports = function registerAdminRoutes(router, ctx) {
  const { json, parseBody, readDb, updateDb, operators, cleanText, numberInRange, domain, fileStorage, reservationEmail } = ctx;
  const { ensureCollections, audit, addOperatorLog, missingDocumentsFor, statusLabel, leadStage, leadStageLabel, id, now, RESERVATION_STATUSES, LEAD_STAGES, DOCUMENT_TYPES, CONTACT_TYPES, COMPLAINT_STATUSES, sanitizeCustomer } = domain;
  const { sessionUser, signToken, safeEqual, setSessionCookie, clearSessionCookie, rateLimit, SESSION_TTL_MS } = ctx.auth;

  // Impede que um duplo clique em "Aprovar no operador" chame
  // adapter.confirm() duas vezes para a mesma reserva - isso enviaria um
  // pedido de confirmacao a mais para o operador real, nao e so um
  // problema interno de dados a dobrar. So protege contra pedidos
  // simultaneos dentro deste mesmo processo, que e o cenario real (o
  // mesmo admin, no mesmo browser, a clicar duas vezes depressa).
  const approvalsInProgress = new Set();

  router.get('/api/admin/session', async (req, res) => {
    const user = sessionUser(req);
    return json(res, 200, { ok: true, authenticated: Boolean(user), user });
  });

  router.post('/api/admin/login', async (req, res) => {
    // 30/15min (nao 10) porque este limite e partilhado por IP - em
    // desenvolvimento local, testes automaticos e o login real do
    // utilizador vem todos do mesmo localhost e esgotavam a quota um do
    // outro.
    const limited = rateLimit(req, res, 'admin-login', 30, 15 * 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const expectedUser = process.env.ADMIN_USERNAME || 'admin';
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
    if (!safeEqual(body.username, expectedUser) || !safeEqual(body.password, expectedPassword)) {
      return json(res, 401, { ok: false, error: 'Credenciais inválidas' });
    }
    const token = signToken({ scope: 'admin', user: expectedUser, exp: Date.now() + SESSION_TTL_MS });
    setSessionCookie(res, token);
    return json(res, 200, { ok: true, user: expectedUser });
  });

  router.post('/api/admin/logout', async (req, res) => {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  });

  router.get('/api/admin/dashboard', async (req, res) => {
    const db = ensureCollections(await readDb());
    const totalReservations = db.reservations.length;
    const confirmed = db.reservations.filter(r => r.status === 'CONFIRMED').length;
    const revenue = db.reservations.filter(r => r.status === 'CONFIRMED').reduce((sum, r) => sum + (r.offer?.finalPrice || 0), 0);
    const margin = db.reservations.filter(r => r.status === 'CONFIRMED').reduce((sum, r) => sum + (r.offer?.marginValue || 0), 0);
    return json(res, 200, {
      company: db.company,
      stats: { leads: db.leads.length, customers: db.customers.length, reservations: totalReservations, confirmed, revenue, margin },
      latest: { leads: db.leads.slice(0, 10), reservations: db.reservations.slice(0, 10), payments: db.payments.slice(0, 10), emails: db.emails.slice(0, 10), logs: db.operatorLogs.slice(0, 10), audit: db.auditLogs.slice(0, 10) },
      margins: db.margins,
      operators: operators.list(),
      statuses: RESERVATION_STATUSES.map(value => ({ value, label: statusLabel(value) }))
    });
  }, { admin: true });

  // Vista de resumo para o novo backoffice (public/backoffice/). So numeros
  // e listas derivados diretamente dos dados que ja existem - nada de
  // metricas inventadas (probabilidade de fecho, contagem de visualizacoes
  // de proposta, etc.) que exigiriam tracking que este site nao tem.
  router.get('/api/admin/crm/overview', async (req, res) => {
    const db = ensureCollections(await readDb());
    const todayStr = now().slice(0, 10);
    const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const interessesHoje = db.leads.filter(l => l.createdAt?.slice(0, 10) === todayStr).length;
    const propostasAguardamResposta = db.leads.filter(l => leadStage(l) === 'PROPOSTA_ENVIADA').length;
    const reservasConfirmadas = db.reservations.filter(r => r.status === 'CONFIRMED').length;
    const pagamentosPendentes = db.payments.filter(p => p.status === 'PENDING');
    const proximasPartidas = db.reservations.filter(r => {
      if (r.status !== 'CONFIRMED' || !r.offer?.checkin) return false;
      const checkin = new Date(`${r.offer.checkin}T00:00:00`);
      return checkin >= new Date() && checkin <= inSevenDays;
    });

    const funil = LEAD_STAGES.map(stage => {
      const leads = db.leads.filter(l => leadStage(l) === stage);
      const potentialValue = leads.reduce((sum, l) => sum + (l.topResult?.finalPrice || l.search?.budget || 0), 0);
      return { stage, label: leadStageLabel(stage), count: leads.length, potentialValue };
    });

    const interessesRecentes = db.leads.slice(0, 8).map(l => ({
      id: l.id,
      destination: l.search?.destination || '',
      name: l.search?.name || '',
      email: l.search?.email || '',
      budget: l.search?.budget || 0,
      createdAt: l.createdAt,
      stage: leadStage(l),
      stageLabel: leadStageLabel(leadStage(l))
    }));

    const proximasViagens = db.reservations
      .filter(r => r.status === 'CONFIRMED' && r.offer?.checkin)
      .sort((a, b) => new Date(a.offer.checkin) - new Date(b.offer.checkin))
      .slice(0, 8)
      .map(r => ({
        id: r.id,
        customerName: r.customer?.name || '',
        destination: r.offer?.destination || '',
        checkin: r.offer.checkin,
        adults: r.offer?.adults || 0,
        children: r.offer?.children || 0
      }));

    return json(res, 200, {
      ok: true,
      company: db.company,
      kpis: {
        interessesHoje,
        propostasAguardamResposta,
        reservasConfirmadas,
        pagamentosPendentes: { count: pagamentosPendentes.length, valor: pagamentosPendentes.reduce((sum, p) => sum + (p.amount || 0), 0) },
        proximasPartidas: proximasPartidas.length
      },
      funil,
      interessesRecentes,
      proximasViagens
    });
  }, { admin: true });

  router.get('/api/admin/margins', async (req, res) => {
    return json(res, 200, { margins: (await readDb()).margins });
  }, { admin: true });

  router.post('/api/admin/margins', async (req, res) => {
    const body = await parseBody(req);
    const saved = await updateDb(db => {
      ensureCollections(db);
      const margin = {
        id: cleanText(body.id || id('margin'), 80),
        name: cleanText(body.name || 'Nova margem', 120),
        match: cleanText(body.match || '*', 500),
        percent: numberInRange(body.percent, 'Percentagem', 0, 80, 7),
        min: numberInRange(body.min, 'Margem minima', 0, 10000, 50),
        roundTo: numberInRange(body.roundTo, 'Arredondamento', 1, 1000, 5),
        active: body.active !== false
      };
      const idx = db.margins.findIndex(m => m.id === margin.id);
      if (idx >= 0) db.margins[idx] = margin; else db.margins.unshift(margin);
      audit(db, sessionUser(req), 'MARGIN_UPSERT', { marginId: margin.id });
      return margin;
    });
    return json(res, 200, { ok: true, margin: saved });
  }, { admin: true });

  router.post('/api/admin/reservations/approve', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    if (approvalsInProgress.has(reservationId)) {
      return json(res, 409, { ok: false, error: 'Esta reserva já está a ser aprovada - aguarde um momento.' });
    }
    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
    const payment = db.payments.find(p => p.reservationId === reservation.id);
    if (!payment || payment.status !== 'PAID') return json(res, 409, { ok: false, error: 'A reserva ainda nao tem pagamento confirmado' });
    if (reservation.status === 'CONFIRMED') return json(res, 200, { ok: true, reservation, payment, alreadyConfirmed: true });

    approvalsInProgress.add(reservationId);
    try {
      const adapter = operators.getForOffer(reservation.offer);
      const confirmation = await adapter.confirm({ reservation, payment });
      let resultPayload = null;

      await updateDb(d => {
        ensureCollections(d);
        const r = d.reservations.find(x => x.id === reservation.id);
        const p = d.payments.find(x => x.id === payment.id);
        r.status = 'CONFIRMED';
        r.confirmedAt = now();
        r.operatorLocator = confirmation.locator;
        r.operatorConfirmation = confirmation.raw?.mock ? 'MOCK_CONFIRM_OK' : 'CONFIRM_SENT';
        const email = reservationEmail({ reservation: r, payment: p });
        d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
        addOperatorLog(d, 'CONFIRM', confirmation);
        audit(d, sessionUser(req), 'RESERVATION_APPROVED', { reservationId: r.id, operatorLocator: r.operatorLocator });
        resultPayload = { reservation: r, payment: p, confirmation };
      });
      return json(res, 200, { ok: true, ...resultPayload });
    } finally {
      approvalsInProgress.delete(reservationId);
    }
  }, { admin: true });

  router.get('/api/admin/reservations', async (req, res) => {
    const db = ensureCollections(await readDb());
    const reservations = db.reservations.map(r => ({ ...r, missingDocuments: missingDocumentsFor(r, db.documents) }));
    return json(res, 200, { ok: true, reservations, statuses: RESERVATION_STATUSES.map(value => ({ value, label: statusLabel(value) })) });
  }, { admin: true });

  router.post('/api/admin/reservations/update', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const status = cleanText(body.status, 40);
    if (!RESERVATION_STATUSES.includes(status)) return json(res, 400, { ok: false, error: 'Estado invalido' });
    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
    let resultPayload = null;

    await updateDb(d => {
      ensureCollections(d);
      const r = d.reservations.find(x => x.id === reservationId);
      const previousStatus = r.status;
      r.status = status;
      r.updatedAt = now();
      if (body.notes !== undefined) r.notes = cleanText(body.notes, 1000);
      if (status === 'CONFIRMED' && !r.confirmedAt) r.confirmedAt = now();
      const p = d.payments.find(x => x.reservationId === r.id);
      const email = reservationEmail({ reservation: r, payment: p });
      d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
      audit(d, sessionUser(req), 'RESERVATION_STATUS_UPDATED', { reservationId: r.id, from: previousStatus, to: status });
      resultPayload = { reservation: r };
    });
    return json(res, 200, { ok: true, ...resultPayload });
  }, { admin: true });

  // Documento pode ficar ligado a uma reserva OU diretamente ao cliente
  // (ex.: passaporte de um familiar, guardado uma vez e reutilizavel em
  // reservas futuras sem reserva nenhuma associada ainda).
  router.post('/api/admin/documents/upload', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const customerEmail = cleanText(body.customerEmail, 254).toLowerCase();
    const type = cleanText(body.type, 20);
    if (!DOCUMENT_TYPES.includes(type)) return json(res, 400, { ok: false, error: 'Tipo de documento invalido' });
    const fileName = cleanText(body.fileName, 200);
    const passengerName = body.passengerName ? cleanText(body.passengerName, 200) : undefined;
    if (!fileName || !body.fileBase64) return json(res, 400, { ok: false, error: 'Ficheiro invalido' });
    if (!reservationId && !customerEmail) return json(res, 400, { ok: false, error: 'Indique a reserva ou o cliente' });

    const db = ensureCollections(await readDb());
    let folder;
    if (reservationId) {
      const reservation = db.reservations.find(r => r.id === reservationId);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
      folder = reservationId;
    } else {
      folder = `cliente/${customerEmail.replace('@', '_')}`;
    }

    const buffer = Buffer.from(body.fileBase64, 'base64');
    const docId = id('doc');
    const storagePath = `${folder}/${docId}-${fileName}`;
    try {
      await fileStorage.uploadFile(storagePath, buffer, body.mimeType);
    } catch (err) {
      return json(res, 502, { ok: false, error: `Falha ao guardar documento: ${err.message}` });
    }

    const document = {
      id: docId, createdAt: now(),
      reservationId: reservationId || undefined,
      customerEmail: reservationId ? undefined : customerEmail,
      type, passengerName, fileName, storagePath, uploadedBy: sessionUser(req)
    };
    await updateDb(d => {
      ensureCollections(d);
      d.documents.unshift(document);
      audit(d, sessionUser(req), 'DOCUMENT_UPLOADED', { reservationId: reservationId || null, customerEmail: customerEmail || null, documentId: docId, type });
    });
    return json(res, 200, { ok: true, document });
  }, { admin: true });

  router.get('/api/admin/documents', async (req, res, url) => {
    const reservationId = cleanText(url.searchParams.get('reservationId'), 120);
    const customerEmail = cleanText(url.searchParams.get('customerEmail'), 254).toLowerCase();
    const db = ensureCollections(await readDb());
    const documents = reservationId
      ? db.documents.filter(d => d.reservationId === reservationId)
      : db.documents.filter(d => d.customerEmail === customerEmail);
    const withUrls = await Promise.all(documents.map(async d => ({ ...d, signedUrl: await fileStorage.signedUrl(d.storagePath) })));
    return json(res, 200, { ok: true, documents: withUrls });
  }, { admin: true });

  router.post('/api/admin/documents/delete', async (req, res) => {
    const body = await parseBody(req);
    const documentId = cleanText(body.documentId, 120);
    const db = ensureCollections(await readDb());
    const document = db.documents.find(d => d.id === documentId);
    if (!document) return json(res, 404, { ok: false, error: 'Documento nao encontrado' });

    try {
      await fileStorage.deleteFile(document.storagePath);
    } catch (err) {
      return json(res, 502, { ok: false, error: `Falha ao remover documento: ${err.message}` });
    }

    await updateDb(d => {
      ensureCollections(d);
      d.documents = d.documents.filter(x => x.id !== documentId);
      audit(d, sessionUser(req), 'DOCUMENT_DELETED', { reservationId: document.reservationId, documentId });
    });
    return json(res, 200, { ok: true });
  }, { admin: true });

  router.get('/api/admin/customers', async (req, res) => {
    const db = ensureCollections(await readDb());
    const customers = db.customers.map(c => ({
      ...sanitizeCustomer(c),
      leadsCount: db.leads.filter(l => l.search?.email === c.email).length,
      reservationsCount: db.reservations.filter(r => r.customer?.email === c.email).length
    }));
    return json(res, 200, { ok: true, customers });
  }, { admin: true });

  router.get('/api/admin/customers/detail', async (req, res, url) => {
    const customerEmail = cleanText(url.searchParams.get('email'), 254);
    const db = ensureCollections(await readDb());
    const customer = db.customers.find(c => c.email === customerEmail);
    if (!customer) return json(res, 404, { ok: false, error: 'Cliente nao encontrado' });
    const leads = db.leads.filter(l => l.search?.email === customerEmail);
    const reservations = db.reservations.filter(r => r.customer?.email === customerEmail)
      .map(r => ({ ...r, payment: db.payments.find(p => p.reservationId === r.id) || null }));
    const documents = db.documents.filter(d => d.customerEmail === customerEmail);
    const documentsWithUrls = await Promise.all(documents.map(async d => ({ ...d, signedUrl: await fileStorage.signedUrl(d.storagePath) })));
    const contacts = db.contactLog.filter(c => c.customerEmail === customerEmail);
    const complaints = db.complaints.filter(c => c.customerEmail === customerEmail);
    return json(res, 200, {
      ok: true,
      customer: sanitizeCustomer(customer),
      leads,
      reservations,
      documents: documentsWithUrls,
      contacts,
      complaints
    });
  }, { admin: true });

  router.post('/api/admin/customers/notes', async (req, res) => {
    const body = await parseBody(req);
    const customerEmail = cleanText(body.email, 254);
    const notes = cleanText(body.notes, 2000);
    const saved = await updateDb(d => {
      ensureCollections(d);
      const customer = d.customers.find(c => c.email === customerEmail);
      if (!customer) return null;
      customer.notes = notes;
      customer.updatedAt = now();
      audit(d, sessionUser(req), 'CUSTOMER_NOTES_UPDATED', { email: customerEmail });
      return customer;
    });
    if (!saved) return json(res, 404, { ok: false, error: 'Cliente nao encontrado' });
    return json(res, 200, { ok: true, customer: sanitizeCustomer(saved) });
  }, { admin: true });

  // Ficha do cliente editavel pelo operador (nao so as notas) - mesmos
  // campos que o proprio cliente pode editar em /conta, mais util quando e
  // a equipa a recolher os dados por telefone.
  router.post('/api/admin/customers/update', async (req, res) => {
    const body = await parseBody(req);
    const customerEmail = cleanText(body.email, 254);
    const updates = {
      name: cleanText(body.name, 120),
      phone: cleanText(body.phone, 40),
      phone2: cleanText(body.phone2, 40),
      nif: cleanText(body.nif, 20),
      address: cleanText(body.address, 200),
      postalCode: cleanText(body.postalCode, 20),
      city: cleanText(body.city, 100),
      birthdate: cleanText(body.birthdate, 30),
      travelScope: ['LAZER', 'NEGOCIOS', 'AMBOS'].includes(body.travelScope) ? body.travelScope : '',
      notes: cleanText(body.notes, 2000)
    };
    const saved = await updateDb(d => {
      ensureCollections(d);
      let customer = d.customers.find(c => c.email === customerEmail);
      if (customer) { Object.assign(customer, updates); customer.updatedAt = now(); }
      else { customer = { id: id('cli'), createdAt: now(), email: customerEmail, ...updates }; d.customers.unshift(customer); }
      audit(d, sessionUser(req), 'CUSTOMER_UPDATED_BY_ADMIN', { email: customerEmail });
      return customer;
    });
    return json(res, 200, { ok: true, customer: sanitizeCustomer(saved) });
  }, { admin: true });

  router.post('/api/admin/customers/contact', async (req, res) => {
    const body = await parseBody(req);
    const customerEmail = cleanText(body.email, 254);
    const type = CONTACT_TYPES.includes(body.type) ? body.type : 'OTHER';
    const summary = cleanText(body.summary, 2000);
    if (!customerEmail || !summary) return json(res, 400, { ok: false, error: 'Cliente e resumo sao obrigatorios' });
    const entry = { id: id('contact'), createdAt: now(), customerEmail, actor: sessionUser(req), type, summary };
    await updateDb(d => {
      ensureCollections(d);
      d.contactLog.unshift(entry);
      audit(d, sessionUser(req), 'CONTACT_LOGGED', { email: customerEmail, type });
    });
    return json(res, 200, { ok: true, entry });
  }, { admin: true });

  router.post('/api/admin/customers/complaints', async (req, res) => {
    const body = await parseBody(req);
    const customerEmail = cleanText(body.email, 254);
    const subject = cleanText(body.subject, 200);
    if (!customerEmail || !subject) return json(res, 400, { ok: false, error: 'Cliente e assunto sao obrigatorios' });
    const complaint = {
      id: id('compl'),
      createdAt: now(),
      customerEmail,
      reservationId: cleanText(body.reservationId, 120) || undefined,
      status: 'OPEN',
      subject,
      description: cleanText(body.description, 4000)
    };
    await updateDb(d => {
      ensureCollections(d);
      d.complaints.unshift(complaint);
      audit(d, sessionUser(req), 'COMPLAINT_CREATED', { email: customerEmail, complaintId: complaint.id });
    });
    return json(res, 200, { ok: true, complaint });
  }, { admin: true });

  router.post('/api/admin/customers/complaints/update', async (req, res) => {
    const body = await parseBody(req);
    const complaintId = cleanText(body.id, 120);
    const status = COMPLAINT_STATUSES.includes(body.status) ? body.status : null;
    if (!status) return json(res, 400, { ok: false, error: 'Estado invalido' });
    const resolution = cleanText(body.resolution, 4000);
    const saved = await updateDb(d => {
      ensureCollections(d);
      const complaint = d.complaints.find(c => c.id === complaintId);
      if (!complaint) return null;
      complaint.status = status;
      complaint.updatedAt = now();
      if (resolution) complaint.resolution = resolution;
      if (status === 'RESOLVED') complaint.resolvedAt = now();
      audit(d, sessionUser(req), 'COMPLAINT_UPDATED', { complaintId, status });
      return complaint;
    });
    if (!saved) return json(res, 404, { ok: false, error: 'Reclamacao nao encontrada' });
    return json(res, 200, { ok: true, complaint: saved });
  }, { admin: true });

  router.get('/api/admin/leads', async (req, res) => {
    const db = ensureCollections(await readDb());
    const leads = db.leads.map(l => ({ ...l, stage: leadStage(l) }));
    return json(res, 200, { ok: true, leads, leadStages: LEAD_STAGES.map(value => ({ value, label: leadStageLabel(value) })) });
  }, { admin: true });

  router.post('/api/admin/leads/update', async (req, res) => {
    const body = await parseBody(req);
    const leadId = cleanText(body.leadId, 120);
    const stage = cleanText(body.status, 40);
    if (!LEAD_STAGES.includes(stage)) return json(res, 400, { ok: false, error: 'Estagio invalido' });
    const saved = await updateDb(d => {
      ensureCollections(d);
      const lead = d.leads.find(l => l.id === leadId);
      if (!lead) return null;
      const previousStatus = lead.status;
      lead.status = stage;
      lead.updatedAt = now();
      audit(d, sessionUser(req), 'LEAD_STAGE_UPDATED', { leadId: lead.id, from: previousStatus, to: stage });
      return lead;
    });
    if (!saved) return json(res, 404, { ok: false, error: 'Lead nao encontrado' });
    return json(res, 200, { ok: true, lead: saved });
  }, { admin: true });

  router.post('/api/admin/operator/tourdiez/test', async (req, res) => {
    const body = await parseBody(req);
    const { tourdiezAdapter } = ctx;
    const checkin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const nights = Number(body.nights || 5);
    const checkout = new Date(checkin.getTime() + nights * 24 * 60 * 60 * 1000);
    // Sem accomodationsCode fixo por omissao: confirmado por teste direto
    // que esse filtro devolve sempre "sem dados" na sandbox, mesmo com um
    // unico codigo valido. Pesquisar so por city devolve dados reais - ver
    // o mesmo raciocinio em operatorAdapters.js#defaultSearchParams.
    const testParams = {
      city: process.env.TOURDIEZ_DEFAULT_CITY || 'ES00634',
      checkin: checkin.toISOString().slice(0, 10),
      checkout: checkout.toISOString().slice(0, 10),
      nights,
      adults: 2,
      children: 0,
      retrieveCancelPolicies: true,
      ...body
    };
    try {
      const login = await tourdiezAdapter.client.login();
      const avail = await tourdiezAdapter.search(testParams);
      await updateDb(db => { addOperatorLog(db, 'TEST_LOGIN', login); addOperatorLog(db, 'TEST_AVAIL', avail); });
      return json(res, 200, { ok: true, configured: tourdiezAdapter.isConfigured(), tourdiezOk: true, params: testParams, login, availability: avail });
    } catch (e) {
      await updateDb(db => addOperatorLog(db, 'TEST_ERROR', { error: e.message, params: testParams }));
      return json(res, 200, { ok: true, configured: tourdiezAdapter.isConfigured(), tourdiezOk: false, params: testParams, error: e.message });
    }
  }, { admin: true });
};
