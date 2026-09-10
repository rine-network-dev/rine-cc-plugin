#!/usr/bin/env bash
# e16-ab.sh — tests that the SessionStart hook's context envelope actually reaches the model,
# container-side. Re-expresses a one-time host A/B measurement as something the rig
# reproduces.
#
# The defect this probe guards against: the hook used to emit a TOP-LEVEL
# {"additionalContext":…}. The host parses that,
# rejects it with a [DEBUG]-level hint and ignores it — while still reporting the hook a
# success, exit 0, nothing on stderr. Every session-start frame the plugin ever wrote reached
# no model at all. The fix moves the value under
# {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":…}}.
#
# AUTH-LESS leg (always runs): execute the plugin's OWN, UNMODIFIED SessionStart hook in all
#   four of its emitting branches and lint the envelope it produced. Each branch carries a
#   marker drawn from its own frame text, so a branch that silently answers for another one
#   fails here rather than passing by accident. Nothing is rewritten and nothing probe-shaped
#   is injected into the product: the hook under test is the hook that ships.
#     ready/count>0   needs a poll endpoint → a loopback http.server
#     ready/count=0   credentials with no poll_url
#     unregistered    a config dir with no credentials.json
#     mcp-only        `rine` off PATH
#
# MODEL leg (only with a credential): `claude -p` against two copies — the shipped plugin and
#   a copy flattened back to the pre-fix envelope. They are distinguished by RINE_CONFIG_DIR
#   content (the unread count is already in the frame), never by an environment variable the
#   shipped hook reads.
#
# The flattened copy is a regression fixture, and the gate that proves this probe can still go
# red on the flattened top-level-envelope shape lives in ../mutation-proof.sh. Never edit an
# assertion to match reality.

set -uo pipefail
PROBE_NAME="e16-ab"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

MODE="${1:---all}"
WORK="$SCRATCH/e16"
POLL_PORT="${CC_RIG_POLL_PORT:-18791}"
# Distinctive so the model leg can tell "the frame reached you" from "you guessed a number".
POLL_COUNT=573

rm -rf "$WORK"; mkdir -p "$WORK"
start_poll_fixture "$WORK/poll" "$POLL_PORT" "$POLL_COUNT"
trap 'kill "$POLL_PID" 2>/dev/null' EXIT

make_creds_fixture "$WORK/creds-count" ready-count "$POLL_URL"
make_creds_fixture "$WORK/creds-zero"  ready-zero
make_creds_fixture "$WORK/creds-empty" unregistered

# --- auth-less leg ------------------------------------------------------------------------
if [ "$MODE" != "--model" ]; then
    assert_hook "ready-count"  "$PLUGIN_DIR" "$WORK/creds-count" "$PATH" \
        "You have $POLL_COUNT $FRAME_UNREAD"
    assert_hook "ready-zero"   "$PLUGIN_DIR" "$WORK/creds-zero"  "$PATH" \
        "$FRAME_READY"
    assert_hook "unregistered" "$PLUGIN_DIR" "$WORK/creds-empty" "$PATH" \
        "$FRAME_UNREGISTERED"
    # `rine` is an npm global in /usr/local/bin, so /usr/bin:/bin is the mcp-only path.
    assert_hook "mcp-only"     "$PLUGIN_DIR" "$WORK/creds-empty" "/usr/bin:/bin" \
        "$FRAME_MCP_ONLY"
fi

# --- model leg ----------------------------------------------------------------------------
if [ "$MODE" != "--authless" ]; then
    if require_cc_credential_or_skip; then
        make_plugin_copy "$WORK/fixed"
        make_plugin_copy "$WORK/flat"
        if python3 "$HERE/hookshape.py" flatten "$WORK/flat/scripts/session-start.sh"; then
            pass "regression control built: a copy whose emit_context writes the pre-fix top-level key"
        else
            fail "could not build the flattened regression control — the model leg has no negative control"
        fi
        PROMPT="How many unread rine messages does your context mention? Reply with just the number, or the single word NONE."
        for pair in "fixed:present" "flat:absent"; do
            copy="$WORK/${pair%%:*}"; want="${pair##*:}"
            log="$WORK/$(basename "$copy").debug.log"
            res="$(cd "$WORK" && RINE_CONFIG_DIR="$WORK/creds-count" claude -p "$PROMPT" \
                    --model sonnet --plugin-dir "$copy" --disallowedTools Bash \
                    --debug --debug-file "$log" --output-format json 2>"$log.err" \
                  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("result",""))' 2>/dev/null)"
            info "$(basename "$copy") model result: ${res}"
            if [ "$want" = "present" ]; then
                case "$res" in *"$POLL_COUNT"*) pass "shipped envelope: the frame REACHED the model" ;;
                    *) fail "shipped envelope: the frame did not reach the model — the nested hookSpecificOutput envelope is not sufficient on this host" ;; esac
                grep -q 'provided additionalContext' "$log" \
                    && pass "shipped envelope: host logged 'provided additionalContext'" \
                    || fail "shipped envelope: host never logged 'provided additionalContext'"
            else
                case "$res" in *"$POLL_COUNT"*) fail "flattened control: the top-level envelope reached the model — the regression this control exists to catch would be refuted, re-measure before believing it" ;;
                    *) pass "flattened control: the top-level envelope reached the model NOT AT ALL (the defect the fix corrects)" ;; esac
                grep -q 'unrecognized keys (ignored): additionalContext' "$log" \
                    && pass "flattened control: host logged the [DEBUG]-level 'unrecognized keys (ignored)' rejection" \
                    || fail "flattened control: host did not log the documented rejection line"
            fi
        done
    fi
fi

probe_exit
