function proposalEmail({ customer, results, search }) {
  const top = results.slice(0, 3);
  const lines = top.map((r, i) => `${i + 1}. ${r.hotel} - ${r.destination} - ${r.board} - ${r.nights} noites - ${r.finalPrice.toFixed(2)} €`).join('\n');
  return {
    subject: `Proposta Boom das Viagens - ${search.destination || 'férias à medida'}`,
    body: `Olá ${customer.name || ''},\n\nEncontrámos estas opções para a sua pesquisa:\n\n${lines}\n\nA opção recomendada é: ${top[0]?.hotel || 'em análise'}.\n\nSe pretender avançar, responda a este email ou finalize a reserva na sua área de cliente.\n\nCumprimentos,\nBoom das Viagens`
  };
}

function reservationEmail({ reservation, payment }) {
  return {
    subject: `Reserva ${reservation.id} - ${reservation.status}`,
    body: `Olá ${reservation.customer?.name || ''},\n\nRecebemos o seu pedido de reserva para ${reservation.offer?.hotel}, ${reservation.offer?.destination}.\n\nEstado: ${reservation.status}\nValor: ${reservation.offer?.finalPrice?.toFixed(2)} €\nPagamento: ${payment?.method || 'não indicado'} - ${payment?.status || 'pendente'}\n\nA equipa Boom das Viagens acompanha a validação final do operador.\n\nObrigado,\nBoom das Viagens`
  };
}

module.exports = { proposalEmail, reservationEmail };
