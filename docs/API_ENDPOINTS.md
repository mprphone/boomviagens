# Endpoints internos

## GET /api/health
Estado do serviço.

## GET /api/config
Configuração pública sanitizada, catálogo de serviços, modo de pagamentos e métodos/gateways disponíveis. Nunca devolve chaves privadas, NET ou margens internas.

## POST /api/search
Pesquisa inteligente.

Body exemplo:

```json
{
  "prompt": "7 noites nas Caraíbas para 2 adultos até 2500 euros",
  "email": "cliente@exemplo.pt"
}
```

## POST /api/checkout
Cria ou atualiza uma reserva pendente e o respetivo pagamento. Exige sessão de cliente, oferta selada, passageiros válidos e revalidação do fornecedor.

## POST /api/payment/method
Altera o método de um pagamento pendente pertencente ao cliente autenticado e invalida a sessão anterior do gateway.

## POST /api/payment/session
Cria/reutiliza uma sessão Stripe ou Easypay em `PAYMENTS_MODE=gateway`. A resposta inclui apenas o manifesto/URL necessário ao checkout do próprio cliente.

## GET /api/payment/status
Devolve o estado persistido do pagamento ao respetivo cliente. O browser usa-o depois do retorno/callback, sem assumir que um callback visual significa dinheiro recebido.

## POST /api/payment/confirm
Confirma manualmente um pagamento apenas em `PAYMENTS_MODE=mock`. Fica bloqueado em gateway/live.

## POST /api/payments/stripe/webhook
Valida assinatura, ambiente, moeda, montante e metadata Stripe antes de registar o pagamento.

## POST /api/payments/easypay/webhook
Recebe a notificação Easypay e volta a consultar a API autenticada antes de registar o pagamento.

## POST /api/customer/reservations/resume
Revalida disponibilidade/preço de uma reserva pendente e devolve uma nova oferta selada para regressar à revisão/checkout.

## POST /api/customer/documents/upload
Anexa um documento verificado ao passageiro selecionado. Para Passaporte/Cartão de Cidadão exige número, validade e país emissor.

## POST /api/customer/documents/update
Completa/corrige metadados de documentos antigos sem obrigar a novo upload.

## POST /api/chat
Chat inteligente local.

## GET /api/admin/dashboard
Resumo do CRM/backoffice.

## POST /api/admin/operator/tourdiez/test
Testa login e disponibilidade no adapter TourDiez. Em `mock` devolve XML simulado.
