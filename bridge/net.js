/**
 * `fetch` com nova tentativa em erro de rede.
 *
 * O runtime da SAP derruba soquete de vez em quando (`UND_ERR_SOCKET`). Sem
 * retry isso vira "Failed to connect" no cliente MCP — inclusive no health check
 * do `claude mcp list`, que faz uma chamada só e conclui que a ponte está morta.
 *
 * Só erro de rede tem nova tentativa. Resposta HTTP volta como veio, mesmo 4xx e
 * 5xx: quem chamou é que sabe se aquele status é falha ou diagnóstico.
 */

function criar(log) {
  return async function fetchComRetry(url, opts, tentativas = 3) {
    let ultimo;
    for (let i = 1; i <= tentativas; i++) {
      try {
        return await fetch(url, opts);
      } catch (e) {
        ultimo = e;
        const causa = (e && e.cause && (e.cause.code || e.cause.message)) || e.message;
        if (i < tentativas) {
          if (log) log(`erro de rede (${causa}), tentativa ${i} de ${tentativas}`);
          await new Promise((r) => setTimeout(r, 400 * i));
        }
      }
    }
    throw ultimo;
  };
}

module.exports = { criar, fetchComRetry: criar(null) };
