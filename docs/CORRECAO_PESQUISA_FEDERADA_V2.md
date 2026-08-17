# Boomviagens — Correção da pesquisa federada e construtor de viagem V2

## O problema encontrado

A versão anterior podia mostrar Disneyland Paris, Maldivas ou outros destinos quando o cliente pesquisava Atenas. A causa foi identificada no código:

1. `src/mockOperators.js` tinha um fallback global que devolvia todas as ofertas demo quando não encontrava o destino.
2. `/api/search` começava pelos demos e só os substituía quando um fornecedor real devolvia stock válido.
3. HBX ainda estava ligado sobretudo ao API Lab; não alimentava realmente a pesquisa pública de hotéis.
4. Duffel aparecia como comparação independente depois de abrir uma oferta, e não como componente de uma combinação voo + hotel.
5. Transfers e Activities HBX estavam configurados, mas não apareciam no construtor da viagem.

Esse comportamento foi removido. Falta de stock agora significa falta de stock — nunca substituição silenciosa por outro destino.

## Pesquisa federada V2

A pesquisa pública resolve primeiro o destino para uma identidade comum (nome, país, IATA e código HBX) e consulta em paralelo os fornecedores que estiverem configurados:

- HBX Hotels → alojamento e tarifas.
- Duffel → voos.
- TourDiez → ofertas/pacotes do operador.
- Novos bedbanks podem ser acrescentados posteriormente ao mesmo normalizador.

Os resultados são separados por família:

- Voo + hotel
- Pacotes
- Só hotel

A vista inicial privilegia `Voo + hotel` quando existe, evitando mostrar o mesmo hotel duas vezes na mesma lista como hotel isolado e combinação dinâmica.

## Regra de destino estrita

`Atenas = Atenas`.

Se um fornecedor devolver stock de outro destino, é ocultado. Se nenhum fornecedor tiver stock, o cliente recebe uma mensagem para alterar datas/origem. `ENABLE_DEMO_SEARCH=false` deve permanecer em Preview e Production.

## HBX Hotels

No ambiente TEST/evaluation, `HBX_ALLOW_LAZY_CONTENT=true` permite descobrir um pequeno portfolio por destino através do **Hotel Content API** para testar Availability. O Transfer Cache não é usado como fonte de códigos de Hotel Booking: para transfers, a V3 faz a ponte GIATA → código ATLAS separadamente.

Em produção, não usar o Content API em tempo real por pesquisa. Deve existir um job de sincronização periódico de conteúdo/códigos para a base local; a pesquisa consulta depois apenas Availability.

## Construtor da viagem

Ao abrir uma opção, o cliente passa a construir a viagem:

1. Hotel escolhido.
2. Voo incluído ou alternativas Duffel.
3. Transfer aeroporto ↔ hotel HBX.
4. Experiências HBX Activities.
5. Seguro (placeholder explícito até existir produto comercial real).

Escolher/trocar componentes chama `/api/trip-builder/update`. O browser envia tokens selados/cifrados, não preços NET. O servidor recalcula o total e devolve um novo `offerToken`.

## Segurança financeira

A resposta pública nunca contém:

- NET do fornecedor;
- margem;
- rateKey HBX em claro;
- referências internas necessárias a booking;
- custo Duffel original.

Voos, transfers e atividades são reprecificados no servidor segundo as regras de margem da Boomviagens antes de aparecerem ao cliente.

## Checkout/backoffice

Quando a viagem foi construída por componentes, o checkout cria linhas de serviço separadas:

- ALOJAMENTO — HBX Hotels
- VOO — Duffel
- TRANSFER — HBX Transfers, se selecionado
- ATIVIDADE — HBX Activities, por cada experiência selecionada

Assim os totais não são duplicados e o backoffice consegue tratar cada reserva individualmente.

## Testes efetuados

- `npm test` passa.
- Teste específico garante que uma pesquisa por Atenas não cai em destinos demo.
- Teste HTTP local confirmou que Atenas sem fornecedores configurados devolve zero resultados e mensagem correta.
- Teste HTTP do construtor confirmou que hotel 600 € + voo 230 € produz total 830 € e novo produto `DYNAMIC_PACKAGE`.

## Ainda não é booking automático multi-fornecedor

A pesquisa e o construtor estão preparados para testes reais com as credenciais do `.env`, mas emissão/booking automático HBX/Duffel/Activities/Transfers deve ser fechado fornecedor a fornecedor com revalidação, idempotência e tratamento de falhas antes de abrir produção real.
