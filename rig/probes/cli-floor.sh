#!/usr/bin/env bash
# cli-floor.sh — tests the plugin's CLI version-floor check, container-side. AUTH-LESS,
# always runs.
#
# Previously the plugin's CLI detection was a binary presence check (`command -v rine`): an
# old CLI was indistinguishable from a current one. The hook now reads a version and, when it
# is below the version the plugin is TESTED against, adds one sentence to the frame.
#
# The cases below are the whole contract, and most of them assert SILENCE — which is the half
# that is easy to lose. A nag on every session start for a CLI we merely could not parse would
# be worse than saying nothing, so "unknown" is treated as at-floor.
#
#   below-floor              → the sentence, naming the installed version
#   below-floor-unregistered → the same sentence on the day-one onboarding frame
#   at-floor                 → nothing
#   unparseable              → nothing (NOT evidence of staleness)
#   version-command-fails    → nothing (a non-zero `rine --version` is a value, not an exception)
#   slow-version             → nothing, and BOUNDED: the call cannot spend the hook's budget
#   no-rine                  → nothing, and the hook takes its mcp-only branch
#   readmes-name-the-floor   → the two shipped READMEs quote the constant, not a stale copy
#
# Every hook case must exit 0 and emit an envelope the host accepts: a version check that can
# take the SessionStart hook down is worse than no version check.

set -uo pipefail
PROBE_NAME="cli-floor"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

WORK="$SCRATCH/cli-floor"
rm -rf "$WORK"; mkdir -p "$WORK"
make_creds_fixture "$WORK/creds-zero"  ready-zero
make_creds_fixture "$WORK/creds-empty" unregistered

# The floor is read from the product, never retyped here: a probe carrying its own copy of the
# constant would pass over a plugin that had silently changed it.
FLOOR="$(. "$PLUGIN_DIR/scripts/lib/cli-version.sh" && printf '%s' "$RINE_CLI_TESTED_FLOOR")"
if [ -n "$FLOOR" ]; then
    info "RINE_CLI_TESTED_FLOOR read from the plugin: ${FLOOR}"
else
    fail "could not read RINE_CLI_TESTED_FLOOR from the plugin — every case below loses its subject"
fi
SENTENCE="this plugin is tested against ${FLOOR} or newer"

# shim_path <name> <version-output> — a PATH whose only `rine` prints that version string.
shim_path() {
    local name="$1" version="$2"
    local dir="$WORK/shim-$name"
    mkdir -p "$dir"
    printf '#!/bin/sh\nprintf "%%s\\n" "%s"\n' "$version" > "$dir/rine"
    chmod +x "$dir/rine"
    printf '%s' "$dir:/usr/bin:/bin"
}

# assert_silent <label> — the frame must carry no version sentence at all.
#
# Two ways this assertion can lie, both closed here:
#   · an EMPTY context passes every "does not contain" test. hook_context prints nothing when
#     the frame did not parse, so a hook that emitted nothing at all would read as well-behaved
#     silence. An empty frame is a failure, never silence.
#   · a needle that no longer appears in ANY frame makes every silence case vacuously green.
#     The needle is $SENTENCE, and the below-floor case above proves it live before any silence
#     case runs; if that proof did not happen, the silence cases say so instead of passing.
NEEDLE_PROVEN=""
assert_silent() {
    local label="$1" ctx
    ctx="$(hook_context)"
    if [ -z "${ctx//[[:space:]]/}" ]; then
        fail "$label: the frame is empty — that is a broken hook, not silence"
        return 1
    fi
    if [ -z "$NEEDLE_PROVEN" ]; then
        fail "$label: the version sentence was never observed in any frame, so 'absent' proves nothing"
        return 1
    fi
    case "$ctx" in
        *"$SENTENCE"*) fail "$label: the frame nags about the CLI version when it must stay silent" ;;
        *) pass "$label: no version sentence in the frame" ;;
    esac
}

# --- below the floor: exactly one added sentence, naming the installed version -------------
OLD="0.0.1"
if assert_hook "below-floor" "$PLUGIN_DIR" "$WORK/creds-zero" "$(shim_path old "$OLD")" \
    "The installed rine CLI is ${OLD}; ${SENTENCE}"; then
    NEEDLE_PROVEN="1"
fi

# The same sentence rides the unregistered frame, which is the day-one onboarding state.
assert_hook "below-floor-unregistered" "$PLUGIN_DIR" "$WORK/creds-empty" \
    "$(shim_path old "$OLD")" "The installed rine CLI is ${OLD}; ${SENTENCE}"

# --- at the floor, unparseable, and absent: silence ----------------------------------------
assert_hook "at-floor" "$PLUGIN_DIR" "$WORK/creds-zero" "$(shim_path cur "$FLOOR")" \
    "$FRAME_READY"
assert_silent "at-floor"

assert_hook "unparseable" "$PLUGIN_DIR" "$WORK/creds-zero" \
    "$(shim_path odd 'rine-cli build 42')" "$FRAME_READY"
assert_silent "unparseable"

# A `rine` that exits non-zero is the same class: a value, never an exception.
assert_hook "version-command-fails" "$PLUGIN_DIR" "$WORK/creds-zero" \
    "$(mkdir -p "$WORK/shim-broken" \
       && printf '#!/bin/sh\nexit 3\n' > "$WORK/shim-broken/rine" \
       && chmod +x "$WORK/shim-broken/rine" \
       && printf '%s' "$WORK/shim-broken:/usr/bin:/bin")" "$FRAME_READY"
assert_silent "version-command-fails"

# --- a `rine` that hangs must not spend the hook's budget ----------------------------------
# The host gives the SessionStart hook a bounded window (15s in plugin.json). An unbounded
# `rine --version` inside it turns one wedged binary into a session-start that never answers,
# and the hook's exit-0 contract cannot save it. The bound belongs to the library, so this
# asserts WALL CLOCK, not the presence of a flag.
mkdir -p "$WORK/shim-slow"
printf '#!/bin/sh\nsleep 30\n' > "$WORK/shim-slow/rine"
chmod +x "$WORK/shim-slow/rine"
SLOW_START="$(date +%s)"
assert_hook "slow-version" "$PLUGIN_DIR" "$WORK/creds-zero" \
    "$WORK/shim-slow:/usr/bin:/bin" "$FRAME_READY"
SLOW_ELAPSED=$(( $(date +%s) - SLOW_START ))
if [ "$SLOW_ELAPSED" -lt 15 ]; then
    pass "slow-version: a hung \`rine --version\` was bounded (${SLOW_ELAPSED}s, hook budget is 15s)"
else
    fail "slow-version: the hook spent ${SLOW_ELAPSED}s on a hung \`rine --version\` — its 15s budget is gone"
fi
assert_silent "slow-version"

assert_hook "no-rine" "$PLUGIN_DIR" "$WORK/creds-empty" "/usr/bin:/bin" "$FRAME_MCP_ONLY"
assert_silent "no-rine"

# --- the shipped prose quotes the constant --------------------------------------------------
# Both READMEs state the floor to a reader who will never run this rig, and nothing else binds
# them to it: raising RINE_CLI_TESTED_FLOOR without touching them ships a documented floor that
# is a release behind, which is indistinguishable from a correct one until a user hits it.
assert_readmes_name cli-floor "**${FLOOR}** or newer" "the tested rine CLI floor RINE_CLI_TESTED_FLOOR (${FLOOR})"

probe_exit
