// Vistas de sistema. Margens e integrações usam endpoints dedicados com
// permissões mais restritas; o dashboard geral não transporta NET, regras de
// pricing nem topologia de fornecedores para perfis sem necessidade.

import { $, esc, money, api } from './utils.js';

export async function renderMargens() {
  const el = $('#view-margens');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try { data = await api('/api/admin/margins'); }
  catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }

  el.innerHTML = `
    <div class="pricing-layout">
      <div class="panel">
        <div class="panel-head"><div><p class="eyebrow">Pricing</p><h2>Regras de margem sobre o NET</h2><p class="muted">Pode definir uma regra geral ou ser mais específico por operador, canal, produto e destino.</p></div></div>
        ${data.margins.length ? data.margins.map(m => `
          <div class="list-row pricing-rule-row">
            <div class="list-row-main"><b>${esc(m.name)}</b><span>${esc(m.match === '*' ? 'Todos os destinos' : `Destino: ${m.match}`)} · Operador: ${esc(m.operator || '*')} · Canal: ${esc(m.channel || '*')} · Produto: ${esc(m.productType || '*')}</span></div>
            <div class="list-row-side"><span class="stage-pill ${m.active === false ? 'PERDIDA' : 'RESERVADO'}">${m.active === false ? 'Inativa' : 'Ativa'}</span><strong>Alvo ${Number(m.percent || 0)}% · mín. ${Number(m.minimumPercent || 0)}%${Number(m.rebatePercent || 0) ? ` · rappel est. ${Number(m.rebatePercent)}%` : ''} · ${money(m.min || 0)}</strong><button type="button" class="ghost mini-action edit-margin-btn" data-id="${esc(m.id)}">Editar</button></div>
          </div>`).join('') : '<p class="empty-note">Sem regras de margem configuradas.</p>'}
      </div>

      <div class="panel pricing-editor-panel">
        <div class="panel-head"><div><p class="eyebrow">Nova regra</p><h2>Definir markup</h2></div></div>
        <form id="marginRuleForm" class="pricing-form">
          <input name="id" type="hidden" value="" />
          <label>Nome<input name="name" value="Regra online" required /></label>
          <label>Destino / match<input name="match" value="*" placeholder="* ou Punta Cana, Maldivas" /></label>
          <label>Operador<input name="operator" value="*" placeholder="* ou HBX" /></label>
          <label>Canal<select name="channel"><option value="*">Todos</option><option value="ONLINE">Online</option><option value="AGENCIA">Agência</option></select></label>
          <label>Produto<select name="productType"><option value="*">Todos</option><option value="ALOJAMENTO">Alojamento</option><option value="PACOTE">Pacote</option><option value="VOO">Voo</option><option value="ATIVIDADE">Atividade</option><option value="TRANSFER">Transfer</option></select></label>
          <label>Markup alvo %<input name="percent" type="number" min="0" max="80" step="0.1" value="12" /></label>
          <label>Markup mínimo %<input name="minimumPercent" type="number" min="0" max="80" step="0.1" value="7" /></label>
          <label>Rappel/override estimado %<input name="rebatePercent" type="number" min="0" max="30" step="0.1" value="0" /><small>Informativo; não reduz o PVP mínimo.</small></label>
          <label>Margem mínima €<input name="min" type="number" min="0" step="1" value="0" /></label>
          <label>Arredondar a €<input name="roundTo" type="number" min="1" step="1" value="5" /></label>
          <div class="pricing-form-actions"><button type="submit" class="btn">Guardar regra</button><button type="button" class="ghost" id="newMarginRuleBtn">Nova regra</button></div>
          <div id="marginRuleStatus"></div>
        </form>
      </div>
    </div>

    <div class="panel pricing-simulator">
      <div class="panel-head"><div><p class="eyebrow">Simulador</p><h2>Quanto posso ceder sem passar o mínimo?</h2></div></div>
      <form id="pricingPreviewForm" class="pricing-preview-form">
        <label>NET €<input name="baseCost" type="number" value="1000" min="0.01" step="0.01" /></label>
        <label>Destino<input name="destination" value="Punta Cana" /></label>
        <label>Operador<input name="operator" value="HBX" /></label>
        <label>Canal<select name="channel"><option value="ONLINE">Online</option><option value="AGENCIA">Agência</option></select></label>
        <label>Produto<select name="productType"><option value="ALOJAMENTO">Alojamento</option><option value="PACOTE">Pacote</option><option value="VOO">Voo</option></select></label>
        <label>Ceder pontos de markup<input name="concessionPercent" type="number" value="0" min="0" max="80" step="0.1" /></label>
        <button class="btn" type="submit">Simular</button>
      </form>
      <div id="pricingPreviewResult" class="pricing-preview-result"><span>Preencha os valores e simule.</span></div>
    </div>`;

  const marginForm = $('#marginRuleForm');
  const resetMarginForm = () => {
    marginForm.reset();
    marginForm.elements.id.value = '';
    marginForm.elements.name.value = 'Regra online';
    marginForm.elements.match.value = '*';
    marginForm.elements.operator.value = '*';
    marginForm.elements.channel.value = '*';
    marginForm.elements.productType.value = '*';
    marginForm.elements.percent.value = '12';
    marginForm.elements.minimumPercent.value = '7';
    marginForm.elements.rebatePercent.value = '0';
    marginForm.elements.min.value = '0';
    marginForm.elements.roundTo.value = '5';
  };
  $('#newMarginRuleBtn').onclick = resetMarginForm;
  document.querySelectorAll('.edit-margin-btn').forEach(btn => {
    btn.onclick = () => {
      const rule = (data.margins || []).find(m => m.id === btn.dataset.id);
      if (!rule) return;
      for (const [field, value] of Object.entries({
        id: rule.id, name: rule.name, match: rule.match || '*', operator: rule.operator || '*',
        channel: rule.channel || '*', productType: rule.productType || '*', percent: rule.percent ?? 0,
        minimumPercent: rule.minimumPercent ?? 0, rebatePercent: rule.rebatePercent ?? 0,
        min: rule.min ?? 0, roundTo: rule.roundTo ?? 5
      })) if (marginForm.elements[field]) marginForm.elements[field].value = value;
      marginForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });

  $('#marginRuleForm').onsubmit = async e => {
    e.preventDefault(); const form = e.currentTarget; const payload = Object.fromEntries(new FormData(form).entries());
    const status = $('#marginRuleStatus'); status.innerHTML = '<span class="muted">A guardar…</span>';
    try { await api('/api/admin/margins', { method:'POST', body:JSON.stringify(payload) }); status.innerHTML = '<span class="success-text">Regra guardada ✓</span>'; setTimeout(() => renderMargens(), 450); }
    catch (err) { status.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
  };

  $('#pricingPreviewForm').onsubmit = async e => {
    e.preventDefault(); const payload = Object.fromEntries(new FormData(e.currentTarget).entries()); const box = $('#pricingPreviewResult'); box.innerHTML = '<span>A calcular…</span>';
    try {
      const data = await api('/api/admin/pricing/preview', { method:'POST', body:JSON.stringify(payload) }); const p = data.pricing;
      box.innerHTML = `<div><span>Regra aplicada</span><b>${esc(p.marginRule)}</b></div><div><span>PVP alvo</span><b>${money(p.targetPrice)}</b></div><div><span>PVP após cedência</span><b>${money(p.finalPrice)}</b></div><div><span>PVP mínimo</span><b>${money(p.minimumPrice)}</b></div><div><span>Margem direta atual</span><b>${money(p.marginValue)} · ${Number(p.effectiveMarkupPercent).toFixed(1)}% sobre NET</b></div><div><span>Rappel/override estimado</span><b>${money(p.expectedRebateValue)} · ${Number(p.rebatePercent).toFixed(1)}%</b></div><div><span>Margem económica esperada</span><b>${money(p.expectedEconomicMargin)}</b></div><div><span>Ainda pode ceder</span><b>${money(Math.max(0, p.finalPrice - p.minimumPrice))}</b></div>`;
    } catch (err) { box.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
  };
}

export async function renderEmails() {
  const el = $('#view-emails');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/admin/dashboard');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const emails = data.latest.emails;
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Emails gerados recentemente</h2></div>
      ${emails.length ? emails.map(e => `
        <div class="list-row">
          <div class="list-row-main">
            <b>${esc(e.subject)}</b>
            <span>Para: ${esc(e.to)}</span>
          </div>
          <div class="list-row-side">
            <span class="stage-pill NOVA">${esc(e.status)}</span>
            <strong>${new Date(e.createdAt).toLocaleString('pt-PT')}</strong>
          </div>
        </div>`).join('') : '<p class="empty-note">Ainda sem emails gerados.</p>'}
    </div>`;
}

export async function renderOperador() {
  const el = $('#view-operador');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let integrationsData, operatorData;
  try {
    [integrationsData, operatorData] = await Promise.all([
      api('/api/admin/integrations'),
      api('/api/admin/operators')
    ]);
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  const integrations = integrationsData.integrations || [];
  const statusText = item => item.enabled ? 'Ativa' : item.configured ? 'Configurada' : 'Por configurar';
  const statusClass = item => item.enabled ? 'RESERVADO' : item.configured ? 'PROPOSTA' : 'PERDIDA';
  const detail = item => {
    if (item.id === 'google-places' && !item.enabled) return 'Mantida desligada por controlo de custos. Só deve ser chamada por ação explícita do cliente.';
    if (item.id === 'hbx-hotels') return 'Acesso de teste preparado. A pesquisa pública aguarda sincronização local do conteúdo HBX antes de usar disponibilidade por hotel.';
    if (item.id === 'hbx-activities' || item.id === 'hbx-transfers') return 'Disponível no laboratório. A ativação pública será progressiva depois de validar conteúdo, destinos e condições.';
    if (item.id === 'duffel') return 'Pesquisa de voos carregada apenas quando o cliente abre uma viagem; a cotação é independente do total do pacote.';
    if (item.id === 'openweather') return 'Condições atuais no detalhe da viagem; não é apresentada como previsão de uma viagem distante.';
    if (item.id === 'ticketmaster') return 'Eventos do destino nas datas da viagem, para inspiração e interação.';
    return item.publicUse || '';
  };

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head integration-panel-head"><div><p class="eyebrow">Integrações</p><h2>API Lab</h2><p class="muted">Testes manuais: abrir esta página não consome chamadas externas.</p></div><span class="stage-pill NOVA">${integrations.filter(i => i.configured).length}/${integrations.length} configuradas</span></div>
      <div class="integration-grid">
        ${integrations.map(item => `<article class="integration-card">
          <div class="integration-card-head"><div><span class="integration-category">${esc(item.category)}</span><h3>${esc(item.name)}</h3></div><span class="stage-pill ${statusClass(item)}">${statusText(item)}</span></div>
          <p>${esc(detail(item))}</p>
          <div class="integration-meta"><span>Modo: <b>${esc(item.mode || '—')}</b></span><span>Uso: <b>${esc(item.publicUse || '—')}</b></span></div>
          <button type="button" class="ghost integration-test-btn" data-id="${esc(item.id)}" ${!item.configured || (item.id === 'google-places' && !item.enabled) ? 'disabled' : ''}>Testar ligação</button>
        </article>`).join('')}
      </div>
      <div id="integrationTestResult" class="integration-test-result" hidden></div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><p class="eyebrow">Operadores comerciais</p><h2>Fornecedores de reserva</h2></div></div>
      ${(operatorData.operators || []).map(o => `<div class="list-row"><div class="list-row-main"><b>${esc(o.name)}</b></div><div class="list-row-side"><span class="stage-pill ${o.configured ? 'RESERVADO' : 'PERDIDA'}">${o.configured ? 'Configurado' : 'Sem configuração'}</span></div></div>`).join('')}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Diagnóstico TourDiez</h2></div>
      <div class="op-actions"><button type="button" id="testOperatorBtn" class="btn">Testar TourDiez</button><span id="opStatus" class="op-status"></span></div>
      <pre id="operatorLog" class="log">${esc(JSON.stringify({ chamadas: operatorData.logs || [], auditoria: operatorData.audit || [] }, null, 2))}</pre>
    </div>`;

  document.querySelectorAll('.integration-test-btn').forEach(btn => {
    btn.onclick = async () => {
      const box = $('#integrationTestResult');
      box.hidden = false;
      box.className = 'integration-test-result';
      box.innerHTML = `<b>A testar ${esc(btn.closest('.integration-card').querySelector('h3').textContent)}…</b><span>O teste é feito agora e pode consumir uma chamada da quota do fornecedor.</span>`;
      btn.disabled = true;
      try {
        const result = await api('/api/admin/integrations/test', { method: 'POST', body: JSON.stringify({ id: btn.dataset.id }) });
        box.classList.add('is-success');
        box.innerHTML = `<b>Ligação OK ✓</b><pre>${esc(JSON.stringify(result.result, null, 2))}</pre>`;
      } catch (err) {
        box.classList.add('is-error');
        box.innerHTML = `<b>Falhou</b><span>${esc(err.message)}</span>`;
      } finally { btn.disabled = false; }
    };
  });

  $('#testOperatorBtn').onclick = async () => {
    $('#opStatus').textContent = 'A testar login + disponibilidade TourDiez...';
    $('#operatorLog').textContent = '';
    try {
      const result = await api('/api/admin/operator/tourdiez/test', { method: 'POST', body: JSON.stringify({ destination: 'Punta Cana', nights: 7, adults: 2 }) });
      $('#opStatus').textContent = result.tourdiezOk ? 'Ligação à TourDiez OK.' : 'TourDiez respondeu, mas com erro - ver detalhe abaixo.';
      $('#operatorLog').textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      $('#opStatus').textContent = 'Falhou.';
      $('#operatorLog').textContent = err.message;
    }
  };
}
