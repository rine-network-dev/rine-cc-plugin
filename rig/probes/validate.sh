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
#   V7  monitors.json entries carry the required name/command/description fields
#
# Records, without asserting (a measured fact about the host tool): `plugin validate`
# reports `"contents": []` — it is a MANIFEST linter. It reads no skill and no monitors.json,
# and it does not fail on a SKILL.md whose YAML does not parse. V6/V7 exist
# precisely because V3/V4 do not cover them. Never describe V3/V4 as covering plugin contents.

set -uo pipefail
PROBE_NAME="validate"
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

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

# Both READMEs tell a reader which Claude Code release the plugin is tested with, and nothing
# else binds that sentence to the pin: moving the pin without them ships a claim a release
# behind, which reads exactly like a current one. The whole sentence is matched, not the bare
# version, so neither another mention of the version nor a longer version number satisfies it.
assert_readmes_name V1 "Tested with Claude Code ${EXPECT_CC}." "the tested Claude Code version ${EXPECT_CC}"

# --- V2 -------------------------------------------------------------------------------
if ! command -v rine >/dev/null 2>&1; then
    fail "V2 rine CLI absent — the plugin would take its mcp-only branch for every probe"
else
    CLI_VER="$(rine --version 2>&1 | tr -d '[:space:]')"
    info "rine --version → ${CLI_VER}"
    if [ "$CLI_VER" = "$EXPECT_CLI" ]; then
        pass "V2 rine CLI pinned at ${EXPECT_CLI}"
    else
        fail "V2 rine CLI is '${CLI_VER}', expected ${EXPECT_CLI} — ${STALE_IMAGE}"
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

# --- V5 / V6 / V7 -----------------------------------------------------------------------
python3 - "$PLUGIN_SRC" <<'PYEOF' > "$SCRATCH/.validate-py.out" 2>&1
import json, os, sys
import yaml

src = sys.argv[1]
plugin = os.path.join(src, "plugins", "rine")
lines = []

def emit(kind, msg):
    lines.append(f"{kind}\t{msg}")

# V5 — every shipped JSON manifest parses.
manifests = [
    os.path.join(src, ".claude-plugin", "marketplace.json"),
    os.path.join(plugin, ".claude-plugin", "plugin.json"),
    os.path.join(plugin, ".mcp.json"),
    os.path.join(plugin, "monitors", "monitors.json"),
]
docs = {}
for path in manifests:
    rel = os.path.relpath(path, src)
    if not os.path.exists(path):
        emit("FAIL", f"V5 missing manifest {rel}")
        continue
    try:
        with open(path) as fh:
            docs[rel] = json.load(fh)
        emit("PASS", f"V5 {rel} parses as JSON")
    except Exception as exc:
        emit("FAIL", f"V5 {rel} does not parse: {exc}")

# V6 — every SKILL.md has parseable YAML frontmatter with name + description.
skills_dir = os.path.join(plugin, "skills")
names = sorted(os.listdir(skills_dir)) if os.path.isdir(skills_dir) else []
if not names:
    emit("FAIL", "V6 no skills directory")
for name in names:
    md = os.path.join(skills_dir, name, "SKILL.md")
    rel = os.path.relpath(md, src)
    if not os.path.isfile(md):
        emit("FAIL", f"V6 {name}/ has no SKILL.md")
        continue
    text = open(md, encoding="utf-8").read()
    if not text.startswith("---"):
        emit("FAIL", f"V6 {rel} has no YAML frontmatter fence")
        continue
    body = text.split("---", 2)
    if len(body) < 3:
        emit("FAIL", f"V6 {rel} frontmatter fence is unterminated")
        continue
    try:
        fm = yaml.safe_load(body[1])
    except Exception as exc:
        emit("FAIL", f"V6 {rel} frontmatter is not valid YAML: {exc}")
        continue
    if not isinstance(fm, dict):
        emit("FAIL", f"V6 {rel} frontmatter is not a mapping")
        continue
    missing = [k for k in ("name", "description") if not fm.get(k)]
    if missing:
        emit("FAIL", f"V6 {rel} frontmatter missing {missing}")
    else:
        emit("PASS", f"V6 {rel} frontmatter ok (name={fm['name']})")

# V7 — monitors.json shape. Required fields per the plugins reference.
mon = docs.get(os.path.join("plugins", "rine", "monitors", "monitors.json"))
if mon is None:
    emit("FAIL", "V7 monitors.json unavailable")
elif not isinstance(mon, list) or not mon:
    emit("FAIL", "V7 monitors.json is not a non-empty array")
else:
    for entry in mon:
        missing = [k for k in ("name", "command", "description") if not entry.get(k)]
        if missing:
            emit("FAIL", f"V7 monitor {entry.get('name', '<unnamed>')} missing {missing}")
        else:
            emit("PASS", f"V7 monitor {entry['name']} has name/command/description")

print("\n".join(lines))
PYEOF
PY_RC=$?
if [ "$PY_RC" -ne 0 ] || [ ! -s "$SCRATCH/.validate-py.out" ]; then
    fail "V5/V6/V7 the manifest+skill checker did not run (exit ${PY_RC}) — no content coverage this run"
fi

while IFS=$'\t' read -r kind msg; do
    case "$kind" in
        PASS) pass "$msg" ;;
        FAIL) fail "$msg" ;;
        *)    [ -n "${kind:-}" ] && info "python: ${kind}${msg:+ $msg}" ;;
    esac
done < "$SCRATCH/.validate-py.out"

probe_exit
