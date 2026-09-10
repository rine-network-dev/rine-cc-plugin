#!/usr/bin/env bash
# session-start.sh — SessionStart hook for the rine CC plugin.
#
# Responsibilities:
#   1. Mode detection (Ready / Unregistered / MCP-only).
#   2. In Ready state: poll for unread count, write state file,
#      return additionalContext with count + toggle instructions.
#   3. In other states: emit a one-time nudge as additionalContext.
#
# Exit 0 always — never break CC.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$PLUGIN_ROOT/scripts/lib/resolve-config-dir.sh"
resolve_config_dir   # sets RINE_DIR, RINE_HAS_CREDS, STATE_DIR, PAUSE_FILE

# The version floor is a NICE-TO-HAVE sentence, so its library is sourced conditionally: an
# unguarded `source` of a file that did not ship exits this hook 1 with no output at all,
# under `set -e`, which is the one thing it must never do. `git add -u` does not stage new
# files, so "did not ship" is a real release accident, not a hypothetical.
HAS_CLI_VERSION_LIB=""
if [[ -r "$PLUGIN_ROOT/scripts/lib/cli-version.sh" ]]; then
    source "$PLUGIN_ROOT/scripts/lib/cli-version.sh"
    HAS_CLI_VERSION_LIB="1"
fi

# emit_context <message> — the ONLY place this hook writes to stdout.
#
# The host parses a top-level {"additionalContext":…}, REJECTS it and ignores it, at [DEBUG]
# level, while still reporting the hook a success. The nested envelope below is the shape it
# accepts. hookEventName is a constant, never a parameter: the hook events are not
# interchangeable and a wrong name is the same silent drop.
#
# Pure bash, no shell-out of any kind. Under `set -euo pipefail` a command substitution here
# takes the unconditional `exit 0` away the moment its binary is off PATH — a `tr` pipeline in
# this helper was measured exiting the hook 127. The escaping is also load-bearing on its own:
# $NOTIFY_NOTE interpolates a filesystem path into a JSON string literal, so a config dir
# holding a quote or a backslash would otherwise emit invalid JSON.
emit_context() {
    local msg="$1"
    local LC_ALL=C                          # byte-ordered ranges for the strip below
    msg="${msg//\\/\\\\}"                   # backslash FIRST
    msg="${msg//\"/\\\"}"                   # then quote
    msg="${msg//$'\t'/\\t}"                 # tab/newline/return are ESCAPED, never dropped:
    msg="${msg//$'\n'/\\n}"                 #   a tab deleted out of a config path names a
    msg="${msg//$'\r'/\\r}"                 #   path that does not exist
    msg="${msg//[$'\001'-$'\037']/}"        # no other raw control char inside a JSON string
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
}

READONLY=""
if mkdir -p "$STATE_DIR" 2>/dev/null \
   && touch "$STATE_DIR/.write-probe" 2>/dev/null; then
    rm -f "$STATE_DIR/.write-probe" 2>/dev/null || true
else
    READONLY="1"
fi

# write_state <json> — poll-state.json, on every branch.
#
# The file is deliberately WRITE-ONLY inside this package: the badge that displayed it has been
# removed, and the harness-owned unread ledger is its next reader. monitor-stream.sh
# reads it solely to increment it. Do not delete these writes as dead code — the ledger seed
# and the monitor's local counter both depend on them.
#
# Never fatal. The READONLY probe above tests the DIRECTORY; the write targets a FILE, and a
# writable directory can hold a file this user cannot write (one earlier run as root is
# enough). On the ready branch this write happens BEFORE the frame is emitted, so under
# `set -e` a failure here would cost the user the whole frame. `printf` is a builtin, so a
# starved PATH cannot reach it either.
write_state() {
    [[ -z "$READONLY" ]] || return 0
    { printf '%s\n' "$1" >"$STATE_DIR/poll-state.json"; } 2>/dev/null || true
    return 0
}

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"

# ---- mode detection ----

HAS_CLI=""
command -v rine >/dev/null 2>&1 && HAS_CLI="1"

