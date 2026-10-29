#!/usr/bin/env bash
# seed-tree-mcp.sh — make the plugin's shipped `npx @rine-network/mcp@<pin>` start THIS tree's
# rine-mcp, and put THIS tree's rine CLI on PATH as `rine`. Runs INSIDE the rig only, before the
# probes (run.sh calls it first).
#
# The shipped .mcp.json pins a published version, and a rig that fetched it would measure the
# release a user already has — or, before a release, fail on a version that does not exist yet.
# The pin is left alone (the probes must exercise the config users install); what changes is what
# it resolves to. npx runs a package straight from the nearest node_modules above the working
# directory when that tree already satisfies the requested spec, so this script installs this
# tree's tarballs into $SCRATCH/node_modules, an ancestor of every probe's working directory.
# The same install puts the CLI's bin in $SCRATCH/node_modules/.bin, which the image's PATH
# names first (rig/Dockerfile), so the unreleased CLI is the rig's `rine`.
#
# The tarballs are packed the way a publish packs them: the package.json file: deps are
# rewritten to the sibling's version (scripts/rewrite-file-deps.py) and `npm pack` applies each
# package's `files` allowlist. They come from the bundles the host already built (rine-core,
# rine-cli and rine-mcp dist, the staged rine-mls addon); nothing is built here, and ci.sh
# refuses a stale dist before it starts the rig. Only the third-party dependencies of those packages come from
# the registry, as for any user install.
#
# Sources are mounted read-only by compose.cc.yml under /work/src, in the monorepo layout so the
# file: paths resolve.

set -euo pipefail
SRC="${CC_TREE_SRC:-/work/src}"
SCRATCH="${CC_RIG_SCRATCH:-/work/scratch}"
PLUGIN_MCP_JSON="${CC_PLUGIN_SRC:-/work/rine-cc-plugin}/plugins/rine/.mcp.json"
STAGE="$SCRATCH/tree-src"
TARBALLS="$SCRATCH/tree-tarballs"
MCP=rine-mcp
CLI=rine-cli
CORE=rine-core
MLS=rine-mls/crates/rine-mls-node

for dir in "$MCP" "$CLI" "$CORE" "$MLS"; do
    [ -f "$SRC/$dir/package.json" ] || { printf 'FAIL  %s/%s is not mounted — run through compose.cc.yml\n' "$SRC" "$dir"; exit 1; }
done

ARCH="$(node -p process.arch)"
ADDON="$MLS/npm/linux-$ARCH-gnu"
ls "$SRC/$ADDON"/*.node >/dev/null 2>&1 \
    || { printf 'FAIL  no staged rine-mls addon at %s/%s — build it with scripts/build-mls-artifacts.sh\n' "$SRC" "$ADDON"; exit 1; }

# The staged addon is what gets packed, and nothing else ties it to the addon built from this
# tree's Rust source, so a staging left over from an earlier build would ship in the tarball
# while the build under test is another binary.
BUILT="$SRC/$MLS/rine-mls.linux-$ARCH-gnu.node"
cmp -s "$BUILT" "$SRC/$ADDON/rine-mls.linux-$ARCH-gnu.node" \
    || { printf 'FAIL  the staged rine-mls addon in %s is missing or differs from the built %s — rebuild and stage it with scripts/build-mls-artifacts.sh\n' "$ADDON" "${BUILT#"$SRC"/}"; exit 1; }

rm -rf "$STAGE" "$TARBALLS" "$SCRATCH/node_modules" "$SCRATCH/package.json" "$SCRATCH/package-lock.json"
mkdir -p "$STAGE" "$TARBALLS"
for dir in "$MCP" "$CLI" "$CORE" "$MLS"; do
    mkdir -p "$STAGE/$dir"
    tar -C "$SRC/$dir" --exclude=node_modules --exclude=target -cf - . | tar -C "$STAGE/$dir" -xf -
done
for dir in "$MCP" "$CLI" "$CORE" "$MLS"; do
    python3 "$SRC/rewrite-file-deps.py" "$STAGE/$dir/package.json" >/dev/null
done
for dir in "$MCP" "$CLI" "$CORE" "$MLS" "$ADDON"; do
    (cd "$STAGE/$dir" && npm pack --silent --pack-destination "$TARBALLS" >/dev/null)
done

version() { node -p "require('$STAGE/$1/package.json').version"; }
npm install --prefix "$SCRATCH" --no-audit --no-fund --loglevel=error \
    "$TARBALLS/rine-network-mcp-$(version "$MCP").tgz" \
    "$TARBALLS/rine-network-cli-$(version "$CLI").tgz" \
    "$TARBALLS/rine-network-core-$(version "$CORE").tgz" \
    "$TARBALLS/rine-network-mls-$(version "$MLS").tgz" \
    "$TARBALLS/rine-network-mls-linux-$ARCH-gnu-$(version "$MLS").tgz"

PIN="$(node -p "require('$PLUGIN_MCP_JSON').mcpServers.rine.args[0]")"
WANT="@rine-network/mcp@$(version "$MCP")"
[ "$PIN" = "$WANT" ] \
    || { printf 'FAIL  .mcp.json pins %s but this tree is %s, so npx would fetch the registry instead\n' "$PIN" "$WANT"; exit 1; }
cmp "$SRC/$MCP/dist/server.js" "$SCRATCH/node_modules/@rine-network/mcp/dist/server.js" \
    && cmp "$SRC/$CLI/dist/main.js" "$SCRATCH/node_modules/@rine-network/cli/dist/main.js" \
    && cmp "$SRC/$CORE/dist/index.js" "$SCRATCH/node_modules/@rine-network/core/dist/index.js" \
    || { printf 'FAIL  the installed bundles differ from the mounted tree\n'; exit 1; }

# `rine` must be the CLI just installed: an image whose PATH skips the seeded bin, or one that
# still carries a published CLI, would run every probe against another build.
WANT_BIN="$SCRATCH/node_modules/.bin/rine"
[ "$(command -v rine)" = "$WANT_BIN" ] \
    || { printf 'FAIL  `rine` resolves to %s, not %s — rebuild the image (docker compose -f compose.cc.yml build)\n' "$(command -v rine || echo nothing)" "$WANT_BIN"; exit 1; }
[ "$(rine --version | tr -d '[:space:]')" = "$(version "$CLI")" ] \
    || { printf 'FAIL  rine --version is not this tree'"'"'s rine-cli %s\n' "$(version "$CLI")"; exit 1; }
rine tui --help >/dev/null \
    || { printf 'FAIL  `rine tui --help` failed — this tree'"'"'s CLI lacks the tui verb or cannot start\n'; exit 1; }

# The org reader reaches MLS only through the addon that rine-core resolves. An addon without
# `EpochReader` still loads, and every reader call would then read the missing class as a gap.
SEEN="$(cd "$SCRATCH" && node -e "const m=require('@rine-network/mls');console.log(typeof m.EpochReader, typeof (m.EpochReader && m.EpochReader.fromEscrow))")" \
    || { printf 'FAIL  the installed rine-mls addon does not load\n'; exit 1; }
[ "$SEEN" = "function function" ] \
    || { printf 'FAIL  the installed rine-mls addon lacks EpochReader.fromEscrow (typeof: %s) — rebuild and stage it with scripts/build-mls-artifacts.sh\n' "$SEEN"; exit 1; }
printf 'PASS  %s resolves to this tree (rine-mcp, rine-cli, rine-core, rine-mls addon %s)\n' "$PIN" "$ARCH"
