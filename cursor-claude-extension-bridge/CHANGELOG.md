# Changelog

## 0.3.0

- **`ask_claude_code` MCP tool — Cursor's native Agent can now delegate to
  Claude Code.** A new standalone stdio MCP server (`dist/ask-claude-server.js`)
  exposes one tool, `ask_claude_code(prompt, cwd?, model?)`, that spawns
  `claude -p` on your subscription and returns the answer. This is the *reverse*
  of the existing tool bridge (which exposes IDE tools *to* the CLI), and it
  uses a **Cursor-supported surface** (MCP), so it needs **no tunnel, no OpenAI
  model, and no exposed port** — unlike the OpenAI endpoint. Runs locally; no
  credential is embedded (auth stays inside the spawned `claude`).
  - New command **Claude Code: Copy Agent MCP Config** generates a ready-to-paste
    `mcpServers` block (correct absolute path + your current settings as env
    defaults) for Cursor's MCP config.
  - What Claude Code may *do* through the tool is bounded by
    `claudeCodeBridge.permissionMode`; `default` reads/answers only. Env knobs:
    `CLAUDE_BRIDGE_{CWD,MODEL,PERMISSION_MODE,CLI_PATH,ALLOWED_TOOLS,TIMEOUT_MS}`.
  - **`CLAUDE_BRIDGE_DEBUG=1`** logs each invocation to **stderr** (server
    ready / call / done + timing; metadata only, no prompt text or credential),
    which Cursor surfaces in its MCP logs — so you can confirm a response really
    came through the bridge and not from Cursor's own model. See the README's
    "Confirming a response really came from Claude Code".
  - **Opt-in** by nature (nothing runs until you paste the config in). Like the
    OpenAI endpoint, it makes the subscription drivable by another agent, but it
    stays local. See the README's "Use from Cursor's native Agent".
  - Build now emits a **third bundle**; `dist/ask-claude-server.js` is spawned as
    its own process and stays independently runnable.

## 0.2.2

- **Sidebar panel is the default experience.** The Cursor-native-chat
  endpoint (`openaiEndpoint.enabled`) now defaults to **false** — it no longer
  auto-runs. Everyday use is the **Claude Code sidebar panel**, which drives
  the `claude` CLI directly and needs no OpenAI model, no base-URL override,
  and no tunnel. Enable the endpoint only for the advanced native-chat path
  (which also requires a public tunnel, since Cursor's cloud refuses loopback
  URLs).
- **Status bar** no longer reads as an error when the endpoint is off — it
  shows a neutral `Claude: <model>` that opens the model picker for the panel.

## 0.2.1

- **Persistent bridge log**: endpoint log lines are now also written to a
  `bridge.log` file under the extension's log directory (survives window
  reloads), alongside the existing "Claude Code Bridge" output channel. New
  command: **Claude Code: Open Bridge Log File**.
- **Packaging fixes**: `npm run package` now uses `--no-dependencies` (the old
  `"vsce"` config block in `package.json` was ignored by `@vscode/vsce` and has
  been removed); `npm run publish:ovsx` publishes the built
  `cursor-claude-code-bridge-<version>.vsix` (requires `OVSX_PAT`); new
  `npm run install:cursor` installs the packaged `.vsix` into the current
  Cursor. README's "Package & publish" section rewritten to match.

## 0.2.0

- **Cursor-chat endpoint** *(opt-in, on by default)*: a loopback-only
  OpenAI-compatible server (`/v1/models`, `/v1/chat/completions`, streaming +
  non-streaming) that translates requests into `claude` CLI runs, so Cursor's
  **native chat** can drive the bridge. Register the `*-bridge` models as custom
  OpenAI models in Cursor pointed at `http://127.0.0.1:8788/v1`. Credential-free
  (auth stays inside `claude`). See the README's "Use from Cursor's native chat".
  - **Caveat:** this is the "wrap subscription auth as an endpoint" pattern that
    [`docs/architecture.md`](docs/architecture.md) lists as an Anthropic
    ToS non-goal; shipped opt-in at explicit user request and gated by
    `claudeCodeBridge.openaiEndpoint.enabled`.
- **Model picker**: choose Opus 4.8 / Sonnet 4.5 / Haiku 4.5 from the new status
  bar item or the **Claude Code: Select Model** command. The choice is passed to
  the CLI via `--model` and drives both the chat panel and the Cursor endpoint.
- **Status bar**: shows endpoint state at a glance — `$(broadcast)` live,
  `$(warning)` bind error, `$(circle-slash)` disabled — with the active model;
  click to switch.
- New commands: **Select Model**, **Show Cursor Endpoint Info** (copies the base
  URL), **Restart Cursor Endpoint**, **Show Bridge Log**.
- **Request log**: the "Claude Code Bridge" output channel records each incoming
  endpoint request and the resolved `--model`, so you can tell whether Cursor is
  actually reaching the bridge (vs. rejecting the model name on its own backend).
- New settings: `claudeCodeBridge.model`, `claudeCodeBridge.openaiEndpoint.enabled`,
  `claudeCodeBridge.openaiEndpoint.port` (default `8788`),
  `claudeCodeBridge.openaiEndpoint.apiKey`.
- Extension now activates on startup (`onStartupFinished`) so the endpoint is
  ready without opening the panel first.

## 0.1.1

- **CI**: automated Open VSX publish + GitHub Release on `ext-v*` tags via
  GitHub Actions (`.github/workflows/publish-extension.yml`).
- Build-tooling bump: `@vscode/vsce` 2 → 3, `esbuild` 0.21 → 0.28.

## 0.1.0

Initial implementation of the Cursor ⇄ Claude Code bridge (all four phases from
[`docs/architecture.md`](docs/architecture.md)).

- **Phase 1 — Skeleton & round-trip**: sidebar webview chat driving the official
  `claude` CLI on your Claude subscription (no API key). Actionable
  binary-missing / not-logged-in / non-zero-exit handling.
- **Phase 2 — Streaming, sessions**: `--output-format stream-json
  --include-partial-messages` with token-by-token rendering, tool-use cards,
  tool results, a cost/token footer, cancel button, and multi-turn continuity
  via `--resume`.
- **Phase 3 — MCP tool bridge**: a loopback endpoint in the extension host
  exposes the IDE's `vscode.lm` extension tools; a standalone MCP stdio server
  (`dist/mcp-bridge.js`), registered with the CLI via `--mcp-config`, proxies
  `tools/list` / `tools/call` to it. Feature-detected; degrades to chat-only
  when the Language Model Tools API is absent (e.g. some Cursor builds).
- **Phase 4 — Editor context & packaging**: per-message toggle to prepend the
  active file, selection, and diagnostics; `vsce` / `ovsx` packaging scripts;
  F5 launch config.
