// Router minimo: todas as rotas desta API sao caminhos exatos (sem
// parametros tipo /reservas/:id), por isso nao precisa de mais do que
// comparar metodo+pathname. `admin: true` marca rotas que exigem sessao de
// administrador - o dispatcher central (server.js) faz essa verificacao
// antes de chamar o handler, para nao repetir a mesma linha em cada rota.

function createRouter() {
  const routes = [];

  function register(method, pathname, handler, opts = {}) {
    routes.push({ method, pathname, handler, admin: Boolean(opts.admin) });
  }

  return {
    get(pathname, handler, opts) { register('GET', pathname, handler, opts); },
    post(pathname, handler, opts) { register('POST', pathname, handler, opts); },
    find(method, pathname) { return routes.find(r => r.method === method && r.pathname === pathname); }
  };
}

module.exports = { createRouter };
