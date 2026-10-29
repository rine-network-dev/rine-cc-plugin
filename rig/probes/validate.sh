#!/usr/bin/env bash
# validate.sh — AUTH-LESS probe. Runs with no Claude credential of any kind.
#
# Asserts:
#   V1  the image's Claude Code binary is the version rig/Dockerfile pins (the tested host),
#       and both READMEs name that version as the one the plugin is tested with
#   V2  the pinned rine CLI is present (the plugin gates every mode on `command -v rine`)
#   V3  `claude plugin validate --strict` is green on the plugin dir
#   V4  `claude plugin validate --strict` is green on the marketplace root
#   V5  every shipped JSON manifest parses
#   V6  every SKILL.md has parseable YAML frontmatter with name + description
#   V7  the mod layout: hooks/hooks.json lists the register.tsx module, plugin.json points at
#       its types file and carries no hooks key, and the old monitors/ and scripts/ are gone
#   V8  `plugin validate --json` lists every hook event the mod registers
#
# Records, without asserting (a measured fact about the host tool): `plugin validate` is a
# MANIFEST linter — it reads no skill and no hooks.json, and does not fail on a SKILL.md whose
# YAML does not parse. V6/V7 exist precisely because V3/V4 do not cover them. Never describe
# V3/V4 as covering plugin contents.

set -uo pipefail
PROBE_NAME="validate"
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
PROBES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The versions this image must carry are read from the tree's own rig/Dockerfile, never from
# the image: a value the image baked in at build time agrees with that image however stale it
# is. The mounted plugin tree always carries rig/Dockerfile, and reading it through PLUGIN_SRC
# lets a mutant tree move the pin.
RIG_DOCKERFILE="$PLUGIN_SRC/rig/Dockerfile"
dockerfile_pin() { sed -n "s/^ARG $1=//p" "$RIG_DOCKERFILE"; }
EXPECT_CC="$(dockerfile_pin CLAUDE_CODE_VERSION)"
EXPECT_CLI="$(dockerfile_pin RINE_CLI_VERSION)"
if [ -z "$EXPECT_CC" ] || [ -z "$EXPECT_CLI" ]; then
    fail "V1/V2 could not read the pin from rig/Dockerfile — every version check loses its subject"
fi
# A mismatch has two causes, and a rebuild fixes only the first: an image built before the pin
# moved, or compose.cc.yml build args that disagree with rig/Dockerfile (they win at build time).
STALE_IMAGE="the image was not built at the tree's pin: rebuild it (docker compose -f compose.cc.yml build); if it still differs, compose.cc.yml's build args disagree with rig/Dockerfile or a lane overrode them on purpose"

# --- V1 -------------------------------------------------------------------------------
CC_VER_RAW="$(claude --version 2>&1)"; CC_VER_RC=$?
info "claude --version → ${CC_VER_RAW}"
if [ "$CC_VER_RC" -ne 0 ]; then
    fail "V1 claude --version exited ${CC_VER_RC}"
elif [ "${CC_VER_RAW%% *}" = "$EXPECT_CC" ]; then
    pass "V1 Claude Code pinned at ${EXPECT_CC}"
else
    fail "V1 Claude Code in this image is '${CC_VER_RAW%% *}', rig/Dockerfile pins ${EXPECT_CC} — ${STALE_IMAGE}"
fi

# Both READMEs tell a reader which Claude Code release the plugin needs, and nothing else binds
# that sentence to the pin: moving the pin without them ships a claim a release behind, which
# reads exactly like a current one. The floor phrase is matched, not the bare version, so a
# longer version number does not satisfy it.
assert_readmes_name V1 "${EXPECT_CC} or newer" "the Claude Code version floor ${EXPECT_CC}"

# --- V2 -------------------------------------------------------------------------------
if ! command -v rine >/dev/null 2>&1; then
    fail "V2 rine CLI absent — the plugin would take its mcp-only branch for every probe; seed-tree-mcp.sh puts this tree's CLI on PATH, and run.sh runs it first"
else
    CLI_VER="$(rine --version 2>&1 | tr -d '[:space:]')"
    info "rine --version → ${CLI_VER}"
    if [ "$CLI_VER" = "$EXPECT_CLI" ]; then
        pass "V2 rine CLI pinned at ${EXPECT_CLI}"
    else
        fail "V2 rine CLI is '${CLI_VER}', expected ${EXPECT_CLI} — the image carries no CLI; seed-tree-mcp.sh installs this tree's rine-cli, so re-run it (a standalone validate.sh run needs the seed first) or move the RINE_CLI_VERSION pin in rig/Dockerfile to the CLI's version"
    fi
fi

# --- V3 / V4 ---------------------------------------------------------------------------
for target_pair in "V3:$PLUGIN_DIR" "V4:$PLUGIN_SRC"; do
    id="${target_pair%%:*}"; target="${target_pair#*:}"
    out="$(claude plugin validate --strict "$target" 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ]; then
        pass "$id plugin validate --strict $target → exit 0"
    else
        fail "$id plugin validate --strict $target → exit $rc :: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
    fi
done

CONTENTS="$(claude plugin validate --strict --json "$PLUGIN_DIR" 2>/dev/null \
    | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("<unparseable>"); raise SystemExit
print(json.dumps(d.get("contents", "<absent>")))' 2>/dev/null || echo '<no --json>')"
info "plugin validate --json .contents → ${CONTENTS}  (manifest linter only; V6/V7 are the real content checks)"

# One reader for every python heredoc that prints PASS/FAIL rows, so the two loops below
# cannot drift apart.
emit_rows() {
    local kind msg
    while IFS=$'\t' read -r kind msg; do
        case "$kind" in
            PASS) pass "$msg" ;;
            FAIL) fail "$msg" ;;
            *)    [ -n "${kind:-}" ] && info "python: ${kind}${msg:+ $msg}" ;;
        esac
    done < "$1"
}

# --- V8 ---------------------------------------------------------------------------------
# `plugin validate --json` reports the hook events the mod registers in contents[].notes[].
# The mod is the only thing that can register them now, so an event missing from that list is
# a mod that silently stopped answering it.
VALIDATE_JSON="$(claude plugin validate --json "$PLUGIN_DIR" 2>/dev/null)"; VJ_RC=$?
if [ "$VJ_RC" -ne 0 ]; then
    fail "V8 plugin validate --json $PLUGIN_DIR → exit $VJ_RC"
else
    printf '%s' "$VALIDATE_JSON" | "$PROBES_DIR/validate-static.py" "$PLUGIN_SRC" events > "$SCRATCH/.validate-v8.out" 2>&1
    [ -s "$SCRATCH/.validate-v8.out" ] || fail "V8 the hook-event checker did not run"
    emit_rows "$SCRATCH/.validate-v8.out"
fi

# --- V5 / V6 / V7 -----------------------------------------------------------------------
"$PROBES_DIR/validate-static.py" "$PLUGIN_SRC" > "$SCRATCH/.validate-py.out" 2>&1
PY_RC=$?
if [ "$PY_RC" -ne 0 ] || [ ! -s "$SCRATCH/.validate-py.out" ]; then
    fail "V5/V6/V7 the manifest+skill checker did not run (exit ${PY_RC}) — no content coverage this run"
fi

emit_rows "$SCRATCH/.validate-py.out"

probe_exit
