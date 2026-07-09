#!/usr/bin/env bash
# PostToolUse hook — correctness gate for TypeScript edits.
#
# After Claude edits a .ts/.tsx file, run the owning package's `typecheck`
# script. On success it stays SILENT (exit 0, no output) so it costs zero
# context. On failure it prints the compiler errors to stderr and exits 2,
# which surfaces them to Claude so it self-corrects before moving on.
#
# Reads the PostToolUse event JSON on stdin; only `.tool_input.file_path` is
# used. Package is resolved by walking up to the nearest package.json that
# actually defines a `typecheck` script — so this no-ops for the leaked
# reference source at the repo root (which has no package.json / script).
set -euo pipefail

input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"

case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;   # not TypeScript — nothing to check
esac

[ -f "$file" ] || exit 0

# Walk up to the nearest package.json defining a "typecheck" script.
dir="$(dirname "$file")"
pkg=""
while [ "$dir" != "/" ]; do
  if [ -f "$dir/package.json" ] && jq -e '.scripts.typecheck' "$dir/package.json" >/dev/null 2>&1; then
    pkg="$dir"
    break
  fi
  dir="$(dirname "$dir")"
done
[ -n "$pkg" ] || exit 0   # no typecheck script owns this file — skip

# Run it. Silent on success; concise error surface (exit 2) on failure.
if ! out="$(cd "$pkg" && npm run --silent typecheck 2>&1)"; then
  {
    echo "typecheck failed in ${pkg} after editing ${file}:"
    # Cap the surfaced output so it doesn't flood context.
    printf '%s\n' "$out" | grep -E 'error TS|: error' | head -20
  } >&2
  exit 2
fi
exit 0
