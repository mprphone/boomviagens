// Mesma formula de src/domain.js#computeServiceTotals - duplicada aqui de
// proposito (o backoffice nao importa ficheiros do servidor). Usada pelo
// separador Servicos e pelo Resumo para mostrar os "Valores Reais" da
// reserva (soma das linhas de compra/venda), a comparar com a proposta
// original guardada em reservation.offer.

export function computeServiceTotals(lines = []) {
  let netTotal = 0;
  let pvpTotal = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity) || 1;
    const net = (Number(line.netValue) || 0) * quantity;
    const gross = (Number(line.pvpValue) || 0) * quantity;
    const discount = gross * (Number(line.discountPercent) || 0) / 100;
    netTotal += net;
    pvpTotal += gross - discount;
  }
  netTotal = Number(netTotal.toFixed(2));
  pvpTotal = Number(pvpTotal.toFixed(2));
  return { netTotal, pvpTotal, margin: Number((pvpTotal - netTotal).toFixed(2)) };
}

export function lineTotal(line) {
  const quantity = Number(line.quantity) || 1;
  const gross = (Number(line.pvpValue) || 0) * quantity;
  const discount = gross * (Number(line.discountPercent) || 0) / 100;
  return Number((gross - discount).toFixed(2));
}
