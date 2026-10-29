#!/usr/bin/env bash
# spike-client-keys.sh — the org-tab client-surface spike. A MEASUREMENT, not a regression gate: it drives
# a real interactive `claude` (the rig's pinned build) through tmux and records what a `Client`
# surface module and a second plugin can and cannot see. Not part of run.sh or ci.sh.
#
# Runs on the HOST, like rig/e2e-interactive.sh: it starts the rig container detached under its
# own compose project (rine-cc-spike, so the e2e's volumes and containers are never touched) and
# drives tmux through `docker exec`. The credential reaches the container through compose's
# env_file BY NAME; only its presence is probed, inside the container.
#
#   rig/probes/spike-client-keys.sh
#
# Output: PASS = a measurement was obtained, FAIL = the instrument broke, FINDING = the result.
# Exit: 0 every measurement obtained · 1 an instrument failed · 2 no credential (fail closed)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PROBE_NAME=spike-client-keys
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck source=e2e-lib.sh
. "$HERE/e2e-lib.sh"

COMPOSE="docker compose -p rine-cc-spike -f $ROOT/compose.cc.yml"
CNAME=rine-cc-spike-cc
WORK=/work/scratch/spike
PROJ=$WORK/proj
OUTD=$WORK/out
EVF=$OUTD/events.json
OBSF=$OUTD/observer.json
TM=spike
DEBUG_LOG=$OUTD/debug.log
# Strings the subject builds at run time (the source never holds them); the driver greps for them.
PROP_MARK=PROPMARK4417
SPAWN_MARK=SPAWNOUT9082

finding() { printf 'FINDING  %s\n' "$*"; }
die() { fail "$1"; probe_exit; exit 1; }

teardown() {
    session_stop "$TM"
    docker rm -f "$CNAME" >/dev/null 2>&1 || true
    $COMPOSE down -v >/dev/null 2>&1 || true
}
trap teardown EXIT

# --- the container and the credential, by name -------------------------------------------------
docker rm -f "$CNAME" >/dev/null 2>&1 || true
$COMPOSE run -d --name "$CNAME" --user "$(id -u):$(id -g)" cc sleep infinity >/dev/null \
    || die "the rig container did not start"
if ! cx sh -c '[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]'; then
    printf 'FAIL  model leg required but %s\n' "$NO_CREDENTIAL_LINE"
    exit 2
fi
CC_VERSION="$(cx claude --version)" || die "claude --version failed in the rig"
finding "rig Claude Code: ${CC_VERSION%% *}"

cx sh -c "rm -rf $WORK && mkdir -p $PROJ $OUTD && cp -r /work/rig/probes/fixtures/spike-client/. $WORK/" \
    || die "the fixtures could not be copied into the scratch volume"
