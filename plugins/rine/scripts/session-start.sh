#!/usr/bin/env bash
# session-start.sh — SessionStart hook for the rine CC plugin.
#
# Responsibilities:
#   1. Mode detection (Ready / Unregistered / MCP-only / Fresh).
#   2. In Ready state: poll for unread count, write state file,
#      return additionalContext if count > 0.
#   3. In Ready state: register this session and spawn the daemon.
#   4. In other states: emit a one-time nudge as additionalContext.
#
# Exit 0 always — never break CC.

set -euo pipefail

[[ -n "${RINE_AUTO_DISABLED:-}" ]] && exit 0

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
source "$PLUGIN_ROOT/scripts/lib/find-cc-pid.sh"
resolve_config_dir

STATE_DIR="$RINE_DIR/state"
LOGS_DIR="$STATE_DIR/logs"
SESSIONS_DIR="$STATE_DIR/sessions"
mkdir -p "$STATE_DIR" "$LOGS_DIR" "$SESSIONS_DIR"

_log() { echo "[session-start $(date -Is)] $*" >>"$LOGS_DIR/session-start.log"; }

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

_log "mode=$MODE rine_dir=$RINE_DIR has_cli=$HAS_CLI has_creds=$RINE_HAS_CREDS"

# ---- mode-specific behavior ----

case "$MODE" in
    ready)
        # Poll for unread count.
        POLL_URL=""
        if command -v jq >/dev/null 2>&1; then
            POLL_URL="$(jq -r '.default.poll_url // .poll_url // empty' "$RINE_DIR/credentials.json" 2>/dev/null || true)"
        fi

        COUNT=0
        if [[ -n "$POLL_URL" ]]; then
            COUNT="$(curl -sf --max-time 5 "$POLL_URL" 2>/dev/null | jq -r '.count // 0' 2>/dev/null || echo 0)"
        fi

        # Write state file for statusline.
        cat >"$STATE_DIR/poll-state.json" <<STATEOF
{"count":${COUNT},"updated_at":"$(date -Is)"}
STATEOF

        # Return additionalContext — mention /rine-notify when not opted in.
        if [[ "$COUNT" -gt 0 ]]; then
            if [[ -n "${RINE_NOTIFY:-}" ]]; then
                echo "{\"additionalContext\":\"You have $COUNT unread rine message(s). The user can type /rine-inbox to triage them, or you can mention it conversationally.\"}"
            else
                echo "{\"additionalContext\":\"You have $COUNT unread rine message(s). Type /rine-inbox to triage. Real-time notifications are off — type /rine-notify to enable for this project.\"}"
            fi
        elif [[ -z "${RINE_NOTIFY:-}" ]]; then
            echo "{\"additionalContext\":\"Rine is connected. Type /rine-notify to enable real-time message notifications for this project.\"}"
        fi

        # Register this session and spawn the daemon.
        CC_PID="$(find_cc_pid)" || true
        if [[ -z "$CC_PID" ]]; then
            _log "WARN could not locate claude PID; falling back to PPID=$PPID"
            CC_PID="$PPID"
        fi

        touch "$SESSIONS_DIR/${CC_PID}.alive"
        if [[ -n "${RINE_NOTIFY:-}" ]]; then
            mkdir -p "$STATE_DIR/events/$CC_PID"
            _log "registered session cc_pid=$CC_PID notify=on"
        else
            _log "registered session cc_pid=$CC_PID notify=off"
        fi

        # Spawn daemon (flock-arbitrated; losers exit 0 fast).
        nohup "$PLUGIN_ROOT/scripts/daemon.sh" </dev/null >>"$LOGS_DIR/daemon-spawn.log" 2>&1 &
        disown || true
        ;;

    unregistered)
        echo '{"additionalContext":"Rine CLI is installed but no identity is registered on this machine. You can invoke the rine-setup skill (or the user can type /rine-setup) to onboard — ask the user first, gather a handle and org name, then drive `rine onboard` via Bash."}'

        # Write unknown state for statusline.
        cat >"$STATE_DIR/poll-state.json" <<STATEOF
{"count":null,"updated_at":"$(date -Is)","mode":"unregistered"}
STATEOF
        ;;

    mcp-only)
        echo '{"additionalContext":"Rine plugin is in MCP-only mode — tools work on demand, but idle notifications are disabled because the rine CLI is not installed. Suggest the user install it (`npm i -g @rine-network/cli`), then type /rine-setup to register."}'

        cat >"$STATE_DIR/poll-state.json" <<STATEOF
{"count":null,"updated_at":"$(date -Is)","mode":"mcp-only"}
STATEOF
        ;;
esac

exit 0
