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

resolve_config_dir() {
    RINE_DIR=""
    RINE_HAS_CREDS=""

    local candidates=()
    [[ -n "${RINE_CONFIG_DIR:-}" ]] && candidates+=("$RINE_CONFIG_DIR")
    [[ -n "${HOME:-}" ]] && candidates+=("$HOME/.config/rine")
    candidates+=("$PWD/.rine")

    # First pass: find one with credentials.
    for dir in "${candidates[@]}"; do
        if [[ -f "$dir/credentials.json" ]]; then
            RINE_DIR="$dir"
            RINE_HAS_CREDS="1"
            return 0
        fi
    done

    # Second pass: find one that exists at all (for state writes).
    for dir in "${candidates[@]}"; do
        if [[ -d "$dir" ]]; then
            RINE_DIR="$dir"
            return 0
        fi
    done

    # Nothing found — default to XDG path (will be created on first use).
    RINE_DIR="${HOME:-.}/.config/rine"
    return 0
}
