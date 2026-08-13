// Aplica uma opcao de quarto/tarifa escolhida a uma oferta - usado tanto
// ao reservar uma tarifa nos resultados como ao aplicar uma sugestao de
// upgrade no passo de revisao.

export function applyRoomOption(offer, option) {
  offer.finalPrice = option.finalPrice;
  offer.costPrice = option.costPrice;
  offer.marginRule = option.marginRule;
  offer.marginPercent = option.marginPercent;
  offer.marginValue = option.marginValue;
  offer.board = option.mealPlanLabel;
  offer.freeCancellation = option.freeCancellation;
  offer.tourdiez = { ...offer.tourdiez, idDistributions: option.idDistributions, code: option.roomCode || offer.tourdiez?.code };
}
