// Helpers puros partilhados pelas tres aplicacoes frontend (site publico
// em public/js, area de cliente em public/conta/js e backoffice em
// public/backoffice/js). Sem fetch e sem DOM proprio de cada app - so
// formatacao, escape de HTML e um atalho de querySelector. Cada aplicacao
// re-exporta daqui o que usa no seu utils.js local e mantem localmente o
// que difere (api com credentials/cache, notify com DOM proprio, etc.).
//
// Atencao ao shortDate: esta versao inclui o ano ("12 ago 2026"). O
// backoffice usa propositadamente uma variante curta sem ano ("12 ago") -
// por isso NAO re-exporta este helper e mantem a sua versao local em
// public/backoffice/js/utils.js. Nao "corrigir" essa divergencia: as
// colunas das tabelas do backoffice foram desenhadas para a forma curta.

export const $ = sel => document.querySelector(sel);

// Qualquer texto submetido por um visitante (nome, destino, notas...) pode
// conter HTML/JS. Isto e inserido via innerHTML em varios sitios - sem
// escapar, um destino tipo "<img src=x onerror=...>" executa no browser de
// um admin autenticado assim que ele abrir o painel.
export const esc = str => String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export const money = n => `${Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const shortDate = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const dateRange = (checkin, checkout) => (checkin && checkout) ? `${shortDate(checkin)} → ${shortDate(checkout)}` : '';

export function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Mesmo mapeamento de src/domain.js#statusLabel - duplicado de proposito
// (os frontends nao importam ficheiros do servidor).
export function statusLabel(status) {
  return ({
    NEW_LEAD: 'Nova lead',
    PROPOSAL_SENT: 'Proposta enviada',
    PENDING_PAYMENT: 'Em pagamento',
    PAYMENT_RECEIVED: 'Pagamento recebido',
    IN_VALIDATION: 'Em validação',
    CONFIRMED: 'Confirmada',
    CANCELLED: 'Cancelada',
    OPERATOR_ERROR: 'Erro no operador',
    HUMAN_REVIEW: 'Pendente de intervenção humana'
  })[status] || status;
}
