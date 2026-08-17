function safeMessage(value, fallback = 'O fornecedor externo respondeu com erro.') {
  const text = String(value || fallback)
    .replace(/(apikey|api-key|authorization|token|secret)=?[^\s&,;]*/ig, '$1=[oculto]')
    .replace(/Bearer\s+[^\s]+/ig, 'Bearer [oculto]');
  return text.slice(0, 500);
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 12000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = { ...options, signal: controller.signal };
    delete init.timeoutMs;
    if (init.json !== undefined) {
      init.body = JSON.stringify(init.json);
      delete init.json;
      init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    }
    const response = await fetch(url, init);
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 2000) }; }
    }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.message || data?.fault?.faultstring || data?.raw;
      const error = new Error(safeMessage(detail, `Erro HTTP ${response.status} no fornecedor externo.`));
      error.status = response.status;
      error.providerPayload = data;
      throw error;
    }
    return { data, status: response.status, headers: response.headers };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('O fornecedor demorou demasiado tempo a responder.');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJson, safeMessage };
