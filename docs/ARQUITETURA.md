# Arquitetura sugerida para produção

## Frontend
- Next.js ou React.
- Páginas SEO por destino.
- Pesquisa clássica e pesquisa por linguagem natural.

## Backend
- Node/NestJS, Laravel ou Django.
- API interna para pesquisa, reserva, cliente, pagamento e chat.
- Sistema de filas para chamadas lentas a operadores.
- Cache de disponibilidade com validade curta.

## Base de dados
- Supabase/PostgreSQL.
- Tabelas: clientes, passageiros, leads, propostas, pesquisas, operadores, ofertas, reservas, pagamentos, emails, logs_api, regras_margem.

## Operadores
Cada operador deve ter adapter próprio:

```text
operatorAdapters/
  tourdiez.js
  solferias.js
  w2m.js
  jolidey.js
```

Todos devolvem o mesmo formato interno:

```json
{
  "operator": "TourDiez",
  "destination": "Punta Cana",
  "hotel": "Hotel X",
  "costPrice": 1000,
  "currency": "EUR",
  "rateKey": "...",
  "cancellationPolicy": "...",
  "available": true
}
```

## Regra principal
Nunca confirmar reserva externa antes de:

1. voltar a validar preço e disponibilidade;
2. confirmar pagamento;
3. guardar o log da operação;
4. gerar confirmação para cliente.
