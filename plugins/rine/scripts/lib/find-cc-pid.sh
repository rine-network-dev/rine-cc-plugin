#!/usr/bin/env bash
# find-cc-pid.sh — locate the long-lived `claude` process in our ancestry.
#
# CC invokes hooks via /bin/sh -c, so $PPID is a transient shim shell.
# Walk ancestors until we find a process named "claude" — that's the stable
# PID we use for session-scoped directories and liveness checks.
#
# Usage: source this file, then call find_cc_pid.
# Returns the PID on stdout; returns 1 if not found.

find_cc_pid() {
    local pid="${PPID:-$$}" comm
    while [[ "$pid" -gt 1 ]]; do
        comm="$(ps -o comm= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
        if [[ "$comm" == "claude" ]]; then
            echo "$pid"
            return 0
        fi
        pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
        [[ -z "$pid" ]] && break
    done
    return 1
}
