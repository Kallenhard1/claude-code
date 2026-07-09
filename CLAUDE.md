# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Two unrelated things live here — don't confuse them:

1. **Root `src/`, `assets/`, root `README.md`** — a mirror of the leaked Claude Code CLI source (proprietary Anthropic code recovered from an npm sourcemap; see root README). It is **reference material only**: it has no build tooling here, is not part of any workflow in this repo, and should not be modified. It's occasionally useful to consult when working on the extension (e.g. CLI flags, stream-json event shapes).
2. **`cursor-claude-extension-bridge/`** — the actively developed project: a VS Code/Cursor extension that runs Claude Code inside Cursor on the user's Claude subscription (no API key) by spawning the official `claude` CLI. All development work happens here.

Also: `scripts/` holds standalone status-line shell scripts for Claude Code (read session JSON on stdin, need `jq`; see `scripts/README.md`), and `docs/cursor-claude-code-extension-architecture.md` is the original architecture plan for the extension (a copy ships inside the extension as `cursor-claude-extension-bridge/docs/architecture.md`).

## Working on the extension

Commands, the WSL+Cursor dev gotcha, the release flow, and the architecture overview live in **`cursor-claude-extension-bridge/CLAUDE.md`**, which loads automatically when you work under that directory.

**Hard safety constraint (applies everywhere):** the extension must never read, store, or transmit Anthropic credentials — auth lives entirely inside the spawned `claude` CLI process. Real CLI binary only: never the Agent SDK, never token extraction. See `cursor-claude-extension-bridge/CLAUDE.md` and `docs/architecture.md` for the full ToS rationale.
