import { $, api, esc, shortDate, notify } from './utils.js';

const KIND_LABELS = {
  APOIO: 'Pedido de apoio', ALTERACAO: 'Alteração', CANCELAMENTO: 'Cancelamento',
  RECLAMACAO: 'Reclamação', PAGAMENTO: 'Pagamento', DOCUMENTOS: 'Documentos'
};

export async function renderMensagens() {
  const el = $('#view-mensagens');
  el.innerHTML = '<p class="muted">A carregar…</p>';
  try {
    const [reservationsData, requestsData] = await Promise.all([
      api('/api/customer/reservations'),
      api('/api/customer/support-requests')
    ]);
    const reservations = reservationsData.reservations || [];
    const requests = requestsData.requests || [];
    el.innerHTML = `
      <div class="support-layout">
        <section class="panel support-form-panel">
          <div class="panel-head"><div><h2>Falar com a Boomviagens</h2><p>O pedido fica associado à sua conta e, quando aplicável, à viagem certa.</p></div></div>
          <form id="supportRequestForm" class="support-form">
            <label>Tipo de pedido<select name="kind">${Object.entries(KIND_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
            <label>Viagem<select name="reservationId"><option value="">Pedido geral</option>${reservations.map(item => `<option value="${esc(item.id)}">${esc(item.offer?.destination || item.offer?.hotel || item.id)} · ${esc(item.id)}</option>`).join('')}</select></label>
            <label class="support-message-field">Mensagem<textarea name="notes" rows="7" minlength="10" maxlength="1500" required placeholder="Explique o que precisa, incluindo datas ou detalhes relevantes."></textarea></label>
            <p id="supportRequestFeedback" class="customer-form-message" aria-live="polite"></p>
            <button class="btn" type="submit">Enviar pedido</button>
          </form>
        </section>
        <section class="panel support-history">
          <div class="panel-head"><div><h2>Histórico de pedidos</h2><p>Referências enviadas através da sua área de cliente.</p></div></div>
          <div id="supportRequestList">${requestList(requests)}</div>
        </section>
      </div>`;

    $('#supportRequestForm').onsubmit = submitRequest;
  } catch (error) {
    el.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
}

function requestList(requests) {
  if (!requests.length) return '<p class="empty-note">Ainda não enviou pedidos através desta área.</p>';
  return `<div class="support-list">${requests.map(item => `
    <article class="support-item">
      <div><span class="support-kind">${esc(KIND_LABELS[item.kind] || item.kind)}</span><b>${esc(item.id)}</b></div>
      <p>${esc(item.notes)}</p>
      <footer><span>${shortDate(String(item.createdAt || '').slice(0, 10))}</span><span class="pill info">${item.status === 'NOVO' ? 'Recebido' : esc(item.status)}</span></footer>
    </article>`).join('')}</div>`;
}

async function submitRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const feedback = $('#supportRequestFeedback');
  button.disabled = true;
  button.textContent = 'A enviar…';
  feedback.textContent = '';
  try {
    const data = await api('/api/customer/support-request', {
      method: 'POST',
      body: JSON.stringify({ kind: form.kind.value, reservationId: form.reservationId.value, notes: form.notes.value })
    });
    notify(`Pedido ${data.requestId} registado.`, 'success');
    await renderMensagens();
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
    button.textContent = 'Enviar pedido';
  }
}
