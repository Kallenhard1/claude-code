# Changelog

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
