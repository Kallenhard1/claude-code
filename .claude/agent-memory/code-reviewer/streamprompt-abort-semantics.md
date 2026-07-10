---
name: streamprompt-abort-semantics
description: claudeCli.ts streamPrompt RESOLVES (not rejects) done on AbortSignal — timeout/cancel error branches in callers are often dead code
metadata:
  type: project
---

`streamPrompt` in `src/claudeCli.ts` spawns the CLI with `spawn(..., { signal })`. On
abort, both its `child.on("error")` and `child.on("close")` handlers check
`options.signal?.aborted` and **`resolve({ sessionId })`** — they do NOT reject.

**Why:** aborting is treated as a clean user-initiated stop, so the returned `done`
promise resolves normally.

**How to apply:** any caller that wires an AbortController to a timeout and then does
`try { await handle.done } catch { /* timeout message */ }` has a **dead catch branch**
for the timeout path — the await resolves, and partial output is returned as if
successful (isError stays false). Correct pattern: after `await handle.done`, check
`controller.signal.aborted` explicitly and surface the timeout there. First seen in
`src/mcp/askClaudeServer.ts` `runAsk` (v0.3.0 reverse-MCP feature).
