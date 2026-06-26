# Endpoints internos

## GET /api/health
Estado do serviço.

## GET /api/config
Configuração pública da empresa e margens.

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
Cria reserva e pagamento simulado.

## POST /api/payment/confirm
Simula pagamento recebido e confirma operador.

## POST /api/chat
Chat inteligente local.

## GET /api/admin/dashboard
Resumo do CRM/backoffice.

## POST /api/admin/operator/tourdiez/test
Testa login e disponibilidade no adapter TourDiez. Em `mock` devolve XML simulado.
