#!/usr/bin/env bash
# mutation-proof.sh — proves each auth-less gate can actually go RED. Runs INSIDE the rig.
#
#   docker compose -f compose.cc.yml run --rm --user "$(id -u):$(id -g)" cc /work/rig/mutation-proof.sh
#
# Every mutation is applied to a COPY of the plugin in the scratch volume; the mounted tree is
# read-only and untouched. A gate authored alongside the code it guards is worth nothing until
# it has been shown to fail on a defect — a green probe over a mutant is a hole, not coverage.
#
# M1  e15-slash  · a README advertises a command no skill answers        → must go RED
# M2  e16-ab     · plugin.json registers a different hook event than the → must go RED
#                  envelope names (proves hookEventName is DERIVED)
# M3  validate   · a SKILL.md whose YAML frontmatter does not parse      → must go RED
#                  …while `claude plugin validate --strict` stays GREEN on the same mutant —
#                  a measured fact about the host tool: it lints only the manifest, reads no
#                  skill file, and would not have caught this. Recorded as INFO, asserted as
#                  a fact.
# M4  run.sh     · --require-model with no credential                    → must exit 2
# M5  e16-ab     · emit_context flattened back to the pre-fix top-level  → must go RED
#                  envelope: the defect that actually shipped. A flat, top-level
#                  `additionalContext` key is silently parsed, rejected and dropped by the
#                  host, which still reports the hook a success — so it passed
#                  `plugin validate --strict` and was invisible in production.
# M6  e15-slash  · a README promises a statusline the plugin no longer   → must go RED
#                  ships (deleted: a plugin settings.json cannot install a working
#                  statusLine on this host)
# M7  cli-floor  · rine_cli_below_floor never reports "below"            → must go RED
#                  (the silent half of a version check is the half that rots)
# M8  hookenv    · emit_context stops escaping the double quote          → must go RED
#                  on the hostile config path, which is where it matters
# M9  hookenv    · emit_context strips control chars with a `tr` pipeline → must go RED
#                  again. Measured exiting the hook 127 under a starved PATH, which breaks the
#                  one contract the hook calls unconditional. This mutant is what stops a
#                  later "tidy-up" from putting the shell-out back.
# M10 e16-ab    · --hostjudge vs an unquoted ${CLAUDE_PLUGIN_ROOT} (a spaced path) → RED
# M11 validate  · the tree's pin moves: image and both READMEs no longer match → must go RED

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBES="$HERE/probes"
# shellcheck source=probes/lib.sh
. "$PROBES/lib.sh"
PROBE_NAME="mutation-proof"

MUT="$SCRATCH/mutants"
rm -rf "$MUT"; mkdir -p "$MUT"

mutant() {
    local name="$1"
    cp -r "$PLUGIN_SRC" "$MUT/$name"
    chmod -R u+w "$MUT/$name"
    printf '%s' "$MUT/$name"
}

expect_rc() {
    local label="$1" want="$2" got="$3"
    if [ "$got" -eq "$want" ]; then
        pass "$label went RED as required (rc=$got)"
    else
        fail "$label did NOT go red (rc=$got, expected $want) — that gate is a hole"
    fi
}

# --- M1 -------------------------------------------------------------------------------
M1="$(mutant m1)"
printf '\nRun `/rine-ghost` to do the thing.\n' >> "$M1/plugins/rine/README.md"
CC_PLUGIN_SRC="$M1" "$PROBES/e15-slash.sh" --authless >"$MUT/m1.log" 2>&1
expect_rc "M1 e15-slash vs an unanswerable /rine-ghost" 1 $?
grep -q 'rine-ghost' "$MUT/m1.log" && pass "M1 names the offending command in its output" \
    || fail "M1 went red without naming /rine-ghost"

