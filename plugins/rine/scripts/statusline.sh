#!/usr/bin/env bash
# statusline.sh — cheap local-file-only statusline for rine.
#
# Reads $RINE_DIR/state/poll-state.json and prints a one-line status.
# No network calls, no secrets.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
resolve_config_dir

STATE_FILE="$RINE_DIR/state/poll-state.json"

if [[ ! -f "$STATE_FILE" ]]; then
    echo "rine: ?"
    exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "rine: ?"
    exit 0
fi

COUNT="$(jq -r '.count // empty' "$STATE_FILE" 2>/dev/null || true)"

if [[ -z "$COUNT" || "$COUNT" == "null" ]]; then
    echo "rine: ?"
elif [[ "$COUNT" -eq 0 ]]; then
    echo "rine: clear"
elif [[ "$COUNT" -eq 1 ]]; then
    echo "📬 1 unread (rine)"
else
    echo "📬 $COUNT unread (rine)"
fi

exit 0
