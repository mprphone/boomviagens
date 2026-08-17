// Etapa 2: um passageiro de cada vez, com validação imediata e linguagem
// humana. O pagamento fica exclusivamente na etapa seguinte.

import { $, esc, api, formToJson } from '../utils.js';
import { getCurrentOffer, setLastPayment, setLastReservation } from '../state.js';
import { setCheckoutStep, setAutosaveStatus } from './checkoutShell.js';
import {
  getBilling, getPassengers, setPassenger, getPassengerIndex, setPassengerIndex,
  setReservationCreated, isEmailVerified, getSavedPassengers, setSavedPassengers,
  getBookerTravels
} from './checkoutState.js';
import { renderCheckoutStep1 } from './billingStep.js';
import { renderCheckoutExtras } from './extrasStep.js';

function guessFirstAndLastName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { name: parts[0] || '', surname: '' };
  return { name: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

function fromWalletShape(w) {
  return {
    ...guessFirstAndLastName(w.name),
    birthdate: w.birthdate || '', gender: w.gender || '', nationality: w.nationality || 'Portuguesa',
    documentType: w.documentType === 'PASSPORT' ? 'PASSPORT' : 'CC',
    documentNumber: w.documentNumber || '', documentCountry: w.documentCountry || 'Portugal', documentExpiry: w.documentExpiry || ''
  };
}

function toWalletShape(p, relationship) {
  return {
    name: [p.name, p.surname].filter(Boolean).join(' '), relationship: relationship || 'OUTRO',
    birthdate: p.birthdate || '', nationality: p.nationality || '', documentType: p.documentType === 'PASSPORT' ? 'PASSPORT' : 'CC',
    documentNumber: p.documentNumber || '', documentExpiry: p.documentExpiry || ''
  };
}

function ageOnDate(birthdate, isoDate) {
  if (!birthdate || !isoDate) return null;
  const b = new Date(`${birthdate}T00:00:00Z`);
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime()) || b > d) return null;
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday = d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

function validatePassenger(data, { expectedType, returnDate, allPassengers, index }) {
  const errors = {};
  if (!data.name.trim()) errors.name = 'Indique o primeiro nome tal como aparece no documento.';
  if (!data.surname.trim()) errors.surname = 'Indique o apelido tal como aparece no documento.';
  if (!data.birthdate) errors.birthdate = 'A data de nascimento é obrigatória para validar o tipo de passageiro.';
  const age = ageOnDate(data.birthdate, returnDate);
  if (data.birthdate && age === null) errors.birthdate = 'Esta data de nascimento não parece válida.';
  if (age !== null && age > 110) errors.birthdate = 'Esta idade parece incorreta. Confirme a data de nascimento.';
  if (age !== null && expectedType === 'ADT' && age < 12) errors.birthdate = `Este passageiro terá ${age} ano${age === 1 ? '' : 's'} na viagem e não pode estar num lugar de adulto.`;
  if (age !== null && expectedType === 'CHD' && age >= 12) errors.birthdate = `Este passageiro terá ${age} anos na viagem e deve ser pesquisado como adulto.`;
  if (age !== null && expectedType === 'CHD' && age < 2) errors.birthdate = 'Este passageiro terá menos de 2 anos. Deve ser pesquisado como bebé para obter tarifa e condições corretas.';
  if (age !== null && expectedType === 'INF' && age >= 2) errors.birthdate = `Este passageiro terá ${age} anos na viagem e deve ser pesquisado como criança.`;
  if (!data.nationality.trim()) errors.nationality = 'Indique a nacionalidade do passageiro.';
  if (!data.documentType) errors.documentType = 'Escolha o documento que será usado na viagem.';
  if (!data.documentNumber.trim()) errors.documentNumber = 'Indique o número do documento.';
  if (!data.documentCountry.trim()) errors.documentCountry = 'Indique o país emissor do documento.';
  if (!data.documentExpiry) errors.documentExpiry = 'Indique a validade do documento.';
  if (data.documentExpiry) {
    const expiry = new Date(`${data.documentExpiry}T00:00:00Z`);
    const ret = new Date(`${returnDate}T00:00:00Z`);
    if (Number.isNaN(expiry.getTime())) errors.documentExpiry = 'A data de validade não é válida.';
    else if (expiry < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) errors.documentExpiry = 'Este documento já está caducado.';
    else if (returnDate && expiry < ret) errors.documentExpiry = 'O documento estará caducado antes do regresso da viagem.';
  }
  if (data.documentNumber.trim()) {
    const duplicate = allPassengers.some((p, i) => i !== index && p?.documentNumber && p.documentNumber.trim().toLowerCase() === data.documentNumber.trim().toLowerCase());
    if (duplicate) errors.documentNumber = 'Este número de documento já está associado a outro passageiro.';
  }
  return errors;
}

