---
paths:
  - "cursor-claude-extension-bridge/src/**/*.ts"
---

# Invariants for the extension source

These load only when you touch `cursor-claude-extension-bridge/src/**` — they don't sit in the always-on context.

- **Never read, store, log, or transmit an Anthropic credential.** Auth lives entirely inside the spawned `claude` CLI process. Real CLI binary only — never the Agent SDK, never a token-extracting proxy. This is a ToS hard constraint (`docs/architecture.md`).
- **The OpenAI-compatible endpoint stays loopback-only (`127.0.0.1`) and opt-in.** Never bind a non-loopback interface. It's a flagged ToS non-goal that exists at explicit user request.
- **Two independent bundles.** `esbuild.js` emits `dist/extension.js` (extension host, `vscode` external) and `dist/mcp-bridge.js` (a standalone stdio server the CLI spawns as its own process). Don't introduce imports that assume they share a runtime.
- **Model-id translation is deliberately lenient** (`models.ts` `resolveCliModel`): unknown `*-bridge` ids resolve to `undefined` so the CLI uses its default rather than a bad `--model` flag. Preserve that fallback.
- **Verify without a full Cursor host** via the driver: `node .claude/skills/run-cursor-claude-extension-bridge/driver.mjs` drives the real endpoint headless. The webview panel needs a real host (F5 or installed vsix).
- A `PostToolUse` hook runs `npm run typecheck` after each edit here; keep the tree type-clean.
