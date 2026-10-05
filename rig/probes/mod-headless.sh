#!/usr/bin/env bash
# mod-headless.sh — AUTH-LESS probe. Runs with no Claude credential of any kind.
#
# Loads the plugin headlessly and asserts its hooks module (a "mod") loads. No prompt is ever
# sent, so there is no model call and no "Not logged in" failure: the session is held open by a
# `sleep` on stdin and torn down by `timeout`. Every `claude` call strips the credentials from
# the environment, so each leg stays auth-less even when the container carries a token.
#
#   Leg 1  module load from a scratch copy: the `hooks module rine@inline loaded` line, the
#          event list it advertises, no classic SessionStart hook, no `rine` process spawned,
#          the MCP server connecting, and the skills loading.
#   Leg 2  the tool-name constant in hooks/lib/refs.ts must match the tool names the engine
#          actually reports for the plugin's MCP server, measured with a throwaway module added
#          to the COPY only.
#   Leg 3  the installed sub-leg: a plugin installed from a marketplace loads its module only
#          with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (or a server rollout flag). The second run
#          records which of the two the host reports, as INFO only.

set -uo pipefail
PROBE_NAME="mod-headless"
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PROBES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="$PROBES/fixtures"
WORK="$SCRATCH/mod-headless"
CWD="$WORK/cwd"; CREDS="$WORK/creds"; SHIM="$WORK/shim"; RINE_LOG="$WORK/rine-calls.log"
rm -rf "$WORK"; mkdir -p "$CWD" "$CREDS" "$SHIM"

# run_headless <copy> <debug-log> <hold-seconds> [VAR=value ...]
# An empty <copy> means "no --plugin-dir" (the installed sub-leg). Extra args are env assignments.
run_headless() {
    local copy="$1" log="$2" hold="$3"; shift 3
    local -a pa=()
    [ -n "$copy" ] && pa=(--plugin-dir "$copy")
    ( cd "$CWD" && ( sleep "$hold" ) | timeout 90 \
        env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY "RINE_CONFIG_DIR=$CREDS" "$@" \
        claude -p --input-format stream-json --output-format stream-json --verbose \
        ${pa[@]+"${pa[@]}"} --debug-file "$log" > "$log.out" 2> "$log.err" )
}

# The no-spawn assertion in leg 1 is only worth anything if the instrument can see a spawn, so
# the shim is proved before it is used.
cat > "$SHIM/rine" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$RINE_LOG"
exit 0
EOF
chmod +x "$SHIM/rine"
PATH="$SHIM:$PATH" rine --probe
SHIM_LINES=0
[ -f "$RINE_LOG" ] && SHIM_LINES="$(wc -l < "$RINE_LOG")"
if [ "$SHIM_LINES" = "1" ]; then
    pass "leg1 PATH shim records a rine invocation (the no-spawn assertion has an instrument)"
else
    fail "leg1 the PATH shim is broken (${SHIM_LINES} lines in rine-calls.log, want 1) — the no-spawn assertion would be vacuous"
fi
rm -f "$RINE_LOG"

# --- leg 1: module load -------------------------------------------------------------------
leg1() {
    local copy="$WORK/plugin" log="$WORK/leg1.debug" line events ev
    make_plugin_copy "$copy" --keep-mcp
    run_headless "$copy" "$log" 10 "PATH=$SHIM:$PATH"

    line="$(grep -m1 'hooks module rine@inline loaded' "$log" 2>/dev/null)"
    if [ -n "$line" ]; then
        pass "leg1 hooks module rine@inline loaded"
        events="${line#*events:}"
        for ev in session.start session.end prompt.compose turn.start turn.step turn.complete \
                  tool.call command.run ui.render classic.UserPromptSubmit; do
            case "$events" in
                *"$ev"*) pass "leg1 loaded line advertises $ev" ;;
                *) fail "leg1 loaded line does not advertise $ev" ;;
            esac
        done
    else
        fail "leg1 no 'hooks module rine@inline loaded' line in the debug log — the mod did not load"
        fail "leg1 the loaded line is absent, so its event list cannot be checked"
    fi

    if grep -qE 'Hook SessionStart|Parsed initial response' "$log" 2>/dev/null; then
        fail "leg1 a classic SessionStart hook ran :: $(grep -m1 -E 'Hook SessionStart|Parsed initial response' "$log")"
    else
        pass "leg1 no classic SessionStart hook ran"
    fi

    if [ ! -s "$RINE_LOG" ]; then
        pass "leg1 no rine process was spawned (the mod makes no \$.process call when not interactive)"
    else
        fail "leg1 the mod spawned rine :: $(head -1 "$RINE_LOG")"
    fi

    if grep -qF 'MCP server "plugin:rine:rine": Starting connection' "$log" 2>/dev/null; then
        pass "leg1 MCP server plugin:rine:rine starts a connection"
    else
        fail "leg1 no 'MCP server \"plugin:rine:rine\": Starting connection' line — the MCP server did not start"
    fi

    if grep -qE 'Loaded [0-9]+ skills from plugin rine' "$log" 2>/dev/null; then
        pass "leg1 skills load from plugin rine :: $(grep -m1 -E 'Loaded [0-9]+ skills from plugin rine' "$log")"
    else
        fail "leg1 no 'Loaded N skills from plugin rine' line — the plugin's skills did not load"
    fi
}

