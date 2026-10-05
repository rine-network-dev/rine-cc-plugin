#!/usr/bin/env bash
# mutation-proof.sh — proves each auth-less gate can actually go RED. Runs INSIDE the rig.
#
#   docker compose -f compose.cc.yml run --rm --user "$(id -u):$(id -g)" cc /work/rig/mutation-proof.sh
#
# Every mutation is applied to a COPY of the plugin in the scratch volume; the mounted tree is
# read-only and untouched. A gate authored alongside the code it guards is worth nothing until
# it has been shown to fail on a defect — a green probe over a mutant is a hole, not coverage.
#
# control · an unmutated copy is GREEN under mod-test — without it every RED below is meaningless
# M1  e15-slash  · a README advertises a command no skill answers        → must go RED
# M3  validate   · a SKILL.md whose YAML frontmatter does not parse      → must go RED
#                  …while `claude plugin validate --strict` stays GREEN on the same mutant —
#                  a measured fact about the host tool: it lints only the manifest, reads no
#                  skill file, and would not have caught this. Recorded as INFO, asserted as
#                  a fact.
# M4  run.sh     · --require-model with no credential                    → must exit 2
# M6  e15-slash  · a README promises a statusline the plugin no longer   → must go RED
#                  ships (deleted: a plugin settings.json cannot install a working
#                  statusLine on this host)
# M11 validate  · the tree's pin moves: image and both READMEs no longer match → must go RED
# M12-M40 mod-test · one defect per row of the TABLE further down, each
#                  applied by mutate.py → must go RED

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

# --- CONTROL --------------------------------------------------------------------------
# A mutant that is RED proves nothing unless the unmutated copy is GREEN: a plugin that
# cannot even start `claude plugin test` is red for every id below, for no reason at all.
CONTROL="$(mutant control)"
CC_PLUGIN_SRC="$CONTROL" "$PROBES/mod-test.sh" >"$MUT/control.log" 2>&1
control_rc=$?
if [ "$control_rc" -eq 0 ]; then
    pass "control: an unmutated copy of the plugin is GREEN under mod-test"
else
    fail "control: an unmutated copy of the plugin is RED under mod-test — every RED below would prove nothing; skipping the mutants"
    probe_exit
    exit $?
fi

# --- M1 -------------------------------------------------------------------------------
M1="$(mutant m1)"
printf '\nRun `/rine-ghost` to do the thing.\n' >> "$M1/plugins/rine/README.md"
CC_PLUGIN_SRC="$M1" "$PROBES/e15-slash.sh" --authless >"$MUT/m1.log" 2>&1
expect_rc "M1 e15-slash vs an unanswerable /rine-ghost" 1 $?
grep -q 'rine-ghost' "$MUT/m1.log" && pass "M1 names the offending command in its output" \
    || fail "M1 went red without naming /rine-ghost"

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

# --- M6 -------------------------------------------------------------------------------
M6="$(mutant m6)"
printf '\nThe statusline shows your unread count.\n' >> "$M6/plugins/rine/README.md"
CC_PLUGIN_SRC="$M6" "$PROBES/e15-slash.sh" --authless >"$MUT/m6.log" 2>&1
expect_rc "M6 e15-slash vs a README that promises the deleted statusline" 1 $?
grep -q 'promises a settings statusline' "$MUT/m6.log" \
    && pass "M6 names the file and line that carries the false claim" \
    || fail "M6 went red without naming the statusline claim"

# --- M11 ------------------------------------------------------------------------------
M11="$(mutant m11)"
sed -i 's/^ARG CLAUDE_CODE_VERSION=.*/ARG CLAUDE_CODE_VERSION=0.0.0/' "$M11/rig/Dockerfile"
CC_PLUGIN_SRC="$M11" "$PROBES/validate.sh" >"$MUT/m11.log" 2>&1
expect_rc "M11 validate vs an image that is not the tree's pin" 1 $?
grep -q "not built at the tree's pin" "$MUT/m11.log" && [ "$(grep -c 'does not name the Claude Code version floor' "$MUT/m11.log")" -eq 2 ] && pass "M11 names the unbuilt pin and both READMEs' stale version-floor claim" \
    || fail "M11 lacks the pin-mismatch signature or one of the two README rows — the pin binding is unproven"

# --- M12-M40 --------------------------------------------------------------------------
# One function, one table. Each id is applied by mutate.py to its own copy and must take
# mod-test to rc=1 with at least one parsed failing test — a RED run that never started
# (no `mod-test N pass, N fail` line) is a hole, not a catch.
prove() {
    local id="$1" desc="$2" dir rc fail_n
    dir="$(mutant "$(printf '%s' "$id" | tr 'A-Z' 'a-z')")"
    if ! python3 "$HERE/mutate.py" "$dir" "$id" >"$MUT/$id.mutate.log" 2>&1; then
        fail "$id anchor moved — mutate.py could not apply the mutation, so the gate is unproven"
        return
    fi
    CC_PLUGIN_SRC="$dir" "$PROBES/mod-test.sh" >"$MUT/$id.log" 2>&1
    rc=$?
    expect_rc "$id mod-test vs $desc" 1 "$rc"
    fail_n="$(grep -oE 'mod-test [0-9]+ pass, [0-9]+ fail' "$MUT/$id.log" | tail -1 | sed -E 's/.*, ([0-9]+) fail/\1/')"
    if [ -n "$fail_n" ] && [ "$fail_n" -ge 1 ]; then
        pass "$id mod-test went RED with $fail_n failing test(s)"
    else
        fail "$id did not go RED: a gate with no failing test over this defect is a hole"
    fi
}

while IFS='|' read -r id desc; do
    [ -n "$id" ] || continue
    prove "$id" "$desc"
done <<'TABLE'
M12|the supervisor marks a run live before the phase is live
M13|sanitize stops stripping a lone ESC and keeps ESC out of INVISIBLE
M20|sanitize's invisible set narrowed to a hand-written list
M14|an allow-listed sender is woken before the deny check
M15|lease read-back: acquire trusts its own write without reading it back
M16|the verification status check is forced true
M17|the mutating-command guard is disabled
M17b|a guard failure is swallowed instead of reported
M18|the wake rate limit is forced allowed
M19|the backlog intent is dropped
M21|list trust is forced true
M22|turnComplete ignores the agentId filter
M23|a permission downgrade is never reported
M24|the envelope digest is not verified
M25|the wake gate skips the allowlist check, webhook events included
M26|a message from this agent wakes whatever its type
M27|a webhook wake no longer checks the read answered for this agent
M28|the CLI's own lifecycle lines refresh the server-silence clock
M29|the 3 s connected settle publishes live for a run that is already overdue
M30|the 3 s connected settle counts a child as healthy with no server frame
M31|a run that never got a server frame is not dated from its first connected
M32|a CLI connecting line lifts a stale status
M33|the stream argv drops --heartbeat-timeout
M34|a lifecycle line with an unknown state refreshes the server-silence clock
M35|a stale run that never got a server frame loses its start date
M36|Reply no longer closes the inbox before opening the reply pane
M37|a reply pane that does not open leaves the person with no inbox
M38|the pane stops hinting how to get the keyboard
M39|a pane letter collides with the band's Hand to Claude letter
M40|the CLI silence timeout leaves the gap between the stale and dead thresholds
TABLE

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
