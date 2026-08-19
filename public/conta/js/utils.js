// Helpers minimos, deliberadamente separados de public/js/utils.js e de
// public/backoffice/js/utils.js - esta e mais uma aplicacao a parte.

export const $ = sel => document.querySelector(sel);

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
// (esta aplicacao nao importa ficheiros do servidor).
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

export function notify(message, type = 'error') {
  let region = document.getElementById('accountToastRegion');
  if (!region) {
    region = document.createElement('div');
    region.id = 'accountToastRegion';
    region.className = 'account-toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  const toast = document.createElement('div');
  toast.className = `account-toast ${type === 'success' ? 'success' : 'error'}`;
  toast.textContent = String(message || 'Não foi possível concluir a operação.');
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 220);
  }, 4200);
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Erro API');
  return data;
}
