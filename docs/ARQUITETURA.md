# Arquitetura atual (Boomviagens)

> Este documento descreve o sistema **como existe hoje**. A versão anterior
> era um esboço aspiracional (Next.js/NestJS/filas) escrito antes da
> implementação - nada disso existe no código.

## Visão geral

Monólito **Node.js vanilla** (sem framework HTTP), CommonJS, arrancado por
`server.js` na raiz. Um único processo serve a API e os ficheiros estáticos:

- **Router próprio** em `src/http/router.js`; as rotas vivem em
  `src/routes/` (public, customer, checkout, admin, staff, opportunities,
  team, branches, payments, cron) e recebem um contexto partilhado (`ctx`)
  montado em `server.js`.
- **Servidor estático** em `src/staticServer.js` serve `public/`.
- Autenticação/sessões em `src/auth.js`; regras de domínio (estados,
  etiquetas, coleções) em `src/domain.js`; validação de input em
  `src/validation.js`.

## Frontends (três aplicações, sem build)

ES modules servidos diretamente, sem bundler em produção:

- `public/js/` - site público (pesquisa, resultados, checkout).
- `public/conta/js/` - área de cliente autenticada.
- `public/backoffice/js/` - backoffice (CRM, reservas, financeiro, equipa).
- `public/shared/utils.js` - helpers puros partilhados pelas três
  (`$`, `esc`, `money`, datas, `statusLabel`). Cada app tem o seu
  `utils.js` local que re-exporta do partilhado e mantém o que difere
  (`api`, `notify`, e o `shortDate` curto do backoffice).

`scripts/check-js.js` valida a sintaxe de todo o JS e faz bundle de
verificação (esbuild, sem escrever ficheiros) dos três entrypoints para
apanhar imports/exports inválidos.

## Integrações (provider kit)

- `src/integrations/registry.js` - registo unificado de fornecedores
  (configurado/em falta/modo), exposto em `/api/admin/integrations`.
- `src/integrations/` - clientes Duffel (voos), Hotelbeds/HBX (hotéis),
  OpenWeather, Ticketmaster, Google Places, Travel Intelligence e o
  catálogo de serviços (`serviceCatalog.js`, `destinations.js`).
- Adapters de operadores em `src/operatorAdapters.js` (TourDiez) e
  `src/hotelbedsAdapter.js` - contrato de "offer" em
  `docs/OPERATOR_ADAPTERS.md`.
- Gateways de pagamento em `src/paymentGatewayAdapters.js` (Stripe,
  EasyPay), com confirmação em `src/paymentConfirmation.js` e
  reconciliação em `src/paymentReconciliation.js`.
- Faturação via FacturaLusa (`src/facturalusaClient.js` +
  `src/invoicing.js`); vouchers PDF em `src/voucherIssuing.js` /
  `src/voucherPdf.js`; email em `src/mailer.js` + `src/emailTemplates.js`.

## Storage

`src/storage.js` escolhe o backend via `DB_MODE`:

- **JSON local** (`data/db.json`, criado a partir de `data/db.example.json`)
  - apenas desenvolvimento.
- **SQLite** (`src/storageSqlite.js`) - alternativa local em ficheiro único.
- **Supabase/PostgREST** - produção. Obrigatório em produção/Vercel: o
  servidor recusa arrancar sem Supabase configurado (filesystem efémero
  tornaria a escrita em JSON local numa perda silenciosa de dados).

O esquema relacional está em `docs/supabase-schema.sql`
(setup: `docs/SUPABASE_SETUP.md`). A coleção `leads` mantém-se para dados
antigos e pedidos assistidos, mas o pipeline comercial é gerido em
**oportunidades** (`src/routes/opportunitiesRoutes.js`) - as rotas legacy
`/api/admin/leads*` foram removidas.

## Deploy

- **Agora:** Vercel (serverless) - daí a obrigatoriedade de Supabase em
  produção e a ausência de estado em disco/memória entre pedidos.
- **Depois:** VPS (processo Node persistente), que passa a permitir estado
  local e SQLite em produção se fizer sentido.

## Regra principal (inalterada)

Nunca confirmar reserva externa antes de:

1. voltar a validar preço e disponibilidade (`src/offerRevalidation.js`);
2. confirmar pagamento;
3. guardar o log da operação;
4. gerar confirmação para o cliente.
