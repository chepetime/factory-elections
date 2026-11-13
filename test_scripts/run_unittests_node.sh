#!/bin/bash

# Stage the generated workspace before running any command that can write.
set -x
printf '\n===== [1/8] Toolchain check =====\n'
for tool in node pnpm; do
  if ! command -v "$tool"; then
    echo "Error: $tool is required on PATH." >&2
    exit 69
  fi
  "$tool" --version || exit 69
done
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])') || exit 69
if [ "$NODE_MAJOR" -lt 26 ]; then
  echo "Error: Node.js 26 or later is required; found $(node --version)." >&2
  exit 69
fi

printf '\n===== [2/8] Argument validation =====\n'
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <build_folder>" >&2
  exit 1
fi
if [ ! -d "$1" ]; then
  echo "Error: build folder is not accessible: $1" >&2
  exit 2
fi
SOURCE_FOLDER=$(cd "$1" && pwd -P) || exit 2
printf '\n===== [3/8] Working directory setup =====\n'
# Each invocation needs its own tree: concurrent factory pulses use the same
# build-folder basename and must not delete each other's dependencies.
WORKING_FOLDER=$(mktemp -d "/tmp/node_$(basename "$SOURCE_FOLDER").XXXXXX") || exit 2
trap 'rm -rf -- "$WORKING_FOLDER"' EXIT
# Never stage within the source tree, including when the source is /tmp.
case "$WORKING_FOLDER/" in
  "$SOURCE_FOLDER/"*) echo "Error: staging directory is inside the source folder." >&2; exit 2 ;;
esac
echo "Source: $SOURCE_FOLDER; staging and isolation root: $WORKING_FOLDER"

printf '\n===== [4/8] Copy build =====\n'
# Exclude dependencies during copying: copying and deleting a large node_modules
# tree can consume the entire test deadline. Install a fresh isolated tree below.
# A temporary archive preserves dotfiles and lets us check both tar exit codes.
tar -C "$SOURCE_FOLDER" --exclude=node_modules -cf "$WORKING_FOLDER/.build-copy.tar" . || exit 2
tar -C "$WORKING_FOLDER" -xf "$WORKING_FOLDER/.build-copy.tar" || exit 2
rm -f "$WORKING_FOLDER/.build-copy.tar" || exit 2

printf '\n===== [5/8] Enter working directory =====\n'
echo "Moving to: $WORKING_FOLDER"
cd "$WORKING_FOLDER" || exit 2

printf '\n===== [6/8] Install isolated dependencies =====\n'
# Keep pnpm, npm, tool and temporary caches in the staged copy, including on later commands.
export HOME="$WORKING_FOLDER/.home"
export XDG_CACHE_HOME="$WORKING_FOLDER/.cache"
export XDG_CONFIG_HOME="$WORKING_FOLDER/.config"
export XDG_DATA_HOME="$WORKING_FOLDER/.data"
export XDG_STATE_HOME="$WORKING_FOLDER/.state"
export npm_config_cache="$WORKING_FOLDER/.npm-cache"
export npm_config_userconfig="$WORKING_FOLDER/.npmrc-isolated"
export npm_config_globalconfig="$WORKING_FOLDER/.npmrc-global"
export TMPDIR="$WORKING_FOLDER/.tmp"
mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$npm_config_cache" "$TMPDIR" || exit 2
echo "Manifest: $WORKING_FOLDER/package.json; lockfile: $WORKING_FOLDER/pnpm-lock.yaml; store: $WORKING_FOLDER/.pnpm-store; PATH=$PATH"
pnpm install --frozen-lockfile --store-dir "$WORKING_FOLDER/.pnpm-store"
INSTALL_STATUS=$?
if [ "$INSTALL_STATUS" -ne 0 ]; then
  echo "Dependency installation failed: pnpm install --frozen-lockfile --store-dir $WORKING_FOLDER/.pnpm-store (cwd $WORKING_FOLDER), exit $INSTALL_STATUS" >&2
  exit "$INSTALL_STATUS"
fi

printf '\n===== [7/8] Static checks =====\n'
CHECKS=0
# Prettier and TypeScript are workspace dev dependencies. The project's ADR
# selects oxlint; --deny-warnings prevents configuration from allowing warnings.
pnpm exec prettier --list-different --ignore-unknown . || CHECKS=1
pnpm exec oxlint --deny-warnings . || CHECKS=1
# A root solution tsconfig needs build mode; ordinary configs use noEmit.
if node -e 'const fs=require("node:fs"); const s=fs.readFileSync("tsconfig.json","utf8"); const ts=require("typescript"); const c=ts.parseConfigFileTextToJson("tsconfig.json",s); if(c.error) process.exit(1); process.exit(Array.isArray(c.config.references) && !c.config.compilerOptions && !c.config.include && (!c.config.files || c.config.files.length === 0) ? 0 : 1)'; then
  pnpm exec tsc --build --pretty false || CHECKS=1
else
  pnpm exec tsc --noEmit --pretty false || CHECKS=1
fi

printf '\n===== [8/8] Unit tests =====\n'
# The workspace owns its test script (node --test and any changed-only selector).
# Run the full suite here: an isolated copy has no reliable git baseline.
echo "Running pnpm test in $WORKING_FOLDER; PATH=$PATH; HOME=$HOME; TMPDIR=$TMPDIR"
pnpm test
TESTS=$?
if [ "$TESTS" -ne 0 ]; then
  STATUS=$TESTS
elif [ "$CHECKS" -ne 0 ]; then
  STATUS=80
else
  STATUS=0
fi
echo "Summary: pnpm test exit $TESTS; static checks failed=$CHECKS; exit $STATUS; working folder $WORKING_FOLDER"
exit "$STATUS"
