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

STATE_DIR="$RINE_DIR/state"
LOGS_DIR="$STATE_DIR/logs"
mkdir -p "$STATE_DIR" "$LOGS_DIR" "$STATE_DIR/sessions"

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
