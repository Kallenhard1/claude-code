#!/bin/bash
# context_statusline_full.sh
# ------------------------------------------------------------------
# Two-line status line for at-a-glance session monitoring.
#
#   line 1:  [Model] 📁 dir | 🌿 branch
#   line 2:  ████░░░░░░ 42% (84.0k/200k) | 💰 $0.12 | ⏱️ 3m 20s
#
# Context bar is color-coded: green <70%, yellow 70-89%, red >=90%.
# Git lookup is cached per-session (5s TTL) so large repos stay snappy.
#
# Test:  ./scripts/test_statusline.sh scripts/context_statusline_full.sh
# ------------------------------------------------------------------
input=$(cat)

# --- Extract fields ---
MODEL=$(echo "$input"     | jq -r '.model.display_name // "Claude"')
DIR=$(echo "$input"       | jq -r '.workspace.current_dir // .cwd // "."')
SESSION_ID=$(echo "$input"| jq -r '.session_id // "nosession"')
COST=$(echo "$input"      | jq -r '.cost.total_cost_usd // 0')
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
PCT=$(echo "$input"       | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
USED=$(echo "$input"      | jq -r '(.context_window.total_input_tokens // 0)')
SIZE=$(echo "$input"      | jq -r '.context_window.context_window_size // 200000')

# --- Colors ---
CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'
DIM='\033[2m'; RESET='\033[0m'

# --- Context bar color ---
if   [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else                         BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); [ "$FILLED" -gt 10 ] && FILLED=10
EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

# --- Human-readable token counts (e.g. 84.0k) ---
human() {  # $1 = token count
  local n=$1
  if [ "$n" -ge 1000000 ]; then
    awk "BEGIN{printf \"%.1fM\", $n/1000000}"
  elif [ "$n" -ge 1000 ]; then
    awk "BEGIN{printf \"%.1fk\", $n/1000}"
  else
    echo "$n"
  fi
}
USED_H=$(human "$USED")
SIZE_H=$(human "$SIZE")

# --- Cost + duration ---
COST_FMT=$(printf '$%.2f' "$COST")
MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

# --- Git branch, cached per session (5s TTL) ---
CACHE_FILE="/tmp/claude-statusline-git-${SESSION_ID}"
CACHE_MAX_AGE=5
cache_is_stale() {
  [ ! -f "$CACHE_FILE" ] && return 0
  local now mtime
  now=$(date +%s)
  mtime=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0)
  [ $(( now - mtime )) -gt "$CACHE_MAX_AGE" ]
}
if cache_is_stale; then
  if git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$DIR" branch --show-current 2>/dev/null > "$CACHE_FILE"
  else
    : > "$CACHE_FILE"
  fi
fi
BRANCH=$(cat "$CACHE_FILE" 2>/dev/null)
GIT_SEG=""
[ -n "$BRANCH" ] && GIT_SEG=" ${DIM}|${RESET} 🌿 ${BRANCH}"

# --- Emit two lines ---
printf '%b\n' "${CYAN}[${MODEL}]${RESET} 📁 ${DIR##*/}${GIT_SEG}"
printf '%b\n' "${BAR_COLOR}${BAR}${RESET} ${PCT}% ${DIM}(${USED_H}/${SIZE_H})${RESET} ${DIM}|${RESET} 💰 ${COST_FMT} ${DIM}|${RESET} ⏱️ ${MINS}m ${SECS}s"
