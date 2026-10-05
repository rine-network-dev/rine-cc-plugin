#!/usr/bin/env bash
# e2e-steps-a.sh — steps 1..5 of the interactive e2e (rig/e2e-interactive.sh). Sourced by the
# driver after probes/lib.sh and probes/e2e-lib.sh; it defines functions and nothing else (no
# top-level commands, no `set` options). The driver sets the globals these steps read (BOB,
# STATE, TAMPER, SHIMLOG, ...) before any of them runs, so shellcheck cannot see the assignments.
# shellcheck disable=SC2154  # globals are assigned by the driver that sources this file

# --- the texts the steps assert (one regex per variable) ------------------------------
readonly RE_STATUS_LIVE='rine ● alice'
readonly RE_NOT_WOKEN='not woken until you type a prompt'
readonly RE_BAND='rine: [0-9]+ new'
readonly RE_NOTIFY='rine notification from the rine plugin, not the user'
readonly RE_WAKE='rine wake: started by the rine plugin'
readonly RE_TAMPERED='tampered'

# wait_lists HANDLE WANT SECS — poll lists.json until the handle's line count reaches WANT
# (1 for "present", 0 for "absent"); 0 on success, 1 at the deadline.
wait_lists() {
    local handle="$1" want="$2" secs="$3" deadline n
    deadline=$(( $(date +%s) + secs ))
    while :; do
        n="$(cx grep -c "$handle" "$STATE/lists.json" 2>/dev/null)"
        n="${n:-0}"
        if [ "$want" = 0 ]; then
            [ "$n" -eq 0 ] && return 0
        else
            [ "$n" -ge "$want" ] && return 0
        fi
        [ "$(date +%s)" -lt "$deadline" ] || return 1
        sleep 0.5
    done
}

# --- step 1: the status line goes live ------------------------------------------------
step1() {
    if wait_screen "$RE_STATUS_LIVE" 8; then
        pass "status line reads rine ● alice within 8 s of the REPL"
    else
        fail "status line never read rine ● alice within 8 s of the REPL; last screen: $(last_screen_tail)"
    fi
}
# --- step 2: a wake before the first typed prompt is held back ------------------------
step2() {
    tm_cmd "/rine allow add $BOB"
    if wait_lists "$BOB" 1 8; then
        pass "allowlist written to lists.json"
    else
        fail "lists.json never named $BOB within 8 s of /rine allow add"
        return
    fi
    local id
    id="$(bob_send "step2-first")"
    if [ -z "$id" ]; then
        fail "bob could not send step2-first"
        return
    fi
    if wait_screen "$RE_NOT_WOKEN" 15; then
        pass "a wake before the first typed prompt is held back"
    elif wait_debug "$RE_NOT_WOKEN" 5; then
        pass "a wake before the first typed prompt is held back (debug log)"
    else
        fail "no 'not woken until you type a prompt' note on the screen or in the debug log"
    fi
    local wakes
    wakes="$(jsonl_count "$RE_WAKE")"
    if [ "${wakes:-0}" -eq 0 ]; then
        pass "no wake started for a message sent before the first typed prompt"
    else
        fail "a wake started ($wakes) for a message sent before the first typed prompt"
    fi
}
# --- step 3: a non-allowlisted message gives a notify row -----------------------------
step3() {
    tm_cmd "Reply with the single word ok."
    if ! finish_turn; then
        fail "turn did not finish"
        return
    fi
    pass "a typed prompt completed"
    tm_cmd "/rine allow remove $BOB"
    if wait_lists "$BOB" 0 8; then
        pass "allowlist removal written to lists.json"
    else
        fail "lists.json still named $BOB 8 s after /rine allow remove"
        return
    fi
    local id
    id="$(bob_send "step3-notify")"
    if [ -z "$id" ]; then
        fail "bob could not send step3-notify"
        return
    fi
    if wait_screen "$RE_BAND" 20; then
        pass "band shows the new message"
    else
        fail "the band never showed 'rine: N new' within 20 s"
    fi
    if wait_jsonl "$RE_NOTIFY" 1 20 && [ "$(jsonl_count "$id")" -ge 1 ]; then
        pass "notify row with the message id is in the session transcript"
    else
        fail "no notify row carrying $id in the session transcript within 20 s"
    fi
    tm_cmd "Which rine message id did you just get notified about? Answer with the id."
    finish_turn
    if wait_screen "${id:0:8}" 5; then
        pass "the model's answer showed the message id"
    else
        info "soft check: the model's answer did not show the id"
    fi
    # Focus the band, then the letter hotkey `m` (Mark read) so it clears.
    tm_key C-x
    tm_key Tab
    tm_type m
    tm_key Escape
}
# --- step 4: an allowlisted idle message wakes Claude ---------------------------------
step4() {
    tm_cmd "/rine allow add $BOB"
    if wait_lists "$BOB" 1 8; then
        pass "allowlist written to lists.json"
    else
        fail "lists.json never named $BOB within 8 s of /rine allow add"
        return
    fi
    local before id
    before="$(jsonl_count "$RE_WAKE")"
    id="$(bob_send "step4-wake")"
    if [ -z "$id" ]; then
        fail "bob could not send step4-wake"
        return
    fi
    if wait_jsonl "$RE_WAKE" "$((before + 1))" 60; then
        pass "idle allowlisted message started a turn with no input"
    else
        fail "no wake started within 60 s for an idle allowlisted message"
        return
    fi
    STEP4_WAKE_AT="$(date +%s)"
    finish_turn
}
# --- step 5: an unverifiable message does not wake ------------------------------------
step5() {
    local now elapsed
    now="$(date +%s)"
    elapsed=$(( now - ${STEP4_WAKE_AT:-$now} ))
    if [ "$elapsed" -lt 35 ]; then
        sleep "$((35 - elapsed))"
    fi
    cx touch "$TAMPER"
    cx rm -f "$SHIMLOG"
    local before id
    before="$(jsonl_count "$RE_WAKE")"
    id="$(bob_send "step5-tampered")"
    if [ -z "$id" ]; then
        cx rm -f "$TAMPER"
        fail "bob could not send step5-tampered"
        return
    fi
    local deadline n
    deadline=$(( $(date +%s) + 20 ))
    n=0
    while :; do
        n="$(cx grep -c "$RE_TAMPERED" "$SHIMLOG" 2>/dev/null)"
        n="${n:-0}"
        [ "$n" -ge 1 ] && break
        [ "$(date +%s)" -lt "$deadline" ] || break
        sleep 0.5
    done
    if [ "$n" -ge 1 ]; then
        pass "the plugin verified through the tampered read"
    else
        fail "the instrument is a suspect: the shim never saw a read"
    fi
    sleep 20
    local after
    after="$(jsonl_count "$RE_WAKE")"
    if [ "${after:-0}" -eq "${before:-0}" ]; then
        pass "no wake for an unverifiable message"
    else
        fail "a wake started for an unverifiable message ($before -> $after)"
    fi
    cx rm -f "$TAMPER"
}
