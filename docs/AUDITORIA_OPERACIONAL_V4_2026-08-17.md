# Auditoria Operacional V4 — 17/08/2026

## Objetivo
Transformar a versão de apresentação do Boomviagens numa experiência pública coerente e operacional, sem esconder funcionalidades atrás de alertas e sem inventar disponibilidade/preços.

## Correções críticas

### 1. Destino errado / Disney em Gran Canaria
- Dados demo ficam **sempre bloqueados em Vercel**, incluindo Preview, mesmo que exista uma variável antiga `ENABLE_DEMO_SEARCH=true`.
- Em desenvolvimento local, demo só ativa com dois opt-ins explícitos e nunca mistura destinos.
- Pesquisa de Gran Canaria nunca aceita Disneyland Paris como inventário equivalente.
- A homepage deixa de mostrar preços fictícios. Quando não existem campanhas reais, mostra inspiração editorial sem preço.

### 2. Modos reais de pesquisa
O cabeçalho e o hero suportam agora:
- Pacotes
- Hotéis
- Voos
- Experiências
- Cruzeiros

Cada modo altera os campos e o endpoint consultado.

### 3. Só Hotéis
- Campo de destino passa a pedir cidade/ilha/localidade.
- Origem é escondida porque não é necessária para hotel-only.
- `/api/search` respeita `searchType=HOTEL`: consulta alojamento sem acrescentar voo/TourDiez.
- Quando o ambiente HBX devolve pouca disponibilidade real, pode apresentar até 12 alojamentos adicionais do **Content API**, claramente identificados como `Preço e disponibilidade a confirmar`.
- Nunca atribui preço estimado a esses alojamentos.
- O botão “Pedir cotação” cria um pedido real no backoffice.

### 4. Só Voos
- Removido o alerta “Voos ainda não disponível”.
- A pesquisa usa `/api/flights/search` e Duffel.
- Resultados mostram companhia, ida/volta, horário, escalas e preço.
- O voo pode ser selecionado e seguir para revisão/checkout como produto `FLIGHT`.
- Checkout cria serviço `VOO` e não um alojamento fictício.

### 5. Experiências / Ticketmaster
- Removido o alerta “Experiências ainda não disponível”.
- A pesquisa consulta em paralelo:
  - HBX Activities
  - Ticketmaster Discovery
- HBX mostra atividades e preço quando disponível.
- Ticketmaster mostra eventos efetivamente publicados para o destino/datas, com link externo para bilhete.
- Se não houver eventos no período, o site diz isso em vez de fingir stock.

### 6. Cruzeiros
- Removido o alert de indisponibilidade.
- Enquanto não existir uma API de cruzeiros contratada, o site abre um fluxo assistido profissional.
- Nome + email/telefone + destino + datas ficam registados em `leads` no backoffice.
- Isto permite apresentar a área sem prometer reserva automática inexistente.

### 7. Transfers
- Melhorada a correspondência entre hotel HBX e o catálogo de Transfers:
  1. GIATA quando existe;
  2. catálogo de hotéis Transfers do mesmo destino;
  3. correspondência por nome e coordenadas.
- O destino nunca é cruzado com hotéis de outra zona.
- Se não existir correspondência/serviço, o motivo é preservado até à UI.
- A disponibilidade continua a ser real; não é criado um transfer fictício só para preencher o ecrã.

### 8. Builder / revisão
- Flight-only tem revisão própria; deixou de mostrar um “hotel” falso.
- Voo + hotel continua com Hotel → Voo → Transfer → Experiências → Seguro.
- Ticketmaster continua disponível como conteúdo de destino no detalhe.
- Components continuam reprecificados no servidor através de tokens protegidos.

### 9. Pricing
- Corrigida inconsistência entre nomes de produto nas regras de margem:
  - HOTEL / ALOJAMENTO
  - PACKAGE / PACOTE / DYNAMIC_PACKAGE
  - FLIGHT / VOO
  - ACTIVITY / ATIVIDADE / TOUR / EXPERIÊNCIA
  - TRANSFER
- Regras antigas continuam a funcionar mesmo quando os integradores usam o nome canónico em inglês.

## Segurança / apresentação
- `.env`, secrets, base local e `node_modules` não fazem parte do ZIP.
- Google Places continua desligado por defeito e só é chamado por ação explícita.
- Custos NET e referências de fornecedor continuam fora do browser público.
- As ofertas catálogo sem disponibilidade não recebem preço inventado.

## Testes executados

```text
npm test
  OK - sintaxe validada em 122 ficheiros JavaScript
  OK - integrações, pricing, passageiros e controlo de custos
  OK - V4 operacional: destinos estritos, modos de pesquisa, datas e tipos de serviço
```

Smoke test adicional com ambiente Vercel simulado e demo forçada por variáveis antigas:

```text
GET /api/deals
  deals: []
  demo: false

POST /api/search — Gran Canaria
  results: [] quando não há fornecedor configurado
  demo: 0
  nunca devolve Disney/Madeira/Punta Cana

POST /api/assisted-request — CRUZEIRO
  pedido criado com referência lead-...
```

## Limitações honestas antes de venda automática real

A versão é adequada para apresentação funcional e para testes com as credenciais sandbox/evaluation. Para venda automática real ainda é necessário concluir/validar:
- acessos de produção dos fornecedores;
- criação/captura real de Stripe/Easypay;
- booking real HBX/Duffel e circuitos de cancelamento/reembolso;
- locks/idempotência persistente em PostgreSQL para booking/pagamentos/faturação;
- catálogo HBX sincronizado localmente em produção;
- novo bedbank (WebBeds/RateHawk/Restel/TBO/etc.) para comparação real multi-fornecedor de hotel;
- fornecedor/API de cruzeiros se se pretender reserva automática de cruzeiros.

## Variáveis importantes na Vercel

```env
ENABLE_DEMO_SEARCH=false
# BOOM_UNSAFE_DEMO_DATA deve ficar vazio
HBX_MODE=test
HBX_ALLOW_LAZY_CONTENT=true
GOOGLE_PLACES_ENABLED=false
```

Além das credenciais já configuradas de Duffel, HBX Hotels/Activities/Transfers, Ticketmaster, OpenWeather, Stripe/Easypay, Supabase e demais integrações.
