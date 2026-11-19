# Corevelos CLI

Use the Corevelos API from your shell. Requires Node.js 20.19 or later.

```sh
npm ci
npm test
npm link
corevelos --help
```

Set `COREVELOS_API_KEY` for CI, or use `corevelos auth login` for an interactive session.
The default API origin is `https://api.corevelos.com`. Set `COREVELOS_API_URL` to select another trusted origin.
The planned npm package is `@corevelos/cli`.

Use `corevelos mcp config --client claude`, `--client cursor`, or `--client vscode` to generate local MCP configuration.
The CLI bundles the published-source MCP bridge and includes a copy of the public SDK so it builds independently.

Apache-2.0. Community support is best effort. See [SECURITY.md](SECURITY.md) to report vulnerabilities privately.
