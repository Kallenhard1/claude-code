# Memory layout for this repository

Supplements the root `CLAUDE.md`. Documents how persistent context is organized under `.claude/`.

## Instruction layers (you write)

| Layer | Location | When it loads |
| --- | --- | --- |
| Repo orientation | `CLAUDE.md` (root) | Every session |
| Extension work | `cursor-claude-extension-bridge/CLAUDE.md` | When Claude reads files under that directory |
| Path-scoped rules | `.claude/rules/*.md` | At launch (no `paths:`) or when matching files are read |
| Personal overrides | `CLAUDE.local.md` (gitignored) | Every session, if present |

## Auto memory (Claude writes)

Enabled in `.claude/settings.json`. Machine-local storage:

`~/.claude/projects/<this-repo>/memory/`

- `MEMORY.md` — index; first 200 lines (or 25KB) load each session
- Topic files (e.g. `debugging.md`) — read on demand

Use auto memory for learnings Claude discovers: debugging notes, workflow habits, preferences surfaced in chat. Keep `MEMORY.md` concise; move detail into topic files.

Use `CLAUDE.md` / rules instead when the whole team should see it from day one.

## Subagent memory

| Agent | Scope | Directory |
| --- | --- | --- |
| `code-reviewer` | `project` (committed) | `.claude/agent-memory/code-reviewer/` |

The subagent maintains its own `MEMORY.md` — recurring review patterns, codebase-specific findings. Distinct from main-session auto memory.

## Quick reference

- Run `/memory` in Claude Code to list loaded files, toggle auto memory, and open the memory folder.
- Promote stable auto-memory learnings into `CLAUDE.md` or `.claude/rules/` when they should be team policy.
- Do not put Anthropic credentials or personal secrets in any committed memory file.
