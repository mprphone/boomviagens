// Etapa 1: dados de faturacao + verificacao obrigatoria do email antes de
// avancar. A verificacao reaproveita o codigo por email da Area de
// Cliente (/api/customer/login/*) - autentica a sessao do cliente como
// efeito colateral, para a reserva ja aparecer em /conta sem novo login.

import { $, esc, api, formToJson, isValidNif } from '../utils.js';
import { setCheckoutStep } from './checkoutShell.js';
import { getBilling, setBilling, isEmailVerified, setEmailVerified, getVerifyChallenge, setVerifyChallenge, setPassengerIndex, hasExistingPassword, setHasExistingPassword, getExistingProfile, setExistingProfile, getBookerTravels, setBookerTravels } from './checkoutState.js';
import { renderPassengerStep } from './passengerStep.js';

export function renderCheckoutStep1() {
  const billing = getBilling();
  const verified = isEmailVerified();
  // NIF ja gravado na conta - nao deixa alterar por aqui (evita trocar por
  // engano um dado fiscal usado na fatura); para corrigir, e' na propria
  // conta, em "Os meus dados".
  const nifLocked = Boolean(getExistingProfile()?.nif);

  $('#checkoutMain').innerHTML = `
    <form id="checkoutStep1Form" class="checkout-form">
      <h3>Dados de faturação</h3>
      <div class="form-row">
        <label>Nome completo <input name="name" value="${esc(billing.name)}" required /></label>
        <label>Email
          <div class="verify-field">
            <input type="email" name="email" id="billingEmail" value="${esc(billing.email)}" required ${verified ? 'readonly' : ''} />
            <button type="button" class="ghost mini-action" id="verifyEmailBtn">${verified ? 'Verificado ✓' : 'Verificar'}</button>
          </div>
        </label>
      </div>
      <div id="emailVerifyPanel" class="verify-panel" hidden>
        <label>Código recebido por email <input id="emailVerifyCode" maxlength="6" inputmode="numeric" autocomplete="one-time-code" /></label>
        <button type="button" class="ghost mini-action" id="confirmEmailCodeBtn">Confirmar código</button>
        <p class="verify-panel-message" id="emailVerifyMessage"></p>
      </div>
      ${verified ? '<p class="field-success">✓ Email verificado</p>' : ''}
      ${verified && !hasExistingPassword() ? `
        <div class="verify-panel" id="passwordOptIn">
          <label>Criar password <span class="muted">(opcional, para entrar mais facilmente da próxima vez)</span>
            <input type="password" id="newPasswordInput" minlength="8" placeholder="mínimo 8 caracteres" />
          </label>
          <button type="button" class="ghost mini-action" id="setPasswordBtn">Guardar password</button>
          <p class="verify-panel-message" id="setPasswordMessage"></p>
        </div>` : ''}
      ${verified && hasExistingPassword() ? '<p class="muted small">Já tem uma password definida para esta conta. Pode alterá-la em Os meus dados depois de entrar.</p>' : ''}
      <div class="form-row">
        <label>Telefone <input name="phone" value="${esc(billing.phone)}" inputmode="tel" autocomplete="tel" required /></label>
        <label>Contribuinte (NIF) <input name="nif" id="billingNif" value="${esc(billing.nif)}" maxlength="9" placeholder="opcional" ${nifLocked ? 'readonly' : ''} />
          <span class="field-error-text" id="nifError" hidden>NIF inválido.</span>
        </label>
      </div>
      ${nifLocked ? '<p class="muted small">NIF definido na sua conta. Para alterar, faça-o em "Os meus dados".</p>' : ''}
      <label>Morada <span class="muted">(opcional)</span> <input name="address" value="${esc(billing.address)}" placeholder="Rua, número, código postal, localidade" /></label>
      <div class="booking-preferences">
        <label class="consent strong"><input type="checkbox" name="bookerTravels" ${getBookerTravels() ? 'checked' : ''} /><span><b>Eu também vou viajar</b><small>Se estiver assinalado, usamos estes dados para pré-preencher o primeiro passageiro.</small></span></label>
        ${verified ? '<label class="consent"><input type="checkbox" name="saveProfile" checked /><span>Guardar/atualizar estes dados na minha conta para a próxima reserva</span></label>' : ''}
      </div>
      <div id="checkoutFormError"></div>
      <button class="btn wide" type="submit" id="step1Continue" ${verified ? '' : 'disabled'}>Continuar para passageiros</button>
      <p class="autosave-line" id="checkoutAutosaveStatus">✓ Guardado automaticamente neste checkout</p><p class="trust-note">Ligação encriptada. Os seus dados servem apenas para tratar esta reserva.</p>
    </form>`;

  wireStep1Form();
}

