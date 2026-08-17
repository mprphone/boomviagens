# Boomviagens — pacote de melhorias 17/08/2026

Este pacote foi preparado sobre a versão `1782026.zip` e implementa as melhorias de UX, checkout, área de cliente, backoffice e robustez discutidas durante a revisão.

## 1. Processo de pesquisa / escolha da viagem

- Resultados com cartões mais visuais e fotografias de destino/hotel.
- Ação **Guardar** diretamente nos resultados.
- Nova página de **Construção/Revisão da Viagem**, em vez de saltar diretamente de um resultado para um formulário de checkout.
- Informação da viagem organizada por componentes (voo, hotel, extras) e preço sempre visível.
- Ações **Guardar viagem** e **Partilhar viagem**.
- Partilha segura por link assinado (`/api/share-trip`), sem expor custo NET ou margem interna.
- Preparação da estrutura para trocar componentes/upgrade de forma mais natural.
- Resumo de confiança antes da reserva (preço, datas, passageiros, cancelamento/condições quando disponíveis).

## 2. Pesquisa de passageiros mais prática

- O seletor deixou de ser um simples campo numérico e passou para um painel de adultos/crianças.
- O checkout distingue claramente **titular/comprador** de **passageiro**.
- Opção explícita **“Eu também vou viajar”**.
- O titular só é usado para pré-preencher o passageiro 1 quando essa opção está ativa.

> Nota: tarifas de bebé/infant ainda devem ser implementadas por operador antes de serem vendidas automaticamente; passageiros com menos de 2 anos são bloqueados no checkout e o sistema explica que necessitam da categoria/tarifa correta.

## 3. Checkout redesenhado

Fluxo agora claramente separado:

1. Dados de faturação / contacto
2. Passageiros
3. Pagamento
4. Confirmação

Melhorias:

- Checkout em experiência de página completa, não numa janela apertada.
- Resumo da viagem sempre visível.
- Auto-save do rascunho em `sessionStorage`.
- Recuperação do formulário se o cliente fechar/voltar dentro da mesma sessão.
- Login/verificação de email sem perder o ponto da reserva.
- Reutilização dos dados já existentes na conta.
- Possibilidade de atualizar conscientemente a ficha do cliente com os dados usados na reserva.
- Escolha do meio de pagamento retirada totalmente da etapa de passageiros.
- Área de pagamento própria para MB WAY, Multibanco e Cartão.
- Confirmação final com linguagem orientada à viagem, e não apenas um ID técnico.

## 4. Validações inteligentes de passageiros

Validação em frontend **e novamente no servidor**:

- Nome e apelido obrigatórios.
- Data de nascimento obrigatória e plausível.
- Idade calculada **na data de regresso da viagem**, não na data de hoje.
- Adulto com menos de 12 anos: bloqueado.
- Criança que terá 12 ou mais anos: bloqueada como criança.
- Menor de 2 anos: indica necessidade de tarifa/categoria de bebé.
- Nacionalidade obrigatória.
- Tipo de documento obrigatório.
- Número de documento obrigatório.
- País emissor obrigatório.
- Validade do documento obrigatória.
- Documento expirado: bloqueado.
- Documento que expira antes do regresso: bloqueado.
- Número de documento duplicado entre passageiros: bloqueado.
- Número de passageiros tem de coincidir com a pesquisa.

As mensagens foram escritas em linguagem humana para ajudar o utilizador a corrigir o problema, e não apenas devolver “campo inválido”.

## 5. Carteira de passageiros da Área de Cliente

- Corrigido o caso em que a conta podia mostrar apenas a esposa/outro passageiro e não o próprio titular.
- O **Titular** passa a ser garantido na carteira mesmo que já existam outros passageiros.
- Passageiros guardados podem ser reutilizados no checkout.
- O conceito fica separado entre “pessoas guardadas na minha conta” e “passageiros desta viagem”.

## 6. Pagamentos — correções de segurança e de lógica

- `/api/payment/confirm` só funciona em `PAYMENTS_MODE=mock`; não pode marcar uma reserva como paga em produção.
- O método de pagamento é alterado por endpoint próprio e validado pelo servidor.
- Quando um webhook real confirma dinheiro recebido, o sistema grava **PAID primeiro** e só depois tenta validar/reservar no operador.
- Assim, uma falha da TourDiez não pode fazer desaparecer o facto de que o Stripe/Easypay já recebeu o dinheiro.
- Stripe: valida montante, moeda e `livemode` do evento antes de aceitar o pagamento.
- Easypay: não confia no corpo recebido; volta a consultar a API Easypay autenticada e valida o estado/montante/moeda.
- Pagamento e reserva passam a poder ter estados diferentes (ex.: pago + operador em revisão humana).

## 7. Segurança do backoffice

