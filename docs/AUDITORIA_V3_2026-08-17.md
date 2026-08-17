# Auditoria V3 — Boomviagens Federated Search / Travel Builder

Data: 17/08/2026

## Resultado executivo

Foi feita uma nova revisão ao ZIP **Federated Search Builder V2**, com testes de sintaxe, testes unitários de integrações/pricing, smoke test completo da API e testes específicos de segurança/permissões.

A V3 está consideravelmente mais segura e coerente para desenvolvimento/preview, mas **ainda não deve ser tratada como pronta para reservas automáticas reais em produção**. Os principais bloqueios restantes estão no fim deste documento.

## Bugs e problemas corrigidos nesta auditoria

### 1. Destino pesquisado nunca é substituído por outro
- correspondência estrita de destinos;
- `Paris` não é `Disneyland Paris`;
- `Atenas` sem stock devolve zero resultados de Atenas;
- termos ambíguos como `Caraíbas` pedem ao cliente para escolher uma sugestão em vez de escolher um destino arbitrário;
- resultados TourDiez que não correspondem ao destino pesquisado são ocultados.

### 2. Ofertas e componentes protegidos contra manipulação do browser
- tokens comerciais passaram a ser **cifrados com AES-256-GCM**, em vez de apenas assinados/legíveis;
- identidade do hotel/destino, NET, referências de fornecedor e preço ficam selados no servidor;
- o checkout reconstrói a oferta pelos dados selados e não pelo JSON alterável do browser;
- voo/transfer/atividade ficam ligados à viagem concreta por `tripBinding`, impedindo reutilizar um componente de outra pesquisa.

### 3. Pesquisa federada com menor desperdício de quota
- cache curta e deduplicação de pedidos simultâneos por pesquisa;
- HBX Hotels: cache de pesquisa 5 min;
- Duffel: cache curta de 60 s (ofertas aéreas expiram rapidamente);
- TourDiez: cache 2 min;
- duplo clique, refresh ou dois separadores iguais deixam de repetir imediatamente a mesma chamada ao fornecedor na mesma instância;
- Google Places continua lazy e desligado por omissão.

> Em Vercel esta cache é por instância. Para volume elevado deve migrar para Redis/Upstash ou outra cache distribuída.

### 4. Ranking de resultados melhorado
O ranking deixou de ser simplesmente a ordem em que os fornecedores responderam. Agora é calculado dentro de cada família de produto usando:
- preço relativo;
- categoria/avaliação do hotel;
- flexibilidade de cancelamento;
- fiabilidade/live do fornecedor.

Isto evita que as primeiras 30 combinações Voo + Hotel ganhem automaticamente a todas as restantes apenas por terem sido inseridas primeiro.

### 5. Homepage não publica preços fictícios em produção
O endpoint `/api/deals` usava as ofertas demo mesmo com a pesquisa demo desligada. Isso podia mostrar preços/hotéis fictícios na homepage de produção.

Agora:
- `ENABLE_DEMO_SEARCH=true`: mostra ofertas demo, identificadas como tal internamente;
- produção/demo desligado: não inventa preços; convida o cliente a fazer uma pesquisa real.

### 6. Calendário de preços não inventa preços
Mantida/corrigida a regra da versão anterior:
- sem histórico real e com demo desligado, o calendário responde que ainda não há histórico suficiente;
- não gera 60 preços fictícios em produção.

### 7. HBX: códigos de Hotel e Transfer corrigidos
Foi removida a suposição de que o código de hotel da Hotel Booking API é o mesmo código usado pela Transfer API.
- Hotels usa o catálogo Hotel Content;
- para Transfers é feita a ponte GIATA → código ATLAS;
- em produção recomenda-se sincronizar o catálogo HBX localmente em vez de fazer Content API lazy por pesquisa.

### 8. HBX: ocupação com bebés corrigida
A pesquisa de hotel passa crianças + bebés com as respetivas idades, em vez de ignorar bebés na ocupação.

### 9. HBX CheckRate aplicado apenas quando necessário
- tarifa `RECHECK` é revalidada antes do checkout;
- tarifa `BOOKABLE` não recebe CheckRate desnecessário;
- alteração de preço devolve conflito e obriga o cliente a aceitar/rever.

### 10. Duffel: oferta revalidada antes de checkout
A oferta aérea selecionada é novamente obtida por ID antes de criar a reserva interna:
- expiração é bloqueada;
- mudança de preço/moeda é bloqueada e devolvida ao cliente;
- o browser não é a fonte de verdade do preço do voo.

