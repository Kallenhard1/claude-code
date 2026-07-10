# code-reviewer memory

Seed patterns for the Cursor ⇄ Claude Code bridge. The subagent updates this file as it learns.

## Invariants — re-check every review

- No Anthropic credential is read, stored, logged, or transmitted; auth stays inside the spawned `claude` CLI.
- OpenAI-compatible endpoint: `127.0.0.1` only, opt-in (`openaiEndpoint.enabled`).
- Three independent esbuild bundles: `dist/extension.js`, `dist/mcp-bridge.js` (IDE tools → CLI), and `dist/ask-claude-server.js` (`ask_claude_code` tool → CLI) — the two stdio bundles stay `vscode`-free; reusing pure-`node:` modules across bundles is fine, but no shared-runtime imports.
- `models.ts`: unknown `*-bridge` ids resolve to `undefined` so the CLI uses its default model.

## Layout

- Active extension code: `cursor-claude-extension-bridge/src/`
- Leaked CLI reference: repo-root `src/` — read-only, never edit

## Dev environment (WSL + Cursor)

- Installed extensions live in `~/.cursor-server/extensions/`, not `~/.cursor/`.
- F5 debug runs working-tree source; normal Cursor windows run the installed `.vsix` — repackage + `install:cursor` + reload after changes.

## Verification

- No automated tests; verify with `npm run typecheck` + `npm run build`.
- Headless endpoint smoke: `node .claude/skills/run-cursor-claude-extension-bridge/driver.mjs`.

## Learnings

- [streamPrompt abort semantics](streamprompt-abort-semantics.md) — `done` RESOLVES (not rejects) on abort; timeout catch-branches in callers are dead code.
