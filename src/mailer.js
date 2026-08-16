// Envio de email real por SMTP - mesmo padrao MODE dos outros integradores
// (TOURDIEZ_MODE/PAYMENTS_MODE/AI_MODE). Sem EMAIL_MODE=smtp (ou sem
// credenciais completas), fica em modo simulado: nada e enviado a serio,
// so registado (ver customerRoutes.js, que grava sempre em db.emails).

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;

const configured = process.env.EMAIL_MODE === 'smtp' && Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);

const transporter = configured ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
}) : null;

// Devolve { mode: 'smtp' | 'mock' } - as rotas usam isto para decidir se
// podem devolver o codigo de login na propria resposta (so em mock, para
// continuar a ser possivel testar sem caixa de correio real).
async function sendMail({ to, subject, body }) {
  if (!configured) return { mode: 'mock', sent: false };
  await transporter.sendMail({ from: `Boomviagens <${SMTP_USER}>`, to, subject, text: body });
  return { mode: 'smtp', sent: true };
}

module.exports = { sendMail, isConfigured: () => configured };
