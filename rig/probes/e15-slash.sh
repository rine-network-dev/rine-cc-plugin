#!/usr/bin/env bash
# e15-slash.sh — tests that the plugin's advertised slash commands actually resolve,
# container-side. A one-time host measurement settled an open question: the plugin's docs
# advertise `/rine-inbox` and `/rine-setup`, but the plugin ships zero `commands/` files, so
# either the text was wrong or the commands were missing. The measurement found that Claude
# Code exposes each plugin skill as a slash command named after its frontmatter `name` — so
# the five shipped skills ARE the five slash commands, and no `commands/` directory was ever
# needed. This probe keeps that finding reproducible.
#
# AUTH-LESS leg (always runs), two passes over the same three user-facing files:
#   1. derive the command names the host would expose from the skills actually shipped, then
#      check every /rine-… name the plugin advertises against that derived set. A README or
#      hook sentence naming a command with no skill behind it fails here, offline, for free.
#      The set is DERIVED, never a hand-typed list — a renamed skill must not pass by inertia.
#   2. no user-facing text may promise a settings statusline. The plugin ships none: a plugin
#      settings.json cannot install one on this host. The mod's own status line (drawn by the
#      hooks module, not by settings) is a different thing and is fine to mention.
#      Seven sentences promising the badge outlived the feature that never worked, because
#      nothing held either README against what the plugin does. This is that gate.
#
#      Its scan is WIDER than pass 1's: the two READMEs and the hook, plus every shipped
#      SKILL.md and both manifests. Pass 1 needs the narrow list — a /rine-… token in a skill
#      body is prose about a command, not a promise the host must answer — but a statusline
#      sentence is a false claim wherever a user can read it, and a skill description is read
#      by the model at every session. It stops at the package tree: rig infrastructure and
#      phase docs are not user-facing text, and policing them here would turn this probe red
#      on a correct build.
#
# MODEL leg (only with a credential): four -p invocations, classified from the stream-json
#   transcript — /rine-setup, /rine:rine-setup, /rine-inbox (bare form), and an unknown command
#   whose prose-only answer is the baseline (the control) the other three must not look like.
#   --disallowedTools Bash so no probe run can touch a real identity.
#
# ⚠️ The bare form works only "unless another command already uses that name" (CC skills
# docs). It is safe today by prefix luck, not by guarantee; the namespaced /rine:<name> form
# is the collision-proof one. Whether user-facing text should switch to it is a pending
# product decision, not a defect this probe should flag.

set -uo pipefail
PROBE_NAME="e15-slash"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

MODE="${1:---all}"
WORK="$SCRATCH/e15"
rm -rf "$WORK"; mkdir -p "$WORK"

# --- auth-less leg ------------------------------------------------------------------------
if [ "$MODE" != "--model" ]; then
    python3 - "$PLUGIN_SRC" <<'PYEOF' > "$WORK/static.out" 2>&1
import os, re, sys
import yaml

src = sys.argv[1]
plugin = os.path.join(src, "plugins", "rine")
pname = "rine"
lines = []
emit = lambda k, m: lines.append(f"{k}\t{m}")

# Derived command set: a plugin skill's frontmatter `name` replaces the directory name in the
# last segment, giving /<plugin>:<name>, and the bare /<name> resolves too unless taken.
names = set()
skills_dir = os.path.join(plugin, "skills")
for d in sorted(os.listdir(skills_dir)):
    md = os.path.join(skills_dir, d, "SKILL.md")
    if not os.path.isfile(md):
        continue
    text = open(md, encoding="utf-8").read()
    fm = yaml.safe_load(text.split("---", 2)[1]) if text.startswith("---") else {}
    names.add((fm or {}).get("name") or d)
emit("INFO", f"derived skill command names: {sorted(names)}")

# A commands/ directory would add more names. There is none today; if one appears, count it.
cmd_dir = os.path.join(plugin, "commands")
if os.path.isdir(cmd_dir):
    for f in sorted(os.listdir(cmd_dir)):
        if f.endswith(".md"):
            names.add(f[:-3])
    emit("INFO", f"commands/ present, names now: {sorted(names)}")

resolvable = names | {f"{pname}:{n}" for n in names}

# Every /rine-… (or /rine:…) token in user-facing text must be one of them.
targets = [
    os.path.join(src, "README.md"),
    os.path.join(plugin, "README.md"),
]
# A slash command only ever starts a line or follows whitespace/backtick/bracket. Anything
# preceded by another path segment is a URL, not a command: codeberg.org/rine/rine-cc-plugin
# and codeberg.org/rine/rine-mcp both matched a naive /rine\S* and reported five defects that
# do not exist. Narrowed here rather than exempted by name, so a real bad command still fails.
pat = re.compile(r"(?:^|(?<=[\s`(\[]))/(rine[:\w-]*)")
statusline = re.compile(r"statusline|unread badge|\U0001f4ec", re.IGNORECASE)
seen = 0
for path in targets:
    if not os.path.isfile(path):
        continue
    rel = os.path.relpath(path, src)
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        for tok in dict.fromkeys(pat.findall(line)):
            tok = tok.rstrip(".,;:)`\"'")
            if tok in {"rine", "rine-network"} or "/" in tok:
                continue
            seen += 1
            if tok in resolvable:
                emit("PASS", f"E15a {rel}:{i} advertises /{tok} and a shipped skill answers it")
            else:
                emit("FAIL", f"E15a {rel}:{i} advertises /{tok} with nothing behind it "
                             f"(resolvable: {sorted(resolvable)})")
