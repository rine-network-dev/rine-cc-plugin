#!/usr/bin/env bash
# wake.sh — asyncRewake Stop hook.
#
# Batch-drains ALL pending messages from this session's events/<CC_PID>/
# directory into a single summary. If nothing pending, blocks on
# inotifywait (or polls) until an event arrives. Exits 2 to wake the
# model; exits 0 if nothing to report.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
source "$PLUGIN_ROOT/scripts/lib/find-cc-pid.sh"
resolve_config_dir

STATE_DIR="$RINE_DIR/state"
LOGS_DIR="$STATE_DIR/logs"
mkdir -p "$LOGS_DIR"

CC_PID="$(find_cc_pid)" || true
if [[ -z "$CC_PID" ]]; then
    echo "[wake $(date -Is) pid=$$] WARN could not locate claude PID; falling back to PPID=$PPID" \
        >>"$LOGS_DIR/wake.log"
    CC_PID="$PPID"
fi

EVENTS_DIR="$STATE_DIR/events/$CC_PID"
if [[ ! -d "$EVENTS_DIR" ]]; then
    # Session did not opt into notifications (no RINE_NOTIFY) — no wake.
    exit 0
fi

_log() { echo "[wake $(date -Is) pid=$$ cc=$CC_PID] $*" >>"$LOGS_DIR/wake.log"; }

_list_events() {
    find "$EVENTS_DIR" -maxdepth 1 -type f -name '*.txt' -printf '%f\n' 2>/dev/null | sort
}

declare -A ALL_SENDERS
TOTAL_DRAINED=0

_drain_batch() {
    local files count=0
    files="$(_list_events)"
    [[ -z "$files" ]] && return 1

    while IFS= read -r fname; do
        [[ -z "$fname" ]] && continue
        local claimed="$EVENTS_DIR/.claiming-$$-$TOTAL_DRAINED"
        mv "$EVENTS_DIR/$fname" "$claimed" 2>/dev/null || continue

        local content sender_handle
        content="$(cat "$claimed" 2>/dev/null || true)"
        rm -f "$claimed"

        if command -v jq >/dev/null 2>&1; then
            sender_handle="$(echo "$content" | jq -r '.data | fromjson | .sender_handle // empty' 2>/dev/null || true)"
        fi
        sender_handle="${sender_handle:-unknown}"
        ALL_SENDERS["$sender_handle"]=$(( ${ALL_SENDERS["$sender_handle"]:-0} + 1 ))
        TOTAL_DRAINED=$((TOTAL_DRAINED + 1))
        count=$((count + 1))
    done <<< "$files"

    [[ $count -eq 0 ]] && return 1
    _log "drained $count event(s)"
    return 0
}

_report() {
    [[ $TOTAL_DRAINED -eq 0 ]] && return
    if [[ $TOTAL_DRAINED -eq 1 ]]; then
        local sole_sender="${!ALL_SENDERS[@]}"
        printf '[rine] new message from %s\n' "$sole_sender" >&2
    else
        printf '[rine] %d new messages:\n' "$TOTAL_DRAINED" >&2
        for sender in "${!ALL_SENDERS[@]}"; do
            local n="${ALL_SENDERS[$sender]}"
            if [[ $n -eq 1 ]]; then
                printf '  • %s\n' "$sender" >&2
            else
                printf '  • %s (%d)\n' "$sender" "$n" >&2
            fi
        done
    fi
}

_log "triggered"

# Fast path: drain everything already pending, then re-drain to batch bursts.
if _drain_batch; then
    while sleep 0.5 && _drain_batch; do :; done
    _report
    exit 2
fi

# Slow path: block until a new event file is created, then drain.
if command -v inotifywait >/dev/null 2>&1; then
    _log "idle — waiting (inotifywait)"
    inotifywait -q -e create,moved_to "$EVENTS_DIR" >/dev/null 2>&1 || true
    sleep 0.3
else
    _log "idle — polling (no inotifywait)"
    while :; do
        [[ -n "$(_list_events | head -1)" ]] && break
        sleep 1
    done
fi

if _drain_batch; then
    while sleep 0.5 && _drain_batch; do :; done
    _report
    exit 2
fi

_log "woke but events dir empty — exiting 0"
exit 0