function renderErrors(errors) {
  document.querySelectorAll('[data-field-error]').forEach(el => { el.textContent = ''; el.hidden = true; });
  document.querySelectorAll('#passengerForm input, #passengerForm select').forEach(el => el.classList.remove('is-invalid'));
  Object.entries(errors).forEach(([field, message]) => {
    const input = document.querySelector(`#passengerForm [name="${field}"]`);
    input?.classList.add('is-invalid');
    const msg = document.querySelector(`[data-field-error="${field}"]`);
    if (msg) { msg.textContent = message; msg.hidden = false; }
  });
}

export async function renderPassengerStep() {
  if (isEmailVerified() && getSavedPassengers() === null) {
    try {
      const data = await api('/api/customer/profile');
      setSavedPassengers(data.customer.passengers || []);
    } catch { setSavedPassengers([]); }
  }

  const offer = getCurrentOffer();
  const adults = Number(offer.adults || 1);
  const children = Number(offer.children || 0);
  const infants = Number(offer.infants || 0);
  const total = adults + children + infants;
  const index = Math.min(getPassengerIndex(), Math.max(0, total - 1));
  const expectedType = index < adults ? 'ADT' : index < adults + children ? 'CHD' : 'INF';
  const label = expectedType === 'ADT' ? `Adulto ${index + 1}` : expectedType === 'CHD' ? `Criança ${index - adults + 1}` : `Bebé ${index - adults - children + 1}`;
  const isLast = index === total - 1;

  const passengers = getPassengers();
  const bookerDefault = index === 0 && getBookerTravels()
    ? { ...guessFirstAndLastName(getBilling().name), nationality: 'Portuguesa', documentCountry: 'Portugal', documentType: 'CC' }
    : null;
  const existing = passengers[index] || bookerDefault || { nationality: 'Portuguesa', documentCountry: 'Portugal', documentType: 'CC' };

  const assignedElsewhere = new Set(passengers.map((p, i) => (i !== index && p) ? `${p.name || ''} ${p.surname || ''}`.trim().toLowerCase() : null).filter(Boolean));
  const pickable = (getSavedPassengers() || []).filter(w => !assignedElsewhere.has((w.name || '').trim().toLowerCase()));

  $('#checkoutMain').innerHTML = `
    <form id="passengerForm" class="checkout-form" novalidate>
      <div class="checkout-step-heading"><div><p class="eyebrow">Passageiros</p><h3>${label}</h3></div><span class="step-count">${index + 1} de ${total}</span></div>
      <div class="legal-notice compact"><span class="legal-notice-icon">✓</span><p>Preencha os dados exatamente como constam no documento. O site valida idade, duplicados e validade antes de deixar avançar.</p></div>
      ${pickable.length ? `<div class="saved-passenger-box"><span class="field-label">Usar passageiro guardado</span><div class="saved-passenger-chips">${pickable.map(w => `<button type="button" class="ghost mini-action saved-passenger-chip" data-id="${esc(w.id)}">${esc(w.name)}</button>`).join('')}</div></div>` : ''}
      <div class="passenger-card">
        <div class="passenger-card-grid">
          ${field('name','Nome',existing.name,'text','given-name')}
          ${field('surname','Apelido',existing.surname,'text','family-name')}
          ${field('birthdate','Data de nascimento',existing.birthdate,'date','bday')}
          <label>Género <select name="gender"><option value="" ${!existing.gender ? 'selected' : ''}>Não indicar</option><option value="F" ${existing.gender === 'F' ? 'selected' : ''}>Feminino</option><option value="M" ${existing.gender === 'M' ? 'selected' : ''}>Masculino</option></select><span class="field-error-text" data-field-error="gender" hidden></span></label>
          ${field('nationality','Nacionalidade',existing.nationality,'text','country-name')}
          <label>Tipo de documento <select name="documentType" required><option value="CC" ${(existing.documentType || 'CC') === 'CC' ? 'selected' : ''}>Cartão de Cidadão</option><option value="PASSPORT" ${existing.documentType === 'PASSPORT' ? 'selected' : ''}>Passaporte</option></select><span class="field-error-text" data-field-error="documentType" hidden></span></label>
          ${field('documentNumber','Número do documento',existing.documentNumber,'text','off')}
          ${field('documentCountry','País emissor',existing.documentCountry || 'Portugal','text','country-name')}
          ${field('documentExpiry','Validade do documento',existing.documentExpiry,'date','off')}
        </div>
      </div>
      <label class="consent"><input type="checkbox" id="saveToWalletCheck" /><span>Guardar este passageiro na minha lista para futuras viagens</span></label>
      ${isLast ? '<div class="ready-to-pay"><b>Próximo passo: extras</b><span>Revise os serviços da viagem antes de escolher o método de pagamento.</span></div>' : ''}
      <div id="passengerFormError"></div>
      <div class="passenger-nav"><button class="ghost" type="button" id="passengerBack">Voltar</button><button class="btn wide" type="submit">${isLast ? 'Validar passageiros e continuar' : 'Guardar e seguinte'}</button></div>
      <p class="autosave-line" id="checkoutAutosaveStatus">✓ Guardado automaticamente neste checkout</p>
    </form>`;

  function field(name, labelText, value = '', type = 'text', autocomplete = 'off') {
    return `<label>${labelText}<input name="${name}" type="${type}" value="${esc(value || '')}" autocomplete="${autocomplete}" required /><span class="field-error-text" data-field-error="${name}" hidden></span></label>`;
  }

  document.querySelectorAll('.saved-passenger-chip').forEach(chip => {
    chip.onclick = () => {
      const w = pickable.find(x => x.id === chip.dataset.id);
      if (!w) return;
      setPassenger(index, fromWalletShape(w));
      renderPassengerStep();
    };
  });

  const form = $('#passengerForm');
  form.querySelectorAll('input,select').forEach(input => {
    input.addEventListener('change', () => { setPassenger(index, readPassengerForm()); setAutosaveStatus(); });
  });

  $('#passengerBack').onclick = () => {
    setPassenger(index, readPassengerForm());
    if (index === 0) { setCheckoutStep(1); renderCheckoutStep1(); }
    else { setPassengerIndex(index - 1); renderPassengerStep(); }
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = readPassengerForm();
    const all = [...getPassengers()]; all[index] = data;
    const errors = validatePassenger(data, { expectedType, returnDate: offer.checkout, allPassengers: all, index });
    renderErrors(errors);
    if (Object.keys(errors).length) {
      $('#passengerFormError').innerHTML = '<p class="error">Revise os campos assinalados. Só avançamos quando os dados essenciais estiverem coerentes.</p>';
      return;
    }
    $('#passengerFormError').innerHTML = '';
    setPassenger(index, data);
    if ($('#saveToWalletCheck').checked) await saveToWallet(data, index === 0 && getBookerTravels() ? 'TITULAR' : 'OUTRO');
    if (!isLast) { setPassengerIndex(index + 1); renderPassengerStep(); return; }
    await submitCheckout(e.target);
  });
}

