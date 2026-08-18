# Boomviagens — Frontoffice Rebuild V8

## Âmbito

Refatoração visual e estrutural profunda do frontoffice público e da área reservada do cliente. O servidor, contratos HTTP, backoffice, autenticação, pricing, persistência e integrações existentes foram preservados.

## Auditoria efetuada

- O servidor Node serve o frontoffice e encaminha as rotas por `src/http/router.js`.
- A pesquisa mantém contratos independentes para pesquisa federada, voos, experiências, aeroportos, destinos, calendário de preço, partilha e construtor de viagem.
- O checkout mantém os endpoints de criação de reserva, escolha de método e confirmação do pagamento.
- A área de cliente mantém autenticação, perfil, passageiros, reservas, documentos, pagamentos, mensagens e pedidos.
- O backoffice continua isolado em `public/backoffice` e não foi alterado.
- Duffel, HBX, Ticketmaster, TourDiez, OpenWeather, Google Places, Stripe, Easypay, Facturalusa e Supabase continuam exclusivamente no servidor.

## Alterações estruturais

- Substituição real da estrutura pública e consolidação das antigas folhas visuais num único sistema em `public/css/app.css`.
- Novo header comercial e responsivo, homepage, catálogo completo de serviços, destinos, campanhas, confiança e balcões.
- Motor com formulários próprios para pacotes, hotéis, voos, experiências e cruzeiros; autocomplete mundial, grupos de aeroportos, calendário, passageiros e multi-cidade foram preservados.
- Resultados com pesquisa compacta, filtros, ordenação, comparação, estados de loading/empty/error e resumo persistente da viagem.
- Construtor de viagem separado dos resultados, com voo, hotel, transfer, seguro, experiências e informação contextual.
- Checkout em cinco etapas reais: Dados, Passageiros, Extras, Pagamento e Confirmação. Extras sem preço disponível criam um pedido no CRM e nunca alteram silenciosamente o total.
- Uma sessão de cliente ativa é reutilizada no checkout; clientes existentes podem entrar com password ou pedir código, sem verificações repetidas desnecessárias.
- Mudanças de conta noutro separador invalidam o estado local antigo, evitando que duas identidades pareçam ativas no mesmo browser.
- Passaporte e Cartão de Cidadão são documentos separados, com passageiro, número, validade, país emissor e reutilização entre reservas.
- Reservas pendentes voltam à revisão, revalidam preço/disponibilidade e continuam o mesmo processo; não saltam diretamente para pagamento.
- Stripe Checkout e Easypay Checkout são criados no servidor e confirmados exclusivamente por webhook autenticado/verificado.
- Área reservada alinhada com a nova identidade Boomviagens, navegação sem emojis principais e erros funcionais apresentados por notificações acessíveis.
- Novo centro autenticado de pedidos e mensagens para apoio, alterações, cancelamentos, reclamações, pagamentos e documentos, com referência, associação à reserva e histórico do cliente.
- Catálogo de capacidades gerado no servidor. Apenas serviços com adaptador configurado aparecem como pesquisa online; os restantes mantêm um fluxo comercial operacional por pedido assistido.
- Remoção de `alert()` do frontoffice e da área de cliente.

## Principais ficheiros

- `public/index.html`, `public/css/app.css`
- `public/js/services.js`, `public/js/heroSearch.js`, `public/js/results.js`, `public/js/review.js`
- `public/js/checkout/extrasStep.js` e restantes módulos de checkout
- `public/conta/index.html`, `public/conta/css/shell.css`, `public/conta/js/*`
- `src/integrations/serviceCatalog.js`, `src/routes/publicRoutes.js`, `server.js`
- `docs/SERVICE_INTEGRATIONS.md`, `.env.example`
- `scripts/test-frontoffice-v8.js`, `package.json`

As folhas antigas `header.css`, `hero-search.css`, `home.css`, `results.css`, `review.css`, `checkout.css`, `shared.css` e `polish.css` foram removidas porque já não são importadas.

## APIs preservadas

- `/api/search`, `/api/flights/search`, `/api/experiences/search`
- `/api/airports/suggest`, `/api/destinations/suggest`, `/api/price-calendar`
- `/api/travel-intelligence`, `/api/trip-builder/update`
- `/api/share-trip`, `/api/assisted-request`
- `/api/checkout`, `/api/payment/method`, `/api/payment/session`, `/api/payment/status`, `/api/payment/confirm`
- `/api/payments/stripe/webhook`, `/api/payments/easypay/webhook`
- `/api/customer/reservations/resume`, `/api/customer/documents/update`
- Rotas `/api/customer/*` e `/api/admin/*`, incluindo `/api/customer/support-request` e histórico de pedidos

## Testes efetuados

- Validação sintática de 146 ficheiros JavaScript, incluindo o frontoffice, área de cliente e backoffice preservado.
- Testes de integrações, pricing, passageiros e controlo de custos.
- Testes operacionais de destinos, datas, tipos de serviço e contratos existentes.
- Testes de aeroportos mundiais, ida, ida e volta e multi-cidade.
- Testes do frontoffice V7 e V8, incluindo catálogo multiproduto, cinco etapas de checkout, serviços assistidos e ausência de segredos no catálogo público.
- Smoke tests HTTP locais do documento público, área de cliente, CSS, módulos e `/api/config`.

## Limitações e dependências de produção

- Preços, disponibilidade e conteúdo comercial dependem sempre das respostas reais dos fornecedores.
- Pagamentos reais dependem das credenciais live e dos webhooks Stripe/Easypay configurados no domínio HTTPS de produção; a criação de sessão está implementada e foi validada em sandbox.
- Serviços ainda sem adaptador utilizam pedido assistido; passam a online apenas depois de o adaptador implementar pesquisa, normalização, pricing e confirmação.
- O enriquecimento Google Places mantém-se desativado por defeito.
- Não foram criados preços, stock ou dados demo.
- A inspeção visual automatizada em navegador não estava disponível nesta sessão. A implementação foi validada por estrutura, CSS responsivo, contratos, testes e HTTP, ficando recomendada a verificação visual final no deployment.

## Segurança

- `.env` permanece ignorado pelo Git; nenhum segredo foi incluído no controlo de versões.
- Nenhum segredo, NET, margem, rate key ou token foi movido para o cliente ou para `/api/config`.
- As novas variáveis em `.env.example` são apenas convenções sem valores reais.
