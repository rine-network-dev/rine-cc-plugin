#!/usr/bin/env bash
# lib.sh — shared helpers for the contained Claude Code probe rig.
# Sourced by every probe; never run directly.

PLUGIN_SRC="${CC_PLUGIN_SRC:-/work/rine-cc-plugin}"
PLUGIN_DIR="$PLUGIN_SRC/plugins/rine"
SCRATCH="${CC_RIG_SCRATCH:-/work/scratch}"
PROBES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PASS_COUNT=0
FAIL_COUNT=0

pass()  { printf 'PASS  %s\n' "$*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()  { printf 'FAIL  %s\n' "$*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info()  { printf 'INFO  %s\n' "$*"; }
skip()  { printf 'SKIPPED: %s\n' "$*"; }

# Exit contract, shared by every probe and understood by run.sh:
#   0 all green · 1 hard failure · 2 fail-closed (model leg demanded, no credential)
probe_exit() {
    printf -- '---- %s: pass=%d fail=%d\n' "${PROBE_NAME:-probe}" "$PASS_COUNT" "$FAIL_COUNT"
    # A probe that asserted nothing is a RED probe, never a green one. Without this a step
    # that could not even write its evidence file exits 0 and reads as coverage.
    if [ $((PASS_COUNT + FAIL_COUNT)) -eq 0 ]; then
        printf 'FAIL  %s made no assertions at all — treat as RED, not as green\n' "${PROBE_NAME:-probe}"
        return 1
    fi
    if [ "$FAIL_COUNT" -gt 0 ]; then
        return 1
    fi
    return 0
}

# --- credential detection ------------------------------------------------------------
# Presence only. The value is never echoed, never passed on a command line, never logged.
have_cc_credential() {
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]
}

NO_CREDENTIAL_LINE='no CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY in .env.e2e — model-driven probes not run (founder: run `claude setup-token` on a machine with a browser, then add CLAUDE_CODE_OAUTH_TOKEN=<token> to .env.e2e)'

# Fail CLOSED: a caller that explicitly demands the model leg gets a non-zero exit and the
# one-line explanation, never a green run that measured nothing.
require_cc_credential_or_skip() {
    if have_cc_credential; then
        return 0
    fi
    if [ "${CC_RIG_REQUIRE_MODEL:-0}" = "1" ]; then
        printf 'FAIL  model leg required (CC_RIG_REQUIRE_MODEL=1) but %s\n' "$NO_CREDENTIAL_LINE"
        exit 2
    fi
    skip "$NO_CREDENTIAL_LINE"
    return 1
}

# --- plugin copies -------------------------------------------------------------------
# The plugin is mounted read-only. Any probe that mutates it works on a copy in the scratch
# volume. .mcp.json is moved aside in every copy: it would start `npx @rine-network/mcp` on
# each -p invocation, which is a network fetch and a second surface the probe is not testing.
# Open question, not yet resolved: whether a later suite should run WITH .mcp.json active —
# the real plugin ships `npx @rine-network/mcp`, giving a live session ~16 `rine_*` tools
# these probes never see. Skill *resolution* does not depend on that, but skill *behaviour*
# might; disabling it here keeps every probe fast and offline.
make_plugin_copy() {
    local dest="$1"
    rm -rf "$dest"
    mkdir -p "$(dirname "$dest")"
    cp -r "$PLUGIN_DIR" "$dest"
    if [ -f "$dest/.mcp.json" ]; then
        mv "$dest/.mcp.json" "$dest/.mcp.json.disabled"
    fi
    chmod -R u+w "$dest"
}

# --- driving the SessionStart hook ----------------------------------------------------
# Every probe that runs the hook goes through these, so the fixture shape and the `env -i`
# invocation have exactly one definition and no probe can quietly drift from another.

# Branch markers — the OTHER half of the fixture, and the half that couples to product prose.
# One definition for the same reason: a copy edit to session-start.sh's frame text must turn
# every probe red in one place, not in three files under four labels, where the natural repair
# is to edit the first assertion you land on and leave the other two red for an unrelated
# reason. Every marker below is a substring of exactly one branch's frame.
FRAME_READY="Rine is connected"
FRAME_UNREAD="unread rine message(s)"
FRAME_UNREGISTERED="no identity is registered"
FRAME_MCP_ONLY="MCP-only mode"

