#!/usr/bin/env bash
# e2e-interactive.sh — the INTERACTIVE end-to-end leg for the rine Claude Code plugin.
#
# Runs on the HOST (never inside the rig): it brings up the local rine server stack, starts the
# rig container detached, drives a real `claude` REPL inside it through tmux via `docker exec`,
# and tears everything down again. This is the tier the verify lane runs; it is NOT part of
# ci.sh, whose rig stage stays auth-less (`run.sh --authless-only`).
#
#   rig/e2e-interactive.sh [--require-model] [--keep-stack] [--with-chain]
#
#     --require-model  accepted for symmetry with run.sh. A missing credential is ALWAYS a
#                      failure here (exit 2), never a named skip, so this flag changes nothing.
#     --keep-stack     leave the local rine stack (compose.threads-e2e.yml) running afterwards.
#                      A stack this run did not start is never taken down either way.
#     --with-chain     also run step11 and step12, which cover features of a later build wave: a
#                      self-addressed webhook wake and a ToolResult card in ctrl+o. The chain
#                      passes once the code chain has built them.
#
# The rig image is selected by the env var CC_RIG_IMAGE (default rine-cc-rig:latest), which
# compose.cc.yml reads. The credential CLAUDE_CODE_OAUTH_TOKEN reaches the container through
# compose's `env_file` from the repo-root .env.e2e, BY NAME: it is never read, printed or passed
# on a command line here. Only its presence is probed, inside the container.
# Exit: 0 all green · 1 a hard failure · 2 fail-closed (no credential)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PROBE_NAME=e2e-interactive
# shellcheck source=probes/lib.sh
. "$HERE/probes/lib.sh"
# shellcheck source=probes/e2e-lib.sh
. "$HERE/probes/e2e-lib.sh"
# shellcheck source=probes/e2e-steps-a.sh
. "$HERE/probes/e2e-steps-a.sh"
# shellcheck source=probes/e2e-steps-b.sh
. "$HERE/probes/e2e-steps-b.sh"
# shellcheck source=probes/e2e-steps-c.sh
. "$HERE/probes/e2e-steps-c.sh"

# --- globals the lib and the steps read -------------------------------------------------
COMPOSE=${CC_RIG_COMPOSE:-"docker compose -p rine-cc-e2e -f $ROOT/compose.cc.yml"}
STACK="docker compose -f $ROOT/compose.threads-e2e.yml"
CNAME=rine-cc-e2e-cc
API_CNAME=rine-threads-e2e-api-1
HOST_API=http://localhost:7199
RIG_API=http://host.docker.internal:7199
OUTD=/work/scratch/e2e-out
PROJ=/work/scratch/e2e-proj
COPY=/work/scratch/e2e/plugin
SHIM=/work/scratch/e2e/shim
TAMPER=/work/scratch/e2e/tamper
SHIMLOG=/work/scratch/e2e/shim-calls.log
STATE=/work/creds/state/cc
TM=e2e
DEBUG_LOG="$OUTD/debug-e2e.log"
ALICE=""
BOB=""
STACK_STARTED=0
KEEP_STACK=0
WITH_CHAIN=0

for arg in "$@"; do
    case "$arg" in
        --require-model) : ;;  # a missing credential is already a hard failure here
        --keep-stack)    KEEP_STACK=1 ;;
        --with-chain)    WITH_CHAIN=1 ;;
        *) printf 'usage: rig/e2e-interactive.sh [--require-model] [--keep-stack] [--with-chain]\n'; exit 2 ;;
    esac
done

# die WHAT — record the failure, print the totals and stop. Every setup failure goes through here.
die() { fail "$1"; probe_exit; exit 1; }

# --- teardown ---------------------------------------------------------------------------
# Idempotent, every command's error ignored: the steps pause and stop the api, so it is left
# running. A stack this run did not start is never taken down.
teardown() {
    docker unpause "$API_CNAME" >/dev/null 2>&1 || true
    docker start "$API_CNAME" >/dev/null 2>&1 || true
    session_stop e2e
    session_stop e2e2
    docker rm -f "$CNAME" >/dev/null 2>&1 || true
    if [ "$STACK_STARTED" = "1" ] && [ "$KEEP_STACK" != "1" ]; then
        $STACK down -v >/dev/null 2>&1 || true
    fi
}
trap teardown EXIT

# --- setup ------------------------------------------------------------------------------
# a. the local rine stack
if [ "$(docker inspect -f '{{.State.Running}}' "$API_CNAME" 2>/dev/null)" != "true" ]; then
    $STACK up -d --build >/dev/null 2>&1 || die "the local rine stack did not come up"
    STACK_STARTED=1
fi
DEADLINE=$(( $(date +%s) + 180 ))
while :; do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' "$HOST_API/health")"
    [ "$CODE" = "200" ] && break
    [ "$(date +%s)" -lt "$DEADLINE" ] || die "the local rine stack never answered $HOST_API/health with 200 (last: $CODE)"
    sleep 2
