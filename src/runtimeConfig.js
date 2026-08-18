function isProductionDeployment(env = process.env) {
  if (env.VERCEL_ENV) return String(env.VERCEL_ENV).toLowerCase() === 'production';
  return !env.VERCEL && String(env.NODE_ENV || '').toLowerCase() === 'production';
}

function productionMockOverride(env = process.env) {
  return String(env.ALLOW_PRODUCTION_MOCK_PAYMENTS || 'false').toLowerCase() === 'true';
}

function paymentsMode(env = process.env) {
  const explicit = String(env.PAYMENTS_MODE || '').trim().toLowerCase();
  const requested = explicit || (isProductionDeployment(env) ? 'disabled' : 'mock');
  // Fail closed também na informação devolvida ao frontend: se alguém
  // deixar PAYMENTS_MODE=mock por engano em Production, a UI não deve
  // sequer apresentar o botão de simulação quando o servidor o recusaria.
  if (requested === 'mock' && isProductionDeployment(env) && !productionMockOverride(env)) return 'disabled';
  return requested;
}

function mockPaymentsAllowed(env = process.env) {
  return paymentsMode(env) === 'mock';
}

function gatewayPaymentsEnabled(env = process.env) {
  return ['gateway', 'real', 'live'].includes(paymentsMode(env));
}

module.exports = { isProductionDeployment, paymentsMode, mockPaymentsAllowed, gatewayPaymentsEnabled };
