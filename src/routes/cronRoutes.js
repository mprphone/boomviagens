// Rotas chamadas so pelo Vercel Cron (nunca por um cliente/staff) - a Vercel
// autentica-se sozinha enviando "Authorization: Bearer $CRON_SECRET" quando
// essa variavel de ambiente esta definida no projeto. Sem ela, a rota
// recusa tudo (fail closed), nunca corre a purga por engano.

const PRUNE_TABLES = ['operator_logs', 'audit_logs', 'contact_log', 'reservation_events'];
const RETENTION_MONTHS = 12;
// Lembrete de documentacao: so faz sentido chatear o cliente passados
// alguns dias a espera, e nunca mais do que uma vez por janela (o registo
// do lembrete fica em reservation_events, tipo DOCUMENT_REMINDER_SENT).
const REMINDER_STALE_MS = 3 * 24 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

module.exports = function registerCronRoutes(router, ctx) {
  const { json, storage, domain } = ctx;
  const { audit, ensureCollections, missingDocumentsFor, id, now } = domain;

  function isAuthorizedCron(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    return req.headers.authorization === `Bearer ${secret}`;
  }

  router.get('/api/cron/prune-logs', async (req, res, url) => {
    if (!isAuthorizedCron(req)) return json(res, 401, { ok: false, error: 'Nao autorizado' });
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const cutoff = new Date(Date.now() - RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000).toISOString();
    const results = [];
    for (const table of PRUNE_TABLES) {
      results.push(await storage.pruneOldRows(table, cutoff, { dryRun }));
    }
    if (!dryRun) {
      await ctx.updateDb(d => {
        ensureCollections(d);
        audit(d, 'system', 'LOGS_PRUNED', { cutoff, results });
      });
    }
    return json(res, 200, { ok: true, dryRun, cutoff, retentionMonths: RETENTION_MONTHS, results });
  });

  router.get('/api/cron/document-reminders', async (req, res) => {
    if (!isAuthorizedCron(req)) return json(res, 401, { ok: false, error: 'Nao autorizado' });
    const { readDb, updateDb, mailer, documentRequestEmail } = ctx;
    const db = ensureCollections(await readDb());
    const nowMs = Date.now();

    // Ultimo lembrete por reserva (os eventos estao em ordem inversa de
    // criacao - unshift - por isso o primeiro encontrado e o mais recente).
    const lastReminderAt = new Map();
    for (const event of db.reservationEvents) {
      if (event.type !== 'DOCUMENT_REMINDER_SENT') continue;
      if (!lastReminderAt.has(event.reservationId)) lastReminderAt.set(event.reservationId, new Date(event.createdAt).getTime());
    }

    const candidates = db.reservations.filter(r => {
      if (r.status !== 'AWAITING_DOCUMENTS') return false;
      const since = new Date(r.awaitingDocumentsSince || r.updatedAt || r.createdAt || 0).getTime();
      if (!since || nowMs - since < REMINDER_STALE_MS) return false;
      const remindedAt = lastReminderAt.get(r.id);
      if (remindedAt && nowMs - remindedAt < REMINDER_COOLDOWN_MS) return false;
      return true;
    });

    let sent = 0;
    let skipped = db.reservations.filter(r => r.status === 'AWAITING_DOCUMENTS').length - candidates.length;
    const delivered = [];
    for (const reservation of candidates) {
      const to = reservation.customer?.email;
      const missing = missingDocumentsFor(reservation, db.documents);
      // Sem destinatario ou sem nada em falta nao ha lembrete util a enviar.
      if (!to || !missing.length) { skipped += 1; continue; }
      const email = documentRequestEmail({ reservation, missingDocuments: missing, reminder: true });
      try {
        await mailer.sendMail({ to, subject: email.subject, body: email.body });
        delivered.push({ reservation, email, to });
        sent += 1;
      } catch (err) {
        // Falha de envio nao grava lembrete - assim o proximo cron volta a
        // tentar em vez de o cliente ficar esquecido ate ao fim do cooldown.
        skipped += 1;
        await updateDb(d => {
          ensureCollections(d);
          d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: reservation.id, actor: 'sistema', type: 'EMAIL_SEND_FAILED', description: err.message });
        });
      }
    }

    if (delivered.length) {
      await updateDb(d => {
        ensureCollections(d);
        for (const { reservation, email, to } of delivered) {
          d.emails.unshift({ id: id('email'), createdAt: now(), to, status: mailer.isConfigured() ? 'ENVIADO' : 'GERADO_DEMO', ...email });
          d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: reservation.id, actor: 'sistema', type: 'DOCUMENT_REMINDER_SENT', description: `Lembrete de documentação enviado para ${to}` });
        }
        audit(d, 'system', 'DOCUMENT_REMINDERS_SENT', { sent });
      });
    }
    return json(res, 200, { ok: true, sent, skipped });
  });
};