function wireStep1Form() {
  const form = $('#checkoutStep1Form');
  const emailInput = $('#billingEmail');
  const nifInput = $('#billingNif');
  const continueBtn = $('#step1Continue');
  const persistCurrentForm = () => {
    const values = formToJson(form);
    setBilling({ name: values.name || '', email: values.email || '', phone: values.phone || '', nif: values.nif || '', address: values.address || '' });
    setBookerTravels(Boolean(form.elements.bookerTravels?.checked));
  };
  form.querySelectorAll('input').forEach(input => input.addEventListener('change', persistCurrentForm));

  emailInput.addEventListener('input', () => {
    if (!isEmailVerified()) return;
    setEmailVerified(false);
    setVerifyChallenge(null);
    emailInput.readOnly = false;
    $('#verifyEmailBtn').textContent = 'Verificar';
    $('.field-success')?.remove();
    continueBtn.disabled = true;
  });

  nifInput.addEventListener('input', () => {
    const value = nifInput.value.trim();
    const errorEl = $('#nifError');
    if (!value) { nifInput.classList.remove('is-invalid', 'is-valid'); errorEl.hidden = true; return; }
    const valid = isValidNif(value);
    nifInput.classList.toggle('is-invalid', !valid);
    nifInput.classList.toggle('is-valid', valid);
    errorEl.hidden = valid;
  });

  $('#verifyEmailBtn').onclick = () => requestEmailCode(emailInput.value.trim());
  $('#setPasswordBtn')?.addEventListener('click', setPassword);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = formToJson(form);
    $('#checkoutFormError').innerHTML = '';
    if (!isEmailVerified() || f.email !== getBilling().email) {
      $('#checkoutFormError').innerHTML = '<p class="error">Confirme o código enviado para o seu email antes de continuar.</p>';
      return;
    }
    if (f.nif && !isValidNif(f.nif)) {
      $('#checkoutFormError').innerHTML = '<p class="error">O NIF indicado não é válido.</p>';
      return;
    }
    setBilling({ name: f.name, email: f.email, phone: f.phone, nif: f.nif || '', address: f.address || '' });
    setBookerTravels(Boolean(form.elements.bookerTravels?.checked));
    if (form.elements.saveProfile?.checked) syncProfileFields(f);
    setCheckoutStep(2);
    setPassengerIndex(0);
    renderPassengerStep();
  });
}

// So grava na ficha os campos que ainda estavam vazios antes desta reserva -
// nunca sobrepoe um valor ja existente (o NIF, alias, nem chega a ficar
// editavel nesse caso - ver renderCheckoutStep1). Sessao ja garantida: so se
// chega aqui com isEmailVerified() true, que so acontece com sessao valida.
function syncProfileFields(f) {
  const c = getExistingProfile() || {};
  const updates = {
    name: (!c.name || c.name === 'Cliente') ? f.name : c.name,
    phone: f.phone || c.phone || '',
    nif: c.nif || f.nif || '',
    address: f.address || c.address || ''
  };
  api('/api/customer/profile', { method: 'POST', body: JSON.stringify({ ...c, ...updates }) })
    .then(data => setExistingProfile(data.customer))
    .catch(() => {
      // Melhor esforco - se falhar, a reserva segue na mesma, so nao fica
      // gravado para a proxima vez.
    });
}

