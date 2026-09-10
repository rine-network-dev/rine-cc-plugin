#!/usr/bin/env bash
# hookenv.sh — the SessionStart hook against a hostile environment. AUTH-LESS, always runs.
#
# Two halves, both of which exist because the same failure would be invisible in production:
# the hook is reported a SUCCESS by the host whatever it emits, so a broken frame is silent.
#
# HOSTILE PATH. $NOTIFY_NOTE interpolates a filesystem path — the config dir's monitor-pause
#   file — straight into a JSON string literal. A config dir containing a quote or a backslash
#   produced invalid JSON, which the host would drop without a word. All four branches must
#   emit PARSEABLE JSON over a config dir holding `"`, `\` and a space, and the path must
#   round-trip byte-for-byte into the frame the model reads.
#
# STARVED PATH. The hook's contract is exit 0 on EVERY path, and that contract is only as
#   strong as the weakest command on it: under `set -euo pipefail` an assignment takes its
#   command substitution's status, so one binary missing from PATH exits the hook 127 and it
#   never reaches its own `exit 0`. A `tr` pipeline in emit_context was measured doing exactly
#   that. This half runs the hook with `tr`, `jq` and `curl` unreachable and, separately, with
#   `curl` alone unreachable — the documented degradation is a count of 0, never a dead hook.
#
# Both halves are mutation-proven in ../mutation-proof.sh: a gate authored in the same wave as
# the code it guards is worth exactly what its mutation proof says it is.

set -uo pipefail
PROBE_NAME="hookenv"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

WORK="$SCRATCH/hookenv"
# CC_RIG_HOOKENV_POLL_PORT, not CC_RIG_POLL_PORT_ENV: e16-ab.sh owns CC_RIG_POLL_PORT, and two
# names one edit apart, differing by a suffix that reads like "the environment one", is how a
# port override lands on the wrong probe and moves nothing.
POLL_PORT="${CC_RIG_HOOKENV_POLL_PORT:-18792}"
rm -rf "$WORK"; mkdir -p "$WORK"
start_poll_fixture "$WORK/poll" "$POLL_PORT" 4
trap 'kill "$POLL_PID" 2>/dev/null' EXIT

# --- half A: a config dir holding a quote, a backslash and a space -------------------------
HOSTILE_COUNT="$WORK/ho\"st\\ile count"
HOSTILE_ZERO="$WORK/ho\"st\\ile zero"
HOSTILE_EMPTY="$WORK/ho\"st\\ile empty"
make_creds_fixture "$HOSTILE_COUNT" ready-count "$POLL_URL"
make_creds_fixture "$HOSTILE_ZERO"  ready-zero
make_creds_fixture "$HOSTILE_EMPTY" unregistered

assert_hook "hostile-ready-count"  "$PLUGIN_DIR" "$HOSTILE_COUNT" "$PATH" "$FRAME_UNREAD"
# The ready branch writes poll-state.json before it emits. Asserting the frame alone cannot see
# whether that write happened, and the write is the half that used to be able to kill the hook.
if [ -s "$HOSTILE_COUNT/state/poll-state.json" ] \
   && python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(d.get("count"),int) else 1)' \
        "$HOSTILE_COUNT/state/poll-state.json" 2>/dev/null; then
    pass "hostile-ready-count: poll-state.json was written and holds a numeric count"
else
    fail "hostile-ready-count: poll-state.json is missing, empty or not parseable — the ready branch emitted without recording state"
fi
assert_hook "hostile-ready-zero"   "$PLUGIN_DIR" "$HOSTILE_ZERO"  "$PATH" "$FRAME_READY"
# The frame the model reads must contain the real path, not a mangled one: escaping that
# merely makes the JSON parse would be a silent corruption of what Claude is told.
case "$(hook_context)" in
    *"$HOSTILE_ZERO/monitor-pause"*) pass "hostile-ready-zero: the config path round-trips byte-for-byte into the frame" ;;
    *) fail "hostile-ready-zero: the config path did not survive escaping — the frame names a path that does not exist" ;;
esac
assert_hook "hostile-unregistered" "$PLUGIN_DIR" "$HOSTILE_EMPTY" "$PATH" "$FRAME_UNREGISTERED"
assert_hook "hostile-mcp-only"     "$PLUGIN_DIR" "$HOSTILE_EMPTY" "/usr/bin:/bin" "$FRAME_MCP_ONLY"

