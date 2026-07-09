# Changelog

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
