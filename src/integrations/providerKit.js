// Kit minimo para integrar novos fornecedores externos sem copiar/colar:
// declara-se o contrato uma vez (id, tipo, variaveis de ambiente, timeouts)
// e ficam gratis a config resolvida, isConfigured()/missingEnv(), o cliente
// lazy e a listagem unificada no backoffice (GET /api/admin/integrations).
// Guia completo em docs/INTEGRACOES.md.
const { fetchJson } = require('./httpClient');

const PROVIDER_KINDS = new Set(['operator', 'payment', 'enrichment', 'invoicing', 'email', 'other']);

// http partilhado passado ao create(config, http) - o mesmo helper usado
// pelos clientes recentes (timeout, erros saneados sem credenciais).
const sharedHttp = { fetchJson };

function defineProvider(def = {}) {
  const id = String(def.id || '').trim();
  if (!id) throw new Error('defineProvider: "id" é obrigatório.');
  if (def.create !== undefined && typeof def.create !== 'function') {
    throw new Error(`defineProvider("${id}"): "create" tem de ser uma função (config, http) => cliente.`);
  }
  if (def.healthCheck !== undefined && typeof def.healthCheck !== 'function') {
    throw new Error(`defineProvider("${id}"): "healthCheck" tem de ser uma função (cliente) => resultado.`);
  }

  const envPrefix = String(def.envPrefix || id).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const requiredEnv = (Array.isArray(def.requiredEnv) ? def.requiredEnv : []).map(String);
  const optionalEnv = (Array.isArray(def.optionalEnv) ? def.optionalEnv : []).map(String);
  // env injetavel para testes; por omissao le process.env em cada chamada,
  // para o estado do backoffice refletir sempre o processo atual.
  const envSource = () => def.env || process.env;

  let cachedClient;

  const provider = {
    id,
    label: String(def.label || id).trim(),
    kind: PROVIDER_KINDS.has(def.kind) ? def.kind : 'other',
    envPrefix,
    requiredEnv,
    optionalEnv,

    config() {
      const env = envSource();
      const cfg = {};
      for (const name of [...requiredEnv, ...optionalEnv]) cfg[name] = String(env[name] || '').trim();
      cfg.mode = provider.mode();
      cfg.baseUrl = def.baseUrlEnv ? (String(env[def.baseUrlEnv] || '').trim() || null) : null;
      cfg.timeoutMs = Math.max(1000, Number(def.timeoutMs || 12000));
      cfg.cacheTtlMs = Math.max(0, Number(def.cacheTtlMs || 0));
      return cfg;
    },

    mode() {
      if (typeof def.mode === 'function') return def.mode(envSource());
      return String(envSource()[`${envPrefix}_MODE`] || '').trim() || null;
    },

    missingEnv() {
      const env = envSource();
      return requiredEnv.filter(name => !String(env[name] || '').trim());
    },

    isConfigured() {
      // Alguns fornecedores so contam como configurados num modo especifico
      // (ex.: TOURDIEZ_MODE=real) - nesses casos o `configured` do contrato
      // replica a regra do cliente real em vez de so olhar para presencas.
      if (typeof def.configured === 'function') return Boolean(def.configured(envSource()));
      return provider.missingEnv().length === 0;
    },

    client() {
      if (cachedClient) return cachedClient;
      if (typeof def.create !== 'function') {
        throw new Error(`Fornecedor "${id}" só tem metadados registados - ainda não existe cliente.`);
      }
      cachedClient = def.create(provider.config(), sharedHttp);
      return cachedClient;
    },

    async healthCheck() {
      if (typeof def.healthCheck !== 'function') {
        return { ok: provider.isConfigured(), note: 'Sem healthCheck definido - apenas verificação de configuração.' };
      }
      return def.healthCheck(provider.client());
    }
  };
  return provider;
}

const registeredProviders = new Map();

const providerRegistry = {
  register(provider) {
    if (!provider || !provider.id) throw new Error('providerRegistry.register: fornecedor inválido (falta id).');
    if (registeredProviders.has(provider.id)) throw new Error(`Fornecedor duplicado no registo: "${provider.id}".`);
    registeredProviders.set(provider.id, provider);
    return provider;
  },
  get(id) { return registeredProviders.get(String(id || '')) || null; },
  has(id) { return registeredProviders.has(String(id || '')); },
  list() {
    return [...registeredProviders.values()].map(p => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      configured: p.isConfigured(),
      missing: p.missingEnv(),
      mode: p.mode()
    }));
  }
};

module.exports = { defineProvider, providerRegistry, PROVIDER_KINDS };
