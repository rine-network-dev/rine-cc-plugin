#!/usr/bin/env bash
# test-monitor-backoff.sh — self-contained tests for monitor-stream.sh backoff logic.
#
# Usage: bash test-monitor-backoff.sh
# Exit:  0 = all pass, non-zero = at least one failure.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_SCRIPT="$SCRIPT_DIR/../monitor-stream.sh"

PASS=0
FAIL=0

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        echo "PASS: $desc"
        (( PASS++ )) || true
    else
        echo "FAIL: $desc — expected '$expected', got '$actual'"
        (( FAIL++ )) || true
    fi
}

assert_ge() {
    local desc="$1" min="$2" actual="$3"
    if (( actual >= min )); then
        echo "PASS: $desc (actual=$actual >= min=$min)"
        (( PASS++ )) || true
    else
        echo "FAIL: $desc — expected >= $min, got $actual"
        (( FAIL++ )) || true
    fi
}

assert_le() {
    local desc="$1" max="$2" actual="$3"
    if (( actual <= max )); then
        echo "PASS: $desc (actual=$actual <= max=$max)"
        (( PASS++ )) || true
    else
        echo "FAIL: $desc — expected <= $max, got $actual"
        (( FAIL++ )) || true
    fi
}

# ─── Unit tests: compute_backoff ────────────────────────────────────────────

echo "=== Unit tests: compute_backoff ==="

# Source the script in test-only mode to load functions without running the main loop.
RINE_MONITOR_TEST_ONLY=1 source "$MONITOR_SCRIPT"

# Test 0 (regression): attempt 0 is the healthy-reset path. It must return
# BASE, not MAX. A naive `base * (1 << (attempt-1))` makes 1<<-1 overflow and the
# delay<=0 guard wrongly returns MAX(300) — a 60x stall after every clean
# disconnect.
export RINE_MONITOR_BACKOFF_BASE=5
export RINE_MONITOR_BACKOFF_MAX=300
v="$(compute_backoff 0)"
assert_eq "attempt 0 (healthy reset) = BASE(5), not MAX" "5" "$v"

# Test 1: attempt 1 with default base=5 returns a value in [5, 6] (base to base*1.1).
v="$(compute_backoff 1)"
assert_ge "attempt 1 >= BASE(5)" 5 "$v"
assert_le "attempt 1 <= BASE*1.1(5)" 5 "$v"  # pre-jitter is exact

# Test 2: attempt 2 doubles the base => 10
v="$(compute_backoff 2)"
assert_eq "attempt 2 = BASE*2 (10)" "10" "$v"

# Test 3: attempt 3 = 20
v="$(compute_backoff 3)"
assert_eq "attempt 3 = BASE*4 (20)" "20" "$v"

# Test 4: attempt 8 should be capped at MAX=300
# base=5, 5*2^7=640 > 300, so capped
v="$(compute_backoff 8)"
assert_eq "attempt 8 capped at MAX(300)" "300" "$v"

# Test 5: attempt 10 also capped at MAX
v="$(compute_backoff 10)"
assert_eq "attempt 10 capped at MAX(300)" "300" "$v"

# Test 6: custom base=2, max=10 — attempt 4 should be capped at 10
# base=2, 2*2^3=16 > 10, so capped at 10
export RINE_MONITOR_BACKOFF_BASE=2
export RINE_MONITOR_BACKOFF_MAX=10
v="$(compute_backoff 4)"
assert_eq "attempt 4 capped at MAX(10) with base=2" "10" "$v"

# Test 7: attempt 1 with base=2, max=10 => 2
v="$(compute_backoff 1)"
assert_eq "attempt 1 = BASE(2) with base=2" "2" "$v"

# Test 8: attempt 2 with base=2, max=10 => 4
v="$(compute_backoff 2)"
assert_eq "attempt 2 = 4 with base=2" "4" "$v"

# Test 9: attempt 3 with base=2, max=10 => 8 (below cap)
v="$(compute_backoff 3)"
assert_eq "attempt 3 = 8 with base=2" "8" "$v"

# ─── Integration test: stubbed rine crash-loop ───────────────────────────────

echo ""
echo "=== Integration test: crash-loop with stub rine ==="

# Create a temp directory with a stub rine that records timestamps and exits immediately.
TMP_DIR="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '$TMP_DIR'" EXIT

STUB_LOG="$TMP_DIR/invocations.log"

# Write stub rine executable.
cat >"$TMP_DIR/rine" <<'STUB'
#!/usr/bin/env bash
# Stub rine: record timestamp and exit immediately (simulating crash).
printf '%s\n' "$(date +%s%3N)" >> "$STUB_LOG"
exit 1
STUB
chmod +x "$TMP_DIR/rine"

# Export STUB_LOG so the stub can see it.
export STUB_LOG

# Create a fake credentials.json so the creds guard passes.
FAKE_RINE_CONFIG="$TMP_DIR/rine-config"
mkdir -p "$FAKE_RINE_CONFIG"
echo '{"default":{"agent_id":"test-agent"}}' > "$FAKE_RINE_CONFIG/credentials.json"

# Prepend stub dir to PATH.
export PATH="$TMP_DIR:$PATH"

# Run _rine_monitor_main directly in a subshell with controlled settings.
# MAX_RESTARTS=3 means the loop runs 3 times then exits.
# BACKOFF_BASE=1, BACKOFF_MAX=4 so delays are short (1, 2, 4, 4, ...).
# MIN_HEALTHY=9999 so no run is ever "healthy" (elapsed always < 9999).
# Use timeout to guard against infinite loop bugs.