### 11. Stripe: métodos de pagamento diferido corrigidos
`checkout.session.completed` deixou de significar automaticamente “pago”.
- só é aceite quando `payment_status=paid`;
- `checkout.session.async_payment_succeeded` é tratado como sucesso posterior;
- `payment_intent.succeeded` continua suportado;
- assinatura, valor e moeda são validados pelo circuito existente.

### 12. Pagamento mock falha fechado em produção
- `/api/payment/confirm` só funciona quando mock é explicitamente permitido;
- produção com `PAYMENTS_MODE=mock` não fica implicitamente vulnerável;
- referência de pagamento simulada só é criada em mock;
- em modo real/desligado o sistema não inventa uma referência Multibanco/MB WAY.

### 13. Login de cliente: código demo nunca sai em produção
Sem SMTP configurado, produção devolve erro de configuração e **não devolve o código de login ao browser**.

### 14. Fuga de dados de cliente existente corrigida
`POST /api/customer/register` deixou de devolver perfil privado de um cliente existente a um visitante que apenas conhece o email.

### 15. Upload de cliente não pode fingir ser documento financeiro
O cliente deixou de poder classificar um upload como:
- fatura de compra;
- fatura de venda;
- recibo;
- nota de crédito;
- fotografia interna de ocorrência.

### 16. Permissões financeiras reforçadas no servidor
Não depende do que o frontend esconde.

Perfis Comercial/Operacional deixam de conseguir obter por API:
- `costPrice`/NET;
- margem e regras de margem;
- `netValue` das linhas de serviço;
- IVA interno da linha;
- movimentos de pagamento a fornecedor;
- faturas de compra.

A sanitização da oferta é recursiva porque uma viagem dinâmica pode ter NET dentro de `components.hotel`, `components.flight`, tarifas, etc.

### 17. Escrita de NET protegida
Antes, um perfil Comercial podia fazer POST direto para `/api/admin/reservations/services` e alterar `netValue` mesmo que o UI não mostrasse esse campo.

Agora:
- NET/IVA/desconto interno: Financeiro/Supervisor/Admin;
- PVP: Comercial/Financeiro/Supervisor/Admin;
- Operacional não consegue adulterar NET nem PVP por chamada manual à API;
- a resposta ao Comercial também não devolve NET/IVA.

### 18. Propostas comerciais: custo protegido
`costValue` das propostas também estava disponível a qualquer utilizador autenticado.

Agora:
- Comercial vê serviços, estado e valor de venda;
- custo/margem só é devolvido a Financeiro/Supervisor/Admin;
- tentativa de um Comercial alterar `costValue` por API é ignorada;
- o próprio frontend deixa de mostrar Custo/Margem quando o perfil não tem autorização.

### 19. Confirmação de reserva com perfil adequado
Endpoints que confirmam operacionalmente uma reserva ficaram limitados a:
- Operacional;
- Supervisor;
- Admin.

Um perfil Comercial já não consegue confirmar manualmente uma reserva apenas por chamar diretamente a API.

### 20. Eliminação de serviço com histórico financeiro bloqueada
Uma linha de serviço com pagamentos/reembolsos já não pode ser fisicamente apagada, destruindo histórico. O sistema obriga a cancelar/anular.

### 21. Documentos financeiros protegidos
- fatura de compra fica escondida de Comercial/Operacional;
- upload/eliminação de documento financeiro exige perfil Financeiro/Supervisor/Admin;
- consulta genérica `/api/admin/documents` aplica a mesma regra.

### 22. Fornecedores sem fuga de custos
Perfis não financeiros podem continuar a consultar dados operacionais do fornecedor, mas:
- não recebem `totalCost`;
- reservas associadas são sanitizadas;
- faturas de compra não são entregues;
- criação/alteração da ficha do fornecedor exige Financeiro/Supervisor/Admin.

### 23. Configuração interna não aparece no dashboard Comercial
Campos como `defaultMarginPercent` e `confirmationMode` deixaram de ser enviados através de `company` para perfis sem permissão financeira.

### 24. Topologia de fornecedores escondida do site público
- `/api/search` devolve apenas resumo genérico de fornecedores;
- `/api/health` deixou de expor o modo TourDiez;
- homepage/deals deixou de devolver o operador interno;
- nomes/configuração completos permanecem no API Lab reservado.

### 25. Static server e URLs externas endurecidos
- proteção contra path traversal/null byte;
- Host malformado não derruba o static server;
- imagens/URLs externas são limitadas a protocolos seguros;
- vários handlers inline com tokens externos foram removidos em favor de `data-*` + event delegation.

## Testes executados

### `npm test`
- validação de sintaxe recursiva de **121 ficheiros JavaScript**;
- testes de integrações/pricing/passengers/security.

Resultado: **PASS**.

