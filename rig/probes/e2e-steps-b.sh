#!/usr/bin/env bash
# e2e-steps-b.sh — steps 6..10 and 13 of the interactive e2e (rig/e2e-interactive.sh). Sourced by the
# driver after probes/lib.sh and probes/e2e-lib.sh; it defines functions and nothing else (no
# top-level commands, no `set` options). The driver sets the globals these steps read (BOB,
# OUTD, HOST_API, RIG_API, CNAME, API_CNAME, ALICE, ...) before any of them runs, so shellcheck
# cannot see the assignments.
# shellcheck disable=SC2154  # globals are assigned by the driver that sources this file

# --- the texts the steps assert (one regex per variable) ------------------------------
readonly HAND='rine hand-off: the user selected'
readonly STALE='rine ⚠ no signal for'
readonly BACKOFF='rine ◌ reconnecting in'
readonly HELD='Held for review'
readonly PANE_ROW='● bob@'
readonly BTN_HAND='\[ Hand to Claude \]'
readonly BTN_REPLY='\[ Reply \]'
readonly REPLY='Reply to .*Enter sends'
readonly KEYS_HINT='click here or ctrl\+x tab to use the keys'
readonly BYPASS='not woken: permissions bypassed'
readonly BTN_ORG='\[ Whole org \]' BTN_SHOW='\[ Show \]' ORG_ACK='You see this once on this machine'
readonly ORG_NEEDS_KEY='This view reads the messages of every agent' ORG_LIVE='[●◉○] live · 6 loaded'
# A list row names the sender after its joint: bare in its own org, else keeping its whole name and its `@` with the
# domain clipped (`mx-cli@…`), beside a long group label (hooks/lib/org-rows.ts partiesText, via fitGroupSender: a short
# party keeps its name, the group takes the rest and clips its domain first).
readonly ORG_ROW='(mx-cli(@[^ ]*)? → |(→|·) mx-cli(@| |$))' ORG_DIR=/work/scratch/e2e/org

# --- step 6: preview mode holds the message; band, pane, hand-off; digits do nothing ---
step6() {
    tm_cmd "/rine preview on"; sleep 2
    local w id h h2 w2
    w="$(jsonl_count "$RE_WAKE")"
    id="$(bob_send "preview-canary-6")"
    [ -n "$id" ] || { fail "bob could not send preview-canary-6"; return; }
    if wait_screen 'preview-canary-6' 25; then pass "band shows the held message and its preview text"; else fail "the band never showed preview-canary-6 within 25 s"; fi
    sleep 15
    if [ "$(jsonl_count "$RE_WAKE")" -eq "$w" ]; then pass "preview holds even an allowlisted sender: no turn started"; else fail "a wake started while preview was on ($w -> $(jsonl_count "$RE_WAKE"))"; fi
    tm_key C-x; tm_key Tab; tm_type o
    if ! wait_screen "$HELD" 15; then fail "the pane never showed 'Held for review'"; return; fi
    pass "pane opens with the held row"
    sleep 2  # a click in the first moments after the pane draws is not taken
    if ! click_pos "$PANE_ROW"; then fail "no held pane row matching '● bob@'"; return; fi
    sleep 1
    # The band's `o` cannot give the pane the keyboard: the pane says so, and a click on its text grants it.
    if wait_screen "$KEYS_HINT" 5; then pass "a pane opened from the band's o shows the keys hint"; else fail "the pane opened from the band's o showed no keys hint"; fi
    click_pos "$HELD" || { fail "no 'Held for review' text to click for the keyboard"; return; }
    sleep 1
    h="$(jsonl_count "$HAND")"; tm_type s
    if wait_jsonl "$HAND" "$((h + 1))" 15; then pass "selecting the row, clicking the pane's text and s starts a hand-off turn"
    else
        fail "the pane's s hotkey started no hand-off within 15 s although its text was clicked: the letter went to the composer"
        tm_key BSpace
        click_pos "$BTN_HAND" || { fail "no '[ Hand to Claude ]' button in the pane"; return; }
        if wait_jsonl "$HAND" "$((h + 1))" 60; then pass "clicking [ Hand to Claude ] starts a hand-off turn"; else fail "no hand-off turn within 60 s of clicking [ Hand to Claude ]"; fi
    fi
    finish_turn; tm_key Escape
    h2="$(jsonl_count "$HAND")"; w2="$(jsonl_count "$RE_WAKE")"
    tm_type 2; sleep 3
    if [ "$(jsonl_count "$HAND")" -eq "$h2" ] && [ "$(jsonl_count "$RE_WAKE")" -eq "$w2" ]; then pass "a digit in the empty composer does nothing to rine"; else fail "a digit in the empty composer changed the rine counts"; fi
    tm_key BSpace
    tm_cmd "/rine preview off"; sleep 2
}

