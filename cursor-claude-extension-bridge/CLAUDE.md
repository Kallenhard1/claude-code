# CLAUDE.md — cursor-claude-extension-bridge

Guidance for the actively developed extension. Loads when working under `cursor-claude-extension-bridge/`. Repo-wide orientation lives in the root `CLAUDE.md`.

## Commands

All run from `cursor-claude-extension-bridge/`:

```bash
npm run typecheck       # tsc --noEmit
npm run build           # esbuild → dist/extension.js + dist/mcp-bridge.js
npm run watch           # esbuild --watch
npm run package         # vsce package --no-dependencies → cursor-claude-code-bridge-<version>.vsix
npm run install:cursor  # install the .vsix into the current Cursor (WSL) — reload window after
npm run publish:ovsx    # publish the built .vsix to Open VSX (needs OVSX_PAT env var)
```

There are no tests. Verification is: typecheck + build, then either F5 (repo-root `.vscode/launch.json` launches an Extension Development Host) or package + install + reload, then exercise the **sidebar chat panel** (the default, override-free surface). The OpenAI endpoint is **opt-in** (`openaiEndpoint.enabled`, default false as of 0.2.2); only when it's enabled does `curl http://127.0.0.1:8788/v1/models` respond. To drive the endpoint headless without a Cursor host, use the run skill's driver (`node .claude/skills/run-cursor-claude-extension-bridge/driver.mjs`).

### Dev-environment gotcha (WSL + Cursor)

This machine runs Cursor attached to WSL. Installed extensions live in `~/.cursor-server/extensions/` (not `~/.cursor/`). **F5 debug runs the working-tree source; normal Cursor windows run the installed `.vsix` — they are independent copies.** After changing code, re-run package + `install:cursor` + reload window, or the installed copy stays stale (classic symptom: Cursor chat says `Model name is not valid: "opus-4.8-bridge"` because the old installed version has no endpoint).

### Release flow

1. Bump `version` in `cursor-claude-extension-bridge/package.json` and add a `CHANGELOG.md` entry.
2. Commit, then `git tag ext-v<version>` (tag must exactly match package.json version — CI verifies) and push the tag.
3. `.github/workflows/publish-extension.yml` typechecks, packages, publishes to Open VSX (`--skip-duplicate`, so a prior manual publish doesn't fail the job), and creates a GitHub Release with the `.vsix`.

## Extension architecture

Everything funnels into spawning the official `claude` CLI (`claudeCli.ts`): `claude -p --output-format stream-json --include-partial-messages`, parsed into normalized `StreamEvent`s, with multi-turn continuity via `--resume`. **The extension must never read, store, or transmit Anthropic credentials** — auth (subscription `/login`) lives entirely inside the spawned `claude` process. This is a hard constraint from the ToS analysis in `docs/architecture.md`, which also dictates: real CLI binary only (never the Agent SDK, never token extraction).

Two front ends drive the CLI:

- **Sidebar chat panel** (`chatViewProvider.ts` + `media/`): webview UI, streams tokens/tool cards, optional editor context prepended per message (`editorContext.ts`).
- **OpenAI-compatible endpoint** (`openaiBridgeServer.ts`): loopback-only HTTP server on `127.0.0.1:8788` (`/v1/models`, `/v1/chat/completions`) so Cursor's *native* chat can use the bridge — users register the `*-bridge` model ids as custom OpenAI models. `models.ts` maps `opus-4.8-bridge`/`sonnet-4.5-bridge`/`haiku-4.5-bridge` → `claude --model opus|sonnet|haiku`. Note: `docs/architecture.md` lists this endpoint pattern as a ToS non-goal; it exists at the user's explicit request and must stay **opt-in and loopback-only**.

The **MCP tool bridge** has two halves because the CLI can't call VS Code APIs: `mcp/toolBridgeServer.ts` runs a token-protected loopback HTTP endpoint inside the extension host exposing `vscode.lm` tools (feature-detected; absent in some Cursor builds), and `mcp/mcpBridge.ts` is a standalone stdio MCP server the CLI launches via a generated `--mcp-config`, proxying `tools/list`/`tools/call` to that endpoint.

The **reverse MCP server** (`mcp/askClaudeServer.ts`) points the other way: it's a standalone stdio MCP server that an *MCP client* (Cursor's native Agent) launches, exposing one tool — `ask_claude_code(prompt, cwd?, model?)` — that spawns `claude -p` (reusing `streamPrompt` from `claudeCli.ts`, which is `vscode`-free) and returns the answer. Defaults come from `CLAUDE_BRIDGE_*` env vars. `extension.ts`'s **Copy Agent MCP Config** command generates the `mcpServers` block (launched via `process.execPath` + `ELECTRON_RUN_AS_NODE`, mirroring the tool bridge). It's opt-in by nature (nothing runs until the user pastes the config into Cursor) and local — but like the OpenAI endpoint it makes the subscription drivable by another agent, so keep it credential-free and documented.

This is why `esbuild.js` produces **three separate bundles** — `dist/mcp-bridge.js` and `dist/ask-claude-server.js` must each remain independently runnable (each is spawned as its own process).

`extension.ts` wires it all: activation on `onStartupFinished` (so the endpoint is up without opening the panel), status bar (endpoint state + model picker), commands, and `logger.ts` (tees the "Claude Code Bridge" output channel to a persistent `bridge.log` under `context.logUri`).
