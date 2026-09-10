#!/usr/bin/env bash
# resolve-config-dir.sh — shared $RINE_DIR resolver.
#
# Replicates rine-core's resolveConfigDir() order:
#   1. $RINE_CONFIG_DIR (explicit override)
#   2. $HOME/.config/rine (XDG standard)
#   3. $PWD/.rine (project-local)
#
# Usage: source this file. $RINE_DIR is set to the first that exists
# and contains credentials.json, or to the first that exists (for
# state-file writes even when unconfigured). $RINE_HAS_CREDS is "1"
# if credentials.json was found, "" otherwise.
#
# The two paths DERIVED from $RINE_DIR are set here too, so both consumers read one
# definition. session-start.sh composes $PAUSE_FILE into the sentence the user is told to
# run; monitor-stream.sh is the process that watches it. Renaming it in one file and not the
# other tells the user to touch a path nothing watches, and no gate covers that pair.
#   $STATE_DIR  — poll-state.json's directory
#   $PAUSE_FILE — the notification pause marker

resolve_config_dir() {
    RINE_DIR=""
    RINE_HAS_CREDS=""

    local candidates=() dir
    [[ -n "${RINE_CONFIG_DIR:-}" ]] && candidates+=("$RINE_CONFIG_DIR")
    [[ -n "${HOME:-}" ]] && candidates+=("$HOME/.config/rine")
    candidates+=("$PWD/.rine")

    # First pass: find one with credentials.
    for dir in "${candidates[@]}"; do
        if [[ -f "$dir/credentials.json" ]]; then
            RINE_DIR="$dir"
            RINE_HAS_CREDS="1"
            break
        fi
    done

    # Second pass: find one that exists at all (for state writes).
    if [[ -z "$RINE_DIR" ]]; then
        for dir in "${candidates[@]}"; do
            if [[ -d "$dir" ]]; then
                RINE_DIR="$dir"
                break
            fi
        done
    fi

    # Nothing found — default to XDG path (will be created on first use).
    [[ -n "$RINE_DIR" ]] || RINE_DIR="${HOME:-.}/.config/rine"

    STATE_DIR="$RINE_DIR/state"
    PAUSE_FILE="$RINE_DIR/monitor-pause"
    return 0
}