# --- step 7: the reply pane sends (y, Enter) ------------------------------------------
step7() {
    docker exec -d -e RINE_CONFIG_DIR=/work/creds-b -e "RINE_OWNER_DIR=$BOB_OWNER_DIR" -e RINE_API_URL="$RIG_API" "$CNAME" \
        sh -c "rine --json stream --persistent > $OUTD/bob-stream.log 2>&1"
    sleep 4
    tm_cmd "/rine"
    if ! wait_screen "$PANE_ROW" 15; then fail "the pane never showed a '● bob@' row"; return; fi
    sleep 2  # a click in the first moments after the pane draws is not taken
    if ! click_pos "$PANE_ROW"; then fail "no pane row matching '● bob@'"; return; fi
    sleep 1
    tm_type y
    if ! wait_screen "$REPLY" 8; then
        fail "the pane's y hotkey opened no reply pane within 8 s: /rine from an empty composer gives the pane the keyboard at once"
        tm_key BSpace
        click_pos "$BTN_REPLY" || { fail "no '[ Reply ]' button in the pane"; return; }
        if ! wait_screen "$REPLY" 10; then fail "clicking [ Reply ] opened no reply pane"; return; fi
    fi
    pass "reply pane opens"
    tm_type "reply-canary-7"; tm_enter
    local pat deadline n
    pat="\"event\":\"message\".*$ALICE|$ALICE.*\"event\":\"message\""
    deadline=$(( $(date +%s) + 30 )); n=0
    while :; do
        n="$(cx grep -Ec "$pat" "$OUTD/bob-stream.log" 2>/dev/null)"; n="${n:-0}"
        [ "$n" -ge 1 ] && break
        [ "$(date +%s)" -lt "$deadline" ] || break
        sleep 1
    done
    if [ "$n" -ge 1 ]; then pass "bob's stream received alice's reply"; else fail "bob's stream never logged a message event from $ALICE within 30 s"; fi
    tm_key Escape
}

# --- step 8: api pause and stop: stale, backoff, recovery ---
step8() {
    api pause
    local t0 left i max n deadline code
    t0="$(date +%s)"
    if wait_screen "$STALE" 100; then pass "stale after the pause"; else fail "no 'rine ⚠ no signal for' within 100 s of the pause"; fi
    left=$(( 175 - ($(date +%s) - t0) )); [ "$left" -lt 5 ] && left=5
    if wait_screen "$BACKOFF" "$left"; then pass "backoff after the silent socket"; else fail "no 'rine ◌ reconnecting in' within ${left}s"; fi
    api unpause
    if wait_screen "$RE_STATUS_LIVE" 120; then pass "live again after unpause"; else fail "no 'rine ● alice' within 120 s of the unpause"; fi
    api stop
    if wait_screen "$BACKOFF" 15; then pass "backoff within 15 s of a stopped api"; else fail "no backoff within 15 s of stopping the api"; fi
    i=0; max=0
    while [ "$i" -lt 15 ]; do
        n="$(child_count)"; n="${n:-0}"
        [ "$n" -gt "$max" ] && max="$n"
        i=$((i + 1)); sleep 1
    done
    if [ "$max" -le 2 ]; then pass "no hot loop: child processes bounded"; else fail "child processes peaked at $max while the api was down"; fi
    api start
    deadline=$(( $(date +%s) + 60 )); code=000
    while :; do
        code="$(curl -s -o /dev/null -w '%{http_code}' "$HOST_API/health")"
        [ "$code" = 200 ] && break
        [ "$(date +%s)" -lt "$deadline" ] || break
        sleep 1
    done
    if [ "$code" = 200 ]; then pass "the api answers /health with 200 after the restart"; else fail "the api never answered /health with 200 within 60 s (last $code)"; fi
    if wait_screen "$RE_STATUS_LIVE" 150; then pass "live again after the api restarts"; else fail "no 'rine ● alice' within 150 s of the restart"; fi
}

# --- step 9: plugin reload mid-stream keeps the stream ---
step9() {
    tm_cmd "/reload-plugins"; sleep 15
    local n
    if wait_screen "$RE_STATUS_LIVE" 5; then
        n="$(child_count)"
        if [ "${n:-0}" -ge 1 ]; then pass "the stream survives a plugin reload"; return; fi
        sleep 10
        n="$(child_count)"
        if [ "${n:-0}" -ge 1 ]; then pass "the stream survives a plugin reload"; else fail "frozen live status with no child after reload"; fi
        return
    fi
    if ! wait_screen "$RE_STATUS_LIVE" 60; then fail "no 'rine ● alice' within 60 s of the reload"; return; fi
    n="$(child_count)"
    if [ "${n:-0}" -ge 1 ]; then pass "the stream survives a plugin reload"; else fail "live status after reload but no stream child"; fi
}

