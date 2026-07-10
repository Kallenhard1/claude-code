#!/bin/bash
# context_breakdown.sh
# ------------------------------------------------------------------
# Detailed context-window breakdown from `current_usage`, splitting
# fresh input, cache writes, and cache reads so you can see where the
# tokens actually go (and how well prompt caching is working).
#
#   [Opus] 62% ██████░░░░  fresh 8.5k · write 5.0k · read 2.0k · out 1.2k
#
# `used_percentage` counts input-side tokens only (fresh + cache
# write + cache read), matching Claude Code's own calculation.
#
# current_usage is null before the first API call and right after
# /compact until the next call — handled with a friendly fallback.
#
# Test:  echo '{"model":{"display_name":"Opus"},
#   "context_window":{"used_percentage":8,"context_window_size":200000,
#     "current_usage":{"input_tokens":8500,"output_tokens":1200,
#       "cache_creation_input_tokens":5000,"cache_read_input_tokens":2000}}}' \
#   | ./context_breakdown.sh
# ------------------------------------------------------------------
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')
PCT=$(echo "$input"   | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
HAS_USAGE=$(echo "$input" | jq -r 'if .context_window.current_usage == null then "no" else "yes" end')

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'
DIM='\033[2m'; RESET='\033[0m'

# --- Bar ---
if   [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else                         BAR_COLOR="$GREEN"; fi
FILLED=$((PCT / 10)); [ "$FILLED" -gt 10 ] && FILLED=10
EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

human() {
  local n=$1
  if   [ "$n" -ge 1000000 ]; then awk "BEGIN{printf \"%.1fM\", $n/1000000}"
  elif [ "$n" -ge 1000 ];    then awk "BEGIN{printf \"%.1fk\", $n/1000}"
  else echo "$n"; fi
}

if [ "$HAS_USAGE" = "no" ]; then
  printf '%b\n' "${CYAN}[${MODEL}]${RESET} ${BAR_COLOR}${BAR}${RESET} ${PCT}% ${DIM}(waiting for first API response…)${RESET}"
  exit 0
fi

FRESH=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')
WRITE=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
READ=$(echo "$input"  | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
OUT=$(echo "$input"   | jq -r '.context_window.current_usage.output_tokens // 0')

printf '%b\n' "${CYAN}[${MODEL}]${RESET} ${BAR_COLOR}${BAR}${RESET} ${PCT}%  ${DIM}fresh${RESET} $(human "$FRESH") ${DIM}·${RESET} ${DIM}write${RESET} $(human "$WRITE") ${DIM}·${RESET} ${DIM}read${RESET} $(human "$READ") ${DIM}·${RESET} ${DIM}out${RESET} $(human "$OUT")"
