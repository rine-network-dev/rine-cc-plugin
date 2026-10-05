#!/usr/bin/env bash
# old-cc-load.sh — AUTH-LESS probe. Runs with no Claude credential of any kind.
#
# Proves the 0.4.0 tree still loads on a Claude Code release that PREDATES the hooks-module
# API: such a release must load the skills and the MCP server and skip only the module. The
# old release is installed side-by-side in the image at $CC_OLD_CLAUDE (2.1.280). This leg
# never runs `plugin validate`: the 2.1.280 validator rejects shapes 2.1.287 accepts, so a
# validate failure here would say nothing about whether the plugin loads.
# Asserts: O1 the old binary ran (non-empty debug log); O2 its --version is older than 2.1.287; O3 no manifest/plugin.json error in the debug log;
# O4 the log loaded N skills from plugin rine, N = the copy's skills/ dirs and N > 0;
# O5 the debug log shows plugin:rine:rine connected; O6 the log says the hooks
# module was NOT loaded (skipped, not crashed).

set -uo pipefail
PROBE_NAME="old-cc-load"
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [ -z "${CC_OLD_CLAUDE:-}" ] || [ ! -x "$CC_OLD_CLAUDE" ]; then
    fail "old Claude Code is not in this image (CC_OLD_CLAUDE): rebuild the rig image"
    probe_exit
fi

WORK="$SCRATCH/old-cc"
COPY="$WORK/plugin"; CONFIG="$WORK/config"; CWD="$WORK/cwd"; CREDS="$WORK/creds"
LOG="$WORK/debug.log"; OUT="$WORK/out.jsonl"
rm -rf "$WORK"; mkdir -p "$CONFIG" "$CWD" "$CREDS"
make_plugin_copy "$COPY" --keep-mcp

# No model call: the stream-json stdin is held open for 14 s with no prompt, and `timeout`
# tears the session down. Credentials are stripped so the leg stays auth-less.
( cd "$CWD" && ( sleep 14 ) | timeout 90 \
    env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY \
        "CLAUDE_CONFIG_DIR=$CONFIG" "RINE_CONFIG_DIR=$CREDS" \
        "$CC_OLD_CLAUDE" -p --input-format stream-json --output-format stream-json --verbose \
        --plugin-dir "$COPY" --debug-file "$LOG" > "$OUT" 2> "$WORK/err.log" )

EXPECT_VER="$("$CC_OLD_CLAUDE" --version 2>&1 | awk '{print $1}')"
info "old Claude Code: $CC_OLD_CLAUDE → ${EXPECT_VER}"

# --- O1 / O2: the binary under test is the old one ----------------------------------------
# stream-json emits no init line until a prompt arrives, so the version comes from the binary.
if [ -s "$LOG" ]; then
    pass "O1 the old binary ran and wrote a debug log"
else
    fail "O1 the debug log is empty — the old binary produced no session"
fi
if [ "$(printf '%s\n2.1.287\n' "$EXPECT_VER" | sort -V | head -1)" = "$EXPECT_VER" ] && [ "$EXPECT_VER" != "2.1.287" ]; then
    pass "O2 ${EXPECT_VER} predates the hooks-module API (2.1.287)"
else
    fail "O2 ${EXPECT_VER} is not older than 2.1.287 — this leg is not testing an old host"
fi
# --- O5: the MCP server connects ------------------------------------------------------------
if grep -qE 'MCP server "plugin:rine:rine": Successfully connected' "$LOG"; then
    pass "O5 MCP server plugin:rine:rine connected on the old host"
else
    fail "O5 the debug log never shows plugin:rine:rine connecting (npx needs network the first time)"
fi

# --- O3: no manifest error ----------------------------------------------------------------
MANIFEST_ERR="$(grep -m1 -iE '(manifest|plugin\.json).*(error|invalid)' "$LOG" 2>/dev/null)"
if [ -n "$MANIFEST_ERR" ]; then
    fail "O3 the debug log reports a manifest error :: ${MANIFEST_ERR}"
else
    pass "O3 no manifest/plugin.json error in the debug log"
fi

# --- O4: skills loaded --------------------------------------------------------------------
SKILL_DIRS=0
for d in "$COPY"/skills/*/; do [ -d "$d" ] && SKILL_DIRS=$((SKILL_DIRS + 1)); done
SKILL_LINE="$(grep -oE 'Loaded [0-9]+ skills from plugin rine' "$LOG" 2>/dev/null | tail -1)"
SKILL_N="$(printf '%s' "$SKILL_LINE" | sed -E 's/Loaded ([0-9]+) skills.*/\1/')"
if [ -z "$SKILL_LINE" ]; then
    fail "O4 no 'Loaded N skills from plugin rine' line in the debug log — the old host loaded no skills"
elif [ "$SKILL_N" -eq "$SKILL_DIRS" ] && [ "$SKILL_N" -gt 0 ]; then
    pass "O4 the old host loaded ${SKILL_N} skills from plugin rine, matching the ${SKILL_DIRS} skills/ dirs in the copy"
else
    fail "O4 the debug log loaded ${SKILL_N} skills, but the copy ships ${SKILL_DIRS} skills/ dirs (want equal and >0)"
fi
# --- O6: the module is skipped, not crashed -----------------------------------------------
if grep -qE 'hooks module rine@inline not loaded' "$LOG" 2>/dev/null; then
    pass "O6 the old host skipped the hooks module (hooks module rine@inline not loaded)"
else
    fail "O6 no 'hooks module rine@inline not loaded' line — the old host did not skip the module cleanly"
fi

probe_exit
