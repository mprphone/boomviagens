// Widget de chat flutuante (respostas locais simples, sem IA externa).

import { $, esc, api } from './utils.js';

$('#chatTriggerBtn')?.addEventListener('click', () => {
  $('#chatPanel').hidden = false;
  $('#chatTriggerBtn').hidden = true;
});
$('#chatCloseBtn')?.addEventListener('click', () => {
  $('#chatPanel').hidden = true;
  $('#chatTriggerBtn').hidden = false;
});

$('#chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = e.target.message.value.trim();
  if (!msg) return;
  $('#chatMessages').innerHTML += `<p><b>Cliente:</b> ${esc(msg)}</p>`;
  e.target.reset();
  const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: msg }) });
  $('#chatMessages').innerHTML += `<p><b>Boom:</b> ${data.answer}${data.handoff ? '<br><small>Sugerido passar para humano.</small>' : ''}</p>`;
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
});
