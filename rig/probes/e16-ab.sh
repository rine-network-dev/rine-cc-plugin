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
# AUTH-LESS leg (--all, --authless): execute the plugin's OWN, UNMODIFIED SessionStart hook in
#   all four of its emitting branches and lint the envelope it produced. Each branch carries a
#   marker drawn from its own frame text, so a branch that silently answers for another one
#   fails here rather than passing by accident. Nothing is rewritten and nothing probe-shaped
#   is injected into the product: the hook under test is the hook that ships.
#     ready/count>0   needs a poll endpoint → a loopback http.server
#     ready/count=0   credentials with no poll_url
#     unregistered    a config dir with no credentials.json
#     mcp-only        `rine` off PATH
#
# HOSTJUDGE leg (no credential needed): `claude -p` against two copies — the shipped plugin and
#   a copy flattened back to the pre-fix envelope — and read the host's own verdict from its
#   --debug log. The host runs the SessionStart hook and logs whether it accepted the envelope
#   BEFORE it fails on the missing credential, so this leg makes no model call and needs no
#   token; it asserts that the log says so. It runs under an allow-listed environment
#   (`env -i`) with a scratch HOME and config dir, so no credential the rig environment
#   happens to carry and no stored login can reach the host. It keys on DEBUG log wording: when
#   a host release changes that wording the leg goes RED, and the new wording is re-measured,
#   never edited in to match. The copies live under a path that contains a space on purpose:
#   the host runs the manifest's hook command through a shell, and an unquoted plugin-root
#   placeholder splits on that space and never runs the hook.
#
# MODEL leg (only with a credential): `claude -p` against the same two copies. They are
#   distinguished by RINE_CONFIG_DIR content (the unread count is already in the frame), never
#   by an environment variable the shipped hook reads.
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
case "$MODE" in
    --all)       RUN_AUTHLESS=1; RUN_HOSTJUDGE=1; RUN_MODEL=1 ;;
    --authless)  RUN_AUTHLESS=1; RUN_HOSTJUDGE=0; RUN_MODEL=0 ;;
    --hostjudge) RUN_AUTHLESS=0; RUN_HOSTJUDGE=1; RUN_MODEL=0 ;;
    --model)     RUN_AUTHLESS=0; RUN_HOSTJUDGE=0; RUN_MODEL=1 ;;
    *) printf 'usage: e16-ab.sh [--all|--authless|--hostjudge|--model]\n'; exit 1 ;;
esac
WORK="$SCRATCH/e16"
AB="$WORK/plugin root"
POLL_PORT="${CC_RIG_POLL_PORT:-18791}"
# Distinctive so the model leg can tell "the frame reached you" from "you guessed a number".
POLL_COUNT=573

rm -rf "$WORK"; mkdir -p "$WORK"
# Only the auth-less and model legs read the poll endpoint, and the fixture asserts its own
# start-up, so a --hostjudge run leaves it off rather than count a row it never uses. A --model
# run starts it even with no credential: that row keeps a skip-only run from reading as a probe
# that asserted nothing, and the SKIPPED line beside it names the hole.
if (( RUN_AUTHLESS || RUN_MODEL )); then
    start_poll_fixture "$WORK/poll" "$POLL_PORT" "$POLL_COUNT"
    trap 'kill "$POLL_PID" 2>/dev/null' EXIT
    make_creds_fixture "$WORK/creds-count" ready-count "$POLL_URL"
fi
make_creds_fixture "$WORK/creds-zero"  ready-zero
make_creds_fixture "$WORK/creds-empty" unregistered

# build_ab_copies — the shipped plugin and its flattened regression control, under $AB.
build_ab_copies() {
    make_plugin_copy "$AB/fixed"
    make_plugin_copy "$AB/flat"
    if python3 "$HERE/hookshape.py" flatten "$AB/flat/scripts/session-start.sh"; then
        pass "regression control built: a copy whose emit_context writes the pre-fix top-level key"
    else
        fail "could not build the flattened regression control — the host-judged and model legs have no negative control"
    fi
}

