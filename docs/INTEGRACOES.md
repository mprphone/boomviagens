# Integrações de APIs externas — como adicionar uma nova

Este projeto usa um **provider kit** (`src/integrations/providerKit.js`) e um
**registo central** (`src/integrations/registry.js`) para que adicionar um
fornecedor novo seja sempre o mesmo processo de poucos passos, sem
copiar/colar infraestrutura.

## Peças

| Peça | Ficheiro | Papel |
|---|---|---|
| `defineProvider()` | `src/integrations/providerKit.js` | Declara o contrato do fornecedor: id, tipo, variáveis de ambiente, timeouts, TTL de cache e como construir o cliente. |
| `providerRegistry` | `src/integrations/providerKit.js` | Mapa central com `register()`, `get(id)` e `list()` (estado de todos os fornecedores: `configured`, `missing`, `mode`). |
| Registo central | `src/integrations/registry.js` | Importado uma vez pelo `server.js`; regista todos os fornecedores (grandes e pequenos). |
| HTTP partilhado | `src/integrations/httpClient.js` | `fetchJson()` com timeout e mensagens de erro saneadas (nunca expõe chaves/tokens). Passado ao `create(config, http)`. |
| Cache TTL | `src/integrations/cache.js` | `TtlCache` em memória para respostas repetidas. |
| Estado no backoffice | `GET /api/admin/integrations` | Devolve `integrations` (Travel Intelligence, formato antigo) **e** `providers` (vista unificada do registo). |

## O que `defineProvider()` devolve

```js
const provider = defineProvider({
  id: 'exemplo',                 // obrigatório, único
  label: 'Exemplo API',          // nome legível no backoffice
  kind: 'enrichment',            // operator | payment | enrichment | invoicing | email | other
  envPrefix: 'EXEMPLO',          // lê EXEMPLO_MODE automaticamente
  requiredEnv: ['EXEMPLO_API_KEY'],
  optionalEnv: ['EXEMPLO_BASE_URL'],
  baseUrlEnv: 'EXEMPLO_BASE_URL',
  timeoutMs: 8000,
  cacheTtlMs: 30 * 60 * 1000,
  create: (config, http) => new ExemploClient(config, http),
  healthCheck: client => client.testConnection() // opcional
});
```

- `provider.config()` — variáveis resolvidas + `mode`, `baseUrl`, `timeoutMs`, `cacheTtlMs`.
- `provider.isConfigured()` — `true` quando todas as `requiredEnv` existem (ou o hook `configured(env)`).
- `provider.missingEnv()` — lista das variáveis obrigatórias em falta.
- `provider.client()` — singleton lazy construído pelo `create(config, http)`.
- `provider.healthCheck()` — corre o teste real do fornecedor (só quando chamado; nunca no arranque).

Para fornecedores cujo "configurado" depende de mais do que a presença de
variáveis (ex.: TourDiez só conta com `TOURDIEZ_MODE=real`), usa-se o hook
`configured: env => ...` e/ou `mode: env => ...` — ver exemplos em
`src/integrations/registry.js`.

## Passo a passo: nova API

1. **Criar o cliente** em `src/integrations/<fornecedor>Client.js`
   (CommonJS). Seguir o padrão de `openWeatherClient.js`:
   - classe com `constructor(env = process.env, options = {})` — `options`
     aceita `http`, `timeoutMs`, `cacheTtlMs`, `cache`;
   - `isConfigured()` e métodos de negócio que falham com mensagem clara
     quando não configurado;
   - no fim do ficheiro, `const xProvider = defineProvider({...})` e
     exportar ambos: `module.exports = { XClient, xProvider }`.
2. **Registar** em `src/integrations/registry.js`: importar o provider e
   juntá-lo à lista final. (Se for só metadados de um cliente grande já
   existente, declarar o `defineProvider` diretamente no registry.)
3. **Variáveis de ambiente** em `.env.example`: prefixo próprio
   (`NOVO_API_KEY`, `NOVO_BASE_URL`, `NOVO_MODE`, ...). Nunca commitar
   valores reais.
4. **Se for um produto vendável** (voos, hotéis, cruzeiros...): seguir
   também `docs/SERVICE_INTEGRATIONS.md` e `docs/OPERATOR_ADAPTERS.md` —
   adapter de normalização, capacidade no `ServiceCatalog`, pesquisa
   paralela com `Promise.allSettled`, pricing só no servidor.
5. **Testes**: adicionar casos em `scripts/test-provider-kit.js` (sem rede)
   e, se houver lógica de normalização, em `scripts/test-integrations.js`.
   Correr `npm run test:provider-kit`.
6. **Verificar no backoffice**: `GET /api/admin/integrations` passa a listar
   o novo fornecedor em `providers` com `configured/missing/mode`.

## Estado atual do registo

| id | kind | Notas |
|---|---|---|
| `tourdiez` | operator | Só metadados; cliente em `src/tourdiezClient.js`. Configurado = modo `real` + URL/utilizador/password. |
| `hbx` | operator | Só metadados; `src/integrations/hbxClient.js`. Configurado = pelo menos uma suite (hotels/activities/transfers) completa. |
| `duffel` | operator | Só metadados; `src/integrations/duffelClient.js`. Modo deriva do prefixo do token (`duffel_test_`/`duffel_live_`). |
| `stripe` | payment | Só metadados; `src/paymentGatewayAdapters.js`. |
| `easypay` | payment | Só metadados; `src/paymentGatewayAdapters.js`. |
| `facturalusa` | invoicing | Só metadados; `src/facturalusaClient.js`. Configurado = modo `real` + API key. |
| `email` | email | Só metadados; `src/mailer.js`. Configurado = `EMAIL_MODE=smtp` + host/utilizador/password. |
| `openweather` | enrichment | Migrado para o kit (referência). |
| `ticketmaster` | enrichment | Migrado para o kit (referência). |
| `google-places` | enrichment | Migrado para o kit. Sem `healthCheck` de propósito: cada chamada tem custo variável — testes manuais ficam em `POST /api/admin/integrations/test`. |

## Integrações futuras (stubs)

Já existem placeholders de ambiente em `.env.example` e entradas no registo
(aparecem como "por configurar" no backoffice), à espera de um cliente real:

| id | Produto | Variáveis |
|---|---|---|
| `cruise` | Cruzeiros | `CRUISE_API_KEY`, `CRUISE_API_BASE_URL` |
| `car` | Rent-a-car | `CAR_API_KEY`, `CAR_API_BASE_URL` |
| `train` | Comboios | `TRAIN_API_KEY`, `TRAIN_API_BASE_URL` |
| `ferry` | Ferries | `FERRY_API_KEY`, `FERRY_API_BASE_URL` |
| `insurance` | Seguros de viagem | `INSURANCE_API_KEY`, `INSURANCE_API_BASE_URL` |

Para ligar um destes fornecedores: criar o cliente com o provider kit
(passo 1), substituir o stub no `registry.js` pelo provider exportado do
cliente, e seguir os passos 3-6. Enquanto não houver confirmação real
testada, o produto continua em modo `ASSISTED` no catálogo (pedido de
proposta no CRM) — nunca stock ou preço inventado.

## Regras obrigatórias (inalteradas)

- Uma falha de fornecedor não bloqueia os restantes (`Promise.allSettled`).
- Nunca expor credenciais, NET, markup, margem ou referências privadas.
- Mensagens de erro saneadas via `httpClient.js` (chaves/tokens ocultos).
- Um serviço só passa a `ONLINE` com adapter e fluxo de validação testados.
