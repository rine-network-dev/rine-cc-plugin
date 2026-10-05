#!/usr/bin/env bash
# e2e-steps-c.sh — steps 11..12 of the interactive e2e (rig/e2e-interactive.sh). Sourced by the
# driver after probes/lib.sh, probes/e2e-lib.sh and the other step files; it defines functions
# and nothing else (no top-level commands, no `set` options). The driver sets the globals these
# steps read (ALICE, TM, ...) before any of them runs, so shellcheck cannot see the assignments.
# shellcheck disable=SC2154  # globals are assigned by the driver that sources this file

# --- the texts these steps assert (one regex per variable) ----------------------------
readonly RAW_BUTTON='\[ raw \]'
readonly RAW_JSON='"(items|total|conversation_id|encryption_version|verification_status)"|next_cursor'  # quoted keys: only the raw view draws them, and the screen shows the tail of a long result

# --- step 11: a self-addressed webhook event wakes an idle session once the own handle is allowlisted ---
step11() {
    if ! wait_idle 60; then
        fail "the session never went idle within 60 s; last screen: $(last_screen_tail)"
        return
    fi
    tm_cmd "/rine allow add $ALICE"
    if wait_lists "$ALICE" 1 8; then
        pass "the own handle is on the allowlist"
    else
        fail "lists.json never named $ALICE within 8 s of /rine allow add"
        return
    fi
    sleep 35
    local before out id
    before="$(jsonl_count "$RE_WAKE")"
    out="$(cx_as alice rine --json send --to "$ALICE" --type rine.v1.webhook --payload '{"text":"step11-webhook"}')" || out=""
    id="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' 2>/dev/null)" || id=""
    if [ -z "$id" ]; then
        fail "alice could not send herself a rine.v1.webhook event (output: ${out:-<empty>})"
        return
    fi
    if wait_jsonl "$RE_WAKE" "$((before + 1))" 60; then
        pass "a webhook event woke the idle session with no input"
    else
        fail "no wake started within 60 s for a self-addressed rine.v1.webhook event; last screen: $(last_screen_tail)"
        return
    fi
    finish_turn
}

# --- step 12: a ToolResult card for a rine tool, raw toggle, in ctrl+o ---
step12() {
    tm_cmd "Call the rine_inbox tool once with status all and limit 3, then say done."  # an empty list draws no card; earlier steps have read the unread, and the full history is too long for a result
    if ! finish_turn; then
        fail "turn did not finish"
        return
    fi
    tm_key C-o
    if ! wait_screen 'detailed transcript|Showing detailed' 10; then
        info "the ctrl+o view did not announce itself within 10 s; continuing"
    fi
    if ! wait_screen "$RAW_BUTTON" 15; then
        fail "the ctrl+o view never showed a card with a [raw] toggle; last screen: $(last_screen_tail)"
        tm_key C-o
        return
    fi
    pass "the ctrl+o view shows a card with a [raw] toggle"
    local screen
    screen="$(tm_screen)"
    if printf '%s\n' "$screen" | grep -q 'bob@'; then
        pass "the card names the sender"
    else
        info "soft check: the card did not name the sender (bob@)"
    fi
    sleep 3  # a click in the first moments after the transcript view draws is not taken
    if ! click_pos "$RAW_BUTTON" last; then  # earlier cards in the transcript carry their own [ raw ]
        fail "the [raw] toggle could not be located on the screen"
        tm_key C-o
        return
    fi
    if wait_screen "$RAW_JSON" 10; then
        pass "pressing [raw] shows the raw JSON"
    else
        fail "pressing [raw] did not show the raw JSON; last screen: $(last_screen_tail)"
    fi
    tm_key C-o
}
