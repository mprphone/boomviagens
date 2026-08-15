// Separador "Ocorrências": leitura filtrada do historico (ver
// ./historyTab.js) so com os tipos "de ocorrencia" - informacao, alteracao,
// problema, incidente, atraso, servico nao prestado, erro do
// fornecedor/interno, pedido do cliente. "+ Registar ocorrência" abre uma
// gaveta lateral com o problema, a resolucao, o estado e os documentos
// anexados especificamente a essa ocorrencia (fica ligado via
// documents.event_id) - so e possivel anexar depois de gravar a
// ocorrencia pela primeira vez (precisa do id).

import { esc, api } from '../utils.js';
import { openDrawer, closeDrawer } from '../drawer.js';

const OCCURRENCE_TYPES = [
  { value: 'INFO', label: 'Informação' },
  { value: 'CHANGE', label: 'Alteração' },
  { value: 'PROBLEM', label: 'Problema' },
  { value: 'INCIDENT', label: 'Incidente' },
  { value: 'DELAY', label: 'Atraso' },
  { value: 'SERVICE_NOT_RENDERED', label: 'Serviço não prestado' },
  { value: 'SUPPLIER_ERROR', label: 'Erro do fornecedor' },
  { value: 'INTERNAL_ERROR', label: 'Erro interno' },
  { value: 'CUSTOMER_REQUEST', label: 'Pedido do cliente' },
  { value: 'OTHER', label: 'Outro' }
];
const OCCURRENCE_TYPE_VALUES = new Set(OCCURRENCE_TYPES.map(t => t.value));

function typeLabel(type) {
  return OCCURRENCE_TYPES.find(t => t.value === type)?.label || type;
}

export function renderOccurrencesTab(panel, reservation, reload, data = {}) {
  const occurrences = (data.events || []).filter(e => OCCURRENCE_TYPE_VALUES.has(e.type));

  panel.innerHTML = `
    <div class="tab-toolbar">
      <button type="button" class="btn mini-action occurrence-add">+ Registar ocorrência</button>
    </div>
    <div class="contact-log-list">
      ${occurrences.map(o => `
        <div class="contact-log-item" data-event="${esc(o.id)}">
          <div class="contact-log-head">
            <span class="pill ${o.type === 'PROBLEM' || o.type === 'INCIDENT' ? 'pill-warning' : ''}">${esc(typeLabel(o.type))}</span>
            <span class="pill ${o.resolved ? 'pill-ok' : 'pill-warning'}">${o.resolved ? 'Resolvida' : 'Aberta'}</span>
            <span class="muted small">${new Date(o.createdAt).toLocaleString('pt-PT')}${o.actor ? ` · ${esc(o.actor)}` : ''}</span>
          </div>
          <p>${esc(o.description)}</p>
          ${o.resolution ? `<p class="muted"><b>Resolução:</b> ${esc(o.resolution)}</p>` : ''}
        </div>`).join('') || '<p class="empty-note">Sem ocorrências registadas neste processo.</p>'}
    </div>`;

  panel.querySelector('.occurrence-add').onclick = () => openOccurrenceDrawer(null);
  panel.querySelectorAll('.contact-log-item').forEach(item => {
    item.onclick = () => openOccurrenceDrawer(occurrences.find(o => o.id === item.dataset.event));
  });

  function openOccurrenceDrawer(occurrence) {
    const docs = occurrence ? (data.documents || []).filter(d => d.eventId === occurrence.id) : [];
    const body = openDrawer(occurrence ? 'Editar ocorrência' : 'Nova ocorrência');

    body.innerHTML = `
      <form class="occurrence-form">
        <div class="drawer-form-fields">
          <label>Tipo
            <select name="type">${OCCURRENCE_TYPES.map(t => `<option value="${t.value}" ${(occurrence?.type || 'INFO') === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
          </label>
          <label>Descrição do problema <textarea name="description" rows="3" required>${esc(occurrence?.description || '')}</textarea></label>
          <label class="service-line-checkbox"><input type="checkbox" name="resolved" ${occurrence?.resolved ? 'checked' : ''} /> Resolvida</label>
          <label>Resolução / notas finais <textarea name="resolution" rows="3" placeholder="O que foi feito para resolver...">${esc(occurrence?.resolution || '')}</textarea></label>
        </div>
        <div class="service-line-form-actions">
          <button class="btn mini-action" type="submit">${occurrence ? 'Guardar alterações' : 'Registar ocorrência'}</button>
        </div>
        <p class="customer-form-message"></p>
      </form>
      <p class="summary-block-label">Anexos</p>
      ${occurrence ? `
        <div class="doc-list">
          ${docs.map(d => `
            <div class="doc-item">
              <span class="muted">${esc(d.fileName)}</span>
              <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
              <button class="ghost mini-action drawer-doc-delete" data-doc="${d.id}">Remover</button>
            </div>`).join('') || '<p class="empty-note">Sem anexos nesta ocorrência.</p>'}
        </div>
        <form class="drawer-doc-form">
          <input type="file" class="drawer-doc-input" required>
          <button type="submit" class="ghost mini-action">Anexar</button>
        </form>` : '<p class="muted small">Guarde a ocorrência primeiro para poder anexar documentos.</p>'}`;

    body.querySelector('.occurrence-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = ev.target;
      const btn = f.querySelector('button[type=submit]');
      const msg = body.querySelector('.customer-form-message');
      btn.disabled = true;
      try {
        if (occurrence) {
          await api('/api/admin/reservations/events/resolve', {
            method: 'POST',
            body: JSON.stringify({ id: occurrence.id, type: f.type.value, description: f.description.value, resolved: f.resolved.checked, resolution: f.resolution.value })
          });
        } else {
          await api('/api/admin/reservations/events', {
            method: 'POST',
            body: JSON.stringify({ reservationId: reservation.id, type: f.type.value, description: f.description.value, resolved: f.resolved.checked, resolution: f.resolution.value })
          });
        }
        await reload();
        closeDrawer();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    };

    if (occurrence) {
      body.querySelectorAll('.drawer-doc-delete').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Remover este anexo?')) return;
          try {
            await api('/api/admin/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
            await reload();
            closeDrawer();
          } catch (err) { alert(err.message); }
        };
      });

      body.querySelector('.drawer-doc-form').onsubmit = async ev => {
        ev.preventDefault();
        const fileInput = body.querySelector('.drawer-doc-input');
        const file = fileInput.files[0];
        if (!file) return;
        const btn = ev.target.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = 'A anexar...';
        try {
          const fileBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          await api('/api/admin/documents/upload', {
            method: 'POST',
            body: JSON.stringify({ reservationId: reservation.id, eventId: occurrence.id, type: 'OTHER', fileName: file.name, mimeType: file.type, fileBase64 })
          });
          await reload();
          closeDrawer();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
          btn.textContent = 'Anexar';
        }
      };
    }
  }
}
