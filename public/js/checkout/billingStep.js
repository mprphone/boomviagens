// Etapa 1: dados de faturacao + verificacao obrigatoria do email antes de
// avancar. A verificacao reaproveita o codigo por email da Area de
// Cliente (/api/customer/login/*) - autentica a sessao do cliente como
// efeito colateral, para a reserva ja aparecer em /conta sem novo login.

import { $, esc, api, formToJson, isValidNif } from '../utils.js';
import { setCheckoutStep } from './checkoutShell.js';
import { getBilling, setBilling, isEmailVerified, setEmailVerified, getVerifyChallenge, setVerifyChallenge, setPassengerIndex } from './checkoutState.js';
import { renderPassengerStep } from './passengerStep.js';

export function renderCheckoutStep1() {
  const billing = getBilling();
  const verified = isEmailVerified();

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
      <div class="form-row">
        <label>Telefone <input name="phone" value="${esc(billing.phone)}" required /></label>
        <label>Contribuinte (NIF) <input name="nif" id="billingNif" value="${esc(billing.nif)}" maxlength="9" placeholder="opcional" />
          <span class="field-error-text" id="nifError" hidden>NIF inválido.</span>
        </label>
      </div>
      <label>Morada <span class="muted">(opcional)</span> <input name="address" value="${esc(billing.address)}" placeholder="Rua, número, código postal, localidade" /></label>
      <div id="checkoutFormError"></div>
      <button class="btn wide" type="submit" id="step1Continue" ${verified ? '' : 'disabled'}>Continuar para passageiros</button>
      <p class="trust-note">Ligação encriptada. Os seus dados servem apenas para tratar esta reserva.</p>
    </form>`;

  wireStep1Form();
}

function wireStep1Form() {
  const form = $('#checkoutStep1Form');
  const emailInput = $('#billingEmail');
  const nifInput = $('#billingNif');
  const continueBtn = $('#step1Continue');

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
    setCheckoutStep(2);
    setPassengerIndex(0);
    renderPassengerStep();
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
    setBilling({ ...getBilling(), email: emailValue });
    $('#emailVerifyPanel').hidden = true;
    $('#billingEmail').readOnly = true;
    $('#verifyEmailBtn').textContent = 'Verificado ✓';
    $('#step1Continue').disabled = false;
    if (!$('.field-success')) {
      $('#emailVerifyPanel').insertAdjacentHTML('afterend', '<p class="field-success">✓ Email verificado</p>');
    }
    await prefillFromExistingProfile();
  } catch (err) {
    msg.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Confirmar código';
  }
}

// Depois de verificar o email, se ja existir uma conta com dados
// guardados, sugere-os nos campos que o visitante ainda nao preencheu -
// sem sobrepor nada que ja tenha escrito.
async function prefillFromExistingProfile() {
  try {
    const data = await api('/api/customer/profile');
    const c = data.customer;
    const form = $('#checkoutStep1Form');
    if (!form) return;
    if (!form.name.value.trim() && c.name) form.name.value = c.name;
    if (!form.phone.value.trim() && c.phone) form.phone.value = c.phone;
    if (!form.nif.value.trim() && c.nif) form.nif.value = c.nif;
    if (!form.address.value.trim() && c.address) form.address.value = c.address;
  } catch {
    // Sem conta existente para este email - nada a sugerir, segue normal.
  }
}
