// Estado do fluxo de checkout (Faturacao -> Passageiros), vivo enquanto o
// modal esta aberto. Modulo dedicado, sem DOM nem logica - so para as
// etapas nao terem de se passar estes valores umas as outras a mao.

let billing = { name: '', email: '', phone: '', nif: '', address: '' };
let emailVerified = false;
let verifyChallenge = null;
let passengers = [];
let currentPassengerIndex = 0;

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

export function resetCheckoutState() {
  billing = { name: '', email: '', phone: '', nif: '', address: '' };
  emailVerified = false;
  verifyChallenge = null;
  passengers = [];
  currentPassengerIndex = 0;
}