# host_judge <copy> <log> — one credential-less `claude -p` whose --debug log carries the
# host's verdict on the copy's envelope. The exit code is always 1 (the missing credential)
# and is deliberately not read: the verdict lives in the log. The environment is an
# allow-list, never the inherited one minus some names — the host has more ways to find a
# credential than any list of names to strip. PATH resolves claude, timeout and rine;
# DISABLE_AUTOUPDATER and CI reproduce the image's own environment. </dev/null skips the
# host's wait for piped stdin.
host_judge() {
    local copy="$1" log="$2"
    mkdir -p "$WORK/cc-home" "$WORK/cc-config"
    ( cd "$WORK" && env -i "PATH=$PATH" "HOME=$WORK/cc-home" \
          "CLAUDE_CONFIG_DIR=$WORK/cc-config" "RINE_CONFIG_DIR=$WORK/creds-zero" \
          DISABLE_AUTOUPDATER=1 CI=true timeout 90 \
          claude -p ping --plugin-dir "$copy" --debug --debug-file "$log" \
          --output-format json >"$log.out" 2>"$log.err" </dev/null )
}
# The host's two verdicts. Acceptance names the hook command as written in the manifest, which
# any plugin using the same script name would log too; it is ours only because host_judge loads
# this one plugin under a scratch HOME and config dir. The rejection names no hook, so any
# top-level key rejected in a session that should have none counts against the shipped envelope.
ACCEPTED='session-start.sh) provided additionalContext'
REJECTED='unrecognized keys (ignored): additionalContext'

# --- auth-less leg ------------------------------------------------------------------------
if (( RUN_AUTHLESS )); then
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

# Built once, and only for a leg that will use them: no copy for a model leg with no credential.
if (( RUN_HOSTJUDGE )) || { (( RUN_MODEL )) && have_cc_credential; }; then
    build_ab_copies
fi

# --- host-judged leg ----------------------------------------------------------------------
if (( RUN_HOSTJUDGE )); then
    for copy in fixed flat; do
        log="$WORK/$copy.hostjudge.log"
        host_judge "$AB/$copy" "$log"
        if grep -qF 'no usable OAuth, WIF, or API key' "$log"; then
            pass "$copy: ran with no credential — no model call was made"
        else
            fail "$copy: host did not log its no-credential line — either it found a credential (this leg must never reach the API) or the wording changed; re-measure"
        fi
        case "$copy" in
            fixed)
                if grep -qF "$ACCEPTED" "$log" && ! grep -qF "$REJECTED" "$log"; then
                    pass "shipped envelope accepted by the host (provided additionalContext), from a path containing a space"
                else
                    fail "shipped envelope: host did not log '$ACCEPTED' with no rejection beside it — re-measure this host's wording before touching the envelope"
                    info "$(grep -m1 -E 'SessionStart\) error|unrecognized keys' "$log" | cut -c1-300)"
                fi ;;
            flat)
                if grep -qF "$ACCEPTED" "$log"; then
                    fail "flattened control: the host accepted the top-level envelope — the two shapes are no longer distinguished; re-measure"
                elif grep -qF "$REJECTED" "$log"; then
                    pass "flattened control rejected by the host ('unrecognized keys (ignored)') — the defect the fix corrects is still detectable"
                else
                    fail "flattened control: host did not log the rejection — the oracle no longer distinguishes the two shapes; re-measure"
                fi ;;
        esac
    done
fi

# --- model leg ----------------------------------------------------------------------------
if (( RUN_MODEL )) && require_cc_credential_or_skip; then
    PROMPT="How many unread rine messages does your context mention? Reply with just the number, or the single word NONE."
    for pair in "fixed:present" "flat:absent"; do
        copy="$AB/${pair%%:*}"; want="${pair##*:}"
        res="$(cd "$WORK" && RINE_CONFIG_DIR="$WORK/creds-count" claude -p "$PROMPT" \
                --model sonnet --plugin-dir "$copy" --disallowedTools Bash --output-format json </dev/null \
              | python3 -c 'import json,sys; print(json.load(sys.stdin).get("result",""))' 2>/dev/null)"
        info "$(basename "$copy") model result: ${res}"
        if [ "$want" = "present" ]; then
            case "$res" in *"$POLL_COUNT"*) pass "shipped envelope: the frame REACHED the model" ;;
                *) fail "shipped envelope: the frame did not reach the model — the nested hookSpecificOutput envelope is not sufficient on this host" ;; esac
        else
            case "$res" in *"$POLL_COUNT"*) fail "flattened control: the top-level envelope reached the model — the regression this control exists to catch would be refuted, re-measure before believing it" ;;
                *) pass "flattened control: the top-level envelope reached the model NOT AT ALL (the defect the fix corrects)" ;; esac
        fi
    done
fi

probe_exit