# --- leg 2: the tool-name constant ---------------------------------------------------
leg2() {
    local copy="$WORK/plugin-tools" log="$WORK/leg2.debug" tools="$WORK/tools.json"
    make_plugin_copy "$copy" --keep-mcp
    cp "$FIXTURES/rig-tools-probe.tsx" "$copy/hooks/rig-tools-probe.tsx"
    # A plugin names one hooks module: the throwaway REPLACES register.tsx in the copy.
    python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["modules"]=["./rig-tools-probe.tsx"]; json.dump(d,open(p,"w"))' "$copy/hooks/hooks.json"

    run_headless "$copy" "$log" 30 "CC_RIG_TOOLS_OUT=$tools"
    if [ ! -s "$tools" ]; then
        fail "leg2 the throwaway module wrote no tool list to tools.json — the engine's tool names are unmeasured"
        return
    fi

    python3 "$PROBES/tools-check.py" "$tools" "$PLUGIN_DIR/hooks/lib/refs.ts" > "$WORK/leg2.out" 2>&1
    if [ ! -s "$WORK/leg2.out" ]; then
        fail "leg2 the constant checker did not run — no tool-name coverage this run"
    fi
    while IFS=$'\t' read -r kind msg; do
        case "$kind" in
            PASS) pass "$msg" ;;
            FAIL) fail "$msg" ;;
            INFO) info "$msg" ;;
        esac
    done < "$WORK/leg2.out"
}

# --- leg 3: installed sub-leg -------------------------------------------------------------
cleanup() {
    claude plugin uninstall rine@rig-mods-mkt >/dev/null 2>&1 || true
    claude plugin marketplace remove rig-mods-mkt >/dev/null 2>&1 || true
}

leg3() {
    local mkt="$WORK/mkt" log="$WORK/leg3.debug" log2="$WORK/leg3-off.debug" out rc
    cp -r "$PLUGIN_SRC" "$mkt"
    python3 - "$mkt/.claude-plugin/marketplace.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
doc = json.load(open(path))
doc["name"] = "rig-mods-mkt"
json.dump(doc, open(path, "w"), indent=2)
PYEOF
    chmod -R u+w "$mkt"
    trap cleanup EXIT

    out="$(claude plugin marketplace add "$mkt" 2>&1)"; rc=$?
    if [ "$rc" -ne 0 ]; then
        fail "leg3 marketplace add failed (exit ${rc}) :: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
        return
    fi
    out="$(claude plugin install rine@rig-mods-mkt 2>&1)"; rc=$?
    if [ "$rc" -ne 0 ]; then
        fail "leg3 plugin install failed (exit ${rc}) :: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
        return
    fi

    run_headless "" "$log" 10 "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1"
    if grep -q 'hooks module rine@rig-mods-mkt loaded' "$log" 2>/dev/null; then
        pass "leg3 installed plugin loads its module with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1"
    else
        fail "leg3 installed plugin did not load its module even with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1"
    fi

    run_headless "" "$log2" 10
    if grep -q 'rollout flag .* is off' "$log2" 2>/dev/null; then
        info "leg3 without the variable: $(grep -m1 'rollout flag .* is off' "$log2")"
    elif grep -q 'hooks module rine@rig-mods-mkt loaded' "$log2" 2>/dev/null; then
        info "leg3 without the variable: the module still loaded (a server rollout flag is on)"
    else
        info "leg3 without the variable: neither a rollout-flag line nor a module load; hooks module lines: $(grep -m3 'hooks module' "$log2" 2>/dev/null | tr '\n' ' ')"
    fi
}

leg1
leg2
leg3

probe_exit