async function saveToWallet(passengerData, relationship) {
  const wallet = toWalletShape(passengerData, relationship);
  if (!wallet.name) return;
  const current = getSavedPassengers() || [];
  const matchIdx = current.findIndex(w => (w.name || '').trim().toLowerCase() === wallet.name.trim().toLowerCase());
  const next = matchIdx >= 0 ? current.map((w, i) => i === matchIdx ? { ...w, ...wallet, id: w.id } : w) : [...current, wallet];
  try {
    const data = await api('/api/customer/passengers', { method: 'POST', body: JSON.stringify({ passengers: next }) });
    setSavedPassengers(data.customer.passengers || next);
  } catch {}
}

function readPassengerForm() {
  const f = formToJson($('#passengerForm'));
  return {
    name: f.name || '', surname: f.surname || '', birthdate: f.birthdate || '', gender: f.gender || '', nationality: f.nationality || '',
    documentType: f.documentType || '', documentNumber: f.documentNumber || '', documentCountry: f.documentCountry || '', documentExpiry: f.documentExpiry || ''
  };
}

async function submitCheckout(form) {
  const currentOffer = getCurrentOffer();
  if (!currentOffer) return;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'A validar e guardar...';
  const billing = getBilling();
  const adults = Number(currentOffer.adults || 1);
  const children = Number(currentOffer.children || 0);
  const infants = Number(currentOffer.infants || 0);
  const total = adults + children + infants;
  const passengerPayloads = getPassengers().slice(0, total).map((p, i) => ({ ...p, type: i < adults ? 'ADT' : i < adults + children ? 'CHD' : 'INF' }));
  try {
    const data = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ offer: currentOffer, customer: { ...billing, passengers: passengerPayloads }, passengers: passengerPayloads, paymentMethod: 'MB WAY', idempotencyKey: `${currentOffer.id}-${billing.email}-${Date.now()}` })
    });
    setLastPayment(data.payment); setLastReservation(data.reservation); setReservationCreated(true);
    setCheckoutStep(3); renderCheckoutExtras(data);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Validar passageiros e continuar';
    $('#passengerFormError').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}
