// Vista "Contactos de emergência": o contacto real da agência sempre à
// mão, sem ter de abrir uma viagem específica primeiro (mesma informação
// já usada no separador Ajuda da página do processo, ver tripDetail.js).
// Não inventa número de apólice/assistência 24h - isso fica para quando
// existir mesmo essa informação estruturada no sistema.

import { $, esc, api } from './utils.js';

export async function renderEmergencia() {
  const el = $('#view-emergencia');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let company = {};
  try {
    const cfg = await api('/api/config');
    company = cfg.company || {};
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  el.innerHTML = `
    <div class="panel" style="max-width:480px">
      <div class="panel-head"><h2>Precisa de ajuda?</h2></div>
      <p class="muted">Contacte a nossa equipa a qualquer momento, antes, durante ou depois da sua viagem.</p>
      ${company.phone ? `<p style="font-size:16px"><a href="tel:${esc(company.phone)}">📞 ${esc(company.phone)}</a></p>` : ''}
      ${company.email ? `<p style="font-size:16px"><a href="mailto:${esc(company.email)}">✉️ ${esc(company.email)}</a></p>` : ''}
      ${!company.phone && !company.email ? '<p class="empty-note">Contactos por confirmar.</p>' : ''}
      <p class="muted">Para o seguro de viagem e outros contactos específicos de uma reserva, consulte o separador "Ajuda" dentro dessa viagem.</p>
    </div>`;
}
