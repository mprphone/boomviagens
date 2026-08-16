// Pipeline comercial ("Oportunidades") - lista/gaveta/arrasto entre fases,
// conversao para processo de viagem quando ganha, e propostas de cada
// oportunidade. Separado de adminRoutes.js para nao engordar ainda mais
// esse ficheiro com um dominio novo e independente.

module.exports = function registerOpportunitiesRoutes(router, ctx) {
  const { json, parseBody, readDb, updateDb, cleanText, numberInRange, domain } = ctx;
  const {
    ensureCollections, audit, id, now,
    OPPORTUNITY_STAGES, OPPORTUNITY_TEMPERATURES, OPPORTUNITY_TAGS, OPPORTUNITY_ORIGINS, NEXT_ACTION_TYPES, LOSS_REASONS, PROPOSAL_STATUSES,
    opportunityStageLabel, opportunityTemperatureLabel, opportunityTagLabel, opportunityOriginLabel, nextActionTypeLabel, lossReasonLabel, proposalStatusLabel,
    opportunityHealth, sanitizeStaff, processNumber, opportunityNumber
  } = domain;
  const { sessionUser } = ctx.auth;

  function metaPayload() {
    return {
      stages: OPPORTUNITY_STAGES.map(value => ({ value, label: opportunityStageLabel(value) })),
      temperatures: OPPORTUNITY_TEMPERATURES.map(value => ({ value, label: opportunityTemperatureLabel(value) })),
      tags: OPPORTUNITY_TAGS.map(value => ({ value, label: opportunityTagLabel(value) })),
      origins: OPPORTUNITY_ORIGINS.map(value => ({ value, label: opportunityOriginLabel(value) })),
      nextActionTypes: NEXT_ACTION_TYPES.map(value => ({ value, label: nextActionTypeLabel(value) })),
      lossReasons: LOSS_REASONS.map(value => ({ value, label: lossReasonLabel(value) })),
      proposalStatuses: PROPOSAL_STATUSES.map(value => ({ value, label: proposalStatusLabel(value) }))
    };
  }

  function lastActivityAt(db, opportunityId) {
    const events = db.opportunityEvents.filter(e => e.opportunityId === opportunityId).map(e => e.createdAt);
    const contacts = db.contactLog.filter(c => c.opportunityId === opportunityId).map(c => c.createdAt);
    const all = [...events, ...contacts].sort((a, b) => new Date(b) - new Date(a));
    return all[0];
  }

  // Separador "Pipeline": todas as oportunidades + resumo do topo (secao
  // "Resumo no topo do Pipeline") + metadados para os filtros/formularios.
  router.get('/api/admin/opportunities', async (req, res) => {
    const db = ensureCollections(await readDb());
    const opportunities = db.opportunities.map(o => ({
      ...o,
      opportunityNumber: opportunityNumber(o),
      health: opportunityHealth(o, { lastEventAt: lastActivityAt(db, o.id) })
    }));

    const active = opportunities.filter(o => o.stage !== 'GANHO' && o.stage !== 'PERDIDO');
    const won = opportunities.filter(o => o.stage === 'GANHO');
    const lost = opportunities.filter(o => o.stage === 'PERDIDO');
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const wonThisMonth = won.filter(o => new Date(o.updatedAt || o.createdAt) >= monthStart);

    const summary = {
      activeCount: active.length,
      pipelineValue: active.reduce((sum, o) => sum + (Number(o.estimatedValue) || 0), 0),
      hotCount: active.filter(o => o.temperature === 'QUENTE').length,
      wonThisMonthValue: wonThisMonth.reduce((sum, o) => sum + (Number(o.estimatedValue) || 0), 0),
      conversionRate: (won.length + lost.length) ? Number(((won.length / (won.length + lost.length)) * 100).toFixed(1)) : 0
    };

    return json(res, 200, {
      ok: true,
      opportunities,
      summary,
      staff: db.staff.filter(s => s.active).map(sanitizeStaff),
      branches: db.branches.filter(b => b.active),
      ...metaPayload()
    });
  }, { admin: true });

  router.get('/api/admin/opportunities/detail', async (req, res, url) => {
    const opportunityId = cleanText(url.searchParams.get('id'), 120);
    const db = ensureCollections(await readDb());
    const opportunity = db.opportunities.find(o => o.id === opportunityId);
    if (!opportunity) return json(res, 404, { ok: false, error: 'Oportunidade não encontrada' });

    const reservation = opportunity.reservationId ? db.reservations.find(r => r.id === opportunity.reservationId) : null;

    return json(res, 200, {
      ok: true,
      opportunity: { ...opportunity, opportunityNumber: opportunityNumber(opportunity), health: opportunityHealth(opportunity, { lastEventAt: lastActivityAt(db, opportunity.id) }) },
      events: db.opportunityEvents.filter(e => e.opportunityId === opportunityId),
      tasks: db.tasks.filter(t => t.opportunityId === opportunityId),
      communications: db.contactLog.filter(c => c.opportunityId === opportunityId),
      proposals: db.proposals.filter(p => p.opportunityId === opportunityId).sort((a, b) => b.version - a.version),
      reservation: reservation ? { ...reservation, processNumber: processNumber(reservation) } : null,
      staff: db.staff.filter(s => s.active).map(sanitizeStaff),
      branches: db.branches.filter(b => b.active),
      ...metaPayload()
    });
  }, { admin: true });

  // Criar/editar (id presente = editar). O campo "stage" so pode ser
  // alterado aqui na criacao - depois disso usa-se sempre /stage, que
  // regista o evento e aplica os automatismos por fase.
  router.post('/api/admin/opportunities', async (req, res) => {
    const body = await parseBody(req);
    const opportunityId = cleanText(body.id, 120);
    const customerName = cleanText(body.customerName, 120);
    if (!customerName) return json(res, 400, { ok: false, error: 'Nome do cliente é obrigatório' });

    // So aplica os campos que vieram mesmo no pedido - a ficha tem varios
    // separadores (Resumo/Cliente/Viagem) e cada formulario submete so os
    // seus proprios campos; se aqui reconstruissemos sempre o objeto
    // completo, guardar um separador apagava o que os outros tinham
    // guardado (ex.: editar o cliente limpava o destino/datas).
    const updates = {};
    if (body.customerName !== undefined) updates.customerName = customerName;
    if (body.customerEmail !== undefined) updates.customerEmail = cleanText(body.customerEmail, 254).toLowerCase();
    if (body.customerPhone !== undefined) updates.customerPhone = cleanText(body.customerPhone, 40);
    if (body.destination !== undefined) updates.destination = cleanText(body.destination, 150);
    if (body.dateStart !== undefined) updates.dateStart = cleanText(body.dateStart, 30);
    if (body.dateEnd !== undefined) updates.dateEnd = cleanText(body.dateEnd, 30);
    if (body.paxAdults !== undefined) updates.paxAdults = numberInRange(body.paxAdults, 'Adultos', 0, 50, 1);
    if (body.paxChildren !== undefined) updates.paxChildren = numberInRange(body.paxChildren, 'Crianças', 0, 50, 0);
    if (body.estimatedValue !== undefined) updates.estimatedValue = body.estimatedValue === '' ? undefined : numberInRange(body.estimatedValue, 'Valor estimado', 0, 10000000, 0);
    if (body.probability !== undefined) updates.probability = body.probability === '' ? undefined : numberInRange(body.probability, 'Probabilidade', 0, 100, 0);
    if (body.origin !== undefined) updates.origin = OPPORTUNITY_ORIGINS.includes(body.origin) ? body.origin : '';
    if (body.temperature !== undefined) updates.temperature = OPPORTUNITY_TEMPERATURES.includes(body.temperature) ? body.temperature : 'MORNO';
    if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? body.tags.filter(t => OPPORTUNITY_TAGS.includes(t)) : [];
    if (body.commercialStaffId !== undefined) updates.commercialStaffId = cleanText(body.commercialStaffId, 120) || undefined;
    if (body.branchId !== undefined) updates.branchId = cleanText(body.branchId, 120) || 'branch-sede';
    if (body.nextActionType !== undefined) updates.nextActionType = NEXT_ACTION_TYPES.includes(body.nextActionType) ? body.nextActionType : '';
    if (body.nextActionDate !== undefined) updates.nextActionDate = cleanText(body.nextActionDate, 30);
    if (body.nextActionNotes !== undefined) updates.nextActionNotes = cleanText(body.nextActionNotes, 1000);
    if (body.notes !== undefined) updates.notes = cleanText(body.notes, 2000);

    let saved = null;
    await updateDb(d => {
      ensureCollections(d);
      let opportunity = d.opportunities.find(o => o.id === opportunityId);
      if (opportunity) {
        Object.assign(opportunity, updates);
        opportunity.updatedAt = now();
        d.opportunityEvents.unshift({ id: id('oppevt'), createdAt: now(), opportunityId: opportunity.id, actor: sessionUser(req), type: 'UPDATED', description: 'Dados da oportunidade atualizados' });
      } else {
        opportunity = {
          id: id('opp'), createdAt: now(), stage: 'NOVO_INTERESSE',
          customerEmail: '', customerPhone: '', destination: '', dateStart: '', dateEnd: '',
          paxAdults: 1, paxChildren: 0, origin: '', temperature: 'MORNO', tags: [],
          nextActionType: '', nextActionDate: '', nextActionNotes: '', notes: '',
          branchId: 'branch-sede',
          ...updates
        };
        d.opportunities.unshift(opportunity);
        d.opportunityEvents.unshift({ id: id('oppevt'), createdAt: now(), opportunityId: opportunity.id, actor: sessionUser(req), type: 'CREATED', description: `Oportunidade criada: ${customerName}` });
      }
      audit(d, sessionUser(req), opportunityId ? 'OPPORTUNITY_UPDATED' : 'OPPORTUNITY_CREATED', { opportunityId: opportunity.id });
      saved = opportunity;
    });
    return json(res, 200, { ok: true, opportunity: saved });
  }, { admin: true });

  // Mover no Pipeline (arrasto entre colunas). PERDIDO exige motivo;
  // PROPOSTA_ENVIADA sugere/agenda um follow-up automatico em 2 dias
  // (secao "Follow-ups automaticos") quando ainda nao houver nenhum agendado.
  router.post('/api/admin/opportunities/stage', async (req, res) => {
    const body = await parseBody(req);
    const opportunityId = cleanText(body.id, 120);
    const stage = OPPORTUNITY_STAGES.includes(body.stage) ? body.stage : null;
    if (!stage) return json(res, 400, { ok: false, error: 'Fase inválida' });
    const lossReason = cleanText(body.lossReason, 30);
    if (stage === 'PERDIDO' && !LOSS_REASONS.includes(lossReason)) {
      return json(res, 400, { ok: false, error: 'Indique o motivo da perda' });
    }

    let saved = null;
    let notFound = false;
    await updateDb(d => {
      ensureCollections(d);
      const opportunity = d.opportunities.find(o => o.id === opportunityId);
      if (!opportunity) { notFound = true; return; }
      const previousStage = opportunity.stage;
      opportunity.stage = stage;
      opportunity.updatedAt = now();

      if (stage === 'PERDIDO') {
        opportunity.lossReason = lossReason;
        opportunity.lossNotes = cleanText(body.lossNotes, 1000);
      }
      if (stage === 'PROPOSTA_ENVIADA' && previousStage !== 'PROPOSTA_ENVIADA' && !opportunity.nextActionDate) {
        opportunity.nextActionType = 'CONFIRMAR_DECISAO';
        opportunity.nextActionDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        opportunity.nextActionNotes = 'Follow-up automático (proposta enviada)';
      }

      d.opportunityEvents.unshift({
        id: id('oppevt'), createdAt: now(), opportunityId, actor: sessionUser(req), type: 'STAGE_CHANGE',
        description: `${opportunityStageLabel(previousStage)} → ${opportunityStageLabel(stage)}${stage === 'PERDIDO' ? ` (${lossReasonLabel(lossReason)})` : ''}`
      });
      audit(d, sessionUser(req), 'OPPORTUNITY_STAGE_CHANGED', { opportunityId, from: previousStage, to: stage });
      saved = opportunity;
    });
    if (notFound) return json(res, 404, { ok: false, error: 'Oportunidade não encontrada' });
    return json(res, 200, { ok: true, opportunity: saved });
  }, { admin: true });

  // GANHO -> processo de viagem (secao "Conversao para processo de
  // viagem"). Copia cliente/destino/datas/passageiros/valor para uma
  // reserva nova, tal como o checkout do site cria - nao pede nada outra
  // vez que ja esteja na oportunidade. operationalStaffId e opcional
  // (secao "Atribuicao operacional ao ganhar").
  router.post('/api/admin/opportunities/convert', async (req, res) => {
    const body = await parseBody(req);
    const opportunityId = cleanText(body.id, 120);
    const operationalStaffId = cleanText(body.operationalStaffId, 120);

    const db = ensureCollections(await readDb());
    const opportunity = db.opportunities.find(o => o.id === opportunityId);
    if (!opportunity) return json(res, 404, { ok: false, error: 'Oportunidade não encontrada' });
    if (opportunity.reservationId) return json(res, 400, { ok: false, error: 'Esta oportunidade já foi convertida num processo' });
    if (!opportunity.customerEmail) return json(res, 400, { ok: false, error: 'A oportunidade precisa de um email de cliente para poder ser convertida' });

    const acceptedProposal = db.proposals.filter(p => p.opportunityId === opportunityId && p.status === 'ACEITE').sort((a, b) => b.version - a.version)[0];
    const finalPrice = acceptedProposal?.saleValue ?? opportunity.estimatedValue ?? 0;
    const costPrice = acceptedProposal?.costValue;

    // O id da reserva reaproveita o sufixo do id da oportunidade, para que
    // processNumber(reservation) (PV-...) e opportunityNumber(opportunity)
    // (OP-...) partilhem o mesmo sufixo e a ligacao fique visivel so pelo
    // numero, sem ter de abrir o processo.
    const opportunitySuffix = String(opportunity.id || '').split('-').pop();
    const reservationId = id('res').replace(/-[^-]+$/, `-${opportunitySuffix}`);

    const reservation = {
      id: reservationId,
      createdAt: now(),
      status: 'PENDING_PAYMENT',
      customer: { name: opportunity.customerName, email: opportunity.customerEmail, phone: opportunity.customerPhone },
      passengers: [],
      offer: {
        destination: opportunity.destination,
        checkin: opportunity.dateStart,
        checkout: opportunity.dateEnd,
        adults: opportunity.paxAdults,
        children: opportunity.paxChildren,
        finalPrice,
        costPrice
      },
      source: 'pipeline',
      notes: `Processo criado a partir da oportunidade comercial ${opportunityNumber(opportunity)}.`,
      commercialStaffId: opportunity.commercialStaffId || undefined,
      operationalStaffId: operationalStaffId || undefined,
      branchId: opportunity.branchId || 'branch-sede',
      origin: opportunity.origin || undefined
    };

    await updateDb(d => {
      ensureCollections(d);
      d.reservations.unshift(reservation);
      let existingCustomer = d.customers.find(c => c.email === opportunity.customerEmail);
      if (!existingCustomer) {
        d.customers.unshift({ id: id('cli'), createdAt: now(), name: opportunity.customerName, email: opportunity.customerEmail, phone: opportunity.customerPhone });
      }
      const opp = d.opportunities.find(o => o.id === opportunityId);
      opp.stage = 'GANHO';
      opp.reservationId = reservation.id;
      opp.updatedAt = now();
      d.opportunityEvents.unshift({ id: id('oppevt'), createdAt: now(), opportunityId, actor: sessionUser(req), type: 'CONVERTED', description: `Convertida em processo ${processNumber(reservation)}` });
      audit(d, sessionUser(req), 'OPPORTUNITY_CONVERTED', { opportunityId, reservationId: reservation.id });
    });

    return json(res, 200, { ok: true, reservation: { ...reservation, processNumber: processNumber(reservation) }, opportunityId });
  }, { admin: true });

  // Propostas de uma oportunidade (id presente = editar; senao cria uma
  // nova versao, numerada a seguir a ultima ja existente).
  // Vista "Propostas" (lista global, todas as oportunidades) - cada
  // proposta ja vem com um resumo da oportunidade a que pertence, para a
  // lista nao precisar de ir buscar isso opportunity a opportunity.
  router.get('/api/admin/proposals', async (req, res) => {
    const db = ensureCollections(await readDb());
    const opportunitiesById = new Map(db.opportunities.map(o => [o.id, o]));
    const proposals = db.proposals.map(p => {
      const opportunity = opportunitiesById.get(p.opportunityId);
      return {
        ...p,
        opportunityCustomerName: opportunity?.customerName,
        opportunityDestination: opportunity?.destination,
        opportunityStage: opportunity?.stage,
        opportunityNumber: opportunity ? opportunityNumber(opportunity) : undefined
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json(res, 200, { ok: true, proposals, ...metaPayload() });
  }, { admin: true });

  router.post('/api/admin/proposals', async (req, res) => {
    const body = await parseBody(req);
    const proposalId = cleanText(body.id, 120);
    const opportunityId = cleanText(body.opportunityId, 120);
    if (!opportunityId) return json(res, 400, { ok: false, error: 'Oportunidade obrigatória' });
    const status = PROPOSAL_STATUSES.includes(body.status) ? body.status : 'RASCUNHO';

    const db = ensureCollections(await readDb());
    const opportunity = db.opportunities.find(o => o.id === opportunityId);
    if (!opportunity) return json(res, 404, { ok: false, error: 'Oportunidade não encontrada' });

    const updates = {
      status,
      services: cleanText(body.services, 4000),
      costValue: body.costValue !== undefined && body.costValue !== '' ? numberInRange(body.costValue, 'Custo', 0, 10000000, 0) : undefined,
      saleValue: body.saleValue !== undefined && body.saleValue !== '' ? numberInRange(body.saleValue, 'Venda', 0, 10000000, 0) : undefined,
      notes: cleanText(body.notes, 2000)
    };

    let saved = null;
    await updateDb(d => {
      ensureCollections(d);
      let proposal = d.proposals.find(p => p.id === proposalId);
      if (proposal) {
        Object.assign(proposal, updates);
        proposal.updatedAt = now();
      } else {
        const version = d.proposals.filter(p => p.opportunityId === opportunityId).length + 1;
        proposal = { id: id('prop'), createdAt: now(), opportunityId, version, ...updates };
        d.proposals.unshift(proposal);
      }
      d.opportunityEvents.unshift({ id: id('oppevt'), createdAt: now(), opportunityId, actor: sessionUser(req), type: proposalId ? 'PROPOSAL_UPDATED' : 'PROPOSAL_CREATED', description: `Proposta V${proposal.version} (${proposalStatusLabel(status)})` });
      audit(d, sessionUser(req), proposalId ? 'PROPOSAL_UPDATED' : 'PROPOSAL_CREATED', { opportunityId, proposalId: proposal.id });
      saved = proposal;
    });
    return json(res, 200, { ok: true, proposal: saved });
  }, { admin: true });
};
