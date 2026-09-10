#!/usr/bin/env bash
# monitor-stream.sh — CC monitor: streams rine message notifications.
#
# The host delivers each stdout line to Claude as a notification, which it reacts to at a
# natural break — not as a user-turn transcript message.
# Outputs metadata only (sender + type) — payload is E2E-encrypted.
#
# Silence: touch $RINE_DIR/monitor-pause
# Resume:  rm    $RINE_DIR/monitor-pause
#
# Backoff env overrides (all optional):
#   RINE_MONITOR_BACKOFF_BASE    — initial delay in seconds (default 5)
#   RINE_MONITOR_BACKOFF_MAX     — cap in seconds (default 300)
#   RINE_MONITOR_MIN_HEALTHY     — seconds child must run to reset attempt counter (default 30)
#   RINE_MONITOR_MAX_RESTARTS    — 0 = unlimited (default); >0 exits loop after N attempts

set -uo pipefail

# ── helper functions (defined before any side-effecting code) ───────────────

# bump_count — the ONLY read of poll-state.json anywhere in this package, and it reads the file
# solely to increment it. Nothing displays the result: the badge that consumed it has been
# removed, and the harness-owned unread ledger is its next consumer. Not dead code.
bump_count() {
    if [[ ! -f "${STATE_DIR}/poll-state.json" ]]; then
        printf '{"count":1,"updated_at":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            >"${STATE_DIR}/poll-state.json"
        return
    fi
    command -v jq >/dev/null 2>&1 || return 0
    local prev
    prev="$(jq -r '.count // 0' "${STATE_DIR}/poll-state.json" 2>/dev/null || echo 0)"
    printf '{"count":%d,"updated_at":"%s"}\n' "$((prev + 1))" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        >"${STATE_DIR}/poll-state.json"
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

# compute_backoff <attempt>
# Echoes the pre-jitter backoff delay in seconds (integer).
# Uses RINE_MONITOR_BACKOFF_BASE and RINE_MONITOR_BACKOFF_MAX.
compute_backoff() {
    local attempt="${1:-1}"
    local base="${RINE_MONITOR_BACKOFF_BASE:-5}"
    local max="${RINE_MONITOR_BACKOFF_MAX:-300}"

    # attempt 0 (healthy reset) or 1 (first failure) → base delay. Guarding
    # attempt<=1 is essential: 1 << (0-1) is a negative left-shift, which bash
    # evaluates to a huge/negative value (shift count masked to 63 → 1<<63 →
    # INT64_MIN), tripping the delay<=0 guard below and wrongly returning MAX.
    # That would stall reconnect for 5 min after every clean disconnect.
    if (( attempt <= 1 )); then
        echo "$base"
        return
    fi

    # delay = base * 2^(attempt-1), capped at max
    local delay=$(( base * (1 << (attempt - 1)) ))
    if (( delay > max || delay <= 0 )); then
        delay=$max
    fi
    echo "$delay"
}

_rine_monitor_main() {
    local attempt=0
    local max_restarts="${RINE_MONITOR_MAX_RESTARTS:-0}"
    local min_healthy="${RINE_MONITOR_MIN_HEALTHY:-30}"

    while true; do
        local start_time="$SECONDS"

        "$RINE_BIN" --json stream --persistent --monitor 2>/dev/null | while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            echo "$line" | grep -q '"event":"message"' 2>/dev/null || continue

            bump_count

            [[ -f "$PAUSE_FILE" ]] && continue

            format_event "$line"
        done || true

        local elapsed=$(( SECONDS - start_time ))

        # Healthy run resets attempt counter; fast exit increments it.
        if (( elapsed >= min_healthy )); then
            attempt=0
        else
            (( attempt++ )) || true
        fi

        # Enforce max-restarts cap (0 = unlimited).
        if (( max_restarts > 0 && attempt >= max_restarts )); then
            break
        fi

        # Compute backoff delay and add 0–10% one-sided jitter via $RANDOM so
        # many monitors that failed together don't reconnect in lockstep.
        local base_delay
        base_delay="$(compute_backoff "$attempt")"
        # jitter ∈ [0, base_delay*0.0999] — integer arithmetic, never shortens base.
        local jitter=$(( base_delay * (RANDOM % 1000) / 10000 ))
        local sleep_secs=$(( base_delay + jitter ))
        (( sleep_secs < 1 )) && sleep_secs=1

        sleep "$sleep_secs"
    done
}

# ── source-guard: sourcing with RINE_MONITOR_TEST_ONLY=1 loads functions only ──
[[ "${RINE_MONITOR_TEST_ONLY:-}" == "1" ]] && return 0

# ── side-effecting startup (runs only when not in test mode) ─────────────────

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
resolve_config_dir   # sets RINE_DIR, RINE_HAS_CREDS, STATE_DIR, PAUSE_FILE

[[ -n "$RINE_HAS_CREDS" ]] || exit 0

RINE_BIN="$(command -v rine 2>/dev/null || true)"
[[ -n "$RINE_BIN" ]] || exit 0

mkdir -p "$STATE_DIR"

trap 'kill 0 2>/dev/null; exit' TERM INT HUP

_rine_monitor_main
