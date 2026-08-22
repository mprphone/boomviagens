// Helpers do backoffice. Os helpers puros e identicos entre as tres
// aplicacoes vivem em public/shared/utils.js e sao re-exportados aqui - os
// consumidores continuam a importar deste ficheiro.
//
// shortDate fica LOCAL de proposito: a versao partilhada inclui o ano
// ("12 ago 2026") e esta app usa a forma curta sem ano ("12 ago") nas
// colunas das tabelas - nao unificar.

export { $, esc, money } from '../../shared/utils.js';

export const shortDate = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }) : '';

export async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Erro API');
  return data;
}
