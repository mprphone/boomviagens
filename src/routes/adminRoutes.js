// Backoffice: login/sessao (publicas, e como se entra) e todas as rotas de
// gestao (marcadas admin:true - o dispatcher central em server.js exige
// sessao valida antes de chamar o handler, sem repetir a verificacao em
// cada rota).

module.exports = function registerAdminRoutes(router, ctx) {
  const { json, parseBody, readDb, updateDb, operators, cleanText, numberInRange, domain, fileStorage, reservationEmail } = ctx;
  const {
    ensureCollections, audit, addOperatorLog, missingDocumentsFor, statusLabel, leadStage, leadStageLabel, id, now,
    RESERVATION_STATUSES, LEAD_STAGES, DOCUMENT_TYPES, CUSTOMER_FINANCIAL_DOC_TYPES, CONTACT_TYPES, COMPLAINT_STATUSES, COMPLAINT_DIRECTIONS,
    VAT_REGIMES, SUPPLIER_TYPES, SERVICE_TYPES, SERVICE_STATUSES, MANUAL_EVENT_TYPES, TASK_STATUSES, TASK_PRIORITIES,
    sanitizeCustomer, computeServiceTotals, serviceTypeLabel, serviceStatusLabel, serviceStatusesForType, eventTypeLabel,
    taskStatusLabel, taskPriorityLabel, complaintStatusLabel, documentTypeLabel, processNumber, computeAlerts
  } = domain;
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
    const reservations = db.reservations.map(r => ({
      ...r,
      processNumber: processNumber(r),
      missingDocuments: missingDocumentsFor(r, db.documents),
      serviceLinesCount: db.serviceLines.filter(s => s.reservationId === r.id).length,
      openComplaintsCount: db.complaints.filter(c => c.reservationId === r.id && !['RESOLVED', 'CLOSED'].includes(c.status)).length
    }));
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
      if (previousStatus !== status) {
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: r.id, actor: sessionUser(req), type: 'STATUS_CHANGE', description: `De "${statusLabel(previousStatus)}" para "${statusLabel(status)}"` });
      }
      audit(d, sessionUser(req), 'RESERVATION_STATUS_UPDATED', { reservationId: r.id, from: previousStatus, to: status });
      resultPayload = { reservation: r };
    });
    return json(res, 200, { ok: true, ...resultPayload });
  }, { admin: true });

  // So registo/classificacao interna - a fatura real e emitida em software
  // certificado pela AT (ex.: OptiTravel). Aqui so se guarda o numero/data
  // depois de emitida la, e o regime de IVA aplicavel para calculo da
  // margem (ver src/pricing.js#marginSchemeVat).
  router.post('/api/admin/reservations/invoice', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const vatRegime = VAT_REGIMES.includes(body.vatRegime) ? body.vatRegime : null;
    const updates = {};
    if (vatRegime) updates.vatRegime = vatRegime;
    if (body.invoiceNumber !== undefined) updates.invoiceNumber = cleanText(body.invoiceNumber, 60);
    if (body.invoiceDate !== undefined) updates.invoiceDate = cleanText(body.invoiceDate, 30);
    if (body.invoiceSystem !== undefined) updates.invoiceSystem = cleanText(body.invoiceSystem, 80);

    const saved = await updateDb(d => {
      ensureCollections(d);
      const r = d.reservations.find(x => x.id === reservationId);
      if (!r) return null;
      Object.assign(r, updates);
      r.updatedAt = now();
      audit(d, sessionUser(req), 'RESERVATION_INVOICE_UPDATED', { reservationId, ...updates });
      return r;
    });
    if (!saved) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
    return json(res, 200, { ok: true, reservation: saved });
  }, { admin: true });

  // Registo manual de um recebimento do cliente (separador "Vendas") - ex.:
  // um sinal pago por transferencia bancaria, fora do fluxo automatico de
  // checkout/MB WAY. Fica sempre com status PAID (o registo so e feito
  // depois de o dinheiro ter entrado).
  router.post('/api/admin/reservations/payments', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const amount = numberInRange(body.amount, 'Valor', 0.01, 1000000, 0);
    const method = cleanText(body.method, 60) || 'Transferência bancária';
    const reference = cleanText(body.reference, 100);
    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });

    const payment = { id: id('pay'), createdAt: now(), reservationId, method, amount, status: 'PAID', reference, paidAt: now() };
    await updateDb(d => {
      ensureCollections(d);
      d.payments.push(payment);
      d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: sessionUser(req), type: 'INFO', description: `Recebimento registado: ${amount.toFixed(2)} € (${method})` });
      audit(d, sessionUser(req), 'PAYMENT_LOGGED_MANUALLY', { reservationId, paymentId: payment.id, amount });
    });
    return json(res, 200, { ok: true, payment });
  }, { admin: true });

  // Ficha de Reserva ("Processo de Viagem"): um unico pedido devolve tudo o
  // que os separadores precisam (servicos, historico, tarefas, reclamacoes,
  // pagamentos, alertas), em vez de cada separador ir buscar os seus dados
  // um a um. O numero de processo (PV-AAAA-XXXXXX) e derivado do id interno,
  // ja unico - ver domain.js#processNumber.
  router.get('/api/admin/reservations/detail', async (req, res, url) => {
    const reservationId = cleanText(url.searchParams.get('reservationId'), 120);
    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Processo nao encontrado' });

    const serviceLines = db.serviceLines.filter(s => s.reservationId === reservationId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const events = db.reservationEvents.filter(e => e.reservationId === reservationId);
    const tasks = db.tasks.filter(t => t.reservationId === reservationId);
    const complaints = db.complaints.filter(c => c.reservationId === reservationId);
    const payments = db.payments.filter(p => p.reservationId === reservationId);
    const documents = db.documents.filter(d => d.reservationId === reservationId);
    const documentsWithUrls = await Promise.all(documents.map(async d => ({ ...d, signedUrl: await fileStorage.signedUrl(d.storagePath) })));
    const communications = db.contactLog.filter(c => c.reservationId === reservationId);

    return json(res, 200, {
      ok: true,
      reservation: { ...reservation, processNumber: processNumber(reservation), missingDocuments: missingDocumentsFor(reservation, db.documents) },
      statuses: RESERVATION_STATUSES.map(value => ({ value, label: statusLabel(value) })),
      serviceLines,
      serviceTotals: computeServiceTotals(serviceLines),
      serviceTypes: SERVICE_TYPES.map(value => ({ value, label: serviceTypeLabel(value) })),
      serviceStatuses: SERVICE_STATUSES.map(value => ({ value, label: serviceStatusLabel(value) })),
      // Cada tipo de servico tem o seu proprio percurso (um voo emite
      // bilhete e faz check-in; um hotel so confirma e paga) - o
      // formulario da gaveta lateral usa isto para mostrar so os estados
      // que fazem sentido para o tipo escolhido.
      serviceStatusesByType: Object.fromEntries(SERVICE_TYPES.map(type => [type, serviceStatusesForType(type).map(value => ({ value, label: serviceStatusLabel(value) }))])),
      events,
      eventTypes: MANUAL_EVENT_TYPES.map(value => ({ value, label: eventTypeLabel(value) })),
      tasks,
      taskStatuses: TASK_STATUSES.map(value => ({ value, label: taskStatusLabel(value) })),
      taskPriorities: TASK_PRIORITIES.map(value => ({ value, label: taskPriorityLabel(value) })),
      complaints,
      complaintStatuses: COMPLAINT_STATUSES.map(value => ({ value, label: complaintStatusLabel(value) })),
      complaintDirections: COMPLAINT_DIRECTIONS,
      payments,
      documents: documentsWithUrls,
      communications,
      suppliers: db.suppliers.map(s => ({ id: s.id, name: s.name })),
      alerts: computeAlerts(reservation, { serviceLines, documents, payments, tasks })
    });
  }, { admin: true });

  router.post('/api/admin/reservations/services', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const lineId = cleanText(body.id, 120);
    const type = cleanText(body.type, 30);
    if (!SERVICE_TYPES.includes(type)) return json(res, 400, { ok: false, error: 'Tipo de serviço inválido' });
    const description = cleanText(body.description, 200);
    if (!description) return json(res, 400, { ok: false, error: 'Descrição obrigatória' });
    // Valida o estado contra o percurso do tipo escolhido (nao a lista
    // completa) - um hotel nao pode ficar "Check-in feito", so um voo.
    const validStatuses = serviceStatusesForType(type);
    const status = validStatuses.includes(body.status) ? body.status : 'NAO_CONFIRMADO';
    const updates = {
      type, description, status,
      supplierName: cleanText(body.supplierName, 150),
      reference: cleanText(body.reference, 100),
      locator: cleanText(body.locator, 100),
      quantity: numberInRange(body.quantity, 'Quantidade', 0.01, 999, 1),
      dateStart: cleanText(body.dateStart, 30),
      dateEnd: cleanText(body.dateEnd, 30),
      netValue: numberInRange(body.netValue, 'Custo (NET)', 0, 1000000, 0),
      pvpValue: numberInRange(body.pvpValue, 'Venda (PVP)', 0, 1000000, 0),
      discountPercent: numberInRange(body.discountPercent, 'Desconto', 0, 100, 0),
      optionDeadline: cleanText(body.optionDeadline, 30),
      cancellationTerms: cleanText(body.cancellationTerms, 1000),
      paid: Boolean(body.paid),
      paidAt: body.paid ? (cleanText(body.paidAt, 30) || now()) : undefined,
      notes: cleanText(body.notes, 1000)
    };
    // So faz sentido preencher os campos de cancelamento quando a linha
    // fica com estado CANCELADO - evita lixo em linhas normais.
    if (status === 'CANCELADO') {
      updates.cancelReason = cleanText(body.cancelReason, 500);
      updates.refundableAmount = body.refundableAmount !== undefined ? numberInRange(body.refundableAmount, 'Valor reembolsável', 0, 1000000, 0) : undefined;
      updates.refundedAmount = body.refundedAmount !== undefined ? numberInRange(body.refundedAmount, 'Valor reembolsado', 0, 1000000, 0) : undefined;
      updates.refundedAt = body.refundedAmount ? (cleanText(body.refundedAt, 30) || now()) : undefined;
    }

    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });

    let resultLine = null;
    await updateDb(d => {
      ensureCollections(d);
      let line = lineId && d.serviceLines.find(s => s.id === lineId && s.reservationId === reservationId);
      if (line) {
        const wasCancelled = line.status === 'CANCELADO';
        Object.assign(line, updates);
        line.updatedAt = now();
        const justCancelled = !wasCancelled && status === 'CANCELADO';
        d.reservationEvents.unshift({
          id: id('evt'), createdAt: now(), reservationId, actor: sessionUser(req), type: 'SERVICE_UPDATED',
          description: justCancelled ? `Cancelado: ${serviceTypeLabel(type)} - ${description}${updates.cancelReason ? ` (${updates.cancelReason})` : ''}` : `${serviceTypeLabel(type)}: ${description}`
        });
      } else {
        line = { id: id('svc'), createdAt: now(), reservationId, ...updates };
        d.serviceLines.push(line);
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: sessionUser(req), type: 'SERVICE_ADDED', description: `${serviceTypeLabel(type)}: ${description}` });
      }
      audit(d, sessionUser(req), lineId ? 'SERVICE_LINE_UPDATED' : 'SERVICE_LINE_CREATED', { reservationId, lineId: line.id });
      resultLine = line;
    });
    return json(res, 200, { ok: true, serviceLine: resultLine });
  }, { admin: true });

  router.post('/api/admin/reservations/services/delete', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const lineId = cleanText(body.id, 120);
    const db = ensureCollections(await readDb());
    const line = db.serviceLines.find(s => s.id === lineId && s.reservationId === reservationId);
    if (!line) return json(res, 404, { ok: false, error: 'Linha de serviço não encontrada' });

    await updateDb(d => {
      ensureCollections(d);
      d.serviceLines = d.serviceLines.filter(s => s.id !== lineId);
      d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: sessionUser(req), type: 'SERVICE_REMOVED', description: `${serviceTypeLabel(line.type)}: ${line.description}` });
      audit(d, sessionUser(req), 'SERVICE_LINE_DELETED', { reservationId, lineId });
    });
    return json(res, 200, { ok: true });
  }, { admin: true });

  // Separador "Histórico"/"Ocorrências": registo manual de informacoes,
  // alteracoes, problemas, incidentes, atrasos, servicos nao prestados,
  // erros (fornecedor/internos) e pedidos do cliente. Os outros tipos de
  // evento (mudança de estado, serviços, documentos) são gerados
  // automaticamente pelas rotas correspondentes, não têm entrada direta
  // aqui.
  router.post('/api/admin/reservations/events', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const type = cleanText(body.type, 30);
    if (!MANUAL_EVENT_TYPES.includes(type)) return json(res, 400, { ok: false, error: 'Tipo de registo inválido' });
    const description = cleanText(body.description, 1000);
    if (!description) return json(res, 400, { ok: false, error: 'Descrição obrigatória' });

    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });

    // O formulario da gaveta lateral pode ja vir com a resolucao
    // preenchida (ex.: um problema que ja foi resolvido no momento em que
    // se regista), por isso aceita resolved/resolution logo na criacao.
    const resolved = Boolean(body.resolved);
    const resolution = cleanText(body.resolution, 1000);

    let event = null;
    await updateDb(d => {
      ensureCollections(d);
      event = { id: id('evt'), createdAt: now(), reservationId, actor: sessionUser(req), type, description, resolved, resolution };
      d.reservationEvents.unshift(event);
      audit(d, sessionUser(req), 'RESERVATION_EVENT_ADDED', { reservationId, type });
    });
    return json(res, 200, { ok: true, event });
  }, { admin: true });

  // Atualiza uma ocorrência existente (tipo, descrição, resolução/estado) -
  // usado no separador "Ocorrências" para editar e acompanhar problemas
  // ate ao fecho.
  router.post('/api/admin/reservations/events/resolve', async (req, res) => {
    const body = await parseBody(req);
    const eventId = cleanText(body.id, 120);
    const saved = await updateDb(d => {
      ensureCollections(d);
      const event = d.reservationEvents.find(e => e.id === eventId);
      if (!event) return null;
      if (body.type !== undefined && MANUAL_EVENT_TYPES.includes(body.type)) event.type = body.type;
      if (body.description !== undefined) {
        const desc = cleanText(body.description, 1000);
        if (desc) event.description = desc;
      }
      if (body.resolved !== undefined) event.resolved = Boolean(body.resolved);
      if (body.resolution !== undefined) event.resolution = cleanText(body.resolution, 1000);
      audit(d, sessionUser(req), 'RESERVATION_EVENT_UPDATED', { eventId });
      return event;
    });
    if (!saved) return json(res, 404, { ok: false, error: 'Registo não encontrado' });
    return json(res, 200, { ok: true, event: saved });
  }, { admin: true });

  // Separador "Tarefas": checklist administrativo/operacional do processo.
  router.post('/api/admin/reservations/tasks', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const taskId = cleanText(body.id, 120);
    const description = cleanText(body.description, 300);
    if (!description) return json(res, 400, { ok: false, error: 'Descrição obrigatória' });
    const status = TASK_STATUSES.includes(body.status) ? body.status : 'TODO';
    const updates = {
      description,
      assignee: cleanText(body.assignee, 100),
      dueDate: cleanText(body.dueDate, 30),
      priority: TASK_PRIORITIES.includes(body.priority) ? body.priority : 'NORMAL',
      status,
      notes: cleanText(body.notes, 1000)
    };

    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });

    let resultTask = null;
    await updateDb(d => {
      ensureCollections(d);
      let task = taskId && d.tasks.find(t => t.id === taskId && t.reservationId === reservationId);
      if (task) {
        const wasDone = task.status === 'DONE';
        Object.assign(task, updates);
        task.updatedAt = now();
        if (status === 'DONE' && !wasDone) task.completedAt = now();
        if (status !== 'DONE') task.completedAt = undefined;
      } else {
        task = { id: id('task'), createdAt: now(), reservationId, ...updates, completedAt: status === 'DONE' ? now() : undefined };
        d.tasks.push(task);
      }
      audit(d, sessionUser(req), taskId ? 'TASK_UPDATED' : 'TASK_CREATED', { reservationId, taskId: task.id });
      resultTask = task;
    });
    return json(res, 200, { ok: true, task: resultTask });
  }, { admin: true });

  router.post('/api/admin/reservations/tasks/delete', async (req, res) => {
    const body = await parseBody(req);
    const taskId = cleanText(body.id, 120);
    const db = ensureCollections(await readDb());
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) return json(res, 404, { ok: false, error: 'Tarefa não encontrada' });
    await updateDb(d => {
      ensureCollections(d);
      d.tasks = d.tasks.filter(t => t.id !== taskId);
      audit(d, sessionUser(req), 'TASK_DELETED', { taskId });
    });
    return json(res, 200, { ok: true });
  }, { admin: true });

  // Checklist de Pós-Viagem: pergunta simples ("a viagem correu bem?") mais
  // notas; se a resposta for "não", a equipa deve ter criado uma ocorrência
  // ou reclamação a documentar o que aconteceu (o formulario no frontend
  // pede isso, mas nao e bloqueado aqui - o backend so guarda a resposta).
  router.post('/api/admin/reservations/posttrip', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const postTripOk = body.postTripOk === null ? null : Boolean(body.postTripOk);
    const postTripNotes = cleanText(body.postTripNotes, 2000);
    const saved = await updateDb(d => {
      ensureCollections(d);
      const r = d.reservations.find(x => x.id === reservationId);
      if (!r) return null;
      r.postTripOk = postTripOk;
      r.postTripNotes = postTripNotes;
      r.updatedAt = now();
      d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: sessionUser(req), type: 'NOTE', description: `Pós-viagem: ${postTripOk === false ? 'houve problemas' : postTripOk === true ? 'correu bem' : 'por confirmar'}${postTripNotes ? ` - ${postTripNotes}` : ''}` });
      audit(d, sessionUser(req), 'POST_TRIP_UPDATED', { reservationId, postTripOk });
      return r;
    });
    if (!saved) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
    return json(res, 200, { ok: true, reservation: saved });
  }, { admin: true });

  router.get('/api/admin/suppliers', async (req, res) => {
    const db = ensureCollections(await readDb());
    const suppliers = db.suppliers.map(s => {
      const purchases = db.reservations.filter(r => matchesSupplier(r, s.name));
      return {
        ...s,
        purchasesCount: purchases.length,
        totalCost: Number(purchases.reduce((sum, r) => sum + (Number(r.offer?.costPrice) || 0), 0).toFixed(2))
      };
    });
    return json(res, 200, { ok: true, suppliers, types: SUPPLIER_TYPES });
  }, { admin: true });

  // Sem uma tabela relacional de reservas-por-fornecedor, o historico de
  // compras e obtido comparando reservation.operator (texto livre, ex.:
  // "TourDiez Demo") com o nome do fornecedor - substring case-insensitive,
  // dos dois lados, para "TourDiez" apanhar "TourDiez Demo" e vice-versa.
  function matchesSupplier(reservation, supplierName) {
    const operator = String(reservation.operator || '').toLowerCase();
    const name = String(supplierName || '').toLowerCase();
    if (!operator || !name) return false;
    return operator.includes(name) || name.includes(operator);
  }

  router.get('/api/admin/suppliers/detail', async (req, res, url) => {
    const supplierId = cleanText(url.searchParams.get('id'), 120);
    const db = ensureCollections(await readDb());
    const supplier = db.suppliers.find(s => s.id === supplierId);
    if (!supplier) return json(res, 404, { ok: false, error: 'Fornecedor nao encontrado' });
    const purchases = db.reservations.filter(r => matchesSupplier(r, supplier.name));
    const documents = db.documents.filter(d => d.supplierId === supplierId);
    const documentsWithUrls = await Promise.all(documents.map(async d => ({ ...d, signedUrl: await fileStorage.signedUrl(d.storagePath) })));
    return json(res, 200, { ok: true, supplier, purchases, documents: documentsWithUrls });
  }, { admin: true });

  router.post('/api/admin/suppliers', async (req, res) => {
    const body = await parseBody(req);
    const name = cleanText(body.name, 150);
    if (!name) return json(res, 400, { ok: false, error: 'Nome obrigatorio' });
    const supplierId = cleanText(body.id, 120);
    const updates = {
      name,
      type: SUPPLIER_TYPES.includes(body.type) ? body.type : 'OUTRO',
      email: cleanText(body.email, 254),
      phone: cleanText(body.phone, 40),
      nif: cleanText(body.nif, 20),
      notes: cleanText(body.notes, 2000)
    };
    const saved = await updateDb(d => {
      ensureCollections(d);
      let supplier = supplierId && d.suppliers.find(s => s.id === supplierId);
      if (supplier) { Object.assign(supplier, updates); supplier.updatedAt = now(); }
      else { supplier = { id: id('sup'), createdAt: now(), ...updates }; d.suppliers.unshift(supplier); }
      audit(d, sessionUser(req), supplierId ? 'SUPPLIER_UPDATED' : 'SUPPLIER_CREATED', { supplierId: supplier.id, name });
      return supplier;
    });
    return json(res, 200, { ok: true, supplier: saved });
  }, { admin: true });

  // Documento pode ficar ligado a uma reserva, a um cliente (ex.: passaporte
  // de um familiar, reutilizavel em reservas futuras) ou a um fornecedor
  // (ex.: contrato, acordo comercial) - so um dos tres por documento.
  router.post('/api/admin/documents/upload', async (req, res) => {
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const customerEmail = cleanText(body.customerEmail, 254).toLowerCase();
    const supplierId = cleanText(body.supplierId, 120);
    const serviceLineId = reservationId ? cleanText(body.serviceLineId, 120) : '';
    const eventId = reservationId ? cleanText(body.eventId, 120) : '';
    const complaintId = reservationId ? cleanText(body.complaintId, 120) : '';
    const type = cleanText(body.type, 20);
    if (!DOCUMENT_TYPES.includes(type)) return json(res, 400, { ok: false, error: 'Tipo de documento invalido' });
    const fileName = cleanText(body.fileName, 200);
    const passengerName = body.passengerName ? cleanText(body.passengerName, 200) : undefined;
    if (!fileName || !body.fileBase64) return json(res, 400, { ok: false, error: 'Ficheiro invalido' });
    if (!reservationId && !customerEmail && !supplierId) return json(res, 400, { ok: false, error: 'Indique a reserva, o cliente ou o fornecedor' });
    // So preenchidos para documentos financeiros (Financeiro > Faturas e
    // Documentos) - numero/data/valor do documento emitido externamente.
    const documentNumber = reservationId ? cleanText(body.documentNumber, 60) : '';
    const documentDate = reservationId ? cleanText(body.documentDate, 30) : '';
    const amount = reservationId && body.amount !== undefined && body.amount !== '' ? numberInRange(body.amount, 'Valor', 0, 1000000, 0) : undefined;

    const db = ensureCollections(await readDb());
    let folder;
    if (reservationId) {
      const reservation = db.reservations.find(r => r.id === reservationId);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
      if (eventId) folder = `${reservationId}/ocorrencias`;
      else if (complaintId) folder = `${reservationId}/reclamacoes`;
      else if (serviceLineId) folder = `${reservationId}/reservas`;
      else if (CUSTOMER_FINANCIAL_DOC_TYPES.includes(type) || type === 'INVOICE_PURCHASE') folder = `${reservationId}/financeiro`;
      else folder = reservationId;
    } else if (customerEmail) {
      folder = `cliente/${customerEmail.replace('@', '_')}`;
    } else {
      const supplier = db.suppliers.find(s => s.id === supplierId);
      if (!supplier) return json(res, 404, { ok: false, error: 'Fornecedor nao encontrado' });
      folder = `fornecedor/${supplierId}`;
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
      customerEmail: reservationId ? undefined : (customerEmail || undefined),
      supplierId: (reservationId || customerEmail) ? undefined : (supplierId || undefined),
      serviceLineId: reservationId ? (serviceLineId || undefined) : undefined,
      eventId: reservationId ? (eventId || undefined) : undefined,
      complaintId: reservationId ? (complaintId || undefined) : undefined,
      documentNumber: documentNumber || undefined,
      documentDate: documentDate || undefined,
      amount,
      type, passengerName, fileName, storagePath, uploadedBy: sessionUser(req)
    };
    await updateDb(d => {
      ensureCollections(d);
      d.documents.unshift(document);
      if (reservationId) {
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: sessionUser(req), type: 'DOCUMENT_UPLOADED', description: fileName });
      }
      audit(d, sessionUser(req), 'DOCUMENT_UPLOADED', { reservationId: reservationId || null, customerEmail: customerEmail || null, supplierId: supplierId || null, documentId: docId, type });
    });
    return json(res, 200, { ok: true, document });
  }, { admin: true });

  router.get('/api/admin/documents', async (req, res, url) => {
    const reservationId = cleanText(url.searchParams.get('reservationId'), 120);
    const customerEmail = cleanText(url.searchParams.get('customerEmail'), 254).toLowerCase();
    const supplierId = cleanText(url.searchParams.get('supplierId'), 120);
    const db = ensureCollections(await readDb());
    let documents;
    if (reservationId) documents = db.documents.filter(d => d.reservationId === reservationId);
    else if (customerEmail) documents = db.documents.filter(d => d.customerEmail === customerEmail);
    else documents = db.documents.filter(d => d.supplierId === supplierId);
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

  // reservationId opcional: quando a comunicacao e registada a partir do
  // separador "Comunicações" da Ficha de Reserva, fica tambem ligada ao
  // processo, alem de aparecer na ficha do cliente (mesmo registo, duas
  // vistas).
  router.post('/api/admin/customers/contact', async (req, res) => {
    const body = await parseBody(req);
    const customerEmail = cleanText(body.email, 254);
    const type = CONTACT_TYPES.includes(body.type) ? body.type : 'OTHER';
    const summary = cleanText(body.summary, 2000);
    if (!customerEmail || !summary) return json(res, 400, { ok: false, error: 'Cliente e resumo sao obrigatorios' });
    const entry = { id: id('contact'), createdAt: now(), customerEmail, reservationId: cleanText(body.reservationId, 120) || undefined, actor: sessionUser(req), type, summary };
    await updateDb(d => {
      ensureCollections(d);
      d.contactLog.unshift(entry);
      audit(d, sessionUser(req), 'CONTACT_LOGGED', { email: customerEmail, type });
    });
    return json(res, 200, { ok: true, entry });
  }, { admin: true });

  // Reclamacao do cliente contra a agencia (direction=CUSTOMER_TO_AGENCY,
  // sem fornecedor) ou da agencia contra um fornecedor/operador
  // (direction=AGENCY_TO_SUPPLIER, com supplierId e valores reclamado/
  // recebido do fornecedor/entregue ao cliente).
  router.post('/api/admin/customers/complaints', async (req, res) => {
    const body = await parseBody(req);
    const customerEmail = cleanText(body.email, 254);
    const subject = cleanText(body.subject, 200);
    if (!customerEmail || !subject) return json(res, 400, { ok: false, error: 'Cliente e assunto sao obrigatorios' });
    const direction = COMPLAINT_DIRECTIONS.includes(body.direction) ? body.direction : 'CUSTOMER_TO_AGENCY';
    const complaint = {
      id: id('compl'),
      createdAt: now(),
      customerEmail,
      reservationId: cleanText(body.reservationId, 120) || undefined,
      direction,
      supplierId: direction === 'AGENCY_TO_SUPPLIER' ? (cleanText(body.supplierId, 120) || undefined) : undefined,
      status: 'OPEN',
      subject,
      description: cleanText(body.description, 4000),
      claimedAmount: body.claimedAmount !== undefined && body.claimedAmount !== '' ? numberInRange(body.claimedAmount, 'Valor reclamado', 0, 1000000, 0) : undefined
    };
    await updateDb(d => {
      ensureCollections(d);
      d.complaints.unshift(complaint);
      if (complaint.reservationId) {
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: complaint.reservationId, actor: sessionUser(req), type: 'PROBLEM', description: `Reclamação aberta: ${subject}` });
      }
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
      if (body.subject !== undefined) { const subj = cleanText(body.subject, 200); if (subj) complaint.subject = subj; }
      if (body.description !== undefined) complaint.description = cleanText(body.description, 4000);
      if (body.claimedAmount !== undefined && body.claimedAmount !== '') complaint.claimedAmount = numberInRange(body.claimedAmount, 'Valor reclamado', 0, 1000000, 0);
      if (body.receivedAmount !== undefined && body.receivedAmount !== '') complaint.receivedAmount = numberInRange(body.receivedAmount, 'Valor recebido', 0, 1000000, 0);
      if (body.paidToCustomer !== undefined && body.paidToCustomer !== '') complaint.paidToCustomer = numberInRange(body.paidToCustomer, 'Valor entregue ao cliente', 0, 1000000, 0);
      if (status === 'RESOLVED' || status === 'CLOSED') complaint.resolvedAt = now();
      if (complaint.reservationId) {
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: complaint.reservationId, actor: sessionUser(req), type: 'INFO', description: `Reclamação atualizada: ${complaintStatusLabel(status)}` });
      }
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
