// Estado do fluxo de checkout. Os dados sensiveis do passageiro ficam apenas
// em sessionStorage (mesma janela/separador) para sobreviver a refreshs sem
// ficarem persistidos indefinidamente no dispositivo. A viagem/oferta pode
// ser guardada separadamente sem documentos pessoais (ver review.js).

const STORAGE_KEY = 'boom_checkout_draft_v2';

let billing = { name: '', email: '', phone: '', nif: '', address: '', city: '', postalCode: '' };
let emailVerified = false;
let verifyChallenge = null;
let passengers = [];
let currentPassengerIndex = 0;
let reservationCreated = false;
let hasPassword = false;
let existingProfile = null;
let savedPassengers = null;
let bookerTravels = true;
let lastSavedAt = null;
let draftOfferId = null;
let draftOwnerEmail = null;

function snapshot() {
  return { billing, passengers, currentPassengerIndex, bookerTravels, draftOfferId, draftOwnerEmail, lastSavedAt: new Date().toISOString() };
}

function persist() {
  try {
    const value = snapshot();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    lastSavedAt = value.lastSavedAt;
  } catch {
    // Nao bloqueia o checkout se o browser nao permitir storage.
  }
}

export function restoreCheckoutDraft(expectedOfferId = null) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (expectedOfferId && data.draftOfferId && data.draftOfferId !== expectedOfferId) return false;
    if (data.billing) billing = { ...billing, ...data.billing };
    if (Array.isArray(data.passengers)) passengers = data.passengers;
    if (Number.isInteger(data.currentPassengerIndex)) currentPassengerIndex = data.currentPassengerIndex;
    if (typeof data.bookerTravels === 'boolean') bookerTravels = data.bookerTravels;
    draftOfferId = data.draftOfferId || expectedOfferId || null;
    draftOwnerEmail = data.draftOwnerEmail ? String(data.draftOwnerEmail).toLowerCase() : null;
    lastSavedAt = data.lastSavedAt || null;
    return Boolean(billing.name || billing.email || passengers.length);
  } catch {
    return false;
  }
}

export function clearCheckoutDraft() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  lastSavedAt = null;
}

export const getBilling = () => billing;
export const setBilling = value => { billing = value; persist(); };

export const getExistingProfile = () => existingProfile;
export const setExistingProfile = value => { existingProfile = value; };

export const getSavedPassengers = () => savedPassengers;
export const setSavedPassengers = value => { savedPassengers = value; };

export const isEmailVerified = () => emailVerified;
export const setEmailVerified = value => { emailVerified = value; };

export const getVerifyChallenge = () => verifyChallenge;
export const setVerifyChallenge = value => { verifyChallenge = value; };

export const getPassengers = () => passengers;
export const setPassengers = value => { passengers = Array.isArray(value) ? value : []; persist(); };
export const setPassenger = (index, data) => { passengers[index] = data; persist(); };

export const getPassengerIndex = () => currentPassengerIndex;
export const setPassengerIndex = value => { currentPassengerIndex = value; persist(); };

export const getBookerTravels = () => bookerTravels;
export const setBookerTravels = value => { bookerTravels = Boolean(value); persist(); };

export const getLastSavedAt = () => lastSavedAt;
export const setDraftOfferId = value => { draftOfferId = value || null; persist(); };
export const getDraftOfferId = () => draftOfferId;

export function setCheckoutOwnerEmail(value) {
  const next = value ? String(value).trim().toLowerCase() : null;
  const billingEmail = String(billing.email || '').trim().toLowerCase();
  const belongsToAnotherAccount = Boolean(
    (draftOwnerEmail && draftOwnerEmail !== next) ||
    (!draftOwnerEmail && next && billingEmail && billingEmail !== next)
  );
  if (belongsToAnotherAccount) {
    billing = { name: '', email: '', phone: '', nif: '', address: '', city: '', postalCode: '' };
    passengers = [];
    currentPassengerIndex = 0;
    existingProfile = null;
    savedPassengers = null;
    emailVerified = false;
    clearCheckoutDraft();
  }
  draftOwnerEmail = next;
  persist();
}

export const setReservationCreated = value => { reservationCreated = value; if (value) clearCheckoutDraft(); };

export const hasExistingPassword = () => hasPassword;
export const setHasExistingPassword = value => { hasPassword = value; };

export function hasCheckoutProgress() {
  if (reservationCreated) return false;
  return emailVerified || Boolean(billing.name || billing.phone || billing.email) || passengers.length > 0;
}

export function resetCheckoutState({ keepDraft = false } = {}) {
  billing = { name: '', email: '', phone: '', nif: '', address: '' };
  emailVerified = false;
  verifyChallenge = null;
  passengers = [];
  currentPassengerIndex = 0;
  reservationCreated = false;
  hasPassword = false;
  existingProfile = null;
  savedPassengers = null;
  bookerTravels = true;
  draftOfferId = null;
  draftOwnerEmail = null;
  if (!keepDraft) clearCheckoutDraft();
}