# --- M2 -------------------------------------------------------------------------------
M2="$(mutant m2)"
python3 - "$M2/plugins/rine/.claude-plugin/plugin.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["hooks"] = {"PostCompact": d["hooks"].pop("SessionStart")}
json.dump(d, open(p, "w"), indent=2)
PY
CC_PLUGIN_SRC="$M2" "$PROBES/e16-ab.sh" --authless >"$MUT/m2.log" 2>&1
expect_rc "M2 e16-ab vs a hookEventName the manifest does not register" 1 $?
grep -q "is not the event plugin.json registers for session-start.sh" "$MUT/m2.log" \
    && pass "M2 proves hookEventName is checked against the manifest entry that runs this script, not a hardcoded string" \
    || fail "M2 went red for some other reason — the derivation is unproven"

# --- M3 -------------------------------------------------------------------------------
M3="$(mutant m3)"
mkdir -p "$M3/plugins/rine/skills/rine-broken"
printf -- '---\nname: rine-broken\ndescription: [unclosed\n---\nbody\n' \
    > "$M3/plugins/rine/skills/rine-broken/SKILL.md"
CC_PLUGIN_SRC="$M3" "$PROBES/validate.sh" >"$MUT/m3.log" 2>&1
expect_rc "M3 validate vs a SKILL.md with unparseable YAML frontmatter" 1 $?
if claude plugin validate --strict "$M3/plugins/rine" >/dev/null 2>&1; then
    info "M3 the host claude plugin validate --strict is GREEN on the same mutant — reproduces the measured fact that the host validator reads no skill file. V6 is the only thing covering this."
    pass "M3 the host validator's blind spot is reproduced, not assumed"
else
    fail "M3 the host validator rejected the broken skill — the measured fact that it reads no skill file needs re-measuring, the rig's V6 rationale changed"
fi

# --- M5 -------------------------------------------------------------------------------
M5="$(mutant m5)"
python3 "$PROBES/hookshape.py" flatten "$M5/plugins/rine/scripts/session-start.sh" >/dev/null \
    && pass "M5 fixture built: emit_context emits the pre-fix top-level envelope" \
    || fail "M5 fixture could not be built — the flattened-envelope regression gate is unproven"
CC_PLUGIN_SRC="$M5" "$PROBES/e16-ab.sh" --authless >"$MUT/m5.log" 2>&1
expect_rc "M5 e16-ab vs the flattened top-level envelope" 1 $?
grep -q 'top-level additionalContext' "$MUT/m5.log" \
    && pass "M5 names the defect the host silently ignores" \
    || fail "M5 went red for some other reason — the flattened-envelope shape is not what it caught"

# --- M6 -------------------------------------------------------------------------------
M6="$(mutant m6)"
printf '\nThe statusline shows your unread count.\n' >> "$M6/plugins/rine/README.md"
CC_PLUGIN_SRC="$M6" "$PROBES/e15-slash.sh" --authless >"$MUT/m6.log" 2>&1
expect_rc "M6 e15-slash vs a README that promises the deleted statusline" 1 $?
grep -q 'promises a statusline' "$MUT/m6.log" \
    && pass "M6 names the file and line that carries the false claim" \
    || fail "M6 went red without naming the statusline claim"

# --- M7 -------------------------------------------------------------------------------
M7="$(mutant m7)"
python3 - "$M7/plugins/rine/scripts/lib/cli-version.sh" <<'PY'
import sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
old = "        if (( 10#${h:-0} < 10#${w:-0} )); then\n            return 0\n        fi\n"
assert t.count(old) == 1, "cli-version.sh's below-floor arm moved; M7 mutates nothing"
open(p, "w", encoding="utf-8").write(t.replace(old, "", 1))
PY
CC_PLUGIN_SRC="$M7" "$PROBES/cli-floor.sh" >"$MUT/m7.log" 2>&1
expect_rc "M7 cli-floor vs a floor check that never reports 'below'" 1 $?
# Failure-only text. Plain `below-floor` matches the PASS line the unmutated probe prints, so
# it corroborated nothing: it was green whether or not the mutant was caught.
grep -qE '^FAIL[[:space:]]+below-floor: .*absent from additionalContext' "$MUT/m7.log" \
    && pass "M7 names the below-floor case that stopped being announced" \
    || fail "M7 went red for some other reason — the version sentence is unproven"

