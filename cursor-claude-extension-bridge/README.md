# Claude Code Bridge (for Cursor)

Run **Claude Code inside Cursor on your Claude subscription (Pro/Max) credits — no API key required.** The extension owns a sidebar chat panel and drives the **official `claude` CLI** under the hood, so your subscription `/login` applies legitimately (the extension never touches your credentials).

> This is **Phase 1** of the architecture described in [`docs/architecture.md`](docs/architecture.md): a working prompt → response round-trip. Streaming, sessions, and the MCP tool bridge land in later phases.

## Why this shape

- **Subscription OAuth is restricted to Claude Code / claude.ai** by Anthropic's Consumer Terms — so this extension calls the real `claude` binary rather than the API-key-only Agent SDK. No token is read, stored, or transmitted by the extension.
- **Cursor's native chat has no extension API**, so the UI is an extension-owned webview panel.

## Prerequisites

1. Install **Claude Code** and make sure `claude` is on your `PATH` (or set `claudeCodeBridge.cliPath`).
2. Authenticate once: run `claude` in a terminal and `/login` with your Claude account. No `ANTHROPIC_API_KEY` needed.

## Develop

```bash
npm install
npm run build      # bundles to dist/extension.js  (npm run watch for incremental)
```

Then press **F5** in VS Code / Cursor to launch an Extension Development Host, open the **Claude Code** view in the Activity Bar, and send a prompt.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `claudeCodeBridge.cliPath` | `""` | Absolute path to the `claude` binary. Empty = resolve from `PATH`. |
| `claudeCodeBridge.cwd` | `""` | Working directory for the process. Empty = first workspace folder. |

## Package

```bash
npm run package    # produces a .vsix via @vscode/vsce (install it, or publish to Open VSX)
```

## Roadmap

- **Phase 2** — `--output-format stream-json`, incremental rendering, `--resume` sessions.
- **Phase 3** — MCP bridge exposing `vscode.lm` extension tools to Claude Code.
- **Phase 4** — active-file/selection context, packaging & Open VSX publish.

## License

MIT — see [`LICENSE`](LICENSE).
