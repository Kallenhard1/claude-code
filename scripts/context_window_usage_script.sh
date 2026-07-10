#!/bin/bash
# context_window_usage_script.sh
# ------------------------------------------------------------------
# Single-line status line: model name + color-coded context bar.
#
# Reads Claude Code's session JSON on stdin and prints a 10-char
# progress bar whose color reflects how full the context window is:
#   green  < 70%   |   yellow 70-89%   |   red >= 90%
#
# Test:  echo '{"model":{"display_name":"Opus"},
#               "context_window":{"used_percentage":42}}' \
#          | ./context_window_usage_script.sh
# ------------------------------------------------------------------
input=$(cat)

# --- Extract fields (// 0 guards against null before first API call) ---
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# --- Colors ---
GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; RESET='\033[0m'

# --- Pick bar color from usage thresholds ---
if   [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else                         BAR_COLOR="$GREEN"; fi

# --- Build the bar: FILLED blocks (▓) + EMPTY blocks (░) ---
BAR_WIDTH=10
FILLED=$((PCT * BAR_WIDTH / 100))
[ "$FILLED" -gt "$BAR_WIDTH" ] && FILLED=$BAR_WIDTH
EMPTY=$((BAR_WIDTH - FILLED))

BAR=""
[ "$FILLED" -gt 0 ] && printf -v FILL "%${FILLED}s" && BAR="${FILL// /▓}"
[ "$EMPTY"  -gt 0 ] && printf -v PAD  "%${EMPTY}s"  && BAR="${BAR}${PAD// /░}"

printf '%b\n' "${DIM}[${MODEL}]${RESET} ${BAR_COLOR}${BAR}${RESET} ${PCT}%"
