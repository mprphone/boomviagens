// Verificacao da assinatura de webhooks da Stripe, sem a SDK oficial (~1MB
// so para isto) - mesmo espirito dos outros clientes deste projeto
// (tourdiezClient.js, facturalusaClient.js), so `crypto` nativo. Esquema
// documentado e estavel da Stripe: https://stripe.com/docs/webhooks#verify-manually
//
//   Stripe-Signature: t=<timestamp>,v1=<hex hmac-sha256>
//   assinado: `${t}.${rawBody}`, chave = signing secret do endpoint

const crypto = require('crypto');

function parseSignatureHeader(header) {
  const parts = {};
  for (const pair of String(header || '').split(',')) {
    const [key, value] = pair.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  }
  return parts;
}

// Lanca erro (mensagem clara) em qualquer falha - quem chama decide o 400.
// toleranceSeconds protege contra replay (mesma janela de 300s que a
// propria Stripe usa por omissao na SDK oficial).
function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET não configurado');
  const { t, v1 } = parseSignatureHeader(signatureHeader);
  if (!t || !v1) throw new Error('Cabeçalho Stripe-Signature em falta ou inválido');

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > toleranceSeconds) throw new Error('Timestamp da assinatura fora da tolerância (possível replay)');

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const gotBuf = Buffer.from(v1, 'hex');
  // timingSafeEqual exige buffers do mesmo tamanho - um v1 malformado (ex.:
  // tamanho errado) nunca deve rebentar com excecao nao tratada, so falhar
  // a verificacao como qualquer outra assinatura errada.
  if (expectedBuf.length !== gotBuf.length || !crypto.timingSafeEqual(expectedBuf, gotBuf)) {
    throw new Error('Assinatura inválida');
  }
}

module.exports = { verifyStripeSignature };
