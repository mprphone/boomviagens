const https = require('https');
const http = require('http');
const { URLSearchParams } = require('url');

function esc(value = '') {
  return String(value).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function extractTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return match ? match[1] : null;
}

// Datas da API TourDiez vao em DDMMYYYY (sem separadores). params.checkin /
// params.checkout chegam em ISO (YYYY-MM-DD) do resto da aplicacao.
function toDDMMYYYY(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const [, year, month, day] = m;
  return `${day}${month}${year}`;
}

function roomXml(tag, room) {
  if (!room) return '';
  const childAges = room.childAges || [];
  return `<${tag}>
      <adult>${esc(room.adults ?? 2)}</adult>
      <children>${esc(room.children ?? 0)}</children>
      <firstChildAge>${esc(childAges[0] ?? '')}</firstChildAge>
      <secondChildAge>${esc(childAges[1] ?? '')}</secondChildAge>
      <units>${esc(room.units ?? 1)}</units>
    </${tag}>`;
}

// Sessao da API TourDiez (sessionID devolvido pelo Login) - cacheada na
// instancia e renovada automaticamente quando expira (cod_result M5) ou
// quando o cache local atinge o TTL conservador definido aqui.
const SESSION_CACHE_TTL_MS = 4 * 60 * 1000;

class TourDiezClient {
  constructor(env = process.env) {
    this.mode = env.TOURDIEZ_MODE || 'mock';
    this.baseUrl = env.TOURDIEZ_BASE_URL || '';
    this.user = env.TOURDIEZ_USER || '';
    this.password = env.TOURDIEZ_PASSWORD || '';
    this.agencyCode = env.TOURDIEZ_AGENCY_CODE || '';
    this.session = null;
  }

  isConfigured() {
    return Boolean(this.mode === 'real' && this.baseUrl && this.user && this.password);
  }

