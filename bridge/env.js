/**
 * Leitor de .env sem dependencia externa.
 *
 * Precisa ser tolerante: o client secret do XSUAA costuma trazer `$`, `=` e
 * `!`, e o clientid traz `|` — por isso o valor nunca passa por um shell.
 */

const fs = require('fs');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

module.exports = { loadEnv };
