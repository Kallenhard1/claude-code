# Claude Code Bridge (for Cursor)

Run **Claude Code inside Cursor on your Claude subscription (Pro/Max) credits — no API key required.** The extension owns a sidebar chat panel and drives the **official `claude` CLI** under the hood, so your subscription `/login` applies legitimately (the extension never touches your credentials).

> Implements all four phases of the architecture in [`docs/architecture.md`](docs/architecture.md) — see [Features](#features) and [`CHANGELOG.md`](CHANGELOG.md).

## Features

- **Streaming chat** — assistant text renders token-by-token, with tool-use cards, tool results, and a cost/token footer. Stop button cancels the run.
- **Multi-turn sessions** — conversations continue across messages via `claude --resume`; "New Chat" starts fresh.
- **Editor context** — a per-message toggle prepends the active file, selection, and diagnostics to your prompt.
- **IDE tool bridge** — exposes this IDE's `vscode.lm` extension tools to Claude Code through a local MCP server. Feature-detected; degrades to chat-only where the API is unavailable (some Cursor builds). Cursor's *proprietary* tools (Composer, indexing) are not part of `vscode.lm` and cannot be bridged.
- **Model picker** — pick Opus / Sonnet / Haiku from the status bar (`$(broadcast) Claude: …`) or the **Claude Code: Select Model** command; the choice drives both the panel and the Cursor endpoint.
- **Cursor-chat endpoint** *(opt-in)* — a loopback OpenAI-compatible server so you can drive the bridge from **Cursor's own chat** via custom `*-bridge` models. See [Use from Cursor's native chat](#use-from-cursors-native-chat).

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

> **Monorepo note:** if your workspace root is the parent `claude-code` repo (not this folder), use the **Run Claude Code Bridge Extension** launch config from the repo-root `.vscode/launch.json`. The local `.vscode/launch.json` here only applies when you open `cursor-claude-extension-bridge` as the workspace folder.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `claudeCodeBridge.cliPath` | `""` | Absolute path to the `claude` binary. Empty = resolve from `PATH`. |
| `claudeCodeBridge.cwd` | `""` | Working directory for the process. Empty = first workspace folder. |
| `claudeCodeBridge.model` | `"opus-4.8-bridge"` | Model for the panel and Cursor endpoint. Change via the status bar or **Select Model**. |
| `claudeCodeBridge.openaiEndpoint.enabled` | `true` | Run the loopback OpenAI-compatible endpoint for Cursor's native chat. |
| `claudeCodeBridge.openaiEndpoint.port` | `8788` | Port for the endpoint (bound to `127.0.0.1`). Base URL = `http://127.0.0.1:<port>/v1`. |
| `claudeCodeBridge.openaiEndpoint.apiKey` | `""` | Optional bearer token required on endpoint requests. Empty = accept any (safe on loopback). |
| `claudeCodeBridge.permissionMode` | `"default"` | `claude --permission-mode`. In non-interactive mode, tools needing approval are denied under `default`; use `acceptEdits`/`auto` to let Claude Code act. |
| `claudeCodeBridge.enableToolBridge` | `true` | Expose `vscode.lm` extension tools to Claude Code via the local MCP server. |
| `claudeCodeBridge.includeEditorContext` | `true` | Prepend active file / selection / diagnostics to prompts (also toggled per message). |
| `claudeCodeBridge.allowedTools` | `[]` | Extra `--allowedTools` patterns (e.g. `"Bash(git *)"`). Bridge MCP tools are allowed automatically. |

> **Permissions note:** because runs are non-interactive (`claude -p`), tools that need approval are denied under the `default` mode and show up as errors. Set `permissionMode` to `acceptEdits` (edits/writes) or `auto` if you want Claude Code to act on your files.

## Use from Cursor's native chat

By default the extension also runs a small **loopback-only OpenAI-compatible endpoint** so Cursor's own chat can talk to the bridge. Wire it up once:

1. Confirm the endpoint is live — the status bar shows `$(broadcast) Claude: <model>`. Run **Claude Code: Show Cursor Endpoint Info** to copy the base URL (default `http://127.0.0.1:8788/v1`).
2. In Cursor: **Settings → Models → Add model**, then enable **Override OpenAI Base URL** and paste the base URL above.
   - **No real OpenAI key is needed** — nothing here talks to OpenAI. Requests go to *your* loopback server (`127.0.0.1:8788`), which calls the `claude` CLI on your subscription. Cursor's form just refuses to save an empty key, so type any placeholder, e.g. `sk-local-bridge`. By default (`openaiEndpoint.apiKey` empty) the endpoint accepts any token. Only if you *set* `openaiEndpoint.apiKey` to a value of your own must the Cursor key field match it exactly.
3. Add these model names (must match exactly):
   - `opus-4.8-bridge`
   - `sonnet-4.5-bridge`
   - `haiku-4.5-bridge`
4. Pick a `*-bridge` model in Cursor's chat model dropdown and chat as usual — requests are routed through the `claude` CLI on your subscription.

The status bar reflects state at a glance: `$(broadcast)` = endpoint live, `$(warning)` = failed to bind (e.g. port in use — change `openaiEndpoint.port`), `$(circle-slash)` = disabled. Click it to switch model.

### Troubleshooting: `Model Not Found: Model name is not valid: "opus-4.8-bridge"`

This is a **Cursor-side** error — it means Cursor sent the model name to its *own* backend instead of to this bridge, so the request never reached the local endpoint. Run **Claude Code: Show Bridge Log** and repeat the request:

- **No `→ POST /v1/chat/completions` line appears** → Cursor isn't routing to the endpoint. Fix the Cursor setup: enable **Override OpenAI Base URL** with `http://127.0.0.1:8788/v1`, put any non-empty placeholder in the key field (no real OpenAI key needed — see step 2), add the `*-bridge` model name **exactly**, toggle it **on**, and disable Cursor's built-in models so it doesn't fall back to them. Some Cursor builds also refuse a pure-`localhost` base URL and verify it via their servers — if so, expose the port through a tunnel (e.g. `http://127.0.0.1:8788` → a loopback-reachable URL).
- **The line appears and shows `→ claude --model opus`** → routing works; the bridge maps `opus-4.8-bridge` to the real model. Any error after that is a CLI/auth issue (check the log for `✗ …`).

> **⚠️ Terms-of-Service caveat.** Routing Cursor's chat through a local OpenAI-compatible shim is the "wrap subscription auth as an endpoint" pattern that [`docs/architecture.md`](docs/architecture.md#L25) lists as an Anthropic **non-goal**. The endpoint is loopback-only and never reads your credentials (auth stays inside `claude`), but it is enabled here at explicit user request — understand the trade-off before relying on it. Set `claudeCodeBridge.openaiEndpoint.enabled` to `false` to turn it off.

## Package, install & publish

```bash
npm run typecheck && npm run build
npm run package         # produces cursor-claude-code-bridge-<version>.vsix
npm run install:cursor  # installs the .vsix into the current Cursor, then Reload Window
```

If the `cursor` CLI isn't on your PATH (common in WSL), install via the server
binary instead — `~/.cursor-server/bin/*/bin/cursor-server --install-extension
cursor-claude-code-bridge-<version>.vsix` — or via the Extensions view
(**⋯ → Install from VSIX…**).

> **F5 debug ≠ installed extension.** The launch config runs the *working-tree*
> source in an Extension Development Host; your normal Cursor windows run the
> *installed* `.vsix`. After changing code, re-run package + install (and reload)
> or the installed copy stays stale — the classic symptom is the endpoint
> working only while debugging.

Publishing to Open VSX (Cursor's registry) needs a personal access token in
`OVSX_PAT`, and — one time only — the namespace must exist:

```bash
npx ovsx create-namespace cursor-claude-bridge -p "$OVSX_PAT"  # first time only
OVSX_PAT=... npm run publish:ovsx                              # publishes the built .vsix
```

CI does the same automatically on `ext-v*` tags
([`publish-extension.yml`](../.github/workflows/publish-extension.yml)).

## License

MIT — see [`LICENSE`](LICENSE).
