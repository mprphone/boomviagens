# Boomviagens — Frontoffice Rebuild

## Âmbito

Refatoração visual e estrutural do frontoffice público, preservando o servidor, contratos HTTP, backoffice, autenticação, checkout, pricing, persistência e integrações existentes.

## Auditoria efetuada

- O servidor Node serve o frontoffice estático e encaminha as rotas por `src/http/router.js`.
- A pesquisa pública mantém contratos independentes para pesquisa federada, voos, experiências, aeroportos, destinos, calendário de preço, partilha e construtor de viagem.
- O checkout mantém as etapas e endpoints de criação, escolha e confirmação do pagamento.
- A área de cliente mantém autenticação, perfil, passageiros, reservas, documentos e pagamentos.
- O backoffice permanece isolado em `public/backoffice` e não foi alterado.
- As integrações Duffel, HBX, Ticketmaster, TourDiez, OpenWeather, Google Places, Stripe, Easypay e Facturalusa continuam exclusivamente no servidor.

## Alterações

- Header público redesenhado, compacto e sticky, com navegação comercial, apoio, idioma, moeda e conta.
- Hero reconstruído com hierarquia editorial, mensagem de confiança e pesquisa como ação principal.
- Motor de pesquisa reorganizado visualmente para reduzir ruído, mantendo tabs, tipos de produto, autocomplete mundial, todos os aeroportos, datas, passageiros e multi-cidade.
- Sistema visual novo: azul Boomviagens, tipografia Plus Jakarta Sans + DM Sans, escala de espaços consistente, superfícies claras, sombras subtis e estados de foco acessíveis.
- Homepage refinada com categorias, ofertas reais, inspiração, prova de confiança e agências.
- Resultados, construtor de viagem e checkout harmonizados com a nova identidade através de uma camada visual partilhada.
- Comportamento mobile reforçado para header, pesquisa, categorias, cards, filtros e ações.
- Removido o emoji do botão principal de pesquisa e substituído o menu mobile por um ícone CSS consistente.

## Ficheiros modificados

- `public/index.html`
- `public/css/base.css`
- `public/css/header.css`
- `public/css/hero-search.css`
- `public/css/polish.css`

## APIs preservadas

- `/api/search`, `/api/flights/search`, `/api/experiences/search`
- `/api/airports/suggest`, `/api/destinations/suggest`, `/api/price-calendar`
- `/api/travel-intelligence`, `/api/trip-builder/update`
- `/api/share-trip`, `/api/assisted-request`
- `/api/checkout`, `/api/payment/method`, `/api/payment/confirm`
- Rotas `/api/customer/*` e `/api/admin/*`

## Testes efetuados

- Validação sintática dos 124 ficheiros JavaScript.
- Testes de integrações, pricing, passageiros e controlo de custos.
- Testes operacionais de destinos, datas e tipos de serviço.
- Testes de aeroportos mundiais, ida, ida e volta e multi-cidade.
- Testes do frontoffice: pesquisa global, grupos aeroportuários, calendário e transição checkout 1 → 2.
- Smoke test HTTP local do documento público e recursos CSS.

## Limitações e dependências de produção

- Preços, disponibilidade e conteúdo comercial dependem das respostas reais dos fornecedores e da configuração do ambiente.
- Pagamentos reais dependem das credenciais e webhooks Stripe/Easypay configurados em produção.
- O enriquecimento Google Places mantém-se desativado por defeito.
- Não foram criados preços, stock ou dados demo.
- A inspeção visual automatizada em navegador ficou indisponível na sessão de execução; a implementação foi validada por estrutura, CSS responsivo e testes funcionais existentes.

## Segurança

- `.env` não foi alterado.
- Nenhum segredo, NET, margem, rate key ou token foi movido para o cliente.
- O ZIP de entrega exclui `.env`, `.git`, `node_modules` e bases locais com dados reais.