async function requestEmailCode(emailValue) {
  const btn = $('#verifyEmailBtn');
  const panel = $('#emailVerifyPanel');
  const msg = $('#emailVerifyMessage');
  if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
    msg.textContent = 'Introduza um email válido antes de pedir o código.';
    panel.hidden = false;
    return;
  }
  btn.disabled = true;
  btn.textContent = 'A enviar...';
  try {
    const data = await api('/api/customer/login/request', { method: 'POST', body: JSON.stringify({ email: emailValue }) });
    setVerifyChallenge(data.challenge);
    panel.hidden = false;
    msg.textContent = `Código enviado. ${data.demoCode ? `(Ambiente de teste: ${data.demoCode})` : ''}`;
    $('#confirmEmailCodeBtn').onclick = () => confirmEmailCode(emailValue);
  } catch (err) {
    msg.textContent = err.message;
    panel.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reenviar código';
  }
}

async function confirmEmailCode(emailValue) {
  const btn = $('#confirmEmailCodeBtn');
  const msg = $('#emailVerifyMessage');
  btn.disabled = true;
  btn.textContent = 'A confirmar...';
  try {
    await api('/api/customer/login/verify', {
      method: 'POST',
      body: JSON.stringify({ email: emailValue, code: $('#emailVerifyCode').value.trim(), challenge: getVerifyChallenge() })
    });
    setEmailVerified(true);
    // Guarda o que ja estava escrito no formulario antes de o recriar -
    // prefillFromExistingProfile() so preenche por cima do que faltar.
    const form = $('#checkoutStep1Form');
    setBilling({ name: form.name.value.trim(), email: emailValue, phone: form.phone.value.trim(), nif: form.nif.value.trim(), address: form.address.value.trim() });
    await prefillFromExistingProfile();
    renderCheckoutStep1();
  } catch (err) {
    msg.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Confirmar código';
  }
}

// Se o visitante ja estiver autenticado na Area de Cliente (mesmo
// cookie de sessao, mesma origem - api() envia-o automaticamente), o
// email ja esta verificado a serio: pedir-lhe o codigo outra vez so
// porque esta a fazer uma nova reserva era redundante. Chamado antes do
// primeiro render do passo 1 (ver checkout.js), para nao haver "flash"
// do formulario por verificar.
export async function applyExistingSessionIfAny() {
  try {
    const session = await api('/api/customer/session');
    if (!session.authenticated || !session.email) return;
    setEmailVerified(true);
    setBilling({ ...getBilling(), email: session.email });
    await prefillFromExistingProfile();
  } catch {
    // Sem sessao ativa (ou falha a confirma-la) - segue o fluxo normal,
    // pede verificacao por codigo como sempre.
  }
}

// Depois de verificar o email, se ja existir uma conta com dados
// guardados, sugere-os nos campos que o visitante ainda nao preencheu -
// sem sobrepor nada que ja tenha escrito. Tambem sabe se ja ha password
// definida, para nao mostrar o convite a criar uma outra vez.
async function prefillFromExistingProfile() {
  try {
    const data = await api('/api/customer/profile');
    const c = data.customer;
    setExistingProfile(c);
    const current = getBilling();
    setBilling({
      name: current.name || c.name || '',
      email: current.email,
      phone: current.phone || c.phone || '',
      nif: current.nif || c.nif || '',
      address: current.address || c.address || ''
    });
    setHasExistingPassword(Boolean(data.hasPassword));
  } catch {
    // Sem conta existente para este email - nada a sugerir, segue normal.
  }
}

async function setPassword() {
  const btn = $('#setPasswordBtn');
  const input = $('#newPasswordInput');
  const msg = $('#setPasswordMessage');
  const value = input.value;
  if (value.length < 8) {
    msg.textContent = 'A password deve ter pelo menos 8 caracteres.';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'A guardar...';
  try {
    await api('/api/customer/set-password', { method: 'POST', body: JSON.stringify({ password: value }) });
    setHasExistingPassword(true);
    $('#passwordOptIn').outerHTML = '<p class="field-success">✓ Password criada - já pode usá-la para entrar da próxima vez</p>';
  } catch (err) {
    msg.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Guardar password';
  }
}