- Em produção o servidor exige `SESSION_SECRET` real.
- Eliminado fallback previsível de segredo de sessão.
- Cookies passam a `Secure` em produção.
- O bootstrap `admin/admin123` deixa de existir em produção.
- Rotas com `roles` falham fechadas se não existir funcionário válido na sessão.
- Detalhe de processo passa a retirar custo NET/margem/pagamentos a fornecedores para perfis que não sejam Financeiro/Supervisor/Admin.

## 8. Backoffice reorganizado por contexto

Nova navegação superior por área:

- **Comercial**
- **Operação**
- **Online**
- **Equipa**
- **Financeiro**
- **Gestão**

O menu lateral é contextual: deixa de tentar mostrar toda a empresa ao mesmo tempo.

Isto aproxima a utilização do princípio:

**Área → O Meu Dia → Processo**

em vez de obrigar o utilizador a navegar por dezenas de listagens globais.

## 9. Área Online / novas vendas

- Criada vista **Online** no backoffice.
- Resumo de entradas online, vendas a tratar, estados e processo.
- Uma nova venda online passa a ter destaque visual no resumo operacional.
- O objetivo é impedir que uma venda automática fique escondida dentro de um KPI ou numa lista extensa.

## 10. Facturalusa

Mantém-se a integração já criada:

- cliente/artigo/série;
- emissão automática após pagamento;
- documento ligado ao processo;
- se a faturação falhar, o pagamento/reserva não são desfeitos;
- fica ocorrência e possibilidade de **Tentar emitir agora**.

Foi preservada a regra de M12 / Regime da Margem configurada no cliente da Facturalusa, mas o modelo fiscal definitivo (FR por pagamento vs. adiantamentos/fatura final) deve ser validado antes de produção.

---

# Importante — o que ainda NÃO deve ser considerado pronto para produção real

Este pacote corrige muitos problemas, mas não pretende esconder os itens que continuam pendentes.

## P0 — antes de abrir pagamentos/reservas automáticas ao público

1. **Criar pagamentos outgoing reais** no Stripe e Easypay (`createPayment` / Checkout Session / Single Payment). Os webhooks estão preparados, mas o frontend real ainda não cria a sessão no gateway.
2. **Idempotência persistente por event ID** de Stripe/Easypay. A proteção atual evita duplicações sequenciais, mas duas funções serverless simultâneas ainda exigem restrição/lock em PostgreSQL.
3. **Locks/transações atómicas Postgres** para:
   - reclamar booking antes de chamar operador;
   - marcar webhook processado;
   - emitir uma única fatura Facturalusa por pagamento;
   - impedir confirmação simultânea por duas instâncias Vercel.
4. **Rate-limit partilhado** (Supabase/Redis/Upstash), em vez de memória local da função.
5. **Modelo fiscal definitivo** de adiantamentos/fatura/recibos/notas de crédito validado para a agência.
6. **Refunds reais** ligados a gateway + NC + conta do processo.
7. **Migrations da BD**: o schema desta entrega foi atualizado e existe migration de Pricing V2; em produção manter migrations versionadas e executar `docs/migrations/2026-08-17-pricing-v2.sql` numa base Supabase já existente.
8. **Testes automáticos de concorrência/webhooks duplicados/falhas de operador** antes de live.

## Próxima fase funcional recomendada

- `booking_orders` separados de processos/reservas para carrinhos/checkouts abandonados.
- `offer_snapshots` server-side (browser envia apenas `offer_id`).
- linhas estruturadas de propostas (`proposal_lines`).
- IDs persistentes para cliente/passageiro/fornecedor em vez de depender de email/nome.
- scheduler real para “O Meu Dia”, opções a expirar, documentos, check-ins e reclamações.
- self-service do cliente: upgrades, extras, alterações, cancelamentos, check-in e reclamações acompanhadas.


---

# Fase adicional — Travel Intelligence / Pricing V2 (17/08/2026)

Foi acrescentada uma nova camada de integração e experiência de pesquisa/revisão, documentada em `docs/TRAVEL_INTELLIGENCE_2026-08-17.md`.

Principais alterações desta fase:

- Duffel para alternativas de voo no detalhe da viagem;
- HBX Hotels/Activities/Transfers com API Lab e ativação progressiva;
- OpenWeather para contexto atual do destino;
- Ticketmaster para eventos nas datas da viagem;
- Google Places preparado mas desligado por omissão e apenas on-demand;
- proteção de quotas através de `offerToken` assinado + rate-limit + cache;
- pesquisa com adultos/crianças/bebés e idades;
- comparação, guardar, partilhar, filtros e revisão mais interativa;
- Pricing V2 por operador/canal/produto/destino;
- cedência automática limitada por margem mínima;
- rappel/override estimado separado e nunca usado automaticamente para quebrar o preço mínimo;
- regras de margem deixam de ser expostas publicamente;
- API Lab e pricing protegidos por perfil;
- migration Supabase `docs/migrations/2026-08-17-pricing-v2.sql`;
- upgrade automático de schemas SQLite antigos.
