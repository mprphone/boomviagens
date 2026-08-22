// Catálogo central de produtos do frontoffice. Expõe capacidades, nunca
// credenciais nem nomes comerciais de fornecedores, e permite que uma nova
// integração seja ligada sem alterar a navegação ou os formulários públicos.

const SERVICE_DEFINITIONS = [
  { id: 'PACKAGE', slug: 'pacotes', label: 'Pacotes', description: 'Voo, hotel e extras numa só viagem', priority: 10 },
  { id: 'HOTEL', slug: 'hoteis', label: 'Hotéis', description: 'Alojamentos e tarifas comparadas', priority: 20 },
  { id: 'FLIGHT', slug: 'voos', label: 'Voos', description: 'Ida e volta, só ida e multi-cidade', priority: 30 },
  { id: 'CRUISE', slug: 'cruzeiros', label: 'Cruzeiros', description: 'Cruzeiros por destino e companhia', priority: 40 },
  { id: 'EXPERIENCE', slug: 'experiencias', label: 'Experiências', description: 'Atividades, visitas e bilhetes de eventos', priority: 50 },
  { id: 'TRANSFER', slug: 'transfers', label: 'Transfers', description: 'Aeroporto, hotel e transporte privado', priority: 60 },
  { id: 'CAR', slug: 'rent-a-car', label: 'Rent-a-car', description: 'Viaturas em todo o mundo', priority: 70 },
  { id: 'TRAIN', slug: 'comboios', label: 'Comboios', description: 'Ligações ferroviárias nacionais e internacionais', priority: 80 },
  { id: 'FERRY', slug: 'ferries', label: 'Ferries', description: 'Travessias para passageiros e viaturas', priority: 90 },
  { id: 'CIRCUIT', slug: 'circuitos', label: 'Circuitos', description: 'Grandes viagens e itinerários acompanhados', priority: 100 },
  { id: 'INSURANCE', slug: 'seguros', label: 'Seguros', description: 'Proteção adaptada a cada viagem', priority: 110 },
  { id: 'GIFT', slug: 'cheques-presente', label: 'Cheque presente', description: 'Ofereça uma viagem com valor flexível', priority: 120 }
];

class ServiceCatalog {
  constructor({ env = process.env, tourdiezAdapter, duffel, hbx, ticketmaster, extraCapabilities = [] } = {}) {
    this.env = env;
    this.integrations = { tourdiezAdapter, duffel, hbx, ticketmaster };
    this.extraCapabilities = new Set(extraCapabilities);
  }

  liveProducts() {
    const { tourdiezAdapter, duffel, hbx, ticketmaster } = this.integrations;
    const live = new Set(this.extraCapabilities);
    if (tourdiezAdapter?.isConfigured?.()) { live.add('PACKAGE'); live.add('HOTEL'); }
    if (duffel?.isConfigured?.()) { live.add('FLIGHT'); live.add('PACKAGE'); }
    if (hbx?.isConfigured?.('hotels')) { live.add('HOTEL'); live.add('PACKAGE'); }
    if (hbx?.isConfigured?.('activities')) live.add('EXPERIENCE');
    if (hbx?.isConfigured?.('transfers')) live.add('TRANSFER');
    if (ticketmaster?.isConfigured?.()) live.add('EXPERIENCE');

    return live;
  }

  publicServices() {
    const live = this.liveProducts();
    const directSearch = new Set(['PACKAGE', 'HOTEL', 'FLIGHT', 'EXPERIENCE']);
    return SERVICE_DEFINITIONS.map(service => ({
      ...service,
      availability: service.id === 'TRANSFER' && live.has(service.id) ? 'BUILDER' : live.has(service.id) && directSearch.has(service.id) ? 'ONLINE' : 'ASSISTED',
      searchable: live.has(service.id) && directSearch.has(service.id),
      requestable: true
    })).sort((a, b) => a.priority - b.priority);
  }
}

module.exports = { ServiceCatalog, SERVICE_DEFINITIONS };
