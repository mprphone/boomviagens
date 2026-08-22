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

// Pedido de documentacao em falta (reserva em AWAITING_DOCUMENTS) e o
// lembrete automatico do cron /api/cron/document-reminders - o mesmo
// conteudo, so muda o assunto e a primeira frase.
function documentRequestEmail({ reservation, missingDocuments = [], reminder = false }) {
  const list = missingDocuments.length
    ? missingDocuments.map(doc => `- ${doc}`).join('\n')
    : '- A nossa equipa confirmará consigo quais os documentos necessários.';
  const intro = reminder
    ? 'Ainda não recebemos toda a documentação necessária para a sua viagem. Este é um lembrete amigável:'
    : 'Para avançarmos com a preparação da sua viagem, precisamos que nos envie a seguinte documentação:';
  return {
    subject: `${reminder ? 'Lembrete: d' : 'D'}ocumentos em falta - Reserva ${reservation.id}`,
    body: `Olá ${reservation.customer?.name || ''},\n\n${intro}\n\n${list}\n\nPode enviar os documentos comodamente na sua Área de Cliente (separador Documentos) ou responder a este email.\n\nObrigado,\nBoomviagens`
  };
}

// Lembrete unico por reserva de pagamento pendente (cron
// /api/cron/customer-notifications) - aponta sempre para a Area de
// Cliente, onde a reserva pode ser retomada e paga.
function paymentReminderEmail({ reservation, payment, accountUrl }) {
  const destination = reservation.offer?.destination || reservation.offer?.hotel || 'a sua viagem';
  return {
    subject: `Lembrete: pagamento pendente - Reserva ${reservation.id}`,
    body: `Olá ${reservation.customer?.name || ''},\n\nA sua reserva para ${destination} continua guardada, mas ainda não recebemos o pagamento${payment?.amount ? ` de ${Number(payment.amount).toFixed(2)} €` : ''}.\n\nPara não perder a reserva, conclua o pagamento na sua Área de Cliente:\n${accountUrl}\n\nSe já pagou ou precisar de ajuda, responda a este email.\n\nObrigado,\nBoomviagens`
  };
}

// Alerta unico por reserva de viagem proxima (7 dias antes do check-in,
// cron /api/cron/customer-notifications) - um resumo simples do essencial.
function tripReminderEmail({ reservation, accountUrl }) {
  const offer = reservation.offer || {};
  const destination = offer.destination || offer.hotel || 'o seu destino';
  return {
    subject: `A sua viagem aproxima-se - Reserva ${reservation.id}`,
    body: `Olá ${reservation.customer?.name || ''},\n\nFaltam poucos dias para a sua viagem! Aqui fica um resumo:\n\nDestino: ${destination}${offer.hotel ? `\nAlojamento: ${offer.hotel}` : ''}\nCheck-in: ${offer.checkin || '-'}\nCheck-out: ${offer.checkout || '-'}${reservation.operatorLocator ? `\nLocalizador: ${reservation.operatorLocator}` : ''}\n\nConfirme que tem os documentos de viagem consigo. Pode consultar todos os detalhes e documentos na sua Área de Cliente:\n${accountUrl}\n\nBoa viagem!\nBoomviagens`
  };
}

// Aviso de voucher emitido (src/voucherIssuing.js) - o PDF fica guardado
// na Area de Cliente; este email e so o aviso, sem anexo.
function voucherEmail({ reservation, accountUrl }) {
  const offer = reservation.offer || {};
  return {
    subject: `Voucher da sua viagem - Reserva ${reservation.id}`,
    body: `Olá ${reservation.customer?.name || ''},\n\nO voucher da sua viagem para ${offer.destination || offer.hotel || 'o seu destino'} já está disponível (localizador ${reservation.operatorLocator}).\n\nPode consultá-lo e descarregá-lo na sua Área de Cliente, separador Documentos:\n${accountUrl}\n\nApresente o voucher (impresso ou digital) no check-in do alojamento.\n\nObrigado,\nBoomviagens`
  };
}

module.exports = { proposalEmail, reservationEmail, loginCodeEmail, documentRequestEmail, paymentReminderEmail, tripReminderEmail, voucherEmail };
