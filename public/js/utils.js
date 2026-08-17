// Helpers genericos sem estado, usados por varios modulos: acesso ao
// DOM, chamadas a API, formatacao de datas/precos e o escape de HTML.

export const $ = sel => document.querySelector(sel);

// Qualquer texto submetido por um visitante (nome, destino, notas...) pode
// conter HTML/JS. Isto e inserido via innerHTML em varios sitios do
// backoffice - sem escapar, um destino tipo "<img src=x onerror=...>"
// executa no browser de um admin autenticado assim que ele abrir o painel.
export const esc = str => String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// URLs vindos de fornecedores externos nunca entram diretamente em src,
// href ou CSS. Aceitamos apenas HTTPS (e HTTP só em localhost para
// desenvolvimento), bloqueando esquemas como javascript:/data: e aspas
// capazes de sair de um atributo/style.
export function safeExternalUrl(value, fallback = '') {
  try {
    const u = new URL(String(value || ''), window.location.origin);
    const localHttp = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !localHttp) return fallback;
    return u.href;
  } catch { return fallback; }
}

export function safeImageUrl(value, fallback = '') {
  return safeExternalUrl(value, fallback);
}

export function cssImageUrl(value, fallback = '') {
  const url = safeImageUrl(value, fallback);
  // URL fica dentro de url('...'); percent-encode dos caracteres que podem
  // fechar a string/CSS antes de inserir no atributo style.
  return String(url).replace(/'/g, '%27').replace(/\\/g, '%5C').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

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

export function notify(message, type = 'error') {
  let host = document.getElementById('appNotifications');
  if (!host) {
    host = document.createElement('div');
    host.id = 'appNotifications';
    host.setAttribute('aria-live', 'polite');
    host.style.cssText = 'position:fixed;right:18px;top:118px;z-index:600;display:grid;gap:8px;width:min(360px,calc(100vw - 28px))';
    document.body.appendChild(host);
  }
  const item = document.createElement('div');
  const success = type === 'success';
  item.style.cssText = `border:1px solid ${success ? '#a9ddc5' : '#efc5cb'};border-radius:11px;padding:12px 14px;background:${success ? '#e9f7f0' : '#fff3f5'};color:${success ? '#126b45' : '#9f2938'};font:600 12px/1.45 "DM Sans",sans-serif;box-shadow:0 12px 34px rgba(10,45,68,.14)`;
  item.textContent = String(message || 'Não foi possível concluir esta ação.');
  host.appendChild(item);
  setTimeout(() => item.remove(), 4200);
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