# --- step 10: a bypassPermissions session does not wake ---
step10() {
    session_stop e2e; sleep 3
    if ! session_start e2e2 --permission-mode bypassPermissions; then fail "the bypassPermissions session never reached the REPL"; return; fi
    if wait_screen "$RE_STATUS_LIVE" 30; then pass "status line reads rine ● alice in the bypassPermissions session"; else fail "no 'rine ● alice' within 30 s of the bypassPermissions session"; fi
    tm_cmd "/rine allow add $BOB"
    tm_cmd "/rine preview off"; sleep 2
    tm_cmd "Reply with the single word ok."; finish_turn
    local w id
    w="$(jsonl_count "$RE_WAKE")"
    id="$(bob_send "step10-bypass")"
    [ -n "$id" ] || { fail "bob could not send step10-bypass"; return; }
    sleep 30
    if [ "$(jsonl_count "$RE_WAKE")" -eq "$w" ]; then pass "no wake under bypassPermissions"; else fail "a wake started under bypassPermissions ($w -> $(jsonl_count "$RE_WAKE"))"; fi
    if wait_screen "$BYPASS" 5 || wait_debug "$BYPASS" 5; then pass "the bypassPermissions note is present"; else info "soft check: no 'not woken: permissions bypassed' note on the screen or in the debug log"; fi
}

# --- step 13: the org tab: the one-time acknowledgement, no org key, a row from a recorded org ---
org_feeds() { cx sh -c 'pgrep -fc "[t]ui --feed" || true'; }

# org_server — a recorded org (the tui fixtures) on the container's loopback, and a `rine` ahead of the
# shim that points only `rine tui` at it: the plugin and its stream keep the local stack.
org_server() {
    local fx=rine-core/test/fixtures/org-reader-parity/org-reader n=0
    org_server_stop
    cx sh -c "rm -f $ORG_DIR/url; mkdir -p $ORG_DIR/scripts/tui-e2e $ORG_DIR/$fx $ORG_DIR/bin $ORG_DIR/none" \
        && docker cp "$ROOT/scripts/tui-e2e/fake_server.py" "$CNAME:$ORG_DIR/scripts/tui-e2e/" \
        && docker cp "$ROOT/scripts/tui-e2e/serve.py" "$CNAME:$ORG_DIR/scripts/tui-e2e/" \
        && docker cp "$ROOT/$fx/read-1.json" "$CNAME:$ORG_DIR/$fx/" \
        && docker cp "$ROOT/rine-cc-plugin/rig/probes/fixtures/org-rine-shim.sh" "$CNAME:$ORG_DIR/bin/rine" || return 1
    docker exec -d "$CNAME" python3 "$ORG_DIR/scripts/tui-e2e/serve.py" org-reader/read-1 "$ORG_DIR/owner" "$ORG_DIR/url"
    until cx test -s "$ORG_DIR/url"; do n=$((n + 1)); [ "$n" -lt 15 ] || return 1; sleep 1; done
}

org_server_stop() { cx pkill -f "[s]cripts/tui-e2e/serve.py" || true; }

# org_session OWNER_DIR — a fresh REPL with that owner dir, whose `rine tui` reads the recorded org.
org_session() {
    session_stop e3; sleep 3
    SESSION_ENV="RINE_OWNER_DIR=$1 RINE_ORG_URL_FILE=$ORG_DIR/url RINE_REAL_RINE=$SHIM/rine PATH=$ORG_DIR/bin:$SHIM:\$PATH"
    session_start e3 && wait_screen "$RE_STATUS_LIVE" 60 || return 1
    tm_cmd "/rine"
    wait_screen "$BTN_ORG" 20 && sleep 2 && click_pos "$BTN_ORG"
}

step13() {
    session_stop e2e2
    org_server || { fail "the recorded org could not be served in the rig"; return; }
    org_session "$ORG_DIR/none" || { fail "no 'Whole org' button to press"; return; }
    if wait_screen "$ORG_ACK" 15 && [ "$(org_feeds)" -eq 0 ]; then pass "the first open shows the acknowledgement and starts no feed"; else fail "no acknowledgement, or a feed already running: $(last_screen_tail)"; return; fi
    # A click in the first moment after the acknowledgement is drawn reaches no button (no ui.press is
    # dispatched), so it waits as a person reading it would, like the Whole org click in org_session.
    sleep 2
    click_pos "$BTN_SHOW" || { fail "no '[ Show ]' button on the acknowledgement"; return; }
    if wait_screen "$ORG_NEEDS_KEY" 30; then pass "an agent key alone gets the needs-the-org-key sentence"; else fail "no needs-the-org-key sentence within 30 s: $(last_screen_tail)"; return; fi
    sleep 15
    if [ "$(org_feeds)" -eq 0 ]; then pass "no feed restarts after exit 3"; else fail "the plugin restarted the feed after exit 3"; fi
    org_session "$ORG_DIR/owner" || { fail "no 'Whole org' button to press with the org key"; return; }
    if wait_screen "$ORG_LIVE" 60 && printf '%s\n' "$LAST_SCREEN" | grep -Eq "$ORG_ROW"; then pass "with the org key the tab goes live and lists the recorded org's rows"; else fail "no live org tab with a recorded row within 60 s: $(last_screen_tail)"; fi
    if printf '%s\n' "$LAST_SCREEN" | grep -q "$ORG_ACK"; then fail "the acknowledgement was shown again after it was kept"; else pass "the kept acknowledgement is not asked for again"; fi
    session_stop e3
    org_server_stop
}
