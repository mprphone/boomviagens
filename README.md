# Boomviagens — plataforma comercial, operacional e de venda online

Projeto de desenvolvimento da Boomviagens para gerir o ciclo completo:

**Pesquisa → Viagem guardada/partilhada → Checkout → Pagamento → Processo → Reservas → Financeiro → Documentos → Pós-viagem**

A versão deste pacote inclui site público, Área de Cliente, backoffice contextual, CRM/pipelines, processo de viagem, integração TourDiez em adapter, webhooks Stripe/Easypay e integração inicial Facturalusa.

> Para perceber exatamente o que foi alterado nesta entrega e o que ainda é bloqueador antes de produção, ler primeiro `MELHORIAS_2026-08-17.md`.

## Executar localmente

Requisitos: Node.js 22.5+ (o modo SQLite usa `node:sqlite`).

```bash
cp .env.example .env
npm install
npm start
```

Abrir `http://localhost:3000`.

O ficheiro `.env` nunca deve ser enviado para Git, ZIPs ou chats. Em Vercel/produção, configurar as variáveis diretamente no ambiente.

## Teste de API

Com o servidor em `PAYMENTS_MODE=mock`, `TOURDIEZ_MODE=mock` e `DB_MODE=local`:

```bash
npm run test:api
```

O smoke test confirma, entre outros:

- backoffice protegido;
- pesquisa;
- login de cliente;
- checkout com passageiros completos;
- pagamento mock;
- reserva demo fica em revisão humana;
- não é inventado localizador do operador;
- confirmação manual exige localizador e motivo auditável.

## Ambientes / segurança

Em produção:

- `SESSION_SECRET` é obrigatório;
- `ADMIN_USERNAME` e `ADMIN_PASSWORD` são obrigatórios se for necessário bootstrap de administrador;
- não existe fallback `admin/admin123` em produção;
- cookies de sessão usam `Secure` em produção;
- `/api/payment/confirm` fica bloqueado fora de `PAYMENTS_MODE=mock`.

Ver `.env.example` para todas as variáveis sem segredos reais.

## Operadores

A abstração principal vive em:

- `src/operatorAdapters.js`
- `src/tourdiezClient.js`

TourDiez suporta pesquisa/availability, value, confirm e cancel, mas uma reserva só pode ficar automaticamente `CONFIRMED` quando existe confirmação real e localizador válido do operador. Ofertas demo ou sem referências ficam em `HUMAN_REVIEW`.

## Pagamentos

Receção de webhooks:

- Stripe: assinatura do webhook validada;
- Easypay: a notificação não é considerada fonte de verdade; o servidor volta a consultar a API Easypay autenticada.

Em ambos os casos são validados montante/moeda antes de marcar pagamento como recebido.

**Ainda pendente para live:** criação outgoing da sessão/pagamento Stripe/Easypay + idempotência persistente/locks transacionais em PostgreSQL. Ver `MELHORIAS_2026-08-17.md`.

## Faturação

- `src/facturalusaClient.js`
- `src/invoicing.js`

A faturação é desacoplada do pagamento: uma falha na Facturalusa não apaga nem reverte o pagamento; fica registada e pode ser repetida no backoffice.

Antes de produção validar o modelo fiscal definitivo da agência (adiantamentos, FR/fatura/recibos, NC e M12).

## Base de dados

Modos existentes:

- `DB_MODE=local` — JSON, apenas desenvolvimento;
- `DB_MODE=sqlite` — SQLite local, desenvolvimento;
- `DB_MODE=supabase` — PostgreSQL/Supabase, recomendado para Vercel/produção.

A arquitetura atual ainda precisa de migrar operações críticas (pagamento, booking, webhook e faturação) para transações/locks atómicos PostgreSQL antes de venda automática real em volume.

## Organização funcional

### Site público

- pesquisa;
- resultados visuais;
- guardar viagem;
- partilhar viagem;
- construtor/revisão da viagem;
- checkout por etapas;
- validação inteligente de passageiros.

### Área de Cliente

- próximas viagens;
- viagens anteriores;
- documentos;
- pagamentos;
- carteira de passageiros;
- dados pessoais;
- preferências;
- apoio/reclamações/emergência (conforme módulos ativos).

### Backoffice

Áreas contextuais:

**Comercial | Operação | Online | Equipa | Financeiro | Gestão**

O menu lateral adapta-se à área escolhida em vez de apresentar toda a aplicação ao mesmo tempo.

## Documentação desta entrega

`MELHORIAS_2026-08-17.md` contém:

- melhorias implementadas;
- decisões de UX;
- validações novas;
- correções de segurança;
- melhorias do backoffice;
- lista explícita de P0 ainda pendentes antes de live.

## Travel Intelligence — 17/08/2026

Esta versão acrescenta uma camada de enriquecimento controlado para **Duffel, HBX Hotels/Activities/Transfers, OpenWeather, Ticketmaster e Google Places**.

Princípio principal: a pesquisa normal continua leve. Voos/clima/eventos só são consultados quando o cliente abre uma viagem; Google Places continua desligado por omissão e só pode ser chamado por ação explícita em **Explorar a zona**.

O backoffice inclui **API Lab** para testar integrações manualmente sem consumir quota ao abrir a página.

Também foi introduzido **Pricing V2**: markup sobre NET por operador/canal/produto/destino, margem mínima, cedência controlada e rappel/override estimado separado da margem direta.

Ver detalhes em `docs/TRAVEL_INTELLIGENCE_2026-08-17.md`.

### Supabase já existente

Antes de usar as novas regras de pricing numa base já criada, executar:

```text
docs/migrations/2026-08-17-pricing-v2.sql
```

### Verificação local

```bash
npm install
npm test
npm run dev
```

`npm test` não chama APIs externas. Para testar uma credencial real, usar o botão **Testar ligação** no API Lab do backoffice.

## Auditoria V3

Antes de qualquer deploy real, ler **`docs/AUDITORIA_V3_2026-08-17.md`**. A V3 é adequada a Preview/testes, mas ainda tem bloqueios explícitos para pagamentos e bookings automáticos reais.
