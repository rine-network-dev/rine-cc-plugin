#!/usr/bin/env bash
# e2e-lib.sh — helpers for the interactive e2e (rig/e2e-interactive.sh). Sourced by the driver
# only; it defines functions and nothing else (no top-level commands, no `set` options).
#
# The driver sets the globals these helpers read (CNAME, TM, RIG_API, ALICE, OUTD, PROJ, COPY,
# SHIM, DEBUG_LOG, API_CNAME) before any of them runs, so shellcheck cannot see the assignments.
# shellcheck disable=SC2154  # globals are assigned by the driver that sources this file

# --- container plumbing ---------------------------------------------------------------
cx() { docker exec "$CNAME" "$@"; }

# Bob's owner dir: beside alice's default, never under /work/creds-b, which onboard refuses as the runtime config dir.
readonly BOB_OWNER_DIR=/home/node/.config/rine-owner-b

# cx_as alice|bob CMD... — run CMD as that identity: its own cred dir, the container's view of
# the local rine stack.
cx_as() {
    local who="$1" dir owner=()
    shift
    # onboard keeps the org root in an owner dir (default ~/.config/rine-owner). alice keeps the default the
    # plugin's own spawns see; bob gets his own, or his onboard finds alice's root and answers already_registered.
    case "$who" in
        alice) dir=/work/creds ;;
        bob)   dir=/work/creds-b; owner=(-e "RINE_OWNER_DIR=$BOB_OWNER_DIR") ;;
        *)     return 1 ;;
    esac
    docker exec -e "RINE_CONFIG_DIR=$dir" "${owner[@]}" -e "RINE_API_URL=$RIG_API" "$CNAME" "$@"
}

# --- driving the tmux pane ------------------------------------------------------------
tm_screen() { cx tmux capture-pane -p -t "$TM"; }

tm_type() { cx tmux send-keys -t "$TM" -l -- "$1"; }

tm_enter() { sleep 0.3; cx tmux send-keys -t "$TM" Enter; }

tm_cmd() { tm_type "$1"; tm_enter; }

tm_key() { cx tmux send-keys -t "$TM" "$@"; }

# A mouse press then release at 1-based cell COL,ROW: the literal SGR pair, ESC being real.
tm_click() {
    local col="$1" row="$2"
    cx tmux send-keys -t "$TM" -l -- "$(printf '\033[<0;%s;%sM' "$col" "$row")"
    cx tmux send-keys -t "$TM" -l -- "$(printf '\033[<0;%s;%sm' "$col" "$row")"
}

# --- polling --------------------------------------------------------------------------
# last_screen_tail — the last three non-blank lines of LAST_SCREEN on one line, for failure messages.
last_screen_tail() {
    printf '%s' "$LAST_SCREEN" | grep -v '^[[:space:]]*$' | tail -3 | tr '\n' '|'
}

# wait_screen REGEX SECS — 0 on a match, 1 at the deadline; the last screen stays in LAST_SCREEN.
wait_screen() {
    local regex="$1" secs="$2" deadline
    deadline=$(( $(date +%s) + secs ))
    while :; do
        LAST_SCREEN="$(tm_screen)"
        printf '%s\n' "$LAST_SCREEN" | grep -Eq "$regex" && return 0
        [ "$(date +%s)" -lt "$deadline" ] || return 1
        sleep 0.5
    done
}

# screen_pos REGEX [last] — print "ROW COL" of the first match on the pane (the last with `last`), or nothing.
screen_pos() {
    local regex="$1" which="${2:-head}" screen row col
    [ "$which" = last ] && which=tail || which=head
    screen="$(tm_screen)"
    row="$(printf '%s\n' "$screen" | grep -En "$regex" | "$which" -1 | cut -d: -f1)"
    [ -n "$row" ] || return 0
    col="$(printf '%s\n' "$screen" | sed -n "${row}p" \
        | RE="$regex" awk '{ if (match($0, ENVIRON["RE"])) { print RSTART; exit } }')"
    printf '%s %s\n' "$row" "$col"
}

# click_pos REGEX [last] — click the first (or last) pane cell matching REGEX; 1 when nothing matches.
click_pos() {
    local pos row col
    pos="$(screen_pos "$@")"
    [ -n "$pos" ] || return 1
    read -r row col <<<"$pos"
    tm_click "$col" "$row"
}

