function proposalEmail({ customer, results, search }) {
  const top = results.slice(0, 3);
  const lines = top.map((r, i) => `${i + 1}. ${r.hotel} - ${r.destination} - ${r.board} - ${r.nights} noites - ${r.finalPrice.toFixed(2)} €`).join('\n');
  return {
    subject: `Proposta Boomviagens - ${search.destination || 'férias à medida'}`,
    body: `Olá ${customer.name || ''},\n\nEncontrámos estas opções para a sua pesquisa:\n\n${lines}\n\nA opção recomendada é: ${top[0]?.hotel || 'em análise'}.\n\nSe pretender avançar, responda a este email ou finalize a reserva na sua área de cliente.\n\nCumprimentos,\nBoomviagens`
  };
}

function reservationEmail({ reservation, payment }) {
  return {
    subject: `Reserva ${reservation.id} - ${reservation.status}`,
    body: `Olá ${reservation.customer?.name || ''},\n\nRecebemos o seu pedido de reserva para ${reservation.offer?.hotel}, ${reservation.offer?.destination}.\n\nEstado: ${reservation.status}\nValor: ${reservation.offer?.finalPrice?.toFixed(2)} €\nPagamento: ${payment?.method || 'não indicado'} - ${payment?.status || 'pendente'}\n\nA equipa Boomviagens acompanha a validação final do operador.\n\nObrigado,\nBoomviagens`
  };
}

function loginCodeEmail({ email, code }) {
  return {
    subject: 'O seu codigo de acesso Boomviagens',
    body: `Ola,\n\nO seu codigo de acesso a area de cliente Boomviagens e:\n\n${code}\n\nEste codigo expira em 10 minutos. Se nao pediu este codigo, ignore este email.\n\nBoomviagens`
  };
}

module.exports = { proposalEmail, reservationEmail, loginCodeEmail };