if seen == 0:
    emit("FAIL", "E15a no /rine-… command name found in any user-facing text — the probe lost its subject")

# G1: every shipped file a user or the model can read, not just the three above. The
# statusline was deleted, and the sentences promising it that survived did so in files
# nobody thought to re-read.
sl_targets = targets + [
    os.path.join(plugin, ".claude-plugin", "plugin.json"),
    os.path.join(src, ".claude-plugin", "marketplace.json"),
] + [
    os.path.join(skills_dir, d, "SKILL.md")
    for d in sorted(os.listdir(skills_dir))
    if os.path.isfile(os.path.join(skills_dir, d, "SKILL.md"))
]
sl_hits = 0
scanned = 0
for path in sl_targets:
    if not os.path.isfile(path):
        emit("FAIL", f"G1 {os.path.relpath(path, src)} is missing — the scan lost one of its targets")
        continue
    scanned += 1
    rel = os.path.relpath(path, src)
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        if statusline.search(line):
            sl_hits += 1
            emit("FAIL", f"G1 {rel}:{i} promises a settings statusline; the plugin ships none "
                          "(a plugin settings.json cannot install one on this host)")
emit("INFO", f"G1 scanned {scanned} shipped files for statusline claims")
if scanned < len(sl_targets):
    emit("FAIL", f"G1 scanned {scanned} of {len(sl_targets)} intended files — silence over an unread file is not evidence")
elif sl_hits == 0:
    emit("PASS", f"G1 no statusline claim survives in any of the {scanned} shipped files")
print("\n".join(lines))
PYEOF
    # The static pass IS this leg. Its stdout is redirected to a file, so a python that died on
    # an import or a traceback writes the traceback there and the loop below reads no PASS/FAIL
    # rows at all — which, on a --model run where the other leg asserted something, is a green
    # probe that checked nothing. Same pattern as validate.sh's PY_RC check, for the same
    # reason. (Same file: a crash inside the derivation is also how the derived command set
    # silently becomes empty.)
    PY_RC=$?
    if [ "$PY_RC" -ne 0 ] || [ ! -s "$WORK/static.out" ]; then
        fail "E15a/G1 the static checker did not run (exit ${PY_RC}) — no command or statusline coverage this run"
        info "$(head -20 "$WORK/static.out" 2>/dev/null)"
    fi
    while IFS=$'\t' read -r kind msg; do
        case "$kind" in
            PASS) pass "$msg" ;;
            FAIL) fail "$msg" ;;
            INFO) info "$msg" ;;
        esac
    done < "$WORK/static.out"
fi

# --- model leg ----------------------------------------------------------------------------
if [ "$MODE" != "--authless" ]; then
    if require_cc_credential_or_skip; then
        make_plugin_copy "$WORK/plugin"
        # A command is resolved when the stream shows the skill ran: a tool call, a forked-skill
        # task, or the skill body arriving as a user turn. An unresolved one reaches the model as
        # plain text and is answered in prose, so the stream carries none of the three. (Measured on
        # 2.1.287 and 2.1.280: the host no longer prints a literal "Unknown command: /x" in -p.)
        classify() {
            python3 -c '
import json, sys
hit = False
for line in sys.stdin:
    d = json.loads(line)
    m = d.get("message") if isinstance(d.get("message"), dict) else {}
    parts = m.get("content") if isinstance(m.get("content"), list) else []
    hit = hit or d.get("subtype") == "task_started" or any(
        p.get("type") == "tool_use" or "Base directory for this skill" in str(p.get("text", ""))
        for p in parts if isinstance(p, dict))
print("resolved" if hit else "unresolved")'
        }
        run_cmd() {
            local label="$1" prompt="$2"
            local log="$WORK/${label}.log"
            (cd "$WORK" && claude -p "$prompt" --model sonnet --plugin-dir "$WORK/plugin" \
                --disallowedTools Bash --debug --debug-file "$log" --output-format stream-json --verbose \
                2>"$log.err" </dev/null | classify)
        }
        UNKNOWN="$(run_cmd unknown '/rine-nope-xyz')"
        info "unknown-command baseline classified: ${UNKNOWN}"
        case "$UNKNOWN" in
            unresolved) pass "E15a baseline: an unresolved command is answered in prose, with no skill run" ;;
            *) fail "E15a baseline did not classify as unresolved — every assertion below loses its control" ;;
        esac
        for c in rine-setup rine:rine-setup rine-inbox; do
            out="$(run_cmd "${c//:/_}" "/$c")"
            case "$out" in
                resolved) pass "E15a /$c resolves (the stream shows the skill ran)" ;;
                *) fail "E15a /$c does not resolve (the host treated it as plain text)" ;;
            esac
        done
    fi
fi

probe_exit
