# Supabase setup - Boom das Viagens

## Decisoes atuais

- Base de dados inicial: Supabase Postgres.
- Mercado: Portugal (`PT`).
- Moeda: Euro (`EUR`).
- Precos do operador: `PVP`.
- Comissao do operador: incluida.
- Margem adicional do site: `5%`.
- Confirmacao: automatica quando pagamento real estiver ligado.
- Pagamentos: por agora `mock`; testar ate ao pagamento e escolher gateway depois.

## Criar projeto

1. Criar projeto Supabase.
2. Abrir SQL Editor.
3. Executar `docs/supabase-schema.sql`.
4. Copiar para `.env`:

```env
DB_MODE=supabase
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_SERVICE_ROLE_KEY` nunca deve ir para frontend. Usar apenas no servidor Node.

Se uma `SUPABASE_SERVICE_ROLE_KEY` real tiver sido colocada em `.env.example`, chat, print, commit ou outro ficheiro partilhado, rode/recrie essa chave no painel do Supabase antes de usar o projeto em producao.

## Importar dados atuais

Depois de criar as tabelas:

```bash
npm run supabase:import
```

O script importa:

- empresa;
- margens;
- clientes;
- leads;
- reservas;
- pagamentos;
- emails;
- logs de operador;
- logs de auditoria;
- chaves de idempotencia.

## Seguranca

As tabelas ficam com RLS ativo e sem policies publicas. Isto e intencional: clientes, reservas e pagamentos nao devem ficar acessiveis diretamente pelo browser.

O site deve continuar a falar com o `server.js`, e o `server.js` fala com Supabase usando service role.

## Proximo passo tecnico

Depois de confirmar que o projeto Supabase esta criado e que o import corre:

1. trocar `src/storage.js` para usar Supabase quando `DB_MODE=supabase`;
2. manter JSON local como fallback;
3. testar `/api/search`, `/api/checkout`, `/api/payment/confirm` e backoffice contra Supabase.
