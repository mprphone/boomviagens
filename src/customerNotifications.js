// Notificacoes proativas ao cliente, corridas uma vez por dia via
// GET /api/cron/customer-notifications (ver src/routes/cronRoutes.js e
// vercel.json):
//   a) lembrete de pagamento pendente - reserva PENDING_PAYMENT ha >24h
//      com um pagamento ainda por concluir (uma unica vez por reserva);
//   b) alerta de viagem proxima - reserva CONFIRMED com check-in dentro
//      de 7 dias (uma unica vez por reserva).
// O "uma unica vez" garante-se com um evento em reservation_events por
// envio (PAYMENT_REMINDER_SENT / TRIP_REMINDER_SENT), mesmo padrao do
// DOCUMENT_REMINDER_SENT do cron de documentos - assim sobrevive a
// multiplas instancias serverless e a restarts.
//
// Agendamento num VPS (fora da Vercel nao ha "crons" da plataforma):
//   0 8 * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" https://dominio/api/cron/customer-notifications
//
// Envio: mailer.sendMail e assincrono e nunca corre dentro do mutator
// sincrono do updateDb (ver storage.js) - envia-se primeiro, e so o que
// foi mesmo entregue ao mailer fica registado em db.emails + evento. Uma
// falha de envio regista EMAIL_SEND_FAILED e deixa a reserva elegivel
// para nova tentativa na corrida seguinte.

const PAYMENT_REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;
const TRIP_ALERT_DAYS = 7;

// Link para a Area de Cliente. Sem PUBLIC_BASE_URL configurado fica o
// caminho relativo - suficiente em modo mock/dev, em producao a variavel
// ja e obrigatoria para os pagamentos (ver checkoutRoutes.js).
function accountUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim().replace(/\/$/, '');
  return base ? `${base}/conta/` : '/conta/';
}

module.exports = function createCustomerNotifications(ctx) {
  const { readDb, updateDb, mailer, paymentReminderEmail, tripReminderEmail, domain } = ctx;
  const { ensureCollections, audit, id, now } = domain;

  // Envia uma lista de notificacoes e grava o que foi entregue. `type` e o
  // evento que marca a reserva como notificada (uma vez por reserva).
  async function deliver(notifications, type, auditAction) {
    const delivered = [];
    let failed = 0;
    for (const item of notifications) {
      try {
        await mailer.sendMail({ to: item.to, subject: item.email.subject, body: item.email.body });
        delivered.push(item);
      } catch (err) {
        failed += 1;
        await updateDb(d => {
          ensureCollections(d);
          d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: item.reservation.id, actor: 'sistema', type: 'EMAIL_SEND_FAILED', description: err.message });
        });
      }
    }
    if (delivered.length) {
      await updateDb(d => {
        ensureCollections(d);
        for (const { reservation, email, to } of delivered) {
          d.emails.unshift({ id: id('email'), createdAt: now(), to, status: mailer.isConfigured() ? 'ENVIADO' : 'GERADO_DEMO', ...email });
          d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: reservation.id, actor: 'sistema', type, description: `${email.subject} -> ${to}` });
        }
        audit(d, 'system', auditAction, { sent: delivered.length, failed });
      });
    }
    return { sent: delivered.length, failed };
  }

  function reservationsAlreadyNotified(db, type) {
    return new Set(db.reservationEvents.filter(event => event.type === type).map(event => event.reservationId));
  }

  async function sendPendingPaymentReminders() {
    const db = ensureCollections(await readDb());
    const nowMs = Date.now();
    const reminded = reservationsAlreadyNotified(db, 'PAYMENT_REMINDER_SENT');
    const candidates = db.reservations.filter(reservation => {
      if (reservation.status !== 'PENDING_PAYMENT') return false;
      if (reminded.has(reservation.id)) return false;
      const since = new Date(reservation.createdAt || 0).getTime();
      if (!since || nowMs - since < PAYMENT_REMINDER_AFTER_MS) return false;
      return db.payments.some(payment => payment.reservationId === reservation.id && payment.status === 'PENDING');
    });

    const notifications = [];
    let skipped = 0;
    for (const reservation of candidates) {
      const to = reservation.customer?.email;
      if (!to) { skipped += 1; continue; }
      const payment = db.payments.find(p => p.reservationId === reservation.id && p.status === 'PENDING');
      notifications.push({ reservation, to, email: paymentReminderEmail({ reservation, payment, accountUrl: accountUrl() }) });
    }
    const result = await deliver(notifications, 'PAYMENT_REMINDER_SENT', 'PAYMENT_REMINDERS_SENT');
    return { ...result, skipped, eligible: candidates.length };
  }

  async function sendUpcomingTripAlerts() {
    const db = ensureCollections(await readDb());
    const alerted = reservationsAlreadyNotified(db, 'TRIP_REMINDER_SENT');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today.getTime() + TRIP_ALERT_DAYS * 24 * 60 * 60 * 1000);
    const candidates = db.reservations.filter(reservation => {
      if (reservation.status !== 'CONFIRMED') return false;
      if (alerted.has(reservation.id)) return false;
      if (!reservation.offer?.checkin) return false;
      const checkin = new Date(`${reservation.offer.checkin}T00:00:00`);
      if (Number.isNaN(checkin.getTime())) return false;
      return checkin >= today && checkin <= limit;
    });

    const notifications = [];
    let skipped = 0;
    for (const reservation of candidates) {
      const to = reservation.customer?.email;
      if (!to) { skipped += 1; continue; }
      notifications.push({ reservation, to, email: tripReminderEmail({ reservation, accountUrl: accountUrl() }) });
    }
    const result = await deliver(notifications, 'TRIP_REMINDER_SENT', 'TRIP_REMINDERS_SENT');
    return { ...result, skipped, eligible: candidates.length };
  }

  return { sendPendingPaymentReminders, sendUpcomingTripAlerts };
};
