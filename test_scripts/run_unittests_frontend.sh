#!/bin/bash

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
WORKING_FOLDER="/tmp/node_frontend_$(basename "$SOURCE_FOLDER")"
case "$WORKING_FOLDER/" in
  "$SOURCE_FOLDER/"*) echo "Error: staging folder overlaps the source folder." >&2; exit 2 ;;
esac

printf '\n===== [3/8] Working directory setup =====\n'
echo "Source: $SOURCE_FOLDER; staging and isolation root: $WORKING_FOLDER"
trap 'rm -rf -- "$WORKING_FOLDER"' EXIT
rm -rf -- "$WORKING_FOLDER" || exit 2
mkdir -p "$WORKING_FOLDER" || exit 2

printf '\n===== [4/8] Copy build =====\n'
cp -R "$SOURCE_FOLDER"/. "$WORKING_FOLDER"/ || exit 2
# Installed modules may contain links back to the source or another project.
find "$WORKING_FOLDER" -name node_modules -prune -exec rm -rf -- {} + || exit 2

printf '\n===== [5/8] Enter working directory =====\n'
echo "Moving to: $WORKING_FOLDER"
cd "$WORKING_FOLDER" || exit 2

printf '\n===== [6/8] Install isolated dependencies =====\n'
export HOME="$WORKING_FOLDER/.home"
export XDG_CACHE_HOME="$WORKING_FOLDER/.cache"
export XDG_CONFIG_HOME="$WORKING_FOLDER/.config"
export XDG_DATA_HOME="$WORKING_FOLDER/.data"
export XDG_STATE_HOME="$WORKING_FOLDER/.state"
export npm_config_cache="$WORKING_FOLDER/.npm-cache"
export npm_config_userconfig="$WORKING_FOLDER/.npmrc-isolated"
export npm_config_globalconfig="$WORKING_FOLDER/.npmrc-global"
export COREPACK_HOME="$WORKING_FOLDER/.corepack"
export TMPDIR="$WORKING_FOLDER/.tmp"
mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$npm_config_cache" "$COREPACK_HOME" "$TMPDIR" || exit 2
echo "Manifest: $WORKING_FOLDER/package.json; lockfile: $WORKING_FOLDER/pnpm-lock.yaml; store: $WORKING_FOLDER/.pnpm-store; PATH=$PATH"
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --store-dir "$WORKING_FOLDER/.pnpm-store"
else
  pnpm install --no-frozen-lockfile --store-dir "$WORKING_FOLDER/.pnpm-store"
fi
INSTALL_STATUS=$?
if [ "$INSTALL_STATUS" -ne 0 ]; then
  echo "Dependency installation failed in $WORKING_FOLDER, exit $INSTALL_STATUS; HOME=$HOME; TMPDIR=$TMPDIR; PATH=$PATH" >&2
  exit "$INSTALL_STATUS"
fi

printf '\n===== [7/8] Static checks =====\n'
CHECKS=0
pnpm exec prettier --list-different --ignore-unknown . || CHECKS=1
pnpm exec oxlint --deny-warnings . || CHECKS=1
# Check each workspace package's TypeScript configuration, including the root.
pnpm --recursive --include-workspace-root exec tsc --noEmit --pretty false || CHECKS=1

printf '\n===== [8/8] Unit tests =====\n'
echo "Running pnpm --recursive --include-workspace-root run test in $WORKING_FOLDER; HOME=$HOME; TMPDIR=$TMPDIR; PATH=$PATH"
pnpm --recursive --include-workspace-root run test
TESTS=$?
if [ "$TESTS" -ne 0 ]; then
  STATUS=$TESTS
elif [ "$CHECKS" -ne 0 ]; then
  STATUS=80
else
  STATUS=0
fi
echo "Summary: pnpm recursive test exit $TESTS; static checks failed=$CHECKS; exit $STATUS; working folder $WORKING_FOLDER"
exit "$STATUS"