# start_poll_fixture <docroot> <port> <count> — a loopback endpoint answering {"count":N}.
# Sets POLL_URL and POLL_PID (the caller traps POLL_PID); asserts rather than returns, so it
# cannot be called in a command substitution.
#
# The assertion is the point. Without it a fixture that never bound — a port still held by a
# container from a killed `docker compose run`, which is a documented trap here — makes the
# ready/count>0 assertion fail with "marker absent from additionalContext", which reads as an
# escaping regression in the product. The instrument has to declare itself first.
start_poll_fixture() {
    local docroot="$1" port="$2" count="$3" _
    mkdir -p "$docroot"
    printf '{"count":%s}\n' "$count" > "$docroot/count.json"
    POLL_URL="http://127.0.0.1:$port/count.json"
    python3 -m http.server "$port" --bind 127.0.0.1 -d "$docroot" >/dev/null 2>&1 &
    POLL_PID=$!
    for _ in $(seq 1 40); do
        curl -sf --max-time 1 "$POLL_URL" >/dev/null 2>&1 && break
        sleep 0.25
    done
    if curl -sf --max-time 2 "$POLL_URL" >/dev/null 2>&1; then
        pass "loopback poll endpoint up on 127.0.0.1:${port} (makes the ready/count>0 branch reachable)"
    else
        fail "loopback poll endpoint did not come up on 127.0.0.1:${port} — the ready/count>0 branch is unreachable"
    fi
}

# make_creds_fixture <dir> <kind> [poll-url] — the identity side of a hook branch.
#   ready-count  credentials.json with a poll_url  → session-start.sh's ready/count>0 branch
#   ready-zero   credentials.json, no poll_url     → ready/count=0
#   unregistered an existing dir, no credentials.json
# Synthetic every time: no probe ever points the hook at a real cred dir.
make_creds_fixture() {
    local dir="$1" kind="$2" poll_url="${3:-}"
    mkdir -p "$dir" || return 1
    case "$kind" in
        ready-count)  printf '{"default":{"poll_url":"%s"}}\n' "$poll_url" > "$dir/credentials.json" ;;
        ready-zero)   printf '{"default":{}}\n' > "$dir/credentials.json" ;;
        unregistered) rm -f "$dir/credentials.json" ;;
        *) fail "make_creds_fixture: unknown kind '$kind'"; return 1 ;;
    esac
}

# assert_hook <label> <plugin-root> <config-dir> <path> [marker]
# Runs the hook once and asserts the two things EVERY branch must satisfy: exit 0 (the hook's
# own unconditional contract) and an envelope the host accepts. A marker asserts which branch
# answered — without it a probe aimed at ready/count>0 passes just as happily on ready/count=0.
# `env -i` so nothing of the rig's environment leaks in; the captured stdout is left at
# $HOOK_OUT for a caller that wants to read the frame itself.
assert_hook() {
    local label="$1" root="$2" creds="$3" path="$4" marker="${5:-}"
    local rc msg
    HOOK_OUT="$SCRATCH/hookout/${label//[^A-Za-z0-9_.-]/_}.json"
    mkdir -p "$SCRATCH/hookout" "$SCRATCH/hook-home" "$SCRATCH/hook-cwd"
    # `env -i` does not change the working directory, and resolve-config-dir.sh's last
    # candidate is $PWD/.rine — so a probe run from a directory that happens to hold a real
    # .rine/credentials.json silently measures that identity instead of its own fixture.
    ( cd "$SCRATCH/hook-cwd" \
      && env -i "HOME=$SCRATCH/hook-home" "CLAUDE_PLUGIN_ROOT=$root" \
             "RINE_CONFIG_DIR=$creds" "PATH=$path" \
             /bin/bash "$root/scripts/session-start.sh" ) >"$HOOK_OUT" 2>"$HOOK_OUT.err"
    rc=$?
    if [ "$rc" -ne 0 ]; then
        fail "$label: hook exited $rc — its own contract is exit 0 always :: $(head -1 "$HOOK_OUT.err")"
        return 1
    fi
    msg="$(python3 "$PROBES_DIR/hookshape.py" lint "$HOOK_OUT" \
        "$root/.claude-plugin/plugin.json" "$root/scripts/session-start.sh" \
        ${marker:+"$marker"} 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ]; then
        pass "$label: $msg"
        return 0
    fi
    fail "$label: $msg"
    return 1
}

# hook_context — the decoded additionalContext of the last assert_hook run.
hook_context() {
    python3 "$PROBES_DIR/hookshape.py" context "$HOOK_OUT" 2>/dev/null
}
