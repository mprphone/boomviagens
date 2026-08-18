# Auditoria V9 — cliente, documentos, retoma e pagamentos

Data: 18/08/2026

## Resultado

Foi auditado o percurso público completo: pesquisa, resultados, revisão, autenticação, checkout, passageiros, documentos, reservas guardadas, retoma e pagamento. Os defeitos encontrados nestes percursos foram corrigidos no código e cobertos por testes automáticos.

## Correções implementadas

### Pesquisa sem disponibilidade

- O estado com zero hotéis deixa de manter uma grelha de três colunas vazias.
- O resumo e a mensagem de indisponibilidade ocupam colunas explícitas e passam para uma coluna em ecrãs menores.
- A barra de ordenação desaparece quando não existem resultados reais.

### Sessão e login

- O checkout reutiliza uma sessão de cliente válida e não pede novamente password/código.
- Sem sessão, um cliente existente pode entrar por password ou pedir um código por email.
- A identidade que possui o rascunho fica registada no browser; dados de uma conta não são restaurados noutra.
- `BroadcastChannel`, com fallback por evento de storage, sincroniza login/logout entre separadores e recarrega vistas antigas.

### Documentos

- `IDENTITY_CARD` e `PASSPORT` são tipos separados.
- Documento de identidade exige passageiro concreto, número, data de validade e país emissor.
- A validade tem de cobrir a data de regresso da viagem.
- O servidor verifica tamanho e assinatura real de PDF/JPEG/PNG; não confia apenas no MIME enviado pelo browser.
- Duplicados são detetados e documentos familiares completos são reutilizados em reservas futuras.
- Documentos antigos podem receber/corrigir metadados sem novo upload.

### Reservas guardadas

- Uma reserva pendente abre novamente a revisão, não um botão de pagamento simulado.
- Antes de continuar, Duffel/HBX ou o adapter do operador voltam a validar disponibilidade e preço.
- Uma alteração de preço é apresentada ao cliente e o checkout atualiza a mesma reserva/pagamento, sem duplicar processos.
- Passageiros já associados são repostos no checkout.

### Pagamentos

- `PAYMENTS_MODE=gateway` cria Stripe Checkout Sessions no servidor.
- MB WAY/Multibanco criam um manifesto Easypay no servidor e carregam o SDK oficial em modo inline.
- O cliente nunca envia nem recebe as chaves privadas dos gateways.
- Retorno/callback do browser apenas inicia polling; só um webhook validado marca `PAID`.
- Stripe valida assinatura, ambiente, moeda, montante e `paymentId` em metadata.
- Easypay volta a consultar `GET /single/{id}`, verifica `payment_status`, valor/moeda e a referência criada em `capture.transaction_key`.
- Sessões são reutilizadas e invalidadas ao trocar de método.
- O armazenamento aceita temporariamente um Supabase sem as colunas novas; a sessão fica espelhada no JSON interno da oferta. A migração continua obrigatória antes de live.

### Privacidade

- As respostas de checkout/Área de Cliente não incluem `costPrice`, margem, rate keys, referências de fornecedor nem manifestos internos de outro cliente.
- Endpoints de sessão/status verificam sempre a sessão e o dono da reserva.

## Verificações executadas

- `npm test`: sintaxe e suites V4–V9 aprovadas.
- `npm run test:api` em modo mock: percurso HTTP completo aprovado contra Supabase.
- `npm run test:gateway:sandbox`: Stripe e Easypay criaram sessões sandbox de 1 EUR sem cobrança.
- Teste HTTP em `PAYMENTS_MODE=gateway`: Stripe redirect, Easypay embedded e reutilização de sessão aprovados.
- `npm audit --omit=dev`: 0 vulnerabilidades conhecidas.
- `git diff --check`: sem erros de whitespace.

## Checklist obrigatório antes de produção

1. Executar `docs/EXECUTAR_NO_SUPABASE.sql` no SQL Editor do Supabase.
2. Definir `PUBLIC_BASE_URL=https://dominio-publico` e confirmar `PAYMENTS_MODE=gateway`.
3. Configurar na Stripe o webhook `POST /api/payments/stripe/webhook` e o segredo correspondente.
4. Configurar na Easypay a notificação de pagamento para `POST /api/payments/easypay/webhook`.
5. Trocar endpoints/chaves sandbox por live apenas depois de um pagamento e reembolso real de baixo valor terem sido reconciliados no backoffice.
6. Confirmar SMTP, domínio, cookies Secure e `SESSION_SECRET` de produção.
7. Fazer QA visual manual em desktop e telemóvel no deployment. O browser automatizado não estava disponível nesta sessão; os ecrãs foram validados por estrutura, CSS, HTTP e testes, não por screenshot final.

## Riscos residuais conhecidos

- As gravações Supabase ainda são uma sequência de upserts PostgREST; para grande volume, pagamento/booking/faturação devem passar para funções SQL transacionais com locks.
- O rate limit de códigos de login vive em memória por instância; num deployment serverless distribuído deve migrar para armazenamento partilhado com TTL.
- A confirmação final de fornecedor continua dependente das credenciais e respostas reais de cada operador; quando não há certeza, o processo fica em `HUMAN_REVIEW` e nunca inventa um localizador.
