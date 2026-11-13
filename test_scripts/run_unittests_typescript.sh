#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <build_folder>" >&2
  exit 1
fi
if [ ! -d "$1" ]; then
  echo "Error: build folder is missing or inaccessible: $1" >&2
  exit 2
fi

# Prefer an already configured Node; also discover Homebrew's versioned Node.
node_version=$(node --version 2>/dev/null) || node_version=""
major=${node_version#v}
major=${major%%.*}
if ! [[ "$major" =~ ^[0-9]+$ ]] || [ "$major" -lt 26 ]; then
  for candidate in /opt/homebrew/opt/node@26/bin /usr/local/opt/node@26/bin; do
    if [ -x "$candidate/node" ]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi
node_version=$(node --version 2>/dev/null) || { echo "Error: Node.js 26 or later is required" >&2; exit 69; }
major=${node_version#v}; major=${major%%.*}
if ! [[ "$major" =~ ^[0-9]+$ ]] || [ "$major" -lt 26 ]; then
  echo "Error: Node.js 26 or later is required (found $node_version)" >&2
  exit 69
fi
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm is required" >&2; exit 69; }
echo "Node: $node_version; pnpm: $(pnpm --version)"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/factory-unit.XXXXXXXX") || exit 69
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/project" "$scratch/store" "$scratch/cache"
cp -R "$1/." "$scratch/project/"
export npm_config_cache="$scratch/cache"
export XDG_CACHE_HOME="$scratch/cache"
cd "$scratch/project" || exit 69
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --store-dir "$scratch/store" || exit 69
else
  pnpm install --no-frozen-lockfile --store-dir "$scratch/store" || exit 69
fi
pnpm -r run format:check
pnpm -r run lint
pnpm -r run typecheck
pnpm -r run test
