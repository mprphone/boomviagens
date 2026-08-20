// Gestao de equipa (separadores "O Meu Dia"/"Visão Geral"/"Tarefas"/
// "Agenda") - leituras/agregacoes sobre tabelas ja existentes (staff,
// opportunities, reservations, tasks, complaints, proposals). Nenhuma
// tabela nova nesta rota - so calculo, nada e guardado aqui.

const OPEN_COMPLAINT_STATUSES_EXCLUDED = ['RESOLVED', 'CLOSED'];
const OPEN_TASK_STATUSES_EXCLUDED = ['DONE', 'CANCELLED'];
const INACTIVE_RESERVATION_STATUSES = ['CONCLUDED', 'CANCELLED'];
const CLOSED_OPPORTUNITY_STAGES = ['GANHO', 'PERDIDO'];
const UPCOMING_TRIP_DAYS = 14;

module.exports = function registerTeamRoutes(router, ctx) {
  const { json, cleanText, readDb, domain } = ctx;
  const { ensureCollections, sanitizeStaff, missingDocumentsFor, processNumber, opportunityStageLabel, taskStatusLabel, taskPriorityLabel } = domain;

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function checkinWithinDays(reservation, days) {
    const checkin = reservation.offer?.checkin;
    if (!checkin) return false;
    const diffDays = (new Date(`${checkin}T00:00:00`) - new Date()) / (24 * 60 * 60 * 1000);
    return diffDays >= 0 && diffDays <= days;
  }

  // Carga de trabalho (secao "Carga de trabalho") - um score simples a
  // partir de sinais que ja existem (nao pede nenhuma classificacao manual
  // de complexidade de processo). Pesos documentados aqui: tarefas
  // atrasadas e reclamacoes abertas pesam mais porque representam atrito
  // real com o cliente, nao so volume de trabalho.
  function workloadColor(score) {
    if (score <= 3) return 'green';
    if (score <= 7) return 'yellow';
    return 'red';
  }

  function groupBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  router.get('/api/admin/team/overview', async (req, res) => {
    const db = ensureCollections(await readDb());
    const today = todayStr();

    // Agrupar uma so vez por colaborador em vez de um .filter() sobre cada
    // tabela dentro do map() de staff - O(staff x (opportunities+
    // reservations+tasks+complaints+proposals)) vira O(mesma soma), com o
    // mesmo resultado (ver auditoria de escala).
    const opportunitiesByStaff = groupBy(db.opportunities, o => o.commercialStaffId);
    const reservationsByStaff = groupBy(db.reservations, r => r.operationalStaffId);
    const tasksByStaff = groupBy(db.tasks, t => t.assigneeStaffId);
    const staffIdByReservationId = new Map(db.reservations.map(r => [r.id, r.operationalStaffId]));
    const complaintsByStaff = groupBy(db.complaints, c => staffIdByReservationId.get(c.reservationId));
    const staffIdByOpportunityId = new Map(db.opportunities.map(o => [o.id, o.commercialStaffId]));
    const proposalsByStaff = groupBy(db.proposals, p => staffIdByOpportunityId.get(p.opportunityId));

    const overview = db.staff.filter(s => s.active).map(staff => {
      const myOpportunities = opportunitiesByStaff.get(staff.id) || [];
      const openOpportunities = myOpportunities.filter(o => !CLOSED_OPPORTUNITY_STAGES.includes(o.stage));
      const wonOpportunities = myOpportunities.filter(o => o.stage === 'GANHO');
      const lostOpportunities = myOpportunities.filter(o => o.stage === 'PERDIDO');

      const myReservations = reservationsByStaff.get(staff.id) || [];
      const activeReservations = myReservations.filter(r => !INACTIVE_RESERVATION_STATUSES.includes(r.status));
      const upcomingTrips = activeReservations.filter(r => checkinWithinDays(r, UPCOMING_TRIP_DAYS));

      const followUpsToday = openOpportunities.filter(o => o.nextActionDate === today);
      const overdueTasks = (tasksByStaff.get(staff.id) || []).filter(t => !OPEN_TASK_STATUSES_EXCLUDED.includes(t.status) && t.dueDate && t.dueDate < today);

      const openComplaints = (complaintsByStaff.get(staff.id) || []).filter(c => !OPEN_COMPLAINT_STATUSES_EXCLUDED.includes(c.status));

      const proposalsSent = (proposalsByStaff.get(staff.id) || []).filter(p => p.status !== 'RASCUNHO').length;
      const wonValue = wonOpportunities.reduce((sum, o) => sum + (Number(o.estimatedValue) || 0), 0);
      const conversionRate = (wonOpportunities.length + lostOpportunities.length)
        ? Number(((wonOpportunities.length / (wonOpportunities.length + lostOpportunities.length)) * 100).toFixed(1))
        : 0;

      const score = openOpportunities.length + activeReservations.length + overdueTasks.length * 2 + openComplaints.length * 2;

      return {
        staff: sanitizeStaff(staff),
        openOpportunities: openOpportunities.length,
        activeReservations: activeReservations.length,
        followUpsToday: followUpsToday.length,
        overdueTasks: overdueTasks.length,
        upcomingTrips: upcomingTrips.length,
        openComplaints: openComplaints.length,
        proposalsSent,
        wonCount: wonOpportunities.length,
        lostCount: lostOpportunities.length,
        wonValue,
        conversionRate,
        workload: { score, color: workloadColor(score) }
      };
    });

    return json(res, 200, { ok: true, overview });
  }, { admin: true });

  router.get('/api/admin/team/my-day', async (req, res, url) => {
    const staffId = cleanText(url.searchParams.get('staffId'), 120);
    const db = ensureCollections(await readDb());
    const staff = db.staff.find(s => s.id === staffId);
    if (!staff) return json(res, 404, { ok: false, error: 'Colaborador não encontrado' });
    const today = todayStr();

    const followUpsToday = db.opportunities
      .filter(o => o.commercialStaffId === staffId && !CLOSED_OPPORTUNITY_STAGES.includes(o.stage) && o.nextActionDate === today)
      .map(o => ({ id: o.id, customerName: o.customerName, nextActionType: o.nextActionType, nextActionNotes: o.nextActionNotes }));

    const tasks = db.tasks
      .filter(t => t.assigneeStaffId === staffId && !OPEN_TASK_STATUSES_EXCLUDED.includes(t.status))
      .map(t => ({ ...t, overdue: Boolean(t.dueDate && t.dueDate < today) }))
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    const myReservations = db.reservations.filter(r => r.operationalStaffId === staffId && !INACTIVE_RESERVATION_STATUSES.includes(r.status));
    const missingDocs = myReservations
      .map(r => ({ reservationId: r.id, processNumber: processNumber(r), customerName: r.customer?.name, missing: missingDocumentsFor(r, db.documents) }))
      .filter(x => x.missing.length);

    const upcomingTrips = myReservations
      .filter(r => checkinWithinDays(r, UPCOMING_TRIP_DAYS))
      .map(r => ({ reservationId: r.id, processNumber: processNumber(r), customerName: r.customer?.name, checkin: r.offer?.checkin, destination: r.offer?.destination }))
      .sort((a, b) => (a.checkin || '').localeCompare(b.checkin || ''));

    const myReservationIds = new Set(myReservations.map(r => r.id));
    const openComplaints = db.complaints
      .filter(c => myReservationIds.has(c.reservationId) && !OPEN_COMPLAINT_STATUSES_EXCLUDED.includes(c.status))
      .map(c => ({ ...c, processNumber: processNumber(db.reservations.find(r => r.id === c.reservationId) || {}) }));

    return json(res, 200, { ok: true, staff: sanitizeStaff(staff), followUpsToday, tasks, missingDocs, upcomingTrips, openComplaints });
  }, { admin: true });

  // Separador "Tarefas" da equipa: todas as tarefas (de reservas e de
  // oportunidades), cada uma ja com o contexto (processo/oportunidade) a
  // que pertence, para nao ter de ir consultar cada uma a parte.
  router.get('/api/admin/team/tasks', async (req, res, url) => {
    const staffId = cleanText(url.searchParams.get('staffId'), 120);
    const onlyOverdue = url.searchParams.get('overdue') === 'true';
    const db = ensureCollections(await readDb());
    const today = todayStr();

    const reservationsById = new Map(db.reservations.map(r => [r.id, r]));
    const opportunitiesById = new Map(db.opportunities.map(o => [o.id, o]));

    let tasks = db.tasks.map(t => {
      const reservation = t.reservationId ? reservationsById.get(t.reservationId) : null;
      const opportunity = t.opportunityId ? opportunitiesById.get(t.opportunityId) : null;
      return {
        ...t,
        overdue: Boolean(t.dueDate && t.dueDate < today && !OPEN_TASK_STATUSES_EXCLUDED.includes(t.status)),
        contextLabel: reservation ? `Processo ${processNumber(reservation)}` : opportunity ? `Oportunidade: ${opportunity.customerName}` : '—',
        contextReservationId: reservation?.id,
        contextOpportunityId: opportunity?.id
      };
    });

    if (staffId) tasks = tasks.filter(t => t.assigneeStaffId === staffId);
    if (onlyOverdue) tasks = tasks.filter(t => t.overdue);
    tasks.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    return json(res, 200, {
      ok: true,
      tasks,
      staff: db.staff.filter(s => s.active).map(sanitizeStaff),
      taskStatuses: ['TODO', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_SUPPLIER', 'DONE', 'CANCELLED'].map(value => ({ value, label: taskStatusLabel(value) })),
      taskPriorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(value => ({ value, label: taskPriorityLabel(value) }))
    });
  }, { admin: true });

  // Separador "Agenda": tarefas + proximas acoes de oportunidades, juntas
  // numa so lista ordenada por data - o frontend agrupa em Atrasadas/
  // Hoje/Proximas (mesmo padrao ja usado em followups.js).
  router.get('/api/admin/team/agenda', async (req, res, url) => {
    const staffId = cleanText(url.searchParams.get('staffId'), 120);
    const db = ensureCollections(await readDb());
    const reservationsById = new Map(db.reservations.map(r => [r.id, r]));

    let taskItems = db.tasks
      .filter(t => t.dueDate && !OPEN_TASK_STATUSES_EXCLUDED.includes(t.status))
      .map(t => ({
        type: 'TASK', date: t.dueDate, staffId: t.assigneeStaffId, title: t.description,
        context: t.reservationId ? `Processo ${processNumber(reservationsById.get(t.reservationId) || {})}` : '',
        priority: t.priority
      }));

    let followUpItems = db.opportunities
      .filter(o => o.nextActionDate && !CLOSED_OPPORTUNITY_STAGES.includes(o.stage))
      .map(o => ({
        type: 'FOLLOW_UP', date: o.nextActionDate, staffId: o.commercialStaffId, title: `${o.customerName} · ${opportunityStageLabel(o.stage)}`,
        context: o.nextActionNotes || '', opportunityId: o.id
      }));

    let items = [...taskItems, ...followUpItems];
    if (staffId) items = items.filter(i => i.staffId === staffId);
    items.sort((a, b) => a.date.localeCompare(b.date));

    return json(res, 200, { ok: true, items, staff: db.staff.filter(s => s.active).map(sanitizeStaff) });
  }, { admin: true });
};
