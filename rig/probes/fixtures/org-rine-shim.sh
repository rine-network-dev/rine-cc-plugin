#!/usr/bin/env bash
# A `rine` ahead of the real shim that points only `rine tui` at the recorded org's server.
[ "$1" = tui ] && export RINE_API_URL="$(cat "$RINE_ORG_URL_FILE")"
exec "$RINE_REAL_RINE" "$@"