if [[ -n "$HAS_CLI" && -n "$RINE_HAS_CREDS" ]]; then
    MODE="ready"
elif [[ -n "$HAS_CLI" && -z "$RINE_HAS_CREDS" ]]; then
    MODE="unregistered"
else
    MODE="mcp-only"
fi

# ---- CLI version floor ----
# One extra sentence when the installed CLI is older than the one this plugin is tested
# against, and nothing at all otherwise — including when the version is unparseable, which is
# not evidence of staleness. Only asked when a CLI exists, so mcp-only costs nothing.

CLI_NOTE=""
if [[ -n "$HAS_CLI" && -n "$HAS_CLI_VERSION_LIB" ]]; then
    CLI_VER="$(rine_cli_version)"
    if rine_cli_below_floor "$CLI_VER"; then
        CLI_NOTE=" The installed rine CLI is $CLI_VER; this plugin is tested against $RINE_CLI_TESTED_FLOOR or newer, so some skills may fail — upgrade with: npm i -g @rine-network/cli"
    fi
fi

# ---- mode-specific behavior ----

case "$MODE" in
    ready)
        POLL_URL=""
        if command -v jq >/dev/null 2>&1; then
            POLL_URL="$(jq -r '.default.poll_url // .poll_url // empty' "$RINE_DIR/credentials.json" 2>/dev/null || true)"
        fi

        # A non-scalar .count pretty-prints over several lines, and the digit filter below
        # would concatenate every digit in that rendering into one fabricated number. The
        # model is told this figure as fact, so anything that is not a JSON number is 0.
        COUNT=0
        if [[ -n "$POLL_URL" ]]; then
            COUNT="$(curl -sf --max-time 5 "$POLL_URL" 2>/dev/null \
                | jq -r 'if (.count | type) == "number" then .count else 0 end' 2>/dev/null || echo 0)"
        fi
        COUNT="${COUNT//[!0-9]/}"
        # Normalise once: a zero-padded "08" is read as OCTAL both in the arithmetic below and
        # by any later reader of the state file, and `[[ 08 -gt 0 ]]` is an error, not a false.
        COUNT="$(( 10#${COUNT:-0} ))"

        write_state "{\"count\":${COUNT},\"updated_at\":\"${NOW}\"}"

        # The pause path is interpolated into prose the model acts on, so it is delimited:
        # a bare path at the end of the sentence runs straight into whatever follows it, and
        # Claude reproduces `touch <path> The installed rine CLI is …` as one argument.
        if [[ -f "$PAUSE_FILE" ]]; then
            NOTIFY_NOTE="Notifications are paused. To resume, run: \`rm $PAUSE_FILE\`."
        else
            NOTIFY_NOTE="Notifications are active. To silence, run: \`touch $PAUSE_FILE\`."
        fi

        if (( COUNT > 0 )); then
            emit_context "You have $COUNT unread rine message(s). The user can type /rine-inbox to triage them, or you can mention it conversationally. $NOTIFY_NOTE$CLI_NOTE"
        else
            emit_context "Rine is connected. $NOTIFY_NOTE$CLI_NOTE"
        fi
        ;;

    unregistered)
        emit_context "Rine CLI is installed but no identity is registered on this machine. You can invoke the rine-setup skill (or the user can type /rine-setup) to onboard — ask the user first, gather email, org name, org slug, and agent name, then drive \`rine onboard --email <email> --name <org-name> --slug <org-slug> --agent-name <agent-name>\` via Bash.$CLI_NOTE"
        write_state "{\"count\":null,\"updated_at\":\"${NOW}\",\"mode\":\"unregistered\"}"
        ;;

    mcp-only)
        emit_context "Rine plugin is in MCP-only mode — tools work on demand, but notifications are disabled because the rine CLI is not installed. Suggest the user install it (\`npm i -g @rine-network/cli\`), then type /rine-setup to register."
        write_state "{\"count\":null,\"updated_at\":\"${NOW}\",\"mode\":\"mcp-only\"}"
        ;;
esac

exit 0