(
    export RINE_MONITOR_BACKOFF_BASE=1
    export RINE_MONITOR_BACKOFF_MAX=4
    export RINE_MONITOR_MIN_HEALTHY=9999
    export RINE_MONITOR_MAX_RESTARTS=3
    export RINE_BIN="$TMP_DIR/rine"
    export STATE_DIR="$TMP_DIR/state"
    export PAUSE_FILE="$TMP_DIR/monitor-pause"
    mkdir -p "$STATE_DIR"

    # Source monitor-stream.sh in test mode to get functions, then call main directly.
    RINE_MONITOR_TEST_ONLY=1 source "$MONITOR_SCRIPT"
    _rine_monitor_main
) &
MONITOR_PID=$!

# Wait up to 30 seconds for the monitor to finish.
WAIT_SECS=30
while (( WAIT_SECS > 0 )) && kill -0 "$MONITOR_PID" 2>/dev/null; do
    sleep 1
    (( WAIT_SECS-- )) || true
done

if kill -0 "$MONITOR_PID" 2>/dev/null; then
    echo "FAIL: monitor did not exit within timeout — killing"
    kill "$MONITOR_PID" 2>/dev/null || true
    (( FAIL++ )) || true
else
    echo "PASS: monitor exited within timeout"
    (( PASS++ )) || true
fi

# Count invocations.
if [[ -f "$STUB_LOG" ]]; then
    invocation_count="$(wc -l < "$STUB_LOG" | tr -d ' ')"
else
    invocation_count=0
fi

echo "INFO: stub invoked $invocation_count times"

# Assert: invocation count equals RINE_MONITOR_MAX_RESTARTS=3.
assert_eq "stub invoked exactly 3 times (max_restarts=3)" "3" "$invocation_count"

# Assert: successive intervals are non-decreasing (backoff grows).
if (( invocation_count >= 3 )); then
    mapfile -t timestamps < "$STUB_LOG"

    t0="${timestamps[0]}"
    t1="${timestamps[1]}"
    t2="${timestamps[2]}"

    interval1=$(( t1 - t0 ))
    interval2=$(( t2 - t1 ))

    echo "INFO: interval1=${interval1}ms, interval2=${interval2}ms"

    # Intervals grow or stay equal (capped). Allow for CI timing noise:
    # interval2 should be >= interval1 (or at most 200ms less due to jitter/overhead).
    if (( interval2 + 200 >= interval1 )); then
        echo "PASS: intervals are non-decreasing (within tolerance)"
        (( PASS++ )) || true
    else
        echo "FAIL: interval2 ($interval2 ms) is much less than interval1 ($interval1 ms)"
        (( FAIL++ )) || true
    fi
else
    echo "SKIP: not enough invocations to compare intervals"
fi

# ─── Integration test: healthy run resets backoff (regression M1) ────────────

echo ""
echo "=== Integration test: healthy reset keeps reconnect prompt ==="

HEALTHY_TMP="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '$TMP_DIR' '$HEALTHY_TMP'" EXIT

HEALTHY_LOG="$HEALTHY_TMP/invocations.log"
export HEALTHY_LOG

# Stub that runs "long enough" to count as healthy, then exits cleanly.
cat >"$HEALTHY_TMP/rine" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$(date +%s%3N)" >> "$HEALTHY_LOG"
sleep 2
exit 0
STUB
chmod +x "$HEALTHY_TMP/rine"

(
    export RINE_MONITOR_BACKOFF_BASE=1
    export RINE_MONITOR_BACKOFF_MAX=120
    export RINE_MONITOR_MIN_HEALTHY=1   # a 2s run counts as healthy → attempt resets to 0
    export RINE_MONITOR_MAX_RESTARTS=0  # unlimited; we bound by wall-clock instead
    export RINE_BIN="$HEALTHY_TMP/rine"
    export STATE_DIR="$HEALTHY_TMP/state"
    export PAUSE_FILE="$HEALTHY_TMP/monitor-pause"
    mkdir -p "$STATE_DIR"
    RINE_MONITOR_TEST_ONLY=1 source "$MONITOR_SCRIPT"
    _rine_monitor_main
) &
HEALTHY_PID=$!

# With the fix each cycle is ~2s(run)+~1s(base backoff) ≈ 3s → expect >=2 in 8s.
# With the M1 bug, the first healthy reset → compute_backoff(0) → MAX(120s),
# so only 1 invocation would land in the window. This asserts the bug is gone.
sleep 8
kill "$HEALTHY_PID" 2>/dev/null || true
wait "$HEALTHY_PID" 2>/dev/null || true

if [[ -f "$HEALTHY_LOG" ]]; then
    healthy_count="$(wc -l < "$HEALTHY_LOG" | tr -d ' ')"
else
    healthy_count=0
fi
echo "INFO: healthy stub invoked $healthy_count times in ~8s"
assert_ge "healthy run reconnects promptly (not stalled at MAX)" 2 "$healthy_count"

# ─── shellcheck (optional) ───────────────────────────────────────────────────

echo ""
echo "=== shellcheck ==="
if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck "$MONITOR_SCRIPT" && shellcheck "${BASH_SOURCE[0]}"; then
        echo "PASS: shellcheck clean"
        (( PASS++ )) || true
    else
        echo "FAIL: shellcheck found issues"
        (( FAIL++ )) || true
    fi
else
    echo "SKIP: shellcheck not installed"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

(( FAIL == 0 ))
