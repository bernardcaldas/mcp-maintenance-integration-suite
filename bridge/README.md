# stdio bridge

A thin stdio to Streamable HTTP bridge (about 200 lines of Node.js, no dependencies). It does two
things: translate the stdio JSON-RPC that Claude Desktop speaks into Streamable HTTP, and fetch and
renew the XSUAA token, which expires in about an hour.

Why a bridge: Claude Desktop's custom connector uses an authorization-code flow, while this server is a
machine-to-machine read path with no named user at the other end. In v1 the bridge wrapped a server I
operated; in v2 it is a transport shim in front of a server SAP operates.

| File | Purpose |
|---|---|
| `bridge.js` | the bridge, with automatic token renewal |
| `net.js` | `fetch` with retry; the runtime occasionally drops sockets |
| `env.js` | `.env` reader that tolerates `$`, `!`, `=` and `\|` in values |
| `claude-desktop-install.js` | registers the bridge in `claude_desktop_config.json` |
| `.env.example` | the four values the bridge needs |

## Use

```bash
cp .env.example .env       # fill in the service key values and the MCP Server URL
node claude-desktop-install.js            # dry run: shows what it would write
node claude-desktop-install.js --apply    # writes the config, with a dated backup
```

Then quit Claude Desktop from the tray and start it again. The installer only touches the
`sap-manutencao` entry, uses the absolute path of `node.exe`, and resolves everything from the script
directory, so it works from any folder. The `.env` is read from next to `bridge.js`, because Claude
Desktop starts the process with a working directory outside the project.

The `.env` holds credentials and is excluded by `.gitignore`.