  async postOperation(operation, xml) {
    if (!this.isConfigured()) {
      return {
        mock: true,
        operation,
        requestXml: xml,
        responseXml: `<result><code>0</code><description>MOCK OK - definir TOURDIEZ_MODE=real e credenciais para chamada externa</description></result>`
      };
    }

    const payload = new URLSearchParams({ pOperacion: operation, pRequest: xml }).toString();
    const target = new URL(this.baseUrl);
    const lib = target.protocol === 'https:' ? https : http;
    const options = {
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    return new Promise((resolve, reject) => {
      const req = lib.request(options, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('latin1');
          resolve({ statusCode: res.statusCode, operation, requestXml: xml, responseXml: body });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('Timeout TourDiez')); });
      req.write(payload);
      req.end();
    });
  }

  loginXml() {
    return `<?xml version="1.0" encoding="ISO-8859-1"?><Login><user>${esc(this.user)}</user><password>${esc(this.password)}</password></Login>`;
  }

  // Schema real (SirioIntegrationWebServicesBooking_2_9_3_T10.docx, secao
  // 4.2): pedido vai dentro de availabilitySearchData, datas em DDMMYYYY,
  // ocupacao por quarto (room1/room2/room3) e e obrigatorio informar pelo
  // menos um de province/zone/city/accomodationsCode.
  availabilityXml(params = {}) {
    const rooms = params.rooms?.length ? params.rooms : [{ adults: params.adults ?? 2, children: params.children ?? 0, childAges: params.childAges, units: 1 }];
    return `<getAccomodationAvail>
  <sessionID>${esc(params.sessionID || 'mock-session')}</sessionID>
  <availabilitySearchData>
    <initialDate>${esc(toDDMMYYYY(params.checkin))}</initialDate>
    <finalDate>${esc(toDDMMYYYY(params.checkout))}</finalDate>
    <onlyConfirmed>${params.onlyConfirmed === true ? 'true' : 'false'}</onlyConfirmed>
    <retrieveCancelPolicies>${params.retrieveCancelPolicies ? 'true' : 'false'}</retrieveCancelPolicies>
    ${roomXml('room1', rooms[0])}
    ${rooms[1] ? roomXml('room2', rooms[1]) : ''}
    ${rooms[2] ? roomXml('room3', rooms[2]) : ''}
    <accomodationsCode>${esc(params.accomodationsCode || '')}</accomodationsCode>
    <countryCode>${esc(params.countryCode || '')}</countryCode>
    <category/>
    <mealPlan/>
    <city>${esc(params.city || '')}</city>
    <province/>
    <zone/>
  </availabilitySearchData>
</getAccomodationAvail>`;
  }

  valueXml(params = {}) {
    return `<value>
  <sessionID>${esc(params.sessionID || 'mock-session')}</sessionID>
  <IdOperation>${esc(params.idOperation || '')}</IdOperation>
  <code>${esc(params.code || '')}</code>
  <idDistributions>${esc(params.idDistributions || '')}</idDistributions>
</value>`;
  }

  confirmXml(params = {}) {
    const clients = (params.clients || []).map(c => `<client>
      <age>${esc(c.age ?? 30)}</age>
      <dni>${esc(c.dni || '')}</dni>
      <name>${esc(c.name)}</name>
      <firstSurname>${esc(c.firstSurname || '')}</firstSurname>
      <secondSurname>${esc(c.secondSurname || '')}</secondSurname>
    </client>`).join('');
    return `<confirm>
  <sessionID>${esc(params.sessionID || 'mock-session')}</sessionID>
  <IdOperation>${esc(params.idOperation || '')}</IdOperation>
  <code>${esc(params.code || '')}</code>
  <idDistributions>${esc(params.idDistributions || '')}</idDistributions>
  <clientLocalizer>${esc(params.clientLocalizer || '')}</clientLocalizer>
  <remarksForProvider>${esc(params.remarksForProvider || '')}</remarksForProvider>
  <clients>${clients}</clients>
  <invoicingRegime>E</invoicingRegime>
</confirm>`;
  }

  // Root capitalizado (Cancellation), tal como Login - schema confirma os
  // dois como excecao ao padrao lowercase dos restantes servicos.
  cancelXml(params = {}) {
    return `<Cancellation>
  <sessionID>${esc(params.sessionID || 'mock-session')}</sessionID>
  <localizer>${esc(params.locator || '')}</localizer>
  <confirm>${params.simulation === false ? '1' : '0'}</confirm>
</Cancellation>`;
  }

  async login() { return this.postOperation('login', this.loginXml()); }

  async ensureSession(force = false) {
    if (!force && this.session && this.session.expiresAt > Date.now()) return this.session.sessionID;
    const result = await this.postOperation('login', this.loginXml());
    if (result.mock) return 'mock-session';
    const code = extractTag(result.responseXml, 'cod_result');
    const sessionID = extractTag(result.responseXml, 'sessionID');
    if (code !== 'M1' || !sessionID) {
      throw new Error(`TourDiez login falhou: ${extractTag(result.responseXml, 'des_result') || result.responseXml}`);
    }
    this.session = { sessionID, expiresAt: Date.now() + SESSION_CACHE_TTL_MS };
    return sessionID;
  }

  async operationWithSession(operation, buildXml, params = {}) {
    if (!this.isConfigured()) return this.postOperation(operation, buildXml({ ...params, sessionID: 'mock-session' }));
    const sessionID = await this.ensureSession();
    let result = await this.postOperation(operation, buildXml({ ...params, sessionID }));
    if (extractTag(result.responseXml, 'cod_result') === 'M5') {
      const freshSessionID = await this.ensureSession(true);
      result = await this.postOperation(operation, buildXml({ ...params, sessionID: freshSessionID }));
    }
    return result;
  }

  async getAccomodationAvail(params) { return this.operationWithSession('getAccomodationAvail', p => this.availabilityXml(p), params); }
  async value(params) { return this.operationWithSession('value', p => this.valueXml(p), params); }
  async confirm(params) { return this.operationWithSession('confirm', p => this.confirmXml(p), params); }
  async cancel(params) { return this.operationWithSession('cancel', p => this.cancelXml(p), params); }
}

module.exports = { TourDiezClient, extractTag, toDDMMYYYY };
