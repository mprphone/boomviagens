// Separador "Histórico": timeline completa e imutável do processo -
// mudanças de estado, serviços, documentos, ocorrências, comunicações,
// reclamações... tudo o que acontece fica aqui registado automaticamente
// pelas rotas correspondentes. Sem edição manual: cada área tem o seu
// próprio separador para registar coisas novas (Ocorrências, Comunicações,
// Tarefas...) - o Histórico é só para consulta, nunca deve ser alterado
// diretamente.

import { esc } from '../utils.js';

const EVENT_LABELS = {
  STATUS_CHANGE: 'Mudança de estado', SERVICE_ADDED: 'Serviço adicionado', SERVICE_UPDATED: 'Serviço atualizado',
  SERVICE_REMOVED: 'Serviço removido', DOCUMENT_UPLOADED: 'Documento anexado',
  INFO: 'Informação', CHANGE: 'Alteração', PROBLEM: 'Problema', INCIDENT: 'Incidente', DELAY: 'Atraso',
  SERVICE_NOT_RENDERED: 'Serviço não prestado', SUPPLIER_ERROR: 'Erro do fornecedor', INTERNAL_ERROR: 'Erro interno',
  CUSTOMER_REQUEST: 'Pedido do cliente', OTHER: 'Outro', CONTACT: 'Contacto', NOTE: 'Nota'
};
const WARNING_TYPES = new Set(['PROBLEM', 'INCIDENT', 'SERVICE_NOT_RENDERED', 'SUPPLIER_ERROR', 'INTERNAL_ERROR', 'SERVICE_REMOVED', 'DELAY']);

export function renderHistoryTab(panel, reservation, reload, data = {}) {
  const events = data.events || [];

  panel.innerHTML = `
    <div class="contact-log-list">
      ${events.map(e => `
        <div class="contact-log-item">
          <div class="contact-log-head">
            <span class="pill ${WARNING_TYPES.has(e.type) ? 'pill-warning' : ''}">${esc(EVENT_LABELS[e.type] || e.type)}</span>
            <span class="muted small">${new Date(e.createdAt).toLocaleString('pt-PT')}${e.actor ? ` · ${esc(e.actor)}` : ''}</span>
          </div>
          <p>${esc(e.description || '')}</p>
        </div>`).join('') || '<p class="empty-note">Ainda sem histórico registado neste processo.</p>'}
    </div>`;
}
