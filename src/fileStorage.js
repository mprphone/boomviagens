// Acesso direto a API de Storage do Supabase (blobs), separado de
// src/storage.js (que fala com as tabelas Postgres via PostgREST). Os
// documentos de reserva exigem Supabase real mesmo que DB_MODE=local para o
// resto, porque sao ficheiros sensiveis (identificacao, seguros) que nao
// devem viver so em disco local/efemero.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'documents';

function assertConfigured() {
  if (!SUPABASE_URL || SUPABASE_URL.includes('PROJECT_REF') ||
      !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY.includes('colocar_')) {
    throw new Error('Documentos exigem SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY reais configurados no .env, independentemente de DB_MODE.');
  }
}

async function uploadFile(storagePath, buffer, mimeType) {
  assertConfigured();
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!res.ok) throw new Error(`Upload de documento falhou: ${res.status} ${await res.text()}`);
  return storagePath;
}

async function signedUrl(storagePath, expiresInSeconds = 300) {
  assertConfigured();
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/sign/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds })
  });
  if (!res.ok) throw new Error(`Geracao de link de documento falhou: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1${data.signedURL}`;
}

async function deleteFile(storagePath) {
  assertConfigured();
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!res.ok) throw new Error(`Remocao de documento falhou: ${res.status} ${await res.text()}`);
}

module.exports = { uploadFile, signedUrl, deleteFile };
