# Adapters de operador (fornecedores de hotel)

Guia para ligar um fornecedor novo (Hotelbeds, Travelgate, W2M real,
Duffel, etc.) ao motor de pesquisa/checkout. O contrato em si esta
documentado em JSDoc em `src/operatorAdapters.js` (classe
`OperatorAdapter`) - este ficheiro explica o resto: a forma exata de
"offer" que o resto da aplicação espera, como o registo/routing
funciona, e um passo a passo.

Não se escreve um adapter novo (ex.: `DuffelAdapter`) sem credenciais
nem sandbox reais para o testar - código sem nada a validar contra é
código morto. `HotelbedsAdapter` (`src/hotelbedsAdapter.js`) já existe:
a HBX já tinha pesquisa/checkrate reais nesta conta, só faltava a
chamada de reserva (`confirm()`) - ver o próprio ficheiro para o
padrão a seguir num fornecedor novo com API em JSON.

## As três peças do sistema

```
src/operatorAdapters.js   ← OperatorAdapter (contrato), OperatorRegistry (routing)
src/tourdiezClient.js     ← cliente HTTP/XML só da TourDiez (não é o contrato)
src/mockOperators.js      ← catálogo demo + motor de pesquisa local (fallback honesto)
```

Um adapter novo só precisa de estender `OperatorAdapter` e implementar
`search`/`value`/`confirm`/`cancel` (ver JSDoc em
`src/operatorAdapters.js`). Tudo o que a `TourDiezAdapter` tem a mais -
`tag()`, `findNumber()`, `availabilityBlocks()`,
`roomOptionsFromBlock()`, `tourdiezRefs()` - é para lidar com o XML
específico da TourDiez/Sirio. Um fornecedor com API em JSON (a maioria
hoje em dia) não precisa de nada disso.

## A forma de "offer" que o resto da aplicação espera

Isto é o contrato mais importante e o que mais falta documentar: o
motor de pesquisa, o checkout, o backoffice e o frontend não sabem
nada sobre TourDiez ou XML - só sabem ler objetos "offer" com estes
campos. `normalizeAvailabilityOffers()` em `TourDiezAdapter` é o
exemplo de referência de como transformar uma resposta de fornecedor
nesta forma.

| Campo | Tipo | Obrigatório | Nota |
|---|---|---|---|
| `id` | string | sim | Único por oferta. Usado para deduplicar (ex.: cartões de destaque nos resultados) e para `getOfferById`. |
| `operator` | string | sim | Tem de conter o `name` passado ao construtor do adapter (ver `OperatorRegistry#getForOffer` abaixo). |
| `destination` | string | sim | Nome do destino tal como devolvido pelo fornecedor - preferir sempre o valor real do fornecedor ao valor pesquisado pelo cliente (ver o comentário sobre isto em `normalizeAvailabilityOffers`: mostrar resultados de um destino diferente do pedido como se fossem o destino pedido é enganoso). |
| `country` | string | não | |
| `hotel` | string | sim | |
| `board` | string | sim | Label pronta a mostrar (ex.: "Tudo incluído"), não o código cru do fornecedor. Ver `mealPlanLabel()` para o padrão de tradução com fallback honesto (código desconhecido mostra-se tal como veio, não se arrisca uma tradução errada). |
| `nights`, `adults`, `children` | number | sim | Ecoados do pedido de pesquisa. |
| `origin` | string | sim | Aeroporto/cidade de saída. |
| `checkin`, `checkout` | string (ISO `AAAA-MM-DD`) | sim | |
| `rating` | number (~1-5) | sim | Usado por `computeScore()` e pela filtragem por estrelas nos resultados. |
| `freeCancellation` | boolean | sim | Usado por `computeScore()` e mostrado ao cliente. |
| `available` | boolean | sim | Usado por `computeScore()`. |
| `operatorReliability` | number (~1-10) | não | Usado por `computeScore()`; sem isto assume 8. |
| `live` | boolean | recomendado | `true` marca a oferta como preço real (mostra o badge "Preço real" em vez de "Simulação" no frontend). |
| `roomOptions` | array | não | Ver forma abaixo. Se ausente, a oferta é tratada como tendo uma única tarifa (os campos de preço ficam diretamente na oferta). |
| `costPrice`, `marginRule`, `marginPercent`, `marginValue`, `finalPrice` | number/string | sim (se sem `roomOptions`) | Vêm de `applyMargin(custoBruto, destination, margins)` em `src/pricing.js` - chamar sempre essa função, nunca calcular a margem à mão. |
| `score` | number (0-99) | recomendado | Vem de `computeScore(offer, parsedSearch)` em `src/pricing.js` - chamar depois de a oferta ter `finalPrice`/`rating`/`freeCancellation`/etc. preenchidos. Alimenta os cartões "Melhor escolha" nos resultados. |
| `label` | string | não | Badge curto (ex.: "Preço real TourDiez"). |
| `trace` | string | não | Texto de depuração interno, mostrado só no backoffice/auditoria. |
| `tourdiez` | object | não | Específico da TourDiez (`idOperation`/`code`/`idDistributions` para as chamadas `value`/`confirm`). Um fornecedor novo guarda os seus próprios identificadores necessários para `value()`/`confirm()` num campo com o seu próprio nome. |
| `hbx` | object | não | Específico da `HotelbedsAdapter` (`rateKey`/`rateType`/`roomCode`/`hotelCode` para `value`/`confirm`). Chama-se `hbx`, não `hotelbeds`, porque o campo já existia (pesquisa/checkrate) antes do adapter de confirmação - não vale a pena um rename só por convenção de nomes. |

