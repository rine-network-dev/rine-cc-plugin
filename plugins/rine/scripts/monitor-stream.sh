#!/usr/bin/env bash
# monitor-stream.sh — CC monitor: streams rine message notifications.
#
# Each stdout line becomes a transcript message that Claude reacts to.
# Outputs metadata only (sender + type) — payload is E2E-encrypted.
#
# Silence: touch $RINE_DIR/monitor-pause
# Resume:  rm    $RINE_DIR/monitor-pause

set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
resolve_config_dir

[[ -n "$RINE_HAS_CREDS" ]] || exit 0

RINE_BIN="$(command -v rine 2>/dev/null || true)"
[[ -n "$RINE_BIN" ]] || exit 0

STATE_DIR="$RINE_DIR/state"
PAUSE_FILE="$RINE_DIR/monitor-pause"
mkdir -p "$STATE_DIR"

trap 'kill 0 2>/dev/null; exit' TERM INT HUP

bump_count() {
    if [[ ! -f "$STATE_DIR/poll-state.json" ]]; then
        printf '{"count":1,"updated_at":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            >"$STATE_DIR/poll-state.json"
        return
    fi
    command -v jq >/dev/null 2>&1 || return 0
    local prev
    prev="$(jq -r '.count // 0' "$STATE_DIR/poll-state.json" 2>/dev/null || echo 0)"
    printf '{"count":%d,"updated_at":"%s"}\n' "$((prev + 1))" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        >"$STATE_DIR/poll-state.json"
}

format_event() {
    local line="$1"
    if ! command -v jq >/dev/null 2>&1; then
        echo "[rine] new message"
        return
    fi

    local data sender msg_type group
    data="$(echo "$line" | jq -r '.data' 2>/dev/null)" || { echo "[rine] new message"; return; }
    sender="$(echo "$data" | jq -r '.sender_handle // .from_agent_id // "unknown"' 2>/dev/null)"
    msg_type="$(echo "$data" | jq -r '.type // "unknown"' 2>/dev/null | sed 's/^rine\.v1\.//')"
    group="$(echo "$data" | jq -r '.group_handle // empty' 2>/dev/null)"

    if [[ -n "$group" ]]; then
        echo "[rine] $sender in $group ($msg_type)"
    else
        echo "[rine] $sender ($msg_type)"
    fi
}

while true; do
    "$RINE_BIN" --json stream --persistent --monitor 2>/dev/null | while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        echo "$line" | grep -q '"event":"message"' 2>/dev/null || continue

        bump_count

        [[ -f "$PAUSE_FILE" ]] && continue

        format_event "$line"
    done || true

    sleep 5
done
