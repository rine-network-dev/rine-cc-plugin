#!/usr/bin/env bash
# mod-test.sh — AUTH-LESS probe. Runs with no Claude credential of any kind.
#
# Runs the plugin's OWN `claude plugin test` suites on a scratch copy of the plugin. The copy
# is what the host reads, so the read-only mount is never mutated and the run is reproducible.
# Credentials are stripped from the environment: `plugin test` must not need a model call.
#
# Asserts:
#   T1  `claude plugin test .` exits 0
#   T2  the summary lines parse (pass / fail / files) — otherwise the run never started
#   T3  0 fail and >0 pass
#   T4  every tests/*.test.ts in the copy is named in the output (a suite that did not run is
#       invisible in the totals, so each file is checked by name)
#   T5  the summary's file count equals the number of tests/*.test.ts in the copy

set -uo pipefail
PROBE_NAME="mod-test"
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

WORK="$SCRATCH/mod-test"
COPY="$WORK/rine"
make_plugin_copy "$COPY"

out="$(cd "$COPY" && env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude plugin test . 2>&1)"; rc=$?
printf '%s\n' "$out" > "$WORK/out.log"
printf '%s\n' "$out" | tail -8 | while IFS= read -r line; do info "mod-test: $line"; done

# --- T1 -----------------------------------------------------------------------------------
if [ "$rc" -eq 0 ]; then
    pass "claude plugin test exited 0"
else
    fail "claude plugin test exited ${rc} :: $(printf '%s\n' "$out" | tail -5 | tr '\n' ' ')"
fi

# --- T2 -----------------------------------------------------------------------------------
# Measured real output ends with: " 131 pass" / " 0 fail" / "Ran 131 tests across 8 files. [3.53s]"
pass_n="$(printf '%s\n' "$out" | grep -E '^ *[0-9]+ pass$' | tail -1 | sed -E 's/^ *([0-9]+) pass$/\1/')"
fail_n="$(printf '%s\n' "$out" | grep -E '^ *[0-9]+ fail$' | tail -1 | sed -E 's/^ *([0-9]+) fail$/\1/')"
files_n="$(printf '%s\n' "$out" | grep -oE 'across [0-9]+ files' | tail -1 | sed -E 's/across ([0-9]+) files/\1/')"
if [ -z "$pass_n" ] || [ -z "$fail_n" ] || [ -z "$files_n" ]; then
    fail "could not read the summary lines: the run did not start"
    probe_exit
fi

# --- T3 -----------------------------------------------------------------------------------
if [ "$fail_n" -eq 0 ] && [ "$pass_n" -gt 0 ]; then
    pass "mod-test ${pass_n} pass, 0 fail across ${files_n} files"
else
    fail "mod-test ${pass_n} pass, ${fail_n} fail across ${files_n} files — want 0 fail and >0 pass"
fi

# --- T4 / T5 ------------------------------------------------------------------------------
shopt -s nullglob
test_files=("$COPY"/tests/*.test.ts)
shopt -u nullglob
if [ "${#test_files[@]}" -eq 0 ]; then
    fail "mod-test the copy ships no tests/*.test.ts files — the file coverage below is vacuous"
fi
for f in ${test_files[@]+"${test_files[@]}"}; do
    base="$(basename "$f")"
    if grep -qF "tests/$base" <<<"$out"; then
        pass "mod-test the run names tests/$base"
    else
        fail "mod-test the run never names tests/$base — that suite did not run"
    fi
done
if [ "$files_n" -eq "${#test_files[@]}" ]; then
    pass "mod-test the summary counts ${files_n} files, matching the ${#test_files[@]} tests/*.test.ts in the copy"
else
    fail "mod-test the summary counts ${files_n} files, but the copy ships ${#test_files[@]} tests/*.test.ts"
fi

probe_exit
