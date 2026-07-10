# Context usage status lines

Shell scripts that visualize Claude Code context-window usage in the status
line. Each reads the session JSON on stdin and prints a formatted line — see
the [status line docs](https://code.claude.com/docs/en/statusline).

| Script | Output | Use when |
| --- | --- | --- |
| `context_window_usage_script.sh` | `[Opus] ▓▓▓░░░░░░░ 30%` | Minimal single-line context bar |
| `context_statusline_full.sh` | 2 lines: dir + branch, then bar + tokens + cost + time | Full at-a-glance session monitor |
| `context_breakdown.sh` | `[Opus] ██████░░░░ 62%  fresh 8.5k · write 5.0k · read 2.0k · out 1.2k` | Inspecting cache efficiency / where tokens go |

All bars are color-coded by usage: **green** `<70%`, **yellow** `70–89%`, **red** `≥90%`.

## Requirements

- [`jq`](https://jqlang.github.io/jq/) (already installed here: `jq --version`)
- A terminal with ANSI color support

## Enable one

Make the script executable and point your settings at it:

```bash
chmod +x scripts/context_statusline_full.sh
```

Add to `~/.claude/settings.json` (user) or `.claude/settings.json` (project):

```json
{
  "statusLine": {
    "type": "command",
    "command": "/home/mariolucas/Dev/claude-code/scripts/context_statusline_full.sh",
    "padding": 1
  }
}
```

Swap `command` for whichever script you want. Settings reload automatically;
the change appears on your next interaction with Claude Code.

> The `refreshInterval` field (seconds) re-runs the command on a timer in
> addition to event updates — handy for the `⏱️` duration in the full script
> while the session is idle. Example: `"refreshInterval": 5`.

## Test without launching Claude Code

`test_statusline.sh` feeds mock session JSON (low / mid / high usage, a 1M
context window, and a fresh session with `current_usage: null`) into a script:

```bash
./scripts/test_statusline.sh scripts/context_statusline_full.sh   # one script
./scripts/test_statusline.sh                                       # all of them
```

## Notes on the data

- `used_percentage` is **input-side only** — fresh input + cache-creation +
  cache-read tokens. It excludes output tokens, matching Claude Code's own math.
- `context_window.current_usage` is `null` before the first API response and
  right after `/compact`; `context_breakdown.sh` shows a "waiting…" fallback.
- `context_window_size` is `200000` by default, `1000000` for extended-context
  models — the full script formats the denominator accordingly (`200.0k` / `1.0M`).
- Git branch in the full script is cached per session (5s TTL) under
  `/tmp/claude-statusline-git-<session_id>` so large repos don't lag the bar.
