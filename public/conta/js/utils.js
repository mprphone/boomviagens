// Helpers da area de cliente. Os helpers puros e identicos entre as tres
// aplicacoes vivem em public/shared/utils.js e sao re-exportados aqui - os
// consumidores continuam a importar deste ficheiro. Ficam localmente apenas
// o notify (toasts com DOM/estilos proprios desta app) e o api (com
// credentials, cache: no-store e erros enriquecidos com code/data).

export { $, esc, money, shortDate, dateRange, daysUntil, statusLabel } from '../../shared/utils.js';

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
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error || 'Erro API');
    error.code = data.code || '';
    error.data = data;
    throw error;
  }
  return data;
}
