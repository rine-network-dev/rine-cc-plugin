#!/usr/bin/env bash
# notify-toggle.sh — live-activate or deactivate rine notifications
# for the current CC session, without requiring a restart.
#
# Usage: notify-toggle.sh on|off

set -euo pipefail

ACTION="${1:-on}"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
source "$PLUGIN_ROOT/scripts/lib/find-cc-pid.sh"
resolve_config_dir

if [[ -z "$RINE_HAS_CREDS" ]]; then
    echo "error: no rine credentials found. Run /rine-setup first." >&2
    exit 1
fi

STATE_DIR="$RINE_DIR/state"
LOGS_DIR="$STATE_DIR/logs"
if ! mkdir -p "$STATE_DIR" "$LOGS_DIR" "$STATE_DIR/sessions" 2>/dev/null \
   || ! touch "$STATE_DIR/.write-probe" 2>/dev/null; then
    echo "error: rine state directory is read-only (sandboxed?). Notifications require a writable config dir." >&2
    exit 1
fi
rm -f "$STATE_DIR/.write-probe"

CC_PID="$(find_cc_pid)" || true
if [[ -z "$CC_PID" ]]; then
    CC_PID="$PPID"
fi

case "$ACTION" in
    on)
        mkdir -p "$STATE_DIR/events/$CC_PID"
        touch "$STATE_DIR/sessions/${CC_PID}.alive"
        nohup "$PLUGIN_ROOT/scripts/daemon.sh" </dev/null >>"$LOGS_DIR/daemon-spawn.log" 2>&1 &
        disown || true
        sleep 0.5
        LOCK="$STATE_DIR/daemon.lock"
        if flock -n "$LOCK" true 2>/dev/null; then
            echo "error: daemon failed to start. Check logs:" >&2
            tail -5 "$LOGS_DIR/daemon.err" 2>/dev/null >&2 || true
            tail -5 "$LOGS_DIR/daemon.log" 2>/dev/null >&2 || true
            rm -rf "${STATE_DIR:?}/events/$CC_PID"
            rm -f "${STATE_DIR:?}/sessions/${CC_PID}.alive"
            exit 1
        fi
        echo "activated for pid=$CC_PID"
        ;;
    off)
        rm -rf "${STATE_DIR:?}/events/$CC_PID"
        echo "deactivated for pid=$CC_PID"
        ;;
    *)
        echo "usage: notify-toggle.sh on|off" >&2
        exit 1
        ;;
esac
