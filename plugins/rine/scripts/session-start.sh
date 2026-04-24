#!/usr/bin/env bash
# session-start.sh — SessionStart hook for the rine CC plugin.
#
# Responsibilities:
#   1. Mode detection (Ready / Unregistered / MCP-only).
#   2. In Ready state: poll for unread count, write state file,
#      return additionalContext with count + toggle instructions.
#   3. In other states: emit a one-time nudge as additionalContext.
#
# Exit 0 always — never break CC.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
resolve_config_dir

STATE_DIR="$RINE_DIR/state"

READONLY=""
if mkdir -p "$STATE_DIR" 2>/dev/null \
   && touch "$STATE_DIR/.write-probe" 2>/dev/null; then
    rm -f "$STATE_DIR/.write-probe"
else
    READONLY="1"
fi

# ---- mode detection ----

HAS_CLI=""
command -v rine >/dev/null 2>&1 && HAS_CLI="1"

if [[ -n "$HAS_CLI" && -n "$RINE_HAS_CREDS" ]]; then
    MODE="ready"
elif [[ -n "$HAS_CLI" && -z "$RINE_HAS_CREDS" ]]; then
    MODE="unregistered"
else
    MODE="mcp-only"
fi

# ---- mode-specific behavior ----

case "$MODE" in
    ready)
        POLL_URL=""
        if command -v jq >/dev/null 2>&1; then
            POLL_URL="$(jq -r '.default.poll_url // .poll_url // empty' "$RINE_DIR/credentials.json" 2>/dev/null || true)"
        fi

        COUNT=0
        if [[ -n "$POLL_URL" ]]; then
            COUNT="$(curl -sf --max-time 5 "$POLL_URL" 2>/dev/null | jq -r '.count // 0' 2>/dev/null || echo 0)"
        fi
        COUNT="${COUNT//[!0-9]/}"
        COUNT="${COUNT:-0}"

        if [[ -z "$READONLY" ]]; then
            cat >"$STATE_DIR/poll-state.json" <<STATEOF
{"count":${COUNT},"updated_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
STATEOF
        fi

        PAUSE_FILE="$RINE_DIR/monitor-pause"
        if [[ -f "$PAUSE_FILE" ]]; then
            NOTIFY_NOTE="Notifications are paused. To resume: rm $PAUSE_FILE"
        else
            NOTIFY_NOTE="Notifications are active. To silence: touch $PAUSE_FILE"
        fi

        if [[ "$COUNT" -gt 0 ]]; then
            echo "{\"additionalContext\":\"You have $COUNT unread rine message(s). The user can type /rine-inbox to triage them, or you can mention it conversationally. $NOTIFY_NOTE\"}"
        else
            echo "{\"additionalContext\":\"Rine is connected. $NOTIFY_NOTE\"}"
        fi
        ;;

    unregistered)
        echo '{"additionalContext":"Rine CLI is installed but no identity is registered on this machine. You can invoke the rine-setup skill (or the user can type /rine-setup) to onboard — ask the user first, gather a handle and org name, then drive `rine onboard` via Bash."}'

        if [[ -z "$READONLY" ]]; then
            mkdir -p "$STATE_DIR"
            cat >"$STATE_DIR/poll-state.json" <<STATEOF
{"count":null,"updated_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","mode":"unregistered"}
STATEOF
        fi
        ;;

    mcp-only)
        echo '{"additionalContext":"Rine plugin is in MCP-only mode — tools work on demand, but notifications are disabled because the rine CLI is not installed. Suggest the user install it (`npm i -g @rine-network/cli`), then type /rine-setup to register."}'

        if [[ -z "$READONLY" ]]; then
            mkdir -p "$STATE_DIR"
            cat >"$STATE_DIR/poll-state.json" <<STATEOF
{"count":null,"updated_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","mode":"mcp-only"}
STATEOF
        fi
        ;;
esac

exit 0