`themes` (array de palavras-chave) existe só nas ofertas demo de
`src/mockOperators.js`, para o motor de pesquisa local decidir que
ofertas mostrar quando não há fornecedor ligado - não faz parte do
contrato de um adapter real.

### Forma de cada item em `roomOptions[]`

Quando um hotel tem várias tarifas/quartos (o caso normal), a lista
completa vem em `roomOptions` e os campos de preço/desconto ficam em
cada item, não na oferta:

```js
{
  idDistributions: '...',      // identificador da tarifa no fornecedor
  roomCode: '...',
  roomName: '...',             // nome cru do fornecedor
  mealPlan: '...',             // código cru do fornecedor
  mealPlanLabel: '...',        // label traduzida (mealPlanLabel())
  freeCancellation: true,
  costPrice, marginRule, marginPercent, marginValue, finalPrice  // de applyMargin()
}
```

O frontend (`public/js/results.js`) ordena por `finalPrice` e mostra
as 3 mais baratas com um "+N opções" para o resto - não é preciso
pré-ordenar no adapter.

## Como o routing funciona (`OperatorRegistry`)

```js
const registry = new OperatorRegistry([tourdiezAdapter, novoAdapter]);
registry.getForOffer(offer); // -> adapter cujo .name está contido em offer.operator (case-insensitive)
```

Por isso o `operator` de cada oferta produzida por um adapter tem de
conter o `name` exato passado ao construtor desse adapter. Sem
correspondência, cai no primeiro adapter da lista - por isso as
ofertas demo (`"TourDiez Demo"`, `"W2M Demo"`, ...) nunca devem chegar
a `value()`/`confirm()` reais; só ofertas com `live: true` vindas de
um adapter de verdade é que devem seguir esse caminho.

## Passo a passo para adicionar um fornecedor novo

1. Criar `src/<fornecedor>Client.js` com o cliente HTTP puro (autenticação, pesquisa, valorização, confirmação, cancelamento) - sem nenhuma lógica de margem ou de forma de "offer" aqui, só a conversa com a API do fornecedor.
2. Criar `<Fornecedor>Adapter extends OperatorAdapter` em `src/operatorAdapters.js` (ou num ficheiro próprio, se ficar grande - seguir o padrão de um ficheiro por responsabilidade já usado no resto do projeto).
3. Implementar `search()`/`liveOffers()` (ou equivalente) devolvendo ofertas na forma documentada acima - chamar sempre `applyMargin()` e `computeScore()`, nunca calcular preço/pontuação à mão.
4. Implementar `value()` e `confirm()` a partir dos identificadores que o próprio adapter guardou na oferta (seguir o padrão de `tourdiezRefs()`/`hasTourdiezRefs()`: se a oferta não tiver os identificadores necessários, devolver `needsHumanReview: true` em vez de rebentar).
5. Registar em `server.js`: `new OperatorRegistry([tourdiezAdapter, novoAdapter])`.
6. Testar contra a sandbox real do fornecedor antes de ligar `live: true` em produção - seguir o mesmo princípio já aplicado à TourDiez (nunca mostrar ao cliente um resultado "real" que na verdade é doutro destino ou inventado; ver o comentário sobre isto em `normalizeAvailabilityOffers`).
