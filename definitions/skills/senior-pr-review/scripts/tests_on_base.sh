#!/usr/bin/env bash
# Prove that the PR's tests detect the bug: run a test command on HEAD, then
# again with every changed NON-test file reverted to the merge-base, keeping
# the PR's test files. A test that passes on base does not prove the fix.
#
# Usage:
#   tests_on_base.sh [--log-dir DIR] <base-ref> -- <test command...>
#
# Example:
#   tests_on_base.sh origin/development -- pnpm --filter=@repo/api exec vitest run src/foo.spec.ts
#
# Runs in the current checkout (it must be at the PR head) and reuses its
# installed dependencies. It refuses to start when a path it would touch has
# local changes, and it restores every touched path on exit, even on failure
# or interrupt.
#
# Output (last line, tab-separated):  head=<pass|fail>  base=<pass|fail>  verdict=<...>
#   verdict=proves        head passes, base fails
#   verdict=does-not-prove  base passes too: the test does not detect the bug
#   verdict=head-fails    the test fails on the PR head itself
#   verdict=import-error  base fails only because a module the test imports is new;
#                         weaker proof, say so in the report
# Exit code: 0 for proves, 1 for any other verdict, 2 for usage, 3 for unsafe tree.

set -euo pipefail

LOG_DIR=""
while [[ $# -gt 0 && "$1" != "--" ]]; do
  case "$1" in
    --log-dir) LOG_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) [[ -z "${BASE_REF:-}" ]] && BASE_REF="$1" && shift && continue
       echo "unexpected argument: $1" >&2; exit 2 ;;
  esac
done
[[ "${1:-}" == "--" ]] && shift
[[ -n "${BASE_REF:-}" && $# -gt 0 ]] || { sed -n '6,8p' "$0" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
MB="$(git merge-base "$BASE_REF" HEAD)"
[[ "$MB" != "$(git rev-parse HEAD)" ]] || { echo "HEAD is the merge-base; nothing to compare" >&2; exit 2; }
LOG_DIR="${LOG_DIR:-$(mktemp -d)}"
mkdir -p "$LOG_DIR"

TEST_RE='(^|/)(__tests__|__mocks__|__snapshots__|__fixtures__|fixtures|test|tests)/|\.(spec|test)\.[cm]?[jt]sx?$|(^|/)test_[^/]*\.py$|_test\.(py|go)$|\.snap$'

SOURCE_PATHS=()
while IFS=$'\t' read -r status a b; do
  case "$status" in
    R*|C*) paths=("$a" "$b") ;;
    *) paths=("$a") ;;
  esac
  for p in "${paths[@]}"; do
    [[ "$p" =~ $TEST_RE ]] && continue
    SOURCE_PATHS+=("$p")
  done
done < <(git diff --name-status "$MB" HEAD)

[[ ${#SOURCE_PATHS[@]} -gt 0 ]] || { echo "no non-test files changed; nothing to revert" >&2; exit 2; }

if [[ -n "$(git status --porcelain -- "${SOURCE_PATHS[@]}")" ]]; then
  echo "local changes on paths this script would revert; commit or move them first:" >&2
  git status --porcelain -- "${SOURCE_PATHS[@]}" >&2
  exit 3
fi

restore() {
  for p in "${SOURCE_PATHS[@]}"; do
    if git cat-file -e "HEAD:$p" 2>/dev/null; then
      git checkout -q HEAD -- "$p"
    else
      rm -f "$p"
    fi
  done
}

run() {
  local label="$1"; shift
  if "$@" >"$LOG_DIR/$label.log" 2>&1; then echo pass; else echo fail; fi
}

HEAD_RESULT="$(run head "$@")"

trap restore EXIT INT TERM
for p in "${SOURCE_PATHS[@]}"; do
  if git cat-file -e "$MB:$p" 2>/dev/null; then
    git checkout -q "$MB" -- "$p"
  else
    rm -f "$p"
  fi
done
BASE_RESULT="$(run base "$@")"
restore
trap - EXIT INT TERM

[[ -z "$(git status --porcelain -- "${SOURCE_PATHS[@]}")" ]] || echo "warning: tree not clean after restore" >&2

if [[ "$HEAD_RESULT" == fail ]]; then
  VERDICT=head-fails
elif [[ "$BASE_RESULT" == pass ]]; then
  VERDICT=does-not-prove
elif grep -qE "Cannot find module|Failed to (load|resolve) (url|import)|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|does not provide an export named" "$LOG_DIR/base.log" \
  && ! grep -qE "AssertionError|expected .* to |Expected:|toBe|toEqual" "$LOG_DIR/base.log"; then
  VERDICT=import-error
else
  VERDICT=proves
fi

echo "reverted ${#SOURCE_PATHS[@]} non-test path(s) to ${MB:0:10}; logs in $LOG_DIR"
printf 'head=%s\tbase=%s\tverdict=%s\n' "$HEAD_RESULT" "$BASE_RESULT" "$VERDICT"
[[ "$VERDICT" == proves ]]
