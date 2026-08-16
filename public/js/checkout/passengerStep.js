// Etapa 2: um passageiro por ecra (Seguinte/Voltar), para nunca precisar
// de scroll mesmo com varios adultos/criancas. O ultimo passageiro traz
// tambem o metodo de pagamento e os consentimentos finais, porque e o
// ecra que efetivamente cria a reserva (POST /api/checkout).

import { $, esc, api, formToJson } from '../utils.js';
import { getCurrentOffer, setLastPayment, setLastReservation } from '../state.js';
import { setCheckoutStep } from './checkoutShell.js';
import { getBilling, getPassengers, setPassenger, getPassengerIndex, setPassengerIndex, setReservationCreated, isEmailVerified, getSavedPassengers, setSavedPassengers } from './checkoutState.js';
import { renderCheckoutStep1 } from './billingStep.js';
import { renderCheckoutStep3 } from './paymentStep.js';

function guessFirstAndLastName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length < 2) return { name: fullName || '', surname: '' };
  return { name: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

// Traduz um passageiro da carteira (public/conta/js/passengers.js, campo
// "name" unico) para o formato dos campos deste passo (name/surname
// separados) - so os campos que existem dos dois lados.
function fromWalletShape(w) {
  return {
    ...guessFirstAndLastName(w.name),
    birthdate: w.birthdate || '',
    gender: '',
    nationality: w.nationality || 'Portuguesa',
    documentType: w.documentType === 'PASSPORT' ? 'PASSPORT' : 'CC',
    documentNumber: w.documentNumber || '',
    documentCountry: 'Portugal',
    documentExpiry: w.documentExpiry || ''
  };
}

// Sentido inverso, para guardar um passageiro deste passo na carteira -
// so os campos que a carteira conhece (ver toWalletShape/fromWalletShape em
// public/conta/js/passengers.js).
function toWalletShape(p) {
  return {
    name: [p.name, p.surname].filter(Boolean).join(' '),
    birthdate: p.birthdate || '',
    nationality: p.nationality || '',
    documentType: p.documentType === 'PASSPORT' ? 'PASSPORT' : 'CC',
    documentNumber: p.documentNumber || '',
    documentExpiry: p.documentExpiry || ''
  };
}

export async function renderPassengerStep() {
  // Carteira de passageiros do cliente (se tiver sessao) - carregada uma so
  // vez por checkout, reaproveitada nos passos seguintes/anteriores.
  if (isEmailVerified() && getSavedPassengers() === null) {
    try {
      const data = await api('/api/customer/profile');
      setSavedPassengers(data.customer.passengers || []);
    } catch {
      setSavedPassengers([]);
    }
  }

  const offer = getCurrentOffer();
  const adults = offer.adults || 1;
  const total = adults + (offer.children || 0);
  const index = getPassengerIndex();
  const isChild = index >= adults;
  const label = isChild ? `Criança ${index - adults + 1}` : `Adulto ${index + 1}`;
  const isLast = index === total - 1;

  const passengers = getPassengers();
  const existing = passengers[index] || (index === 0
    ? { ...guessFirstAndLastName(getBilling().name), nationality: 'Portuguesa' }
    : { nationality: 'Portuguesa' });

  // So oferece passageiros da carteira que ainda nao estao atribuidos a
  // outro lugar desta mesma reserva (nao faz sentido escolher a mesma
  // pessoa duas vezes).
  const assignedElsewhere = new Set(passengers
    .map((p, i) => (i !== index && p) ? `${p.name || ''} ${p.surname || ''}`.trim().toLowerCase() : null)
    .filter(Boolean));
  const pickable = (getSavedPassengers() || []).filter(w => !assignedElsewhere.has((w.name || '').trim().toLowerCase()));

  $('#checkoutMain').innerHTML = `
    <form id="passengerForm" class="checkout-form">
      <h3>Passageiros</h3>
      <div class="passenger-progress"><span>${label}</span><span>${index + 1} de ${total}</span></div>
      <div class="legal-notice">
        <span class="legal-notice-icon">⚠️</span>
        <p>Os nomes têm de corresponder exatamente ao documento de identificação (Cartão de Cidadão ou Passaporte). Correções depois da confirmação podem implicar custos adicionais cobrados pelo operador.</p>
      </div>
      ${pickable.length ? `
        <div class="field-label">Passageiros guardados</div>
        <div class="saved-passenger-chips">
          ${pickable.map(w => `<button type="button" class="ghost mini-action saved-passenger-chip" data-id="${esc(w.id)}">${esc(w.name)}</button>`).join('')}
        </div>` : ''}
      <div class="passenger-card">
        <div class="passenger-card-grid">
          <label>Nome <input name="name" value="${esc(existing.name || '')}" required /></label>
          <label>Apelido <input name="surname" value="${esc(existing.surname || '')}" /></label>
          <label>Data de nascimento <input name="birthdate" type="date" value="${esc(existing.birthdate || '')}" /></label>
          <label>Género
            <select name="gender">
              <option value="" ${!existing.gender ? 'selected' : ''}>Prefiro não indicar</option>
              <option value="F" ${existing.gender === 'F' ? 'selected' : ''}>Feminino</option>
              <option value="M" ${existing.gender === 'M' ? 'selected' : ''}>Masculino</option>
            </select>
          </label>
          <label>Nacionalidade <input name="nationality" value="${esc(existing.nationality || '')}" /></label>
          <label>Tipo de documento
            <select name="documentType">
              <option value="CC" ${(existing.documentType || 'CC') === 'CC' ? 'selected' : ''}>Cartão de Cidadão</option>
              <option value="PASSPORT" ${existing.documentType === 'PASSPORT' ? 'selected' : ''}>Passaporte</option>
            </select>
          </label>
          <label>Número do documento <input name="documentNumber" value="${esc(existing.documentNumber || '')}" /></label>
          <label>País do documento <input name="documentCountry" value="${esc(existing.documentCountry || 'Portugal')}" /></label>
          <label>Validade do documento <input name="documentExpiry" type="date" value="${esc(existing.documentExpiry || '')}" /></label>
        </div>
      </div>
      <label class="consent"><input type="checkbox" id="saveToWalletCheck" /><span>Guardar este passageiro na minha lista para reservas futuras</span></label>
      ${isLast ? `
        <label class="consent"><input type="checkbox" required /><span>Confirmo que os nomes e dados dos passageiros estão corretos e coincidem com o documento de identificação que vão usar na viagem.</span></label>
        <label class="field-label">Método de pagamento</label>
        <div class="payment-methods" role="radiogroup" aria-label="Metodo de pagamento">
          <label class="payment-option"><input type="radio" name="paymentMethod" value="MB WAY" checked /><span class="payment-option-icon">\u{1F4F1}</span><span>MB WAY</span></label>
          <label class="payment-option"><input type="radio" name="paymentMethod" value="Referência Multibanco" /><span class="payment-option-icon">\u{1F3E7}</span><span>Multibanco</span></label>
          <label class="payment-option"><input type="radio" name="paymentMethod" value="Cartão" /><span class="payment-option-icon">\u{1F4B3}</span><span>Cartão</span></label>
        </div>
        <label class="consent"><input type="checkbox" required /><span>Li e aceito os <a href="#legal">Termos e Condições</a> e a <a href="#legal">Política de Privacidade</a>.</span></label>
      ` : ''}
      <div id="passengerFormError"></div>
      <div class="passenger-nav">
        <button class="ghost" type="button" id="passengerBack">Voltar</button>
        <button class="btn wide" type="submit">${isLast ? 'Continuar para pagamento' : 'Seguinte'}</button>
      </div>
    </form>`;

  document.querySelectorAll('.saved-passenger-chip').forEach(chip => {
    chip.onclick = () => {
      const w = pickable.find(x => x.id === chip.dataset.id);
      if (!w) return;
      setPassenger(index, fromWalletShape(w));
      renderPassengerStep();
    };
  });

  $('#passengerBack').onclick = () => {
    setPassenger(index, readPassengerForm());
    if (index === 0) {
      setCheckoutStep(1);
      renderCheckoutStep1();
    } else {
      setPassengerIndex(index - 1);
      renderPassengerStep();
    }
  };

  $('#passengerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = readPassengerForm();
    setPassenger(index, data);
    // Aguarda-se: se nao ficasse serializado com o passageiro seguinte, os
    // dois "guardar na carteira" (cada um substitui a lista completa) podiam
    // correr em paralelo com a mesma lista em cache e o segundo apagava o
    // primeiro.
    if ($('#saveToWalletCheck').checked) await saveToWallet(data);
    if (!isLast) {
      setPassengerIndex(index + 1);
      renderPassengerStep();
      return;
    }
    await submitCheckout(e.target);
  });
}

