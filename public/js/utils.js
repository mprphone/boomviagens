// Helpers genericos sem estado, usados por varios modulos: acesso ao
// DOM, chamadas a API, formatacao de datas/precos e o escape de HTML.

export const $ = sel => document.querySelector(sel);

// Qualquer texto submetido por um visitante (nome, destino, notas...) pode
// conter HTML/JS. Isto e inserido via innerHTML em varios sitios do
// backoffice - sem escapar, um destino tipo "<img src=x onerror=...>"
// executa no browser de um admin autenticado assim que ele abrir o painel.
export const esc = str => String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export const money = n => `${Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const shortDate = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
export const dateRange = (checkin, checkout) => (checkin && checkout) ? `${shortDate(checkin)} → ${shortDate(checkout)}` : '';

export async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Erro API');
  return data;
}

export function formToJson(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Digito de controlo do NIF portugues - mesmo algoritmo do servidor
// (src/validation.js#isValidNif), aqui so para dar feedback imediato no
// formulario sem esperar por um pedido; o servidor continua a validar.
export function isValidNif(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(digits)) return false;
  const d = digits.split('').map(Number);
  const sum = d.slice(0, 8).reduce((acc, digit, i) => acc + digit * (9 - i), 0);
  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;
  return expected === d[8];
}

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
