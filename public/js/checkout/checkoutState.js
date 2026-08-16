// Estado do fluxo de checkout (Faturacao -> Passageiros), vivo enquanto o
// modal esta aberto. Modulo dedicado, sem DOM nem logica - so para as
// etapas nao terem de se passar estes valores umas as outras a mao.

let billing = { name: '', email: '', phone: '', nif: '', address: '' };
let emailVerified = false;
let verifyChallenge = null;
let passengers = [];
let currentPassengerIndex = 0;
let reservationCreated = false;
let hasPassword = false;
let existingProfile = null;
let savedPassengers = null;

export const getBilling = () => billing;
export const setBilling = value => { billing = value; };

// Perfil do cliente tal como estava gravado antes desta reserva (ou null se
// nao houver conta) - guardado no momento do pre-preenchimento, para saber
// que campos ja estavam la (e por isso nao devem ser reescritos "por cima"
// nem, no caso do NIF, deixados editar sem mais).
export const getExistingProfile = () => existingProfile;
export const setExistingProfile = value => { existingProfile = value; };

// Carteira de passageiros do cliente (null = ainda nao carregada nesta
// sessao de checkout). Carregada uma vez, atualizada depois de cada
// "guardar para o futuro" na etapa de passageiros.
export const getSavedPassengers = () => savedPassengers;
export const setSavedPassengers = value => { savedPassengers = value; };

export const isEmailVerified = () => emailVerified;
export const setEmailVerified = value => { emailVerified = value; };

export const getVerifyChallenge = () => verifyChallenge;
export const setVerifyChallenge = value => { verifyChallenge = value; };

export const getPassengers = () => passengers;
export const setPassenger = (index, data) => { passengers[index] = data; };

export const getPassengerIndex = () => currentPassengerIndex;
export const setPassengerIndex = value => { currentPassengerIndex = value; };

export const setReservationCreated = value => { reservationCreated = value; };

export const hasExistingPassword = () => hasPassword;
export const setHasExistingPassword = value => { hasPassword = value; };

// Ha dados que se perdem ao fechar? So enquanto a reserva ainda nao foi
// criada no servidor (etapas 1-2) e ja se escreveu ou verificou alguma
// coisa - depois de criada, ja esta guardada (ver "Guardar e continuar
// mais tarde" na etapa de Pagamento), fechar nao perde nada.
export function hasCheckoutProgress() {
  if (reservationCreated) return false;
  return emailVerified || Boolean(billing.name || billing.phone) || passengers.length > 0;
}

export function resetCheckoutState() {
  billing = { name: '', email: '', phone: '', nif: '', address: '' };
  emailVerified = false;
  verifyChallenge = null;
  passengers = [];
  currentPassengerIndex = 0;
  reservationCreated = false;
  hasPassword = false;
  existingProfile = null;
  savedPassengers = null;
}
