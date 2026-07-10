#!/bin/bash
# test_statusline.sh
# ------------------------------------------------------------------
# Exercise a status line script with a range of mock session inputs
# so you can eyeball its output without launching Claude Code.
#
# Usage:
#   ./test_statusline.sh scripts/context_statusline_full.sh
#   ./test_statusline.sh scripts/context_window_usage_script.sh
#   ./test_statusline.sh scripts/context_breakdown.sh
#
# With no argument it runs every *.sh status line in this directory.
# ------------------------------------------------------------------
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"

# Mock payloads: label -> JSON
mock() {  # $1 = pct, $2 = fresh, $3 = write, $4 = read, $5 = out, $6 = size
  cat <<EOF
{
  "model": {"id": "claude-opus-4-8", "display_name": "Opus"},
  "cwd": "$DIR",
  "workspace": {"current_dir": "$DIR", "project_dir": "$DIR"},
  "session_id": "test-session-abc",
  "cost": {"total_cost_usd": 0.1234, "total_duration_ms": 200000},
  "context_window": {
    "used_percentage": $1,
    "total_input_tokens": $(( ($2 + $3 + $4) )),
    "context_window_size": $6,
    "current_usage": {
      "input_tokens": $2,
      "cache_creation_input_tokens": $3,
      "cache_read_input_tokens": $4,
      "output_tokens": $5
    }
  }
}
EOF
}

# null current_usage (pre-first-response / post-compact)
mock_null() {
  cat <<EOF
{
  "model": {"display_name": "Opus"},
  "workspace": {"current_dir": "$DIR"},
  "session_id": "test-session-abc",
  "cost": {"total_cost_usd": 0, "total_duration_ms": 0},
  "context_window": {"used_percentage": 0, "total_input_tokens": 0,
    "context_window_size": 200000, "current_usage": null}
}
EOF
}

run_one() {
  local script="$1"
  echo "======================================================"
  echo "  $script"
  echo "======================================================"
  printf -- '-- low (12%%) ------------------------------------\n';   mock 12  8500  3000 500   1200 200000 | bash "$script"
  printf -- '-- mid (75%%) ------------------------------------\n';   mock 75  40000 20000 90000 3000 200000 | bash "$script"
  printf -- '-- high (94%%) -----------------------------------\n';   mock 94  50000 30000 108000 4000 200000 | bash "$script"
  printf -- '-- 1M window (30%%) ------------------------------\n';   mock 30  100000 80000 120000 5000 1000000 | bash "$script"
  printf -- '-- null usage (fresh session) -------------------\n';    mock_null | bash "$script"
  echo
}

if [ $# -ge 1 ]; then
  run_one "$1"
else
  for s in "$DIR"/context_*.sh; do
    run_one "$s"
  done
fi
