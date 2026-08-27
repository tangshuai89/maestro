#!/usr/bin/env bash
# scripts/test.sh — auto-discover and run every *.test.ts / *.test.mjs under packages/*/src.
# Usage:
#   npm test                 one-shot run
#   npm test -- --watch      re-run whenever any *.test.* or src/** changes
set -euo pipefail

WATCH=0
for arg in "$@"; do
  case "$arg" in
    --watch|-w) WATCH=1 ;;
  esac
done

run_pkg() {
  local pkg="$1"
  local root="$2"
  # ts-node runs ONE script at a time and treats subsequent positional
  # args as process.argv — so we loop, not batch.
  # .test.ts → ts-node (CommonJS packages: common/server/electron)
  # .test.mjs → node (ESM packages: renderer)
  local ts_files mjs_files files
  ts_files=$(find "$root/packages/$pkg/src" -type f -name '*.test.ts' 2>/dev/null | sort)
  mjs_files=$(find "$root/packages/$pkg/src" -type f -name '*.test.mjs' 2>/dev/null | sort)
  files="${ts_files}${mjs_files:+$'\n'${mjs_files}}"
  if [ -z "$files" ]; then return; fi
  local count
  count=$(printf '%s\n' "$files" | grep -c . | tr -d ' ')
  echo "── ${pkg} (${count} test files) ──"
  local f
  for f in $files; do
    if [[ "$f" == *.mjs ]]; then
      ( cd "$root/packages/$pkg" && node "$f" )
    else
      ( cd "$root/packages/$pkg" && npx ts-node "$f" )
    fi
  done
}

run_all() {
  run_pkg common    "$PWD"
  run_pkg server    "$PWD"
  run_pkg electron  "$PWD"
  run_pkg renderer  "$PWD"
  echo "── all tests passed ──"
}

if [ "$WATCH" -eq 0 ]; then
  run_all
  exit 0
fi

# --watch: cheap mtime polling. No chokidar / fs.watch dependency — we just
# re-run whenever any *.test.ts or src/** is newer than the last run.
SENTINEL="$(mktemp -t maestro-test.XXXXXX)"
touch "$SENTINEL"
trap 'rm -f "$SENTINEL"' EXIT

run_all
echo "── watching for changes (Ctrl-C to exit) ──"

while true; do
  sleep 1
  if [ -n "$(find packages -type f \( -name '*.test.ts' -o -name '*.test.mjs' -o -path '*/src/*' \) -newer "$SENTINEL" -print -quit)" ]; then
    touch "$SENTINEL"
    echo
    echo "── change detected, re-running tests ──"
    if ! run_all; then
      echo "── tests failed; will retry on next change ──"
    fi
  fi
done
