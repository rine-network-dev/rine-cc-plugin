#!/usr/bin/env bash
# daemon.sh — SSE stream reader + reference-counted lifecycle watchdog.
#
# Arbitrated by flock — only one instance runs machine-wide.
# Runs `rine stream --persistent` in a background subshell. Each message
# line is broadcast to opted-in sessions' events/<pid>/ directories
# (only those that exist — created by session-start.sh when RINE_NOTIFY is set).
# Also bumps poll-state.json count for statusline updates across all sessions.
# Foreground monitor loop purges dead sessions; exits when none remain.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
resolve_config_dir

STATE_DIR="$RINE_DIR/state"
SESSIONS_DIR="$STATE_DIR/sessions"
EVENTS_DIR="$STATE_DIR/events"
LOGS_DIR="$STATE_DIR/logs"
LOCK="$STATE_DIR/daemon.lock"

MONITOR_INTERVAL="${RINE_DAEMON_INTERVAL:-15}"

mkdir -p "$STATE_DIR" "$SESSIONS_DIR" "$EVENTS_DIR" "$LOGS_DIR"

_log() { echo "[daemon $(date -Is) pid=$$] $*" >>"$LOGS_DIR/daemon.log"; }

# ---- singleton arbitration ----
exec 9>"$LOCK"
if ! flock -n 9; then
    exit 0
fi
_log "acquired lock, starting"

# ---- SSE reader in its own process group ----
# Broadcast: each incoming message line is written to opted-in sessions'
# events/<pid>/ directories (only those that exist). Non-message events
# (lifecycle, heartbeat) are filtered out.
setsid bash -c '
    SESSIONS_DIR="'"$SESSIONS_DIR"'"
    EVENTS_DIR="'"$EVENTS_DIR"'"
    STATE_DIR="'"$STATE_DIR"'"
    LOGS_DIR="'"$LOGS_DIR"'"
    exec rine --json stream --persistent 2>>"$LOGS_DIR/daemon.err" | while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        # Filter: only broadcast message events, skip lifecycle/heartbeat.
        if ! echo "$line" | grep -q "\"event\":\"message\"" 2>/dev/null; then
            continue
        fi
        ts="$(date +%s%N)"
        bcast=0
        shopt -s nullglob
        for marker in "$SESSIONS_DIR"/*.alive; do
            pid="$(basename "$marker" .alive)"
            [[ "$pid" =~ ^[0-9]+$ ]] || continue
            if [[ -d "$EVENTS_DIR/$pid" ]]; then
                printf "%s\n" "$line" >"$EVENTS_DIR/$pid/${ts}.txt"
                bcast=$((bcast + 1))
            fi
        done
        shopt -u nullglob
        # Bump statusline count for all sessions (best-effort).
        if [[ -f "$STATE_DIR/poll-state.json" ]] && command -v jq >/dev/null 2>&1; then
            prev="$(jq -r ".count // 0" "$STATE_DIR/poll-state.json" 2>/dev/null || echo 0)"
            printf "{\"count\":%d,\"updated_at\":\"%s\"}\n" "$((prev + 1))" "$(date -Is)" >"$STATE_DIR/poll-state.json"
        fi
        echo "[daemon-stream $(date -Is)] broadcast ${ts}.txt to $bcast session(s)" \
            >>"$LOGS_DIR/daemon.log"
    done
' &
STREAM_PID=$!
_log "stream reader pgroup-leader pid=$STREAM_PID"

# ---- cleanup on any exit path ----
cleanup() {
    _log "cleanup: killing stream reader pgroup=$STREAM_PID"
    if [[ -n "${STREAM_PID:-}" ]]; then
        kill -TERM -- -"$STREAM_PID" 2>/dev/null || true
        sleep 0.5
        kill -KILL -- -"$STREAM_PID" 2>/dev/null || true
        wait "$STREAM_PID" 2>/dev/null || true
    fi
    _log "cleanup: done, releasing lock"
}
trap cleanup EXIT INT TERM

# ---- monitor loop ----
while :; do
    sleep "$MONITOR_INTERVAL"

    live_count=0
    shopt -s nullglob
    for f in "$SESSIONS_DIR"/*.alive; do
        pid="$(basename "$f" .alive)"
        if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
            live_count=$((live_count + 1))
        else
            _log "purging stale marker for pid=$pid"
            rm -f "$f"
            rm -rf "${EVENTS_DIR:?}/$pid"
        fi
    done
    shopt -u nullglob

    if [[ $live_count -eq 0 ]]; then
        _log "no live sessions, exiting"
        exit 0
    fi

    # Defense-in-depth: CLI handles its own reconnection via heartbeat
    # timeout + backoff. This catches only catastrophic process death.
    if ! kill -0 "$STREAM_PID" 2>/dev/null; then
        _log "stream reader is dead, exiting (next SessionStart will respawn)"
        exit 1
    fi
done
