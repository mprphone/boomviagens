// Estado partilhado entre o passo de revisao e o checkout: a oferta
// escolhida e o pagamento/reserva criados. Um modulo pequeno e dedicado
// evita que review.js e checkout.js tenham de se importar um ao outro.

let currentOffer = null;
let lastPayment = null;
let lastReservation = null;

export const getCurrentOffer = () => currentOffer;
export const setCurrentOffer = offer => { currentOffer = offer; };

export const getLastPayment = () => lastPayment;
export const setLastPayment = payment => { lastPayment = payment; };

export const getLastReservation = () => lastReservation;
export const setLastReservation = reservation => { lastReservation = reservation; };