### `npm run test:api`
Smoke test end-to-end local:
1. config pública sanitizada;
2. backoffice exige autenticação;
3. pesquisa;
4. login cliente;
5. manipulação de hotel/destino/preço no browser é ignorada;
6. checkout;
7. Comercial não lê/altera custo de propostas;
8. Comercial não lê/altera NET/IVA do processo;
9. Comercial não confirma operacionalmente uma reserva;
10. pagamento mock validado;
11. operador sem referências reais entra em revisão humana;
12. confirmação manual auditada;
13. registo público de email existente não expõe PII.

Resultado: **PASS**.

### Teste produção-like sem demo
Com `ENABLE_DEMO_SEARCH=false` e sem fornecedores externos ligados:
- Atenas → 0 resultados, sem Disneyland/outro destino;
- Caraíbas → pede escolha entre sugestões (ex.: Punta Cana/Riviera Maya);
- calendário → indisponível, sem preços inventados.

Resultado: **PASS**.

### Dependências
Foi tentado `npm audit --omit=dev`, mas o ambiente de auditoria não conseguiu resolver `registry.npmjs.org` (`EAI_AGAIN`). Assim, **não é correto afirmar que o audit de vulnerabilidades npm foi concluído**. Deve ser executado no PC/CI com internet:

```bash
npm audit --omit=dev
```

## Bloqueios antes de produção real

1. **Criar pagamentos reais outgoing** Stripe/Easypay. Hoje os webhooks estão mais seguros, mas a criação real do pagamento ainda não está completa.
2. **Idempotência persistente de webhooks**: tabela `payment_gateway_events` com `gateway + event_id` UNIQUE.
3. **Transações/locks PostgreSQL** para checkout, booking, confirmação, faturação e claims. `updateDb`/estado inteiro não é suficiente sob concorrência Vercel.
4. `approvalsInProgress = new Set()` é apenas uma proteção local; precisa lock de DB.
5. **Facturalusa**: `billing_jobs` com UNIQUE por pagamento/tipo e claim transacional para impedir emissão duplicada concorrente.
6. **Booking real Duffel/HBX**: create order/booking, alterações, cancelamentos e reconciliação ainda não estão completos.
7. **Refund real**: REQUESTED → APPROVED → SENT_TO_GATEWAY → REFUNDED/FAILED + refund id + NC.
8. **Rate limit distribuído** (Redis/Upstash) em vez de Map em memória.
9. **Cache distribuída** para pesquisa quando houver tráfego real; a cache V3 atual é por instância.
10. **Login code one-use persistente**: challenge id, tentativas e `consumedAt`; hoje o challenge assinado ainda pode ser reutilizado durante o TTL.
11. **Âmbito por agência/branch no servidor**: filtros visuais não substituem autorização por agência.
12. **Upload direto para storage** com signed URL, limite MIME/magic bytes/hash/antimalware/versionamento; Base64 JSON deve desaparecer.
13. **Dinheiro em integer cents/Decimal**, evitando JS `Number` nos cálculos críticos.
14. **CSP estrita** depois de remover os handlers/styles inline restantes.
15. **Logs append-only/paginados**; não truncar audit/operator logs a 100/200 registos.
16. **Regras documentais por destino/serviço**; não exigir sempre passaporte + seguro a toda a gente.
17. **Propostas estruturadas por linhas** em vez de `services` texto livre.
18. **IDs relacionais** para cliente/passageiro/fornecedor + snapshots históricos no processo.
19. **Deduplicação multi-bedbank real** quando entrarem WebBeds/RateHawk/Restel/etc.: hotel master/mapper + várias tarifas de fornecedores sob o mesmo hotel.
20. **HBX Content sync** periódico em produção; `HBX_ALLOW_LAZY_CONTENT` é apenas para teste/evaluation.
21. **Guardar viagem persistentemente na conta**: hoje guardar é sobretudo local/share token; para retomar dias depois deve existir SavedTrip no servidor e nova revalidação automática de preço.
22. **CI + observabilidade**: GitHub Actions, testes em cada push, Sentry/logs estruturados e alertas.

## Configuração recomendada para Preview

```env
ENABLE_DEMO_SEARCH=false
GOOGLE_PLACES_ENABLED=false
PAYMENTS_MODE=mock
HBX_ALLOW_LAZY_CONTENT=true
```

`PAYMENTS_MODE=mock` deve ser usado apenas em Preview/Development. Em Production deve permanecer `disabled` até a criação real do gateway estar pronta.

## Veredicto

**Boa versão para Preview, desenvolvimento e testes das APIs. Não abrir ainda booking/pagamento automático real ao público.**

A prioridade seguinte deve ser: pagamentos outgoing + idempotência/locks PostgreSQL + booking real dos fornecedores; depois multi-bedbank/deduplicação e Saved Trips persistentes.
