---
name: run-cursor-claude-extension-bridge
description: Build, run, and drive the Cursor ⇄ Claude Code bridge extension. Use when asked to run, start, build, test, package, or smoke-test the extension, drive its OpenAI-compatible endpoint, or check the `*-bridge` model routing.
---

A VS Code / Cursor extension that runs Claude Code on the user's Claude
subscription by spawning the official `claude` CLI. Its headless-driveable
surface — and the one most PRs touch — is the loopback **OpenAI-compatible HTTP
endpoint** (`src/openaiBridgeServer.ts`): `/v1/models`, `/v1/chat/completions`.
Drive it with `.claude/skills/run-cursor-claude-extension-bridge/driver.mjs`,
which bundles the real server module with a stubbed `vscode`, points it at a
fake `claude` CLI, and exercises every route. The webview chat panel and MCP
tool bridge only run inside a real Cursor extension host (see Human path).

All paths below are relative to `cursor-claude-extension-bridge/`.

## Prerequisites

Node ≥ 18 (tested on v22.22.1) and npm. No system packages needed — the driver
runs headless with no browser, no xvfb. The `claude` CLI is **not** required for
the driver (it uses a fake CLI); it's only needed for the real end-to-end path.

## Setup

```bash
npm install   # installs esbuild, which the driver uses to bundle the server
```

## Build

```bash
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/extension.js + dist/mcp-bridge.js
```

`esbuild.js` emits **two** bundles: `dist/extension.js` (extension host, `vscode`
external) and `dist/mcp-bridge.js` (standalone MCP stdio server the CLI spawns).

## Run (agent path) — the driver

The driver is the way to verify the endpoint without a running Cursor. It bundles
the actual `openaiBridgeServer.ts`, aliases `vscode` → `vscode-stub.cjs`, wires in
`fake-claude.mjs` as the CLI, starts the server, and asserts routing, api-key
auth gating, the `opus-4.8-bridge → --model opus` translation, and the full
stream-json → OpenAI translation (streaming and non-streaming):

```bash
node .claude/skills/run-cursor-claude-extension-bridge/driver.mjs
```

Expected output (exit 0):

```
  ✓ server.start() → listening
  ✓ GET /health → 200 ok
  ✓ GET /v1/models lists the 3 bridge models
  ✓ POST with wrong api key → 401
  ✓ POST (non-stream) → assistant text assembled
  ✓ POST (non-stream) → usage tokens surfaced
  ✓ opus-4.8-bridge translated to `--model opus` for the CLI
  ✓ POST (stream) → SSE assembles same text
  ✓ POST (stream) → terminates with [DONE]

PASS — 9 passed, 0 failed
```

To poke the live server yourself, leave it running with `KEEPALIVE=1` and `curl`
it (the driver runs its checks first, then idles). Note: when `apiKey` is set
(the driver sets `test-secret-key`) the server gates **every** route, so the
bearer token is required even on `/health` and `/v1/models`:

```bash
KEEPALIVE=1 PORT=8801 node .claude/skills/run-cursor-claude-extension-bridge/driver.mjs &
# wait for listen, then:
curl -s -H "authorization: Bearer test-secret-key" http://127.0.0.1:8801/health
# {"status":"ok","service":"claude-code-bridge"}
curl -s -H "authorization: Bearer test-secret-key" http://127.0.0.1:8801/v1/models
# → data[].id = opus-4.8-bridge, sonnet-4.5-bridge, haiku-4.5-bridge
kill %1   # stop it
```

`PORT` defaults to 8799 (kept off 8788 so it won't clash with a real Cursor
endpoint). The three helper files live in the skill dir: `driver.mjs`,
`vscode-stub.cjs` (minimal `vscode` API surface), `fake-claude.mjs` (emits
canned stream-json).

## Package & install into Cursor (real deploy)

```bash
npm run package         # vsce package --no-dependencies → cursor-claude-code-bridge-<version>.vsix
npm run install:cursor  # cursor --install-extension <that vsix>  — then RELOAD the Cursor window
```

## Run (human path) — inside Cursor

The webview chat panel and the MCP tool bridge need a real extension host and
can't be driven headless. Two ways to load it:

- **F5** — repo-root `.vscode/launch.json` ("Run Claude Code Bridge Extension")
  builds and opens an Extension Development Host on the working-tree source.
- **Installed vsix** — `npm run package && npm run install:cursor`, then reload.

Once loaded, the real endpoint listens on `127.0.0.1:8788`; verify with
`curl -s http://127.0.0.1:8788/v1/models` (no auth header unless you set
`claudeCodeBridge.openaiEndpoint.apiKey`). Real chat requires `claude` on PATH
and a logged-in subscription (`claude` → `/login`).

## Gotchas

- **F5 debug ≠ the installed extension.** They are independent copies: F5 runs
  working-tree source, normal Cursor windows run the installed `.vsix`. After a
  code change you must re-package + re-install + reload, or the installed copy
  stays stale. Classic symptom: Cursor chat shows `Model name is not valid:
  "opus-4.8-bridge"` because the stale installed build predates the endpoint.
- **WSL install location:** on this machine Cursor is a WSL remote, so installs
  land in `~/.cursor-server/extensions/` (not `~/.cursor/`). The `cursor` CLI on
  PATH is the remote CLI and `--install-extension` works. Reload still required.
- **api-key gates all routes, not just chat.** The auth check runs before route
  dispatch in `handle()`, so a set `apiKey` makes `/health` and `/v1/models`
  return 401 without the bearer token. The driver sends it on every request.
- **`vscode` is external in the real bundle** (`esbuild.js`), so the server
  module can't be `require`d directly outside a host — that's exactly why the
  driver re-bundles it with `vscode-stub.cjs` aliased in.
- **Model translation is deliberately lenient:** unknown ids ending in `-bridge`
  resolve to `undefined` (CLI uses its default) rather than a bad `--model` flag;
  see `resolveCliModel` in `src/models.ts`.

## Troubleshooting

- **Driver: `Cannot find package 'esbuild'`** — run `npm install` in the unit
  dir first; the driver imports the project's local esbuild.
- **Driver: `EADDRINUSE`** — port already taken (a real Cursor endpoint on 8788,
  or a leftover KEEPALIVE run). Pass a different `PORT=...`.
- **KEEPALIVE server not answering curl** — it runs its assertions first (~1s)
  before idling; wait for the `KEEPALIVE — endpoint left running` line, and
  remember the bearer-token requirement above.
