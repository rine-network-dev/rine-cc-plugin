#!/usr/bin/env bash
# cli-version.sh — detect the installed @rine-network/cli version and compare it against the
# version this plugin is tested against.
#
# Sourced by session-start.sh. Three rules the SessionStart hook depends on:
#   1. Both functions return a VALUE and never raise. session-start.sh runs under
#      `set -euo pipefail` and its contract is exit 0 on every path, so a `rine --version` that
#      fails or prints something unexpected must degrade to the literal "unknown" — never take
#      the hook down. That includes the FLOOR constant below: it is compared numerically, so a
#      field of it that is not digits must degrade too, not raise. An unset name inside (( ))
#      is a fatal shell error that `if` does not exempt.
#   2. "unknown" is treated as AT the floor and emits nothing. A per-session nag about a CLI we
#      merely could not parse is worse than silence.
#   3. The version call is BOUNDED. It is the only process this hook spawns, the hook's whole
#      manifest budget is `timeout: 15`, and a `rine` that never returns produces no exit
#      status for `||` to catch — the host kills the hook and the frame reaches nobody. A
#      hang must cost the version sentence, never the frame.
#
# Pure bash: no `tr`, no `sort -V`, no `jq`. Everything on the hook's path has to survive a
# starved PATH, because a missing binary inside a command substitution is an exit code the
# hook cannot afford. `timeout` is the one exception and it is probed, never assumed: without
# it the call falls back to the unbounded form rather than becoming a fourth hard dependency.

# The single place the number lives. TESTED against, not a proven minimum: 0.20.0 is the
# published CLI, the version the host probes measured, and the version the rig pins. Which
# release first shipped the verbs the five skills call has never been bisected — that
# archaeology lives in rine-cli/. Raise this constant when new verbs land.
RINE_CLI_TESTED_FLOOR="0.20.0"

# How long `rine --version` gets. The hook's manifest budget is 15 s and the poll `curl` is
# already bounded at 5 s, so the two together stay inside it with room to spare.
RINE_CLI_VERSION_TIMEOUT=5

# rine_cli_version — echoes "<major>.<minor>.<patch>", or the literal "unknown".
# A prerelease suffix is dropped at the first "-": 0.21.0-rc.1 reads as 0.21.0.
rine_cli_version() {
    local raw ver
    if command -v timeout >/dev/null 2>&1; then
        raw="$(timeout "$RINE_CLI_VERSION_TIMEOUT" rine --version 2>/dev/null)" || raw=""
    else
        raw="$(rine --version 2>/dev/null)" || raw=""
    fi
    raw="${raw//[$' \t\r\n']/}"
    ver="${raw%%-*}"
    if [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        printf '%s' "$ver"
    else
        printf 'unknown'
    fi
}

# rine_cli_below_floor <version> — 0 = below the tested floor · 1 = at or above it, or unknown.
# Numeric on three dot-separated fields; 10# so a zero-padded field is never read as octal.
#
# BOTH sides are reduced to digits before the comparison. `have` arrives regex-validated;
# RINE_CLI_TESTED_FLOOR is validated by nothing, and a field of it that is not pure digits
# makes `10#0-rc` parse as `10#0` minus the NAME `rc` — an unset name inside (( )) is a fatal
# `set -u` error that `if` does not exempt, so the hook would die on the constant this file's
# own comment invites the next session to edit.
rine_cli_below_floor() {
    local ver="$1"
    if [[ "$ver" == "unknown" ]]; then
        return 1
    fi
    local IFS=.
    local -a have want
    # shellcheck disable=SC2206  # deliberate word splitting on IFS=.
    have=($ver)
    # shellcheck disable=SC2206
    want=($RINE_CLI_TESTED_FLOOR)
    local i h w
    for i in 0 1 2; do
        h="${have[i]:-0}"; h="${h%%-*}"; h="${h//[!0-9]/}"
        w="${want[i]:-0}"; w="${w%%-*}"; w="${w//[!0-9]/}"
        if (( 10#${h:-0} < 10#${w:-0} )); then
            return 0
        fi
        if (( 10#${h:-0} > 10#${w:-0} )); then
            return 1
        fi
    done
    return 1
}
