// Rotas chamadas so pelo Vercel Cron (nunca por um cliente/staff) - a Vercel
// autentica-se sozinha enviando "Authorization: Bearer $CRON_SECRET" quando
// essa variavel de ambiente esta definida no projeto. Sem ela, a rota
// recusa tudo (fail closed), nunca corre a purga por engano.

const PRUNE_TABLES = ['operator_logs', 'audit_logs', 'contact_log', 'reservation_events'];
const RETENTION_MONTHS = 12;

module.exports = function registerCronRoutes(router, ctx) {
  const { json, storage, domain } = ctx;
  const { audit, ensureCollections } = domain;

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
};