done

# b. the rig container
docker rm -f "$CNAME" >/dev/null 2>&1 || true
$COMPOSE run -d --name "$CNAME" --user "$(id -u):$(id -g)" cc sleep infinity >/dev/null \
    || die "the rig container did not start"

# c. the credential, by name only
if ! cx sh -c '[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]'; then
    printf 'FAIL  model leg required but %s\n' "$NO_CREDENTIAL_LINE"
    exit 2
fi

# d. the two identities
# Identities left by an earlier run are reused (onboarding is capped). The host store holding the lists-trust
# digests goes with the state dir: a stale digest makes the fresh lists read as edited outside /rine, correctly.
if cx_as alice rine --json whoami >/dev/null 2>&1 && cx_as bob rine --json whoami >/dev/null 2>&1; then
    cx sh -c 'rm -rf /work/creds/state /work/creds-b/state "$CLAUDE_CONFIG_DIR/plugins/store"' || die "the plugin state could not be cleared"
else
    cx sh -c 'find /work/creds /work/creds-b -mindepth 1 -delete' || die "the cred dirs could not be emptied"
    S="e2e$RANDOM$RANDOM"
    # A "Rate limited" refusal here is that cap, not a defect; rerun after it lapses.
    cx_as alice rine --json onboard --email "alice-$S@gmail.com" --name "A$S" --slug "a$S" \
        --agent-name alice >/dev/null || die "alice could not be onboarded (the stack's 24 h registration cap?)"
    cx_as bob rine --json onboard --email "bob-$S@gmail.com" --name "B$S" --slug "b$S" \
        --agent-name bob >/dev/null || die "bob could not be onboarded (the stack's 24 h registration cap?)"
fi

# whoami_field WHO FIELD — one field of that identity's whoami, parsed on the host.
whoami_field() {
    cx_as "$1" rine --json whoami \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$2"
}
ALICE="$(whoami_field alice agent)" || die "alice's whoami did not report a handle"
BOB="$(whoami_field bob agent)" || die "bob's whoami did not report a handle"
[ -n "$ALICE" ] && [ -n "$BOB" ] || die "a handle is empty after onboarding (alice='$ALICE' bob='$BOB')"
pass "identities onboarded: $ALICE and $BOB"

# e. seed claude's config so no onboarding or trust dialog appears (no value is ever printed)
cx mkdir -p "$PROJ" "$OUTD" "$SHIM" "$(dirname "$COPY")" || die "the scratch dirs could not be created"
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

# f. the plugin copy (the MCP config stays active)
cx sh -c "rm -rf $COPY && cp -r /work/rine-cc-plugin/plugins/rine $COPY" \
    || die "the plugin copy could not be made"

# g. the CLI shim: a tampered `rine --json read` reports the message as unverifiable
REAL_RINE="$(cx sh -c 'command -v rine')" || die "the real rine binary was not found on PATH"
[ -n "$REAL_RINE" ] || die "the real rine binary was not found on PATH"
cx sh -c "cat > $SHIM/rine <<'SHIMEOF'
#!/usr/bin/env bash
if [ -f $TAMPER ] && [ \"\$1\" = --json ] && [ \"\$2\" = read ]; then
    printf 'tampered %s\n' \"\$*\" >> $SHIMLOG
    $REAL_RINE \"\$@\" | python3 -c 'import json,sys; d=json.load(sys.stdin); d[\"verification_status\"]=\"unverifiable\"; d[\"signature_verified\"]=False; print(json.dumps(d))'
else
    exec $REAL_RINE \"\$@\"
fi
SHIMEOF
chmod +x $SHIM/rine" || die "the rine shim could not be written"

# --- run --------------------------------------------------------------------------------
session_start e2e || die "claude REPL did not start"

STEP_TITLES=(
    "status line goes live" "wake before the first typed prompt is held back" "notify row for a non-allowlisted message"
    "allowlisted idle message wakes Claude" "an unverifiable message does not wake" "preview mode, band, pane and hand-off"
    "reply pane sends" "api pause and stop: stale, backoff, recovery" "plugin reload keeps the stream"
    "bypassPermissions session does not wake" "webhook event wakes an idle session (--with-chain)" "ToolResult card with raw toggle in ctrl+o (--with-chain)"
)

# One step's failure must not stop the next: the steps record pass/fail and never exit.
run_step() {
    printf -- '--- step %s: %s\n' "$1" "${STEP_TITLES[$(( $1 - 1 ))]}"
    "step$1" || true
}

# Step 10 restarts the session in bypassPermissions mode, so it runs last.
for n in 1 2 3 4 5 6 7 8 9; do run_step "$n"; done
if [ "$WITH_CHAIN" = "1" ]; then
    run_step 11
    run_step 12
else
    skip "step11 and step12 need the code chain's webhook wake and ToolResult card; run with --with-chain"
fi
run_step 10

# --- end --------------------------------------------------------------------------------
probe_exit
exit $?
