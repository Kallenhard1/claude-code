# Claude Code Bridge (for Cursor)

Run **Claude Code inside Cursor on your Claude subscription (Pro/Max) credits — no API key required.** The extension owns a sidebar chat panel and drives the **official `claude` CLI** under the hood, so your subscription `/login` applies legitimately (the extension never touches your credentials).

> Implements all four phases of the architecture in [`docs/architecture.md`](docs/architecture.md) — see [Features](#features) and [`CHANGELOG.md`](CHANGELOG.md).

## Features

- **Streaming chat** — assistant text renders token-by-token, with tool-use cards, tool results, and a cost/token footer. Stop button cancels the run.
- **Multi-turn sessions** — conversations continue across messages via `claude --resume`; "New Chat" starts fresh.
- **Editor context** — a per-message toggle prepends the active file, selection, and diagnostics to your prompt.
- **IDE tool bridge** — exposes this IDE's `vscode.lm` extension tools to Claude Code through a local MCP server. Feature-detected; degrades to chat-only where the API is unavailable (some Cursor builds). Cursor's *proprietary* tools (Composer, indexing) are not part of `vscode.lm` and cannot be bridged.

## Why this shape

- **Subscription OAuth is restricted to Claude Code / claude.ai** by Anthropic's Consumer Terms — so this extension calls the real `claude` binary rather than the API-key-only Agent SDK. No token is read, stored, or transmitted by the extension.
- **Cursor's native chat has no extension API**, so the UI is an extension-owned webview panel.
- **The CLI can't call VS Code APIs**, so the tool bridge runs a loopback endpoint in the extension host that a CLI-launched MCP stdio server (`dist/mcp-bridge.js`, registered via `--mcp-config`) proxies to.

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
| `claudeCodeBridge.permissionMode` | `"default"` | `claude --permission-mode`. In non-interactive mode, tools needing approval are denied under `default`; use `acceptEdits`/`auto` to let Claude Code act. |
| `claudeCodeBridge.enableToolBridge` | `true` | Expose `vscode.lm` extension tools to Claude Code via the local MCP server. |
| `claudeCodeBridge.includeEditorContext` | `true` | Prepend active file / selection / diagnostics to prompts (also toggled per message). |
| `claudeCodeBridge.allowedTools` | `[]` | Extra `--allowedTools` patterns (e.g. `"Bash(git *)"`). Bridge MCP tools are allowed automatically. |

> **Permissions note:** because runs are non-interactive (`claude -p`), tools that need approval are denied under the `default` mode and show up as errors. Set `permissionMode` to `acceptEdits` (edits/writes) or `auto` if you want Claude Code to act on your files.

## Package & publish

```bash
npm run package       # produces a .vsix via @vscode/vsce
npm run publish:ovsx  # publish to Open VSX (Cursor's registry); needs OVSX_PAT
```

Install the `.vsix` in Cursor via the Extensions view (**⋯ → Install from VSIX…**).

## License

MIT — see [`LICENSE`](LICENSE).
