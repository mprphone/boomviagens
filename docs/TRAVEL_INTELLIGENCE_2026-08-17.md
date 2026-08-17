# Boomviagens — Travel Intelligence e Pricing V2

Entrega de 17/08/2026.

## Objetivo

Melhorar a vivência do cliente sem transformar cada pesquisa numa sequência cara de chamadas externas. A pesquisa de alojamento continua leve; os dados adicionais entram quando o cliente demonstra intenção real ao abrir uma viagem.

Fluxo pretendido:

**Pesquisar → comparar → guardar/partilhar → abrir viagem → enriquecer → rever → passageiros → pagamento → processo**

## Integrações implementadas

### Duffel — voos

- Cliente em `src/integrations/duffelClient.js`.
- Usa Offer Requests em modo test/live conforme o token.
- Pesquisa ida/volta com adultos, crianças e bebés/idades.
- Normaliza companhia, horários, escalas, duração, preço e condições.
- Só é chamada quando o cliente abre o detalhe/revisão da viagem.
- A cotação de voo é apresentada como **independente** do preço do pacote/alojamento; ainda não é adicionada automaticamente à reserva principal.
- Cache técnico de curta duração para evitar repetir a mesma consulta.

### HBX / Hotelbeds

- Cliente em `src/integrations/hbxClient.js`.
- Credenciais separadas para Hotels, Activities e Transfers.
- Gera `X-Signature` no servidor a cada pedido.
- API Lab permite testar manualmente cada suite.
- A Booking API de hotéis está preparada para disponibilidade por códigos de hotel.
- **Não** se faz Content API hotel-a-hotel durante a pesquisa pública. O catálogo/content deve ser sincronizado em batch/localmente antes de ativar HBX Hotels como fonte pública principal.
- Activities/Transfers permanecem em laboratório até validar mapeamentos, preço, disponibilidade e condições.

### OpenWeather

- Cliente em `src/integrations/openWeatherClient.js`.
- Mostra condições atuais no detalhe da viagem.
- Nunca apresenta condições atuais como se fossem previsão para uma viagem distante.
- Geocoding e clima têm cache.

### Ticketmaster Discovery

- Cliente em `src/integrations/ticketmasterClient.js`.
- Pesquisa eventos na cidade/datas da viagem.
- Mostra eventos como inspiração/interação.
- A compra de bilhete continua externa até existir acordo/componente comercial próprio.

### Google Places

- Cliente em `src/integrations/googlePlacesClient.js`.
- **Desligado por omissão** com `GOOGLE_PLACES_ENABLED=false`.
- Nunca é chamado durante a listagem normal de hotéis.
- Só é chamado quando o cliente carrega explicitamente em **Explorar a zona**.
- O endpoint exige `offerToken` válido, tem rate-limit e pede apenas um conjunto reduzido de campos.
- O objetivo é impedir que um cliente a percorrer milhares de hotéis gere milhares de pedidos pagos.

## Travel Intelligence Engine

`src/integrations/travelIntelligence.js` funciona como camada central entre o site e os fornecedores.

Responsabilidades:

- resolver destino/origem para códigos IATA e contexto geográfico;
- decidir quais integrações podem ser usadas;
- executar integrações em paralelo no detalhe da viagem;
- deixar uma API falhar sem bloquear a reserva principal;
- devolver informação normalizada ao frontend;
- manter Google fora do carregamento automático;
- disponibilizar testes manuais ao API Lab do backoffice.

## Proteção de quotas / custos

As rotas de enriquecimento não aceitam um destino/data arbitrários enviados pelo browser. O servidor assina no `offerToken`:

- destino;
- origem;
- check-in/check-out;
- adultos/crianças/bebés e idades;
- preço e referências internas do operador.

`/api/travel-intelligence` e `/api/explore-zone` exigem token válido. Isto reduz abuso e garante que as APIs externas só são chamadas para uma oferta realmente gerada pelo servidor.

Além disso:

- pesquisa normal: **0 chamadas Google**;
- Google: só ação explícita;
- HBX tests: só botão manual no API Lab;
- clientes externos usam TTL cache;
- rate-limit aplicado às rotas de enriquecimento;
- erros HTTP são sanitizados para não imprimir tokens/secrets.

> O rate-limit atual continua em memória do processo Node. Para produção serverless em volume deve passar para um backend partilhado (Supabase/Redis/Upstash).

## Pesquisa e experiência do cliente

### Pesquisa

- sugestões de destinos vindas do servidor;
- origem/destino com código IATA quando mapeado;
- adultos, crianças e bebés separados;
- idade de cada criança/bebé guardada desde a pesquisa;
- idade transportada até Duffel e checkout;
- pesquisa base não cria automaticamente um lead.

### Resultados

- cartões comerciais mais visuais;
- filtros por estrelas, regime, cancelamento e preço;
- ordenação por recomendação, preço, classificação e flexibilidade;
- guardar viagem;
- partilhar viagem;
- comparar até três opções;
- escolha de tarifa/quarto;
- PVP e preço por passageiro;
- nomes de fornecedores/NET/margem não são enviados para o browser.

