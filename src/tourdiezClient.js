const https = require('https');
const http = require('http');
const { URLSearchParams } = require('url');

function esc(value = '') {
  return String(value).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
}

class TourDiezClient {
  constructor(env = process.env) {
    this.mode = env.TOURDIEZ_MODE || 'mock';
    this.baseUrl = env.TOURDIEZ_BASE_URL || '';
    this.user = env.TOURDIEZ_USER || '';
    this.password = env.TOURDIEZ_PASSWORD || '';
    this.agencyCode = env.TOURDIEZ_AGENCY_CODE || '';
  }

  isConfigured() {
    return this.mode === 'real' && this.baseUrl && this.user && this.password;
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
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    return new Promise((resolve, reject) => {
      const req = lib.request(options, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, operation, requestXml: xml, responseXml: body }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('Timeout TourDiez')); });
      req.write(payload);
      req.end();
    });
  }

  loginXml() {
    return `<login><user>${esc(this.user)}</user><password>${esc(this.password)}</password></login>`;
  }

  availabilityXml(params = {}) {
    return `<getAccomodationAvail>
  <sessionID>${esc(params.sessionID || 'mock-session')}</sessionID>
  <language>PT</language>
  <checkIn>${esc(params.checkin || '')}</checkIn>
  <nights>${esc(params.nights || 7)}</nights>
  <adults>${esc(params.adults || 2)}</adults>
  <children>${esc(params.children || 0)}</children>
  <destination>${esc(params.destination || '')}</destination>
  <country>${esc(params.country || '')}</country>
  <city>${esc(params.city || '')}</city>
  <board>${esc(params.board || '')}</board>
</getAccomodationAvail>`;
  }

  valueXml(params = {}) {
    return `<value><sessionID>${esc(params.sessionID || 'mock-session')}</sessionID><optionID>${esc(params.optionID || '')}</optionID><rateKey>${esc(params.rateKey || '')}</rateKey></value>`;
  }

  confirmXml(params = {}) {
    const pax = (params.passengers || []).map(p => `<passenger><name>${esc(p.name)}</name><surname>${esc(p.surname || '')}</surname><type>${esc(p.type || 'ADT')}</type></passenger>`).join('');
    return `<confirm><sessionID>${esc(params.sessionID || 'mock-session')}</sessionID><optionID>${esc(params.optionID || '')}</optionID><agencyReference>${esc(params.agencyReference || '')}</agencyReference><holder>${esc(params.holder || '')}</holder><passengers>${pax}</passengers></confirm>`;
  }

  cancelXml(params = {}) {
    return `<cancel><sessionID>${esc(params.sessionID || 'mock-session')}</sessionID><locator>${esc(params.locator || '')}</locator><simulation>${params.simulation === false ? 'false' : 'true'}</simulation></cancel>`;
  }

  async login() { return this.postOperation('login', this.loginXml()); }
  async getAccomodationAvail(params) { return this.postOperation('getAccomodationAvail', this.availabilityXml(params)); }
  async value(params) { return this.postOperation('value', this.valueXml(params)); }
  async confirm(params) { return this.postOperation('confirm', this.confirmXml(params)); }
  async cancel(params) { return this.postOperation('cancel', this.cancelXml(params)); }
}

module.exports = { TourDiezClient };
