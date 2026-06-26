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

## Estado atual: ligado

`src/storage.js` ja fala com Supabase via PostgREST (`fetch` nativo do Node, sem dependencias novas) quando `DB_MODE=supabase` e `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` estao definidos com valores reais. Caso contrario usa sempre `data/db.json` local (nao persistente em Vercel) e avisa na consola.

Detalhes da implementacao:

- `readDb()` faz `select` em paralelo a todas as tabelas e monta o mesmo formato que `data/db.json` (company, margins, customers, leads, reservations, payments, emails, operatorLogs, auditLogs, idempotencyKeys).
- `updateDb(mutator)` le o estado atual, aplica o mutator e grava so as linhas que mudaram (diff por `id`), para nao reenviar todo o historico a cada pedido. Nada e apagado nas tabelas - so upsert.
- `operator_logs` e `audit_logs` sao lidos com `limit` (100/200) para acompanhar o comportamento anterior em ficheiro.
- `company_settings` so e lido (nao ha endpoint que o edite); se a linha `main` nao existir ainda, usa os valores de `.env` como default.

### Como validar contra Supabase real

1. Criar o projeto e correr `docs/supabase-schema.sql`.
2. Preencher `.env` com `DB_MODE=supabase`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` reais.
3. `npm run supabase:import` (opcional, semeia dados existentes do `data/db.json`).
4. `npm start` e depois `npm run test:api` - o fluxo completo (login admin, pesquisa, checkout, pagamento, aprovacao) deve passar a ler/escrever direto no Supabase.
5. Confirmar no SQL Editor do Supabase que `reservations`, `payments` e `audit_logs` ganharam linhas novas.
