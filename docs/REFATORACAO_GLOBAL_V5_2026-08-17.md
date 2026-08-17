# Boomviagens V5 — Refatoração Global

## Objetivo
Deixar de tratar a pesquisa aérea como um formulário português com três aeroportos e aproximar a experiência de comparadores globais, mantendo a lógica comercial e de agência da Boomviagens.

## Alterações principais

- Pesquisa de voos mundial através do endpoint Places da Duffel.
- Origem e destino aceitam cidades, áreas metropolitanas e aeroportos (ex.: Londres/LON, Heathrow/LHR, Nova Iorque/NYC, JFK, Dubai/DXB, Tóquio/TYO/NRT).
- Três tipos de viagem: Ida e volta, Só ida e Multi-cidade.
- Multi-cidade suporta 2 a 6 trajetos, cada um com origem, destino e data próprios.
- Pesquisa Multi-cidade é enviada à Duffel como várias `slices`, em vez de simular vários bilhetes separados.
- Autocomplete de aeroportos é server-side; o token Duffel nunca vai para o browser.
- Resultados de voos mostram todos os trajetos e não apenas ida/volta.
- Pesquisa de destinos de hotel/pacote passou a enriquecer sugestões com cidades Duffel. Para destinos dinâmicos, o sistema tenta o código de cidade/IATA no HBX e falha de forma limpa se o ambiente HBX não tiver mapeamento/disponibilidade.
- UI mobile redesenhada: cabeçalho compacto, telefone retirado do topo móvel, produtos em scroll horizontal e pesquisa aérea mais próxima de um comparador moderno.
- Removidos os emojis grandes do seletor de produto.
- Erros de preenchimento de voo aparecem dentro do formulário; deixámos de depender de `alert()` neste fluxo.
- Mantida a regra: nunca substituir o destino pesquisado por inventário de outro destino.

## Limite importante do HBX
A Duffel pode pesquisar cidades/aeroportos globalmente em tempo real. O HBX recomenda que o Content API seja sincronizado para uma base de dados local e não consultado em tempo real para autocomplete. A V5 aceita destinos globais e tenta códigos usuais, mas a versão de produção deve ter uma tabela local `destinations` sincronizada do HBX para mapear corretamente qualquer cidade para os respetivos códigos HBX.

## Próxima fase recomendada

1. Sincronização offline de destinos/hotéis HBX para Supabase.
2. Segundo/terceiro bedbank para comparação real de tarifas do mesmo hotel.
3. Deduplicação por GIATA + hotel + quarto + regime.
4. Filtros de voo: bagagem, direto, companhia, horários, duração, aeroportos próximos.
5. Datas flexíveis ±1/±3 dias e calendário de tarifas reais.
6. Booking real Duffel/HBX + pagamentos com idempotência persistente.
7. Transfer e atividades após seleção do hotel, com origem/destino derivados do itinerário e não pedidos novamente ao cliente.
