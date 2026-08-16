// Agencias/balcoes (separador "Agências", em Sistema) - CRUD proprio e
// simples, sem nomes fixos no codigo (ver auditoria: a lista de agencias
// vai crescer). Mesmo padrao de /api/admin/margins. Sem DELETE real -
// "apagar" e so active:false, tal como as outras listas administraveis
// deste projeto (margens, fornecedores).

module.exports = function registerBranchesRoutes(router, ctx) {
  const { json, parseBody, readDb, updateDb, cleanText, domain } = ctx;
  const { ensureCollections, audit, id, now } = domain;
  const { sessionUser } = ctx.auth;

  router.get('/api/admin/branches', async (req, res) => {
    const db = ensureCollections(await readDb());
    return json(res, 200, { ok: true, branches: db.branches });
  }, { admin: true });

  router.post('/api/admin/branches', async (req, res) => {
    const body = await parseBody(req);
    const name = cleanText(body.name, 120);
    if (!name) return json(res, 400, { ok: false, error: 'Nome da agência é obrigatório' });
    const branchId = cleanText(body.id, 120);

    let saved = null;
    await updateDb(d => {
      ensureCollections(d);
      let branch = d.branches.find(b => b.id === branchId);
      if (branch) {
        branch.name = name;
        branch.code = cleanText(body.code, 20);
        branch.active = body.active !== false;
        branch.updatedAt = now();
      } else {
        branch = { id: id('branch'), createdAt: now(), name, code: cleanText(body.code, 20), active: true };
        d.branches.unshift(branch);
      }
      audit(d, sessionUser(req), branchId ? 'BRANCH_UPDATED' : 'BRANCH_CREATED', { branchId: branch.id });
      saved = branch;
    });
    return json(res, 200, { ok: true, branch: saved });
  }, { admin: true, roles: ['SUPERVISOR', 'ADMIN'] });
};