wait_debug() {
    local regex="$1" secs="$2" deadline
    deadline=$(( $(date +%s) + secs ))
    while :; do
        cx cat "$DEBUG_LOG" 2>/dev/null | grep -Eq "$regex" && return 0
        [ "$(date +%s)" -lt "$deadline" ] || return 1
        sleep 0.5
    done
}

# --- the session transcript -----------------------------------------------------------
jsonl_file() { cx sh -c 'ls -t /home/node/.claude/projects/*/*.jsonl 2>/dev/null | head -1'; }

jsonl_count() {
    local file n
    file="$(jsonl_file)"
    if [ -z "$file" ]; then
        printf '0\n'
        return 0
    fi
    n="$(cx grep -Ec "$1" "$file" 2>/dev/null)"
    printf '%s\n' "${n:-0}"
}

wait_jsonl() {
    local regex="$1" want="$2" secs="$3" deadline n
    deadline=$(( $(date +%s) + secs ))
    while :; do
        n="$(jsonl_count "$regex")"
        [ "${n:-0}" -ge "$want" ] && return 0
        [ "$(date +%s)" -lt "$deadline" ] || return 1
        sleep 0.5
    done
}

# wait_idle SECS — 0 once the screen shows no "esc to interrupt" for two consecutive polls.
wait_idle() {
    local secs="$1" deadline quiet=0
    deadline=$(( $(date +%s) + secs ))
    while :; do
        LAST_SCREEN="$(tm_screen)"
        if printf '%s\n' "$LAST_SCREEN" | grep -q 'esc to interrupt'; then
            quiet=0
        else
            quiet=$(( quiet + 1 ))
            [ "$quiet" -ge 2 ] && return 0
        fi
        [ "$(date +%s)" -lt "$deadline" ] || return 1
        sleep 0.5
    done
}

finish_turn() { wait_idle 90; }

# --- the other identity and the local stack -------------------------------------------
# bob_send TEXT [TYPE] — bob sends alice a message; print its id, or return 1.
bob_send() {
    local text="$1" type="${2:-rine.v1.task}" out id
    out="$(cx_as bob rine --json send --to "$ALICE" --type "$type" \
        --payload "{\"text\":\"$text\"}")" || return 1
    id="$(printf '%s' "$out" \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' 2>/dev/null)" || return 1
    [ -n "$id" ] || return 1
    printf '%s\n' "$id"
}

api() {
    case "$1" in
        pause)   docker pause "$API_CNAME" ;;
        unpause) docker unpause "$API_CNAME" ;;
        stop)    docker stop "$API_CNAME" ;;
        start)   docker start "$API_CNAME" ;;
        *)       return 1 ;;
    esac
}

child_count() {
    local n
    # only alice's streams: step 7 leaves bob's own `rine stream` (and its sh wrapper) running in the same container
    n="$(cx sh -c 'n=0; for p in $(pgrep -f "[r]ine.* stream"); do grep -qz "^RINE_CONFIG_DIR=/work/creds$" /proc/$p/environ 2>/dev/null && n=$((n + 1)); done; echo $n' 2>/dev/null)"
    printf '%s\n' "${n:-0}"
}

# --- the REPL -------------------------------------------------------------------------
# session_start NAME [CLAUDE_ARGS...] — start the REPL under tmux; 1 if it never shows. SESSION_ENV, when set,
# is extra NAME=value words for the REPL's environment, after the defaults so it wins.
session_start() {
    local name="$1"
    shift
    TM="$name"
    DEBUG_LOG="$OUTD/debug-$name.log"
    cx tmux new-session -d -s "$name" -x 200 -y 50 -c "$PROJ" \
        "env RINE_CONFIG_DIR=/work/creds RINE_API_URL=$RIG_API PATH=$SHIM:\$PATH ${SESSION_ENV:-} claude --plugin-dir $COPY --debug-file $DEBUG_LOG $*"
    case " $* " in
        *bypassPermissions*)
            if wait_screen 'Yes, I accept' 30; then
                tm_key Down
                tm_key Enter
            fi
            ;;
    esac
    wait_screen 'shortcuts|Claude Code' 60
}

session_stop() { cx tmux kill-session -t "$1" 2>/dev/null || true; }
