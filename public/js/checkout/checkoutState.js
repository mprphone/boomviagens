// Estado do fluxo de checkout (Faturacao -> Passageiros), vivo enquanto o
// modal esta aberto. Modulo dedicado, sem DOM nem logica - so para as
// etapas nao terem de se passar estes valores umas as outras a mao.

let billing = { name: '', email: '', phone: '', nif: '', address: '' };
let emailVerified = false;
let verifyChallenge = null;
let passengers = [];
let currentPassengerIndex = 0;
let reservationCreated = false;

export const getBilling = () => billing;
export const setBilling = value => { billing = value; };

export const isEmailVerified = () => emailVerified;
export const setEmailVerified = value => { emailVerified = value; };

export const getVerifyChallenge = () => verifyChallenge;
export const setVerifyChallenge = value => { verifyChallenge = value; };

export const getPassengers = () => passengers;
export const setPassenger = (index, data) => { passengers[index] = data; };

export const getPassengerIndex = () => currentPassengerIndex;
export const setPassengerIndex = value => { currentPassengerIndex = value; };

export const setReservationCreated = value => { reservationCreated = value; };

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
}