# --- half B: a PATH with binaries the hook must not depend on ------------------------------
# starve <name> <binary>... — a PATH farm of symlinks to everything the image has EXCEPT the
# named binaries. Lower-priority dirs are linked first so the real precedence survives.
starve() {
    local name="$1"; shift
    local dir="$WORK/starved-$name"
    local p b x skip rine_bin
    mkdir -p "$dir"
    # `rine` is resolved rather than assumed into one of these three directories: a farm that
    # silently lacks it puts every branch below into mcp-only and the leg passes on nothing.
    rine_bin="$(command -v rine 2>/dev/null || true)"
    for p in /bin/* /usr/bin/* /usr/local/bin/* "$rine_bin"; do
        [ -f "$p" ] && [ -x "$p" ] || continue
        b="$(basename "$p")"
        skip=""
        for x in "$@"; do
            [ "$b" = "$x" ] && skip=1
        done
        [ -n "$skip" ] && continue
        ln -sf "$p" "$dir/$b"
    done
    printf '%s' "$dir"
}

STARVED="$(starve nojqcurl tr jq curl)"
STARVED_NORINE="$(starve norine tr jq curl rine)"
STARVED_NOCURL="$(starve nocurl curl)"
# The hook also shells out to mkdir/touch/rm (the writability probe) and date (the timestamp),
# and every one of those sits on the ready branch BEFORE the frame is emitted. Under
# `set -euo pipefail` an unguarded one of them takes the hook to 127 with no output, so the
# starvation half has to name them too — `tr/jq/curl` was the set that happened to be measured,
# not the set that matters.
STARVED_NOCORE="$(starve nocore mkdir touch rm date)"

# The instrument is a suspect: prove each farm holds exactly what the leg below assumes, or a
# green run means only that the PATH was fully stocked all along.
#   <farm>:<binary>:absent|present
for probe_pair in \
    "$STARVED:tr:absent"    "$STARVED:jq:absent"    "$STARVED:curl:absent"   "$STARVED:rine:present" \
    "$STARVED_NORINE:rine:absent" \
    "$STARVED_NOCURL:curl:absent" "$STARVED_NOCURL:jq:present" "$STARVED_NOCURL:rine:present" \
    "$STARVED_NOCORE:mkdir:absent" "$STARVED_NOCORE:touch:absent" "$STARVED_NOCORE:rm:absent" \
    "$STARVED_NOCORE:date:absent"  "$STARVED_NOCORE:rine:present"
do
    dir="${probe_pair%%:*}"; rest="${probe_pair#*:}"; bin="${rest%%:*}"; want="${rest##*:}"
    if PATH="$dir" command -v "$bin" >/dev/null 2>&1; then
        got=present
    else
        got=absent
    fi
    if [ "$got" = "$want" ]; then
        pass "starvation fixture $(basename "$dir"): '$bin' is $want on PATH, as the leg requires"
    else
        fail "starvation fixture $(basename "$dir"): '$bin' is $got, expected $want — the leg would prove nothing"
    fi
done

make_creds_fixture "$WORK/creds-count" ready-count "$POLL_URL"
make_creds_fixture "$WORK/creds-empty" unregistered

# Without jq the poll URL is never read, so the count degrades to 0 and the frame says
# "Rine is connected" — the documented behaviour, and the reason the README requires jq.
assert_hook "starved-ready"        "$PLUGIN_DIR" "$WORK/creds-count" "$STARVED" "$FRAME_READY"
assert_hook "starved-unregistered" "$PLUGIN_DIR" "$WORK/creds-empty" "$STARVED" "$FRAME_UNREGISTERED"
assert_hook "starved-mcp-only"     "$PLUGIN_DIR" "$WORK/creds-empty" "$STARVED_NORINE" "$FRAME_MCP_ONLY"
# The worst case the two halves can make together.
assert_hook "starved-hostile"      "$PLUGIN_DIR" "$HOSTILE_ZERO"     "$STARVED" "$FRAME_READY"
# curl alone missing: jq resolves the poll_url, the fetch cannot happen, count stays 0.
assert_hook "no-curl"              "$PLUGIN_DIR" "$WORK/creds-count" "$STARVED_NOCURL" "$FRAME_READY"
# No mkdir/touch/rm/date: the writability probe cannot run and the timestamp is empty, but jq
# and curl are still there, so this is the ready/count>0 branch with its state write disarmed.
assert_hook "starved-nocore"       "$PLUGIN_DIR" "$WORK/creds-count" "$STARVED_NOCORE" "$FRAME_UNREAD"

# --- half C: the state file itself cannot be written ---------------------------------------
# The writability probe tests the DIRECTORY; the write targets a FILE. A writable directory
# holding an unwritable poll-state.json is the gap, and on the ready branch that write happens
# BEFORE the frame — so under `set -e` the user loses the whole frame to a failed redirection
# and the host still calls the hook a success.
#
# The unwritable file is a DIRECTORY where a file is expected, not a chmod: this rig runs as
# ROOT, and root writes through mode bits. A `chmod 0444` fixture would assert the opposite of
# what it claims and pass for the wrong reason.
make_creds_fixture "$WORK/creds-blocked" ready-count "$POLL_URL"
mkdir -p "$WORK/creds-blocked/state/poll-state.json"
assert_hook "state-file-unwritable" "$PLUGIN_DIR" "$WORK/creds-blocked" "$PATH" "$FRAME_UNREAD"
if [ -d "$WORK/creds-blocked/state/poll-state.json" ]; then
    pass "state-file-unwritable: the blocking directory is still in place — the fixture held for the whole run"
else
    fail "state-file-unwritable: the blocking directory is gone, so the hook was never actually blocked"
fi

probe_exit