# --- M8 -------------------------------------------------------------------------------
M8="$(mutant m8)"
python3 - "$M8/plugins/rine/scripts/session-start.sh" <<'PY'
import sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
old = '    msg="${msg//\\"/\\\\\\"}"'
hits = [ln for ln in t.splitlines() if ln.startswith(old)]
assert len(hits) == 1, f"emit_context's quote escape moved; M8 mutates nothing ({len(hits)} hits)"
open(p, "w", encoding="utf-8").write(t.replace(hits[0] + "\n", "", 1))
PY
CC_PLUGIN_SRC="$M8" "$PROBES/hookenv.sh" >"$MUT/m8.log" 2>&1
expect_rc "M8 hookenv vs emit_context without its quote escape" 1 $?
grep -qE 'hostile.*(not JSON|not a JSON object)' "$MUT/m8.log" \
    && pass "M8 caught it on the hostile config path, which is the only place it shows" \
    || fail "M8 went red somewhere other than the hostile path"

# --- M9 -------------------------------------------------------------------------------
M9="$(mutant m9)"
python3 - "$M9/plugins/rine/scripts/session-start.sh" <<'PY'
import sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
hits = [ln for ln in t.splitlines() if ln.strip().startswith('msg="${msg//[$\'\\001\'')]
assert len(hits) == 1, f"emit_context's control strip moved; M9 mutates nothing ({len(hits)} hits)"
shell_out = '    msg="$(printf \'%s\' "$msg" | tr -d \'\\000-\\037\')"'
open(p, "w", encoding="utf-8").write(t.replace(hits[0], shell_out, 1))
PY
CC_PLUGIN_SRC="$M9" "$PROBES/hookenv.sh" >"$MUT/m9.log" 2>&1
expect_rc "M9 hookenv vs a tr pipeline back on the emit path" 1 $?
grep -q 'hook exited 127' "$MUT/m9.log" \
    && pass "M9 shows the exact failure: a starved PATH takes the hook to exit 127, not to exit 0" \
    || fail "M9 went red without the exit-127 signature — the starvation leg is not what caught it"

# --- M10 ------------------------------------------------------------------------------
M10="$(mutant m10)"
sed -i 's/\\"//g' "$M10/plugins/rine/.claude-plugin/plugin.json"
CC_PLUGIN_SRC="$M10" "$PROBES/e16-ab.sh" --hostjudge >"$MUT/m10.log" 2>&1
expect_rc "M10 e16-ab --hostjudge vs an unquoted plugin-root placeholder" 1 $?
grep -q 'SessionStart) error.*not found' "$MUT/m10.log" && pass "M10 shows the host's shell split the spaced path" \
    || fail "M10 went red without the split-path signature — the quoting is not what it caught"

# --- M11 ------------------------------------------------------------------------------
M11="$(mutant m11)"
sed -i 's/^ARG CLAUDE_CODE_VERSION=.*/ARG CLAUDE_CODE_VERSION=0.0.0/' "$M11/rig/Dockerfile"
CC_PLUGIN_SRC="$M11" "$PROBES/validate.sh" >"$MUT/m11.log" 2>&1
expect_rc "M11 validate vs an image that is not the tree's pin" 1 $?
grep -q "not built at the tree's pin" "$MUT/m11.log" && [ "$(grep -c 'does not name the tested Claude Code version' "$MUT/m11.log")" -eq 2 ] && pass "M11 names the unbuilt pin and both READMEs' stale tested-version claim" \
    || fail "M11 lacks the pin-mismatch signature or one of the two README rows — the pin binding is unproven"

# --- M4 -------------------------------------------------------------------------------
if have_cc_credential; then
    info "M4 skipped: a credential is present, so the fail-closed path is not exercisable here"
else
    CC_RIG_REQUIRE_MODEL=1 "$HERE/run.sh" --require-model >"$MUT/m4.log" 2>&1
    expect_rc "M4 run.sh --require-model with no credential" 2 $?
    grep -q 'model set required but no CLAUDE_CODE_OAUTH_TOKEN' "$MUT/m4.log" \
        && pass "M4 fails closed with the one-line explanation" \
        || fail "M4 exited 2 without the explanation line"
fi

probe_exit
