#!/usr/bin/env bash
# run.sh — the contained Claude Code probe battery. Runs INSIDE the rig only.
#
#   docker compose -f compose.cc.yml run --rm --user "$(id -u):$(id -g)" cc /work/rig/run.sh
#
# The auth-less set always runs. The model-driven set runs only when a Claude credential is
# present in the environment (from .env.e2e, by name); otherwise it is a NAMED SKIP printed in
# the summary — never a silent pass. `--require-model` (or CC_RIG_REQUIRE_MODEL=1) turns the
# absent credential into a non-zero exit with the same one-line explanation: fail closed.
#
# Exit: 0 all green · 1 a hard failure · 2 model set demanded without a credential

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBES="$HERE/probes"
# shellcheck source=probes/lib.sh
. "$PROBES/lib.sh"

for arg in "$@"; do
    case "$arg" in
        --require-model) export CC_RIG_REQUIRE_MODEL=1 ;;
        --authless-only) export CC_RIG_AUTHLESS_ONLY=1 ;;
        *) printf 'usage: run.sh [--require-model] [--authless-only]\n'; exit 2 ;;
    esac
done

printf '=== rine Claude Code rig ===\n'
printf 'claude       %s\n' "$(claude --version 2>&1)"
printf 'HOME         %s\n' "$HOME"
printf 'plugin (ro)  %s\n' "$PLUGIN_SRC"
printf 'creds        %s (%s entries)\n' "${RINE_CONFIG_DIR:-<unset>}" \
    "$(ls -A "${RINE_CONFIG_DIR:-/nonexistent}" 2>/dev/null | wc -l)"
if have_cc_credential; then
    printf 'credential   present (name only; value never read or printed)\n'
else
    printf 'credential   absent\n'
fi
printf '\n'

# Severity, not magnitude. `rc` is not an ordered scale: 2 is the fail-closed signal (the model
# set was demanded and no credential exists) and 1 is a hard failure, so taking the numeric max
# reported a RED battery as "no credential" — the one verdict a reader acts on by fetching a
# token instead of reading the failure. Rank first, map back to an exit code last.
#   rank 0 = green · rank 1 = fail-closed (exit 2) · rank 2 = hard failure (exit 1)
WORST_RANK=0
rank_of() {
    case "$1" in
        0) printf 0 ;;
        2) printf 1 ;;
        *) printf 2 ;;
    esac
}
note_rc() {
    local r
    r="$(rank_of "$1")"
    if [ "$r" -gt "$WORST_RANK" ]; then
        WORST_RANK="$r"
    fi
    return 0
}

# The probes load the plugin's shipped .mcp.json, which pins a published rine-mcp. Resolve that
# pin to this tree's build first, or the legs measure the release (or fail on an unreleased pin).
printf -- '--- seed · this tree'"'"'s rine-mcp\n'
if ! "$HERE/seed-tree-mcp.sh"; then
    printf '=== VERDICT: RED (this tree'"'"'s rine-mcp could not be seeded) ===\n'
    exit 1
fi
printf 'rine CLI     %s (this tree'"'"'s, seeded above)\n\n' "$(rine --version 2>&1 | tr -d '[:space:]')"

LEG_LOGS="$SCRATCH/legs"
rm -rf "$LEG_LOGS"; mkdir -p "$LEG_LOGS"
SKIP_TOTAL=0

AUTHLESS_RESULTS=()
run_leg() {
    local label="$1"; shift
    local slug="${label//[^A-Za-z0-9]/_}"
    local log="$LEG_LOGS/$slug.log"
    printf -- '--- %s\n' "$label"
    # tee, so the leg still streams live AND its named skips can be counted. rc comes from
    # PIPESTATUS: the pipeline's own status is tee's.
    "$@" 2>&1 | tee "$log"
    local rc=${PIPESTATUS[0]}
    # A named SKIP is coverage this run does not have, and it is invisible in a per-leg rc=0.
    # Surfacing it in the summary is the difference between "12 green" and "12 green, 3 of them
    # measuring nothing".
    # Both spellings: lib.sh's skip() prints "SKIPPED:"; a leg that does not source lib.sh may
    # print "SKIP:".
    local skips
    skips="$(grep -cE '^(SKIPPED|SKIP):' "$log" 2>/dev/null || true)"
    skips="${skips//[!0-9]/}"
    skips="${skips:-0}"
    SKIP_TOTAL=$(( SKIP_TOTAL + skips ))
    if [ "$skips" -gt 0 ]; then
        AUTHLESS_RESULTS+=("$label rc=$rc ($skips SKIPPED — coverage this run does not have)")
    else
        AUTHLESS_RESULTS+=("$label rc=$rc")
    fi
    note_rc "$rc"
    printf '\n'
}

run_leg "auth-less · validate"  "$PROBES/validate.sh"
run_leg "auth-less · e15-slash" "$PROBES/e15-slash.sh" --authless
run_leg "auth-less · mod-test" "$PROBES/mod-test.sh"
run_leg "auth-less · mod-headless" "$PROBES/mod-headless.sh"
run_leg "auth-less · old-cc-load" "$PROBES/old-cc-load.sh"

if [ "${CC_RIG_AUTHLESS_ONLY:-0}" = "1" ]; then
    printf -- '--- model-driven set\nSKIPPED: --authless-only requested\n\n'
elif have_cc_credential; then
    run_leg "model · e15-slash" "$PROBES/e15-slash.sh" --model
else
    printf -- '--- model-driven set\n'
    if [ "${CC_RIG_REQUIRE_MODEL:-0}" = "1" ]; then
        printf 'FAIL  model set required but %s\n\n' "$NO_CREDENTIAL_LINE"
        printf '=== VERDICT: RED (fail-closed, no credential) ===\n'
        exit 2
    fi
    printf 'SKIPPED: %s\n\n' "$NO_CREDENTIAL_LINE"
    AUTHLESS_RESULTS+=("model set SKIPPED (no credential)")
fi

printf '=== summary ===\n'
for line in "${AUTHLESS_RESULTS[@]}"; do printf '  %s\n' "$line"; done
if [ "$SKIP_TOTAL" -gt 0 ]; then
    printf '  %s named skip(s) across the battery — read them; a SKIPPED leg is a hole, not a pass\n' "$SKIP_TOTAL"
fi
case "$WORST_RANK" in
    0) printf '=== VERDICT: GREEN ===\n'; exit 0 ;;
    1) printf '=== VERDICT: RED (fail-closed, no credential) ===\n'; exit 2 ;;
    *) printf '=== VERDICT: RED ===\n'; exit 1 ;;
esac