// Melhor esforco, nao bloqueia o avanco no checkout se falhar - so grava
// para a proxima reserva ser mais rapida. Atualiza uma entrada existente
// (mesmo nome) em vez de duplicar.
async function saveToWallet(passengerData) {
  const wallet = toWalletShape(passengerData);
  if (!wallet.name) return;
  const current = getSavedPassengers() || [];
  const matchIdx = current.findIndex(w => (w.name || '').trim().toLowerCase() === wallet.name.trim().toLowerCase());
  const next = matchIdx >= 0
    ? current.map((w, i) => i === matchIdx ? { ...w, ...wallet, id: w.id } : w)
    : [...current, wallet];
  try {
    const data = await api('/api/customer/passengers', { method: 'POST', body: JSON.stringify({ passengers: next }) });
    setSavedPassengers(data.customer.passengers || next);
  } catch {
    // Sem sorte desta vez - a reserva segue na mesma.
  }
}

function readPassengerForm() {
  const f = formToJson($('#passengerForm'));
  return {
    name: f.name || '',
    surname: f.surname || '',
    birthdate: f.birthdate || '',
    gender: f.gender || '',
    nationality: f.nationality || '',
    documentType: f.documentType || '',
    documentNumber: f.documentNumber || '',
    documentCountry: f.documentCountry || '',
    documentExpiry: f.documentExpiry || ''
  };
}

async function submitCheckout(form) {
  const currentOffer = getCurrentOffer();
  if (!currentOffer) return;
  const f = formToJson(form);
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'A criar reserva...';
  $('#passengerFormError').innerHTML = '';
  const billing = getBilling();
  const adults = currentOffer.adults || 1;
  const total = adults + (currentOffer.children || 0);
  const passengerPayloads = getPassengers().slice(0, total).map((p, i) => ({ ...p, type: i < adults ? 'ADT' : 'CHD' }));
  try {
    const data = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        offer: currentOffer,
        customer: { ...billing, passengers: passengerPayloads },
        paymentMethod: f.paymentMethod,
        idempotencyKey: `${currentOffer.id}-${billing.email}-${Date.now()}`
      })
    });
    setLastPayment(data.payment);
    setLastReservation(data.reservation);
    setReservationCreated(true);
    setCheckoutStep(3);
    renderCheckoutStep3(data);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Continuar para pagamento';
    $('#passengerFormError').innerHTML = `<p class="error">${err.message}</p>`;
  }
}
