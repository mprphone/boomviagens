# Integrações de serviços do frontoffice

## Princípio

O frontoffice trabalha por capacidades e não por marcas de fornecedores. Cada produto pode estar num de três estados públicos:

- `ONLINE`: existe pelo menos uma integração configurada para pesquisar disponibilidade real.
- `BUILDER`: a integração está disponível como componente de uma viagem, como acontece com HBX Transfers.
- `ASSISTED`: o serviço continua operacional através de um pedido registado no CRM, sem preço ou stock inventado.

O estado é calculado no servidor por `src/integrations/serviceCatalog.js` e enviado em `GET /api/config`. Credenciais, fornecedores, NET, rate keys e margens nunca são incluídos.

## Matriz atual

| Produto | Integrações já previstas | Fallback |
|---|---|---|
| Pacotes | TourDiez, Duffel + HBX | Pedido assistido |
| Hotéis | HBX Hotels, TourDiez | Pedido assistido |
| Voos | Duffel | Pedido assistido |
| Experiências | HBX Activities, Ticketmaster | Pedido assistido |
| Transfers | HBX Transfers | Pedido assistido |
| Cruzeiros | Adapter futuro | Pedido de proposta |
| Rent-a-car | Adapter futuro | Pedido de proposta |
| Comboios | Adapter futuro | Pedido de proposta |
| Ferries | Adapter futuro | Pedido de proposta |
| Circuitos | TourDiez / adapter futuro | Pedido de proposta |
| Seguros | Adapter futuro | Pedido de proposta |
| Cheques-presente | Produto interno futuro | Pedido comercial |

## Ligar uma API nova

1. Criar um cliente HTTP isolado em `src/integrations/<fornecedor>Client.js`.
2. Implementar timeout, retry apenas para erros transitórios e mapeamento seguro da resposta.
3. Criar o adapter de normalização seguindo `docs/OPERATOR_ADAPTERS.md`.
4. Aplicar pricing exclusivamente no servidor.
5. Registar a capacidade do produto no catálogo.
6. Adicionar o provider à pesquisa paralela com `Promise.allSettled`.
7. Assinar a oferta e remover campos internos antes da resposta pública.
8. Implementar valorização e confirmação antes de permitir checkout online.
9. Testar sandbox, falha parcial, timeout, preço alterado e indisponibilidade.

## Regras obrigatórias

- Uma falha de fornecedor não bloqueia os restantes.
- Nunca transformar uma resposta vazia numa oferta fictícia.
- Nunca expor credenciais, NET, markup, margem ou referências privadas.
- Um serviço só muda para `ONLINE` quando o adapter e o fluxo de validação estão testados.
- Enquanto não houver confirmação real, o pedido entra no backoffice como oportunidade comercial.
