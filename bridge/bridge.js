#!/usr/bin/env node
/**
 * Ponte stdio -> MCP Server remoto (SAP Integration Suite / MCP Gateway).
 *
 * O Claude Code CLI fala MCP por stdio; o MCP Gateway da SAP fala Streamable
 * HTTP e exige um Bearer token XSUAA que expira em ~1h. Esta ponte resolve as
 * duas coisas: traduz stdio <-> HTTP e busca/renova o token sozinha.
 *
 * Configuracao: bridge/.env (ver .env.example)
 */

const path = require('path');
const { loadEnv } = require('./env');

// ---------------------------------------------------------------- config ---

const env = { ...loadEnv(path.join(__dirname, '.env')), ...process.env };

const CFG = {
  clientId: env.SAP_CLIENT_ID,
  clientSecret: env.SAP_CLIENT_SECRET,
  tokenUrl: env.SAP_TOKEN_URL,
  mcpUrl: env.SAP_MCP_URL,
  timeoutMs: Number(env.SAP_TIMEOUT_MS || 60000),
};

for (const k of ['clientId', 'clientSecret', 'tokenUrl', 'mcpUrl']) {
  if (!CFG[k]) {
    process.stderr.write(`[bridge] faltando configuracao: ${k}\n`);
    process.exit(1);
  }
}

const log = (...a) => process.stderr.write('[bridge] ' + a.join(' ') + '\n');

const fetchComRetry = require('./net').criar(log);

// ----------------------------------------------------------------- token ---

let tokenCache = { value: null, expiresAt: 0 };

async function getToken(force = false) {
  const now = Date.now();
  if (!force && tokenCache.value && now < tokenCache.expiresAt) return tokenCache.value;

  const basic = Buffer.from(`${CFG.clientId}:${CFG.clientSecret}`).toString('base64');
  const res = await fetchComRetry(CFG.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const j = await res.json();
  // Renova 60s antes de expirar, para nao cair no meio de uma chamada.
  tokenCache = {
    value: j.access_token,
    expiresAt: now + Math.max(0, (j.expires_in || 3600) - 60) * 1000,
  };
  log(`token renovado, valido por ${j.expires_in}s`);
  return tokenCache.value;
}

// ------------------------------------------------------------- transporte ---

let sessionId = null;

/** Uma resposta pode vir como JSON puro ou como SSE (event: message / data: {...}). */
function parseBody(contentType, text) {
  if (!text) return null;
  if ((contentType || '').includes('text/event-stream')) {
    const msgs = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          try { msgs.push(JSON.parse(payload)); } catch { /* fragmento parcial */ }
        }
      }
    }
    return msgs.length === 1 ? msgs[0] : (msgs.length ? msgs : null);
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function postOnce(message, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
  try {
    const res = await fetchComRetry(CFG.mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: ctrl.signal,
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const text = await res.text();
    return { status: res.status, contentType: res.headers.get('content-type'), text };
  } finally {
    clearTimeout(timer);
  }
}

async function forward(message) {
  let token = await getToken();
  let res = await postOnce(message, token);

  // 401 = token expirado ou revogado; 404 = sessao caducou no gateway.
  if (res.status === 401) {
    token = await getToken(true);
    res = await postOnce(message, token);
  } else if (res.status === 404 && sessionId) {
    log('sessao expirou, reabrindo');
    sessionId = null;
    res = await postOnce(message, token);
  }
  return res;
}

// -------------------------------------------------------------- stdio I/O ---

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

function errorFor(message, code, msg) {
  return { jsonrpc: '2.0', id: message.id, error: { code, message: msg } };
}

async function handle(message) {
  const isRequest = message && message.id !== undefined && message.id !== null;
  try {
    const res = await forward(message);

    if (res.status === 202 || !res.text) {
      // Notificacao aceita sem corpo: nada a devolver.
      if (isRequest) send(errorFor(message, -32603, `HTTP ${res.status} sem corpo`));
      return;
    }
    if (res.status >= 400) {
      if (isRequest) send(errorFor(message, -32603, `HTTP ${res.status}: ${res.text.slice(0, 500)}`));
      else log(`HTTP ${res.status} em notificacao: ${res.text.slice(0, 200)}`);
      return;
    }

    const parsed = parseBody(res.contentType, res.text);
    if (parsed === null) {
      if (isRequest) send(errorFor(message, -32603, `resposta ilegivel: ${res.text.slice(0, 300)}`));
      return;
    }
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) send(m);
  } catch (e) {
    log('erro: ' + (e && e.message) + ' | cause: ' + JSON.stringify(e && e.cause && (e.cause.code || e.cause.message)));
    if (isRequest) send(errorFor(message, -32603, String(e && e.message)));
  }
}

// Serializa as mensagens: o gateway mantem estado de sessao, entao enviar em
// paralelo antes do initialize responder gera 400.
let chain = Promise.resolve();
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { log('linha invalida ignorada'); continue; }
    chain = chain.then(() => handle(msg));
  }
});

process.stdin.on('end', () => chain.then(() => process.exit(0)));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
