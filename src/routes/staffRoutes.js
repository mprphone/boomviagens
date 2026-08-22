// Sessao do backoffice (login/logout/quem-esta-autenticado) e gestao da
// Equipa (separador "Equipa"). Substitui o antigo login unico por
// variaveis de ambiente por um login real por colaborador (tabela
// public.staff), com perfil (COMERCIAL/OPERACIONAL/FINANCEIRO/SUPERVISOR/
// ADMIN) - ver domain.js#STAFF_ROLES.
//
// Arranque sem perder acesso: enquanto a tabela staff estiver vazia, um
// login com as credenciais de ADMIN_USERNAME/ADMIN_PASSWORD (as mesmas de
// sempre) cria automaticamente o primeiro colaborador, com role ADMIN.
// Nao precisa de nenhum script manual nem de correr SQL a mao.

module.exports = function registerStaffRoutes(router, ctx) {
  const { json, parseBody, readDb, updateDb, cleanText, domain } = ctx;
  const { ensureCollections, audit, id, now, STAFF_ROLES, EMPLOYMENT_TYPES, sanitizeStaff, staffRoleLabel, employmentTypeLabel } = domain;
  const { sessionUser, sessionStaff, signToken, safeEqual, hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, rateLimit, SESSION_TTL_MS } = ctx.auth;

  router.get('/api/admin/session', async (req, res) => {
    const user = sessionUser(req);
    const staff = sessionStaff(req);
    return json(res, 200, { ok: true, authenticated: Boolean(user), user, staff });
  });

  router.post('/api/admin/login', async (req, res) => {
    // 30/15min (nao 10) porque este limite e partilhado por IP - em
    // desenvolvimento local, testes automaticos e o login real do
    // utilizador vem todos do mesmo localhost e esgotavam a quota um do
    // outro.
    const limited = await rateLimit(req, res, 'admin-login', 30, 15 * 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const username = cleanText(body.username, 60);
    const password = String(body.password || '');

    const db = ensureCollections(await readDb());
    let staffMember = db.staff.find(s => s.username === username && s.active);

    // Arranque: tabela staff vazia + credenciais batem com as variaveis de
    // ambiente historicas -> cria o primeiro colaborador (ADMIN) nesse
    // login, para nao perder o acesso ja existente.
    if (!staffMember && db.staff.length === 0) {
      const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
      const envUser = process.env.ADMIN_USERNAME || (isProd ? '' : 'admin');
      const envPassword = process.env.ADMIN_PASSWORD || (isProd ? '' : 'admin123');
      if (!envUser || !envPassword) return json(res, 503, { ok: false, error: 'Credenciais de bootstrap ADMIN nao configuradas no ambiente de producao.' });
      if (safeEqual(username, envUser) && safeEqual(password, envPassword)) {
        staffMember = {
          id: id('staff'), createdAt: now(), name: 'Administrador', email: '',
          username: envUser, passwordHash: hashPassword(envPassword), role: 'ADMIN', color: '', active: true,
          branchId: 'branch-sede', employmentType: 'INTERNO'
        };
        await updateDb(d => {
          ensureCollections(d);
          d.staff.push(staffMember);
          audit(d, envUser, 'STAFF_BOOTSTRAPPED', { staffId: staffMember.id });
        });
      }
    }

    if (!staffMember || !verifyPassword(password, staffMember.passwordHash)) {
      return json(res, 401, { ok: false, error: 'Credenciais inválidas' });
    }

    const token = signToken({ scope: 'admin', user: staffMember.username, staffId: staffMember.id, role: staffMember.role, exp: Date.now() + SESSION_TTL_MS });
    setSessionCookie(res, token);
    return json(res, 200, { ok: true, user: staffMember.username, staff: { id: staffMember.id, username: staffMember.username, name: staffMember.name, role: staffMember.role } });
  });

  router.post('/api/admin/logout', async (req, res) => {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  });

  // Separador "Equipa". Lista visivel a qualquer colaborador autenticado
  // (usada para preencher os varios seletores de "Responsavel"); criar/
  // editar fica reservado a quem gere a equipa.
  router.get('/api/admin/staff', async (req, res) => {
    const db = ensureCollections(await readDb());
    return json(res, 200, {
      ok: true,
      staff: db.staff.map(sanitizeStaff),
      roles: STAFF_ROLES.map(value => ({ value, label: staffRoleLabel(value) })),
      employmentTypes: EMPLOYMENT_TYPES.map(value => ({ value, label: employmentTypeLabel(value) })),
      branches: db.branches.filter(b => b.active)
    });
  }, { admin: true });

  router.get('/api/admin/staff/detail', async (req, res, url) => {
    const staffId = cleanText(url.searchParams.get('id'), 120);
    const db = ensureCollections(await readDb());
    const staffMember = db.staff.find(s => s.id === staffId);
    if (!staffMember) return json(res, 404, { ok: false, error: 'Colaborador não encontrado' });
    return json(res, 200, { ok: true, staff: sanitizeStaff(staffMember) });
  }, { admin: true });

  router.post('/api/admin/staff', async (req, res) => {
    const body = await parseBody(req);
    const staffId = cleanText(body.id, 120);
    const username = cleanText(body.username, 60).toLowerCase();
    const name = cleanText(body.name, 120);
    if (!username || !name) return json(res, 400, { ok: false, error: 'Nome e utilizador são obrigatórios' });
    const role = STAFF_ROLES.includes(body.role) ? body.role : 'COMERCIAL';
    const password = String(body.password || '');

    const db = ensureCollections(await readDb());
    const existing = db.staff.find(s => s.id === staffId);
    const usernameTaken = db.staff.find(s => s.username === username && s.id !== staffId);
    if (usernameTaken) return json(res, 400, { ok: false, error: 'Já existe um colaborador com esse utilizador' });
    if (!existing && !password) return json(res, 400, { ok: false, error: 'Defina uma password para o novo colaborador' });

    let saved = null;
    await updateDb(d => {
      ensureCollections(d);
      let staffMember = d.staff.find(s => s.id === staffId);
      const updates = {
        name, username, role,
        email: cleanText(body.email, 254),
        color: cleanText(body.color, 20),
        active: body.active !== false,
        employmentType: EMPLOYMENT_TYPES.includes(body.employmentType) ? body.employmentType : 'INTERNO',
        branchId: cleanText(body.branchId, 120) || undefined
      };
      if (password) updates.passwordHash = hashPassword(password);
      if (staffMember) {
        Object.assign(staffMember, updates);
        staffMember.updatedAt = now();
      } else {
        staffMember = { id: id('staff'), createdAt: now(), ...updates };
        d.staff.push(staffMember);
      }
      audit(d, sessionUser(req), staffId ? 'STAFF_UPDATED' : 'STAFF_CREATED', { staffId: staffMember.id });
      saved = staffMember;
    });
    return json(res, 200, { ok: true, staff: sanitizeStaff(saved) });
  }, { admin: true, roles: ['SUPERVISOR', 'ADMIN'] });
};
