// Uma origem/browser tem apenas um cookie de cliente. Este canal impede que
// separadores antigos continuem a mostrar dados já renderizados da conta
// anterior depois de outro separador trocar de sessão.

const CHANNEL_NAME = 'boom_customer_session_v1';
const STORAGE_SIGNAL = 'boom_customer_session_signal_v1';
const listeners = new Set();
let channel = null;

try {
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = () => listeners.forEach(listener => listener());
  }
} catch { channel = null; }

window.addEventListener('storage', event => {
  if (event.key === STORAGE_SIGNAL) listeners.forEach(listener => listener());
});

export function announceCustomerSessionChange() {
  try { channel?.postMessage({ changedAt: Date.now() }); } catch {}
  try { localStorage.setItem(STORAGE_SIGNAL, `${Date.now()}-${Math.random()}`); } catch {}
}

export function watchCustomerSessionChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearCustomerScopedBrowserState() {
  try { sessionStorage.removeItem('boom_checkout_draft_v2'); } catch {}
  try { localStorage.removeItem('boom_saved_trips_v1'); } catch {}
}
