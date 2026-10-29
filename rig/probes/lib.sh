#!/usr/bin/env bash
# lib.sh — shared helpers for the contained Claude Code probe rig.
# Sourced by every probe; never run directly.

PLUGIN_SRC="${CC_PLUGIN_SRC:-/work/rine-cc-plugin}"
PLUGIN_DIR="$PLUGIN_SRC/plugins/rine"
SCRATCH="${CC_RIG_SCRATCH:-/work/scratch}"

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

# --- the shipped READMEs ----------------------------------------------------------------
# assert_readmes_name <label> <needle> <what> — both READMEs must carry <needle>, the text that
# states <what> to a reader who will never run this rig. One definition, so every value bound
# to the READMEs gets the same missing-file and stale-claim handling.
assert_readmes_name() {
    local label="$1" needle="$2" what="$3" readme rel
    if [ -z "$needle" ]; then
        fail "$label has an empty needle, which grep -F matches in every file, so nothing binds $what"
        return
    fi
    for readme in "$PLUGIN_SRC/README.md" "$PLUGIN_DIR/README.md"; do
        rel="${readme#"$PLUGIN_SRC"/}"
        if [ ! -f "$readme" ]; then
            fail "$label $rel is missing, so nothing states $what"
        elif grep -qF -- "$needle" "$readme"; then
            pass "$label $rel names $what"
        else
            fail "$label $rel does not name $what — the shipped claim is stale"
        fi
    done
}

# --- plugin copies -------------------------------------------------------------------
# The plugin is mounted read-only. Any probe that mutates it works on a copy in the scratch
# volume. By default .mcp.json is moved aside in the copy: it would start `npx
# @rine-network/mcp` (this tree's build, seeded by seed-tree-mcp.sh) on each -p invocation, a
# second surface the probe is not testing. Pass --keep-mcp to skip that rename — the headless and e2e legs keep
# the MCP server active; the others do not.
make_plugin_copy() {
    local dest="$1" keep_mcp="${2:-}"
    rm -rf "$dest"
    mkdir -p "$(dirname "$dest")"
    cp -r "$PLUGIN_DIR" "$dest"
    if [ "$keep_mcp" != "--keep-mcp" ] && [ -f "$dest/.mcp.json" ]; then
        mv "$dest/.mcp.json" "$dest/.mcp.json.disabled"
    fi
    chmod -R u+w "$dest"
}