### Revisão/construção da viagem

- resumo sticky;
- guardar e partilhar;
- voo alternativo consultado apenas nesta fase;
- clima/contexto do destino;
- eventos durante as datas;
- explorar zona só quando ativado e pedido;
- checklist antes da reserva;
- extras preparados para evolução progressiva.

## Passageiros e validação

O motor transporta:

- `adults`;
- `children` + `childAges`;
- `infants` + `infantAges`.

Checkout valida coerência ADT/CHD/INF, datas, documentos e número esperado de passageiros. A TourDiez recebe menores no seu modelo `children + child ages`; o nosso frontend mantém CHD/INF separados para uma experiência e validação mais corretas.

## Pricing V2 — margem acima do NET

As regras de pricing podem ser definidas por:

- destino;
- operador;
- canal (`ONLINE`, `AGENCIA`, etc.);
- produto (`ALOJAMENTO`, `PACOTE`, `VOO`, `ATIVIDADE`, `TRANSFER`).

Cada regra pode ter:

- markup alvo sobre o NET;
- markup mínimo;
- margem mínima fixa em euros;
- arredondamento comercial;
- rappel/override estimado.

A cedência comercial (`concessionPercent`) reduz o markup até ao mínimo autorizado, nunca abaixo dele. O rappel/override é **informativo/económico** e não é usado para baixar automaticamente o preço mínimo, porque pode depender de objetivos futuros.

O simulador no backoffice mostra:

- PVP alvo;
- PVP após cedência;
- PVP mínimo;
- margem direta;
- rappel estimado;
- margem económica esperada;
- capacidade adicional de cedência.

As regras podem ser criadas e editadas em **Gestão → Margens**.

## API Lab

No backoffice, a área de operador/integrações mostra:

- estado de configuração;
- modo test/live/off;
- uso atual no produto;
- botão **Testar ligação**.

Abrir a página não faz pedidos externos. O pedido só ocorre ao carregar explicitamente no botão.

Acesso ao API Lab fica limitado a `SUPERVISOR` e `ADMIN`. Regras de margem ficam limitadas a `FINANCEIRO`, `SUPERVISOR` e `ADMIN`.

## Segurança comercial

O site público já não recebe em `/api/config`:

- lista de operadores;
- configuração de fornecedores;
- regras de margem;
- estados comerciais internos das APIs.

A API pública recebe apenas `features` necessárias à interface. Ofertas enviadas ao browser excluem NET, margem e referências do operador; estes dados viajam dentro do `offerToken` selado/cifrado e são recuperados no servidor no checkout.

## Base de dados / migration

Pricing V2 acrescenta às regras de margem:

- `operator_name`;
- `channel`;
- `product_type`;
- `minimum_percent`;
- `rebate_percent`.

### Supabase existente

Executar uma vez:

`docs/migrations/2026-08-17-pricing-v2.sql`

A migration também remove a antiga `public.public_margins`, porque NET/regras de pricing são internas e já não precisam de leitura anónima.

### SQLite

`src/storageSqlite.js` faz upgrade idempotente de colunas antigas antes de criar índices. Também corrige compatibilidade com ficheiros SQLite antigos que ainda não tinham várias colunas introduzidas pelo backoffice atual.

## Variáveis de ambiente

O ZIP desta entrega **não inclui `.env`**. Manter as chaves no `.env` local e, em Vercel, nas Environment Variables.

Nomes esperados:

```text
DUFFEL_API_TOKEN
HBX_HOTELS_API_KEY
HBX_HOTELS_SECRET
HBX_ACTIVITIES_API_KEY
HBX_ACTIVITIES_SECRET
HBX_TRANSFERS_API_KEY
HBX_TRANSFERS_SECRET
OPENWEATHER_API_KEY
TICKETMASTER_API_KEY
GOOGLE_PLACES_ENABLED
GOOGLE_PLACES_API_KEY
```

## Testes

Sem consumir quotas externas:

```bash
npm test
```

Este comando corre verificação de sintaxe + testes de integrações/pricing/passageiros.

Smoke test com servidor a correr em modos mock:

```bash
npm run test:api
```

## Ainda não considerar produção automática concluída

Continuam importantes antes de abrir venda automática real em volume:

1. criar pagamentos outgoing reais Stripe/Easypay;
2. idempotência persistente por evento do gateway;
3. locks/transações PostgreSQL para payment/booking/invoicing;
4. sincronização local HBX Content + mapeamento de hotéis/destinos;
5. concluir fluxo de seleção/reserva de voo Duffel se o voo for para entrar no carrinho principal;
6. concluir booking real HBX e pós-venda/cancelamento;
7. refunds reais + notas de crédito;
8. rate-limit partilhado para serverless;
9. testes de concorrência e falhas de fornecedor;
10. monitorização/alertas em produção.