# Seed claude's config so no onboarding or trust dialog appears.
cx node -e '
const fs = require("fs");
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
const p = process.env.CLAUDE_CONFIG_DIR + "/.claude.json";
let d = {};
try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { d = {}; }
d.hasCompletedOnboarding = true;
d.theme = "dark";
d.projects = d.projects || {};
d.projects[process.argv[1]] = Object.assign({}, d.projects[process.argv[1]],
    { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
fs.writeFileSync(p, JSON.stringify(d));
' "$PROJ" || die "claude's config could not be seeded"

# --- helpers ---------------------------------------------------------------------------------------
# start_session DIR... — a REPL with those plugin dirs, in that order; 1 if it never shows.
start_session() {
    local dirs="" d
    for d in "$@"; do dirs="$dirs --plugin-dir $WORK/$d"; done
    cx rm -f "$EVF" "$OBSF" "$DEBUG_LOG"
    cx tmux new-session -d -s "$TM" -x 200 -y 50 -c "$PROJ" \
        "env SPIKE_OUT=$EVF SPIKE_OBS_OUT=$OBSF claude$dirs --debug-file $DEBUG_LOG"
    wait_screen 'shortcuts|Claude Code' 60
}

# open_pane — /spike, then wait for the pane's first drawing.
open_pane() {
    sleep 3
    tm_cmd '/spike'
    wait_screen 'SPIKE MEM=' 30
}

# ev_count — how many posts the subject's ui.message hook has recorded.
ev_count() {
    cx python3 -c 'import json,sys
try: print(len(json.load(open(sys.argv[1]))))
except Exception: print(0)' "$EVF"
}

# ev_last — the newest recorded post as one JSON line, or nothing.
ev_last() {
    cx python3 -c 'import json,sys
try: print(json.dumps(json.load(open(sys.argv[1]))[-1]))
except Exception: pass' "$EVF"
}

# click_client — a click on the Client region, the one documented way to give it the keys.
click_client() {
    click_pos 'CLIENT keys=' || { fail "no CLIENT row on the pane to click"; return 1; }
    sleep 0.5
}

# arrived BEFORE — the newest recorded post when it is newer than BEFORE posts, within 2.4 s.
arrived() {
    local i
    for i in 1 2 3 4 5 6; do
        sleep 0.4
        [ "$(ev_count)" -gt "$1" ] && { ev_last; return 0; }
    done
    return 1
}

# probe_key TMUX_ARGS... — send one key to whatever holds the focus; report whether a post
# arrived and what it carried. 0 when it arrived.
probe_key() {
    local before got
    before="$(ev_count)"
    tm_key "$@"
    if got="$(arrived "$before")"; then
        finding "key $* arrived as $got"
    else
        finding "key $* did not arrive at the Client"
        return 1
    fi
}

# send_key TMUX_ARGS... — click the Client (the documented way to give it the focus), then
# probe_key. A key that does not arrive is followed by a plain `j` with no click, which says
# whether that key took the focus away.
send_key() {
    click_client || return
    probe_key "$@" && return
    probe_key j >/dev/null && finding "  ... the Client kept the focus after $*" || finding "  ... the focus was lost after $*"
}

# screen_field REGEX — the first capture group of REGEX on the pane, or nothing.
screen_field() {
    tm_screen | grep -Eo "$1" | head -1
}

# screen_value REGEX — the text after the last = of the first match of REGEX.
screen_value() {
    screen_field "$1" | sed -E 's/^.*=//'
}

# --- the ui.fault hook: does this build accept it? (auth-less) ---------------------------------
cx sh -c "mkdir -p $WORK/fault/.claude-plugin $WORK/fault/hooks && cd $WORK/fault \
  && echo '{\"name\":\"spike-fault\",\"version\":\"0.0.1\",\"description\":\"client-surface spike\"}' > .claude-plugin/plugin.json \
  && echo '{\"modules\":[\"./register.tsx\"]}' > hooks/hooks.json \
  && printf '%s\n' \"import type { Register } from 'claude-code'\" \"export const register: Register = (on) => { on('ui.fault', async (_\$, e, next) => next(e)) }\" > hooks/register.tsx"
finding "a hooks module hooking ui.fault under ${CC_VERSION%% *}: $(cx claude plugin validate $WORK/fault 2>&1 | grep -E '✘|✔|❯' | head -4 | cut -c1-160 | tr '\n' '|')"

# --- leg 1: the Client surface exists, and keys without a click ---------------------------
start_session subject || die "claude REPL did not start"
pass "REPL started with the subject plugin"
if open_pane; then
    pass "the pane drew; the Client surface module loaded"
    if wait_screen 'CLIENT keys=0' 10; then
        finding "the Client surface exists in ${CC_VERSION%% *}: the module drew, props arrived (marker $(screen_field "marker=$PROP_MARK" | cut -c1-6)...), region $(screen_field 'size=[0-9]+x[0-9]+')"
    else
        finding "the pane drew but the Client region did not: tail $(last_screen_tail)"
    fi
else
    fail "the /spike pane never drew: tail $(last_screen_tail)"
fi
grep_debug() { cx grep -E "$1" "$DEBUG_LOG" 2>/dev/null | head -"${2:-3}"; }
finding "debug log, module/Client lines: $(grep_debug 'spike-client.*(loaded|Client|surface|fault)' 4 | cut -c1-200 | tr '\n' '|')"

finding "pane focused after /spike (focus:true, empty composer): $(screen_value 'FOCUSED=(true|false)')"
probe_key j
finding "after 'j' with no click: Client keys=$(screen_value 'CLIENT keys=[0-9]+')"

# --- leg 2: click the Client region, then the key table ----------------------------------------
click_client && finding "after a click on the Client: clicks=$(screen_value 'clicks=[0-9]+') FOCUSED=$(screen_value 'FOCUSED=(true|false)')"
for key in j k G g / '?' n N Enter C-d C-u C-f C-b PageDown PageUp Up Down Home End Tab BSpace; do
    send_key "$key"
done
send_key -l ':'
send_key -l 'x'
finding "LAST row after the table: $(screen_field 'LAST .*' | cut -c1-120)"

# --- leg 3: module memory, a $.state counter, and invalidate -----------------------------------
mem_of() { screen_field 'MEM=[0-9]+ REV=[0-9]+ RENDERS=[0-9]+ SPAWNBYTES=-?[0-9]+ GLOBAL=[a-z]+'; }
finding "baseline $(mem_of)"
send_key 1
sleep 1
finding "after op 'mem' (module memory +1, no state write) the pane reads $(mem_of)"
send_key 2
sleep 1
finding "after op 'rev' (\$.state counter +1) the pane reads $(mem_of)"
send_key 1
send_key 3
sleep 1
finding "after op 'mem' then op 'inval' (\$.ui.invalidate) the pane reads $(mem_of)"

# --- leg 4: does the engine log spawn output or props? -----------------------------------------
send_key s
sleep 3
finding "the hooks module read the spawned child: $(mem_of)"
tm_screen | grep -q "$SPAWN_MARK" && finding "spawn output reached the screen" || finding "spawn output did not reach the screen"
for mark in "$SPAWN_MARK" "$PROP_MARK"; do
    in_debug="$(cx grep -c "$mark" "$DEBUG_LOG" 2>/dev/null)"
    in_files="$(cx sh -c "grep -rlF '$mark' /home/node/.claude /work/scratch/spike/out 2>/dev/null | grep -v '^$DEBUG_LOG\$' | wc -l")"
    finding "marker $mark: debug-log lines ${in_debug:-0}, other files under the config dir and out dir ${in_files:-0}"
done
cx sh -c "ls /home/node/.claude/projects/*/*.jsonl 2>/dev/null | wc -l" | xargs -I{} printf 'FINDING  transcript files: %s\n' {}

# --- leg 5: Escape, and the chord prefix ----------------------------------------------------------
click_client
probe_key Escape
finding "FOCUSED after Escape: $(screen_value 'FOCUSED=(true|false)')"
probe_key j
send_key C-x
send_key x
finding "the pane is still open after C-x then x: $(tm_screen | grep -c 'SPIKE MEM=') drawing(s) on screen"
# The chord that moves the focus between panes: does it land on the Client without a click?
tm_key Escape
tm_key C-x
tm_key Tab
sleep 0.5
probe_key j

pass "client-key legs measured"
session_stop "$TM"

# --- leg 6: a second plugin, both load orders -------------------------------------------------------
observe() {
    local order="$*"
    start_session "$@" || { fail "REPL for order [$order] did not start"; return; }
    if ! open_pane; then
        fail "order [$order]: the pane never drew"
        session_stop "$TM"
        return
    fi
    send_key 1
    send_key 2
    tm_key Escape
    sleep 1
    tm_cmd '/observe'
    sleep 3
    finding "order [$order] observer: $(cx cat "$OBSF" 2>/dev/null || echo 'no report written')"
    session_stop "$TM"
}
observe observer subject
observe subject observer

probe_exit
