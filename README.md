# Boom das Viagens — Site operacional de reservas inteligentes

Este ZIP inclui uma primeira versão **funcional para testes reais em ambiente local** do `boomdasviagens.pt`:

- site público com pesquisa inteligente;
- motor de comparação de operadores;
- cálculo de preço com margem configurável;
- propostas automáticas;
- criação de leads e clientes;
- checkout com MB WAY / Multibanco / Cartão em modo simulado;
- reserva semi/automática;
- adapter preparado para TourDiez/Sirio;
- backoffice com leads, reservas, margens, emails e logs;
- chat local com handoff para humano;
- base de dados em JSON para arranque rápido.

> Importante: funciona já em modo `mock`, sem credenciais externas. Para produção é necessário ligar pagamentos reais, credenciais dos operadores, emails reais, autenticação do backoffice e validações legais finais.

---

## Como correr

1. Instalar Node.js 18 ou superior.
2. Abrir terminal na pasta do projeto.
3. Executar:

```bash
npm start
```

4. Abrir:

```text
http://localhost:3000
```

---

## Teste rápido API

Com o servidor ligado:

```bash
npm run test:api
```

O teste faz:

1. pesquisa inteligente;
2. cria reserva;
3. cria pagamento simulado;
4. confirma pagamento;
5. chama validação/confirm mock do operador;
6. gera email interno.

---

## Configuração

Copiar `.env.example` para `.env` se quiser usar variáveis de ambiente.

Campos principais:

```env
PORT=3000
COMPANY_RNAVT=INSERIR_NUMERO_RNAVT
TOURDIEZ_MODE=mock
TOURDIEZ_BASE_URL=https://endpoint-do-operador.example/api
TOURDIEZ_USER=
TOURDIEZ_PASSWORD=
PAYMENTS_MODE=mock
```

Nota: este projeto não carrega automaticamente `.env` para evitar dependências. Em produção, usar variáveis no servidor, Docker, Vercel, Render, Railway ou instalar `dotenv`.

---

## Adapter TourDiez/Sirio

Ficheiro principal:

```text
src/tourdiezClient.js
```

Inclui métodos:

- `login()`;
- `getAccomodationAvail()`;
- `value()`;
- `confirm()`;
- `cancel()`.

O adapter envia `POST` com:

- `pOperacion`;
- `pRequest` em XML.

Isto segue a estrutura da documentação TourDiez/Sirio enviada. Como os endpoints/credenciais definitivos não foram enviados, o modo predefinido é `mock`.

---

## Onde configurar margens

No ficheiro:

```text
data/db.json
```

Bloco:

```json
"margins": [
  { "name": "Caraíbas", "percent": 8, "min": 80, "roundTo": 5 }
]
```

Também existe endpoint:

```http
POST /api/admin/margins
```

---

## Fluxo operacional incluído

### 1. Site e captação

Cliente pesquisa destino/datas/orçamento. O sistema cria lead e proposta.

### 2. Operadores

O motor está preparado para multi-operador. Neste MVP há operadores demo e adapter TourDiez.

### 3. Margem e proposta

O sistema aplica regra por destino/campanha e arredonda o preço comercial.

### 4. Reserva e pagamento

Cria reserva, pagamento simulado e, após confirmação, valida/confirm no operador.

### 5. CRM, chat e automação

Backoffice mostra leads, reservas, emails e logs. Chat responde e indica quando deve passar para humano.

---

## Pontos obrigatórios antes de produção

- Inserir RNAVT real.
- Ligar Livro de Reclamações.
- Rever Termos e Condições com regras de viagens organizadas.
- Ativar política de privacidade e cookies.
- Colocar autenticação no backoffice.
- Ligar pagamentos reais: SIBS / Easypay / Stripe.
- Ligar email real: Brevo / Sendgrid / Mailgun.
- Confirmar contrato e limites de API com operadores.
- Garantir que nunca se confirma uma reserva externa sem preço validado e pagamento confirmado.

---

## Próximo desenvolvimento recomendado

1. ~~Migrar `data/db.json` para Supabase/PostgreSQL.~~ Feito: `src/storage.js` liga a Supabase quando `DB_MODE=supabase` (ver `docs/SUPABASE_SETUP.md`). Falta criar o projeto real e definir as variáveis em produção.
2. Criar autenticação de clientes e backoffice.
3. Colocar jobs de sincronização de hotéis/destinos TourDiez.
4. Adicionar mais operadores.
5. Implementar ranking real com avaliações externas e políticas de cancelamento.
6. Integrar WhatsApp Business.
7. Gerar PDF de proposta e voucher.
8. Enviar emails reais.
9. Integrar pagamentos SIBS/Stripe/Easypay.
10. Preparar deploy em VPS/Vercel/Render.
Nota atual: o backoffice esta protegido por login. Por defeito local, use `ADMIN_USERNAME=admin` e `ADMIN_PASSWORD=admin123`; altere estes valores antes de expor o site. O teste `npm run test:api` tambem valida que `/api/admin/dashboard` bloqueia pedidos sem sessao.
# boomviagens
