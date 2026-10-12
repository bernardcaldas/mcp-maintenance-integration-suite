#!/usr/bin/env node
/**
 * Registra a ponte no claude_desktop_config.json sem tocar nas outras entradas.
 *
 *   node claude-desktop-install.js            # so mostra o que faria
 *   node claude-desktop-install.js --apply    # grava (faz backup antes)
 *   node claude-desktop-install.js --apply --name outro-nome
 *
 * A ponte pode morar em qualquer diretorio: o caminho gravado e o desta copia
 * do arquivo, entao basta rodar o script de dentro da pasta que voce quer usar.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const nameIdx = args.indexOf('--name');
const NAME = nameIdx >= 0 ? args[nameIdx + 1] : 'sap-manutencao';

const CONFIG =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

const bridge = path.join(__dirname, 'bridge.js');
if (!fs.existsSync(bridge)) { console.error(`bridge.js nao encontrado em ${__dirname}`); process.exit(1); }
if (!fs.existsSync(path.join(__dirname, '.env'))) {
  console.error(`aviso: nao ha .env em ${__dirname} — a ponte nao vai subir sem ele`);
}

// O Claude Desktop no Windows nao herda o PATH de shell interativo em todos os
// casos; usar o caminho absoluto do node evita "command not found" silencioso.
const nodeBin = process.execPath;
const entry = { command: nodeBin, args: [bridge] };

if (!fs.existsSync(CONFIG)) {
  console.error(`config nao encontrado: ${CONFIG}\nAbra o Claude Desktop uma vez para ele criar o arquivo.`);
  process.exit(1);
}

const raw = fs.readFileSync(CONFIG, 'utf8');
let cfg;
try { cfg = JSON.parse(raw); } catch (e) {
  console.error(`o config atual nao e JSON valido (${e.message}) — corrija antes de rodar isto`);
  process.exit(1);
}
cfg.mcpServers = cfg.mcpServers || {};

const before = cfg.mcpServers[NAME];
const same = before && before.command === entry.command &&
  JSON.stringify(before.args) === JSON.stringify(entry.args);

console.log(`config:   ${CONFIG}`);
console.log(`entrada:  ${NAME}`);
console.log(`command:  ${entry.command}`);
console.log(`args:     ${JSON.stringify(entry.args)}`);
console.log(`vizinhos: ${Object.keys(cfg.mcpServers).filter((k) => k !== NAME).join(', ') || '(nenhum)'}`);

if (same) { console.log('\nJa esta registrado exatamente assim. Nada a fazer.'); process.exit(0); }
if (before) console.log(`\nsubstitui a entrada existente: ${before.command} ${JSON.stringify(before.args)}`);

if (!apply) { console.log('\n(simulacao) rode de novo com --apply para gravar.'); process.exit(0); }

const backup = `${CONFIG}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.writeFileSync(backup, raw);
cfg.mcpServers[NAME] = entry;
fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
console.log(`\nbackup:  ${backup}`);
console.log('gravado. Reinicie o Claude Desktop (feche pela bandeja, nao so a janela).');
