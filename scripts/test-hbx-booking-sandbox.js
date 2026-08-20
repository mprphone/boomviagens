// Smoke test manual e isolado do fluxo real de reserva HBX (nunca chamado
// por nenhuma rota da aplicacao ainda - ver src/hotelbedsAdapter.js e o
// plano em docs/OPERATOR_ADAPTERS.md). Nao toca em pagamentos nem na base
// de dados: pesquisa -> checkRate -> createBooking -> cancelBooking
// imediato, tudo contra o ambiente de TESTE da Hotelbeds.
require('dotenv').config();
const assert = require('assert');
const { HbxClient } = require('../src/integrations/hbxClient');

async function run() {
  const hbx = new HbxClient(process.env);
  assert(hbx.isConfigured('hotels'), 'HBX hotels nao esta configurado (HBX_HOTELS_API_KEY/SECRET)');
  assert(String(process.env.HBX_MODE || '').toLowerCase() !== 'live', 'Este script nao deve correr contra HBX_MODE=live');

  const checkIn = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const checkOut = new Date(Date.now() + 47 * 86400000).toISOString().slice(0, 10);
  console.log(`A pesquisar hoteis em Barcelona (BCN), ${checkIn} -> ${checkOut}...`);

  const results = await hbx.searchHotels({ destinationCode: 'BCN', checkIn, checkOut, adults: 2, children: 0, limit: 20 });
  assert(results.hotels?.length, 'Pesquisa HBX nao devolveu hoteis - nao e possivel continuar o teste');
  const cheapest = results.hotels[0];
  console.log(`Hotel escolhido: ${cheapest.name || cheapest.hotelCode} (rateKey inicial da pesquisa)`);

  const rateKey = cheapest.bestRate?.rateKey;
  assert(rateKey, 'Resultado da pesquisa nao trouxe rateKey - verificar normalizeHotelAvailability()');

  console.log('A verificar a tarifa (checkRate)...');
  const fresh = await hbx.checkRate(rateKey);
  console.log(`Tarifa confirmada: ${fresh.net} EUR, rateKey=${fresh.rateKey.slice(0, 24)}...`);

  console.log('A tentar criar reserva de teste (createBooking)...');
  const suffix = Date.now();
  let booking;
  try {
    booking = await hbx.createBooking({
      rateKey: fresh.rateKey,
      holder: { name: 'Teste', surname: 'Sandbox' },
      paxes: [
        { type: 'AD', name: 'Teste', surname: 'Sandbox' },
        { type: 'AD', name: 'Auditoria', surname: 'Boomviagens' }
      ],
      clientReference: `sbx-${String(suffix).slice(-14)}`
    });
  } catch (err) {
    console.error('createBooking falhou:', err.message, err.status ? `(HTTP ${err.status})` : '');
    console.error('Isto pode significar que a conta de sandbox nao tem o produto de Reservas ativo - confirmar com o suporte da Hotelbeds antes de reagendar este teste.');
    throw err;
  }

  console.log('Resposta bruta da Hotelbeds:', JSON.stringify(booking, null, 2).slice(0, 2000));
  const reference = booking?.booking?.reference;
  const status = booking?.booking?.status;
  console.log(`booking.status=${status} booking.reference=${reference}`);

  if (reference) {
    console.log('A cancelar imediatamente a reserva de teste...');
    const cancelResult = await hbx.cancelBooking(reference);
    console.log('Cancelamento pedido:', JSON.stringify(cancelResult, null, 2).slice(0, 1000));
  } else {
    console.log('Sem referencia devolvida - nada para cancelar.');
  }

  console.log('OK - fluxo completo de reserva HBX testado contra o sandbox.');
}

run().catch(error => { console.error('FALHOU:', error.message); process.exit(1); });
