#!/usr/bin/env bash
# scripts/test.sh — auto-discover and run every *.test.ts under packages/*/src.
# Usage: npm test
set -euo pipefail

run_pkg() {
  local pkg="$1"
  local root="$2"
  # ts-node runs ONE script at a time and treats subsequent positional
  # args as process.argv — so we loop, not batch. `find -print0` + the
  # while-read idiom handles filenames with spaces (none today, but free).
  local files
  files=$(find "$root/packages/$pkg/src" -type f -name '*.test.ts' | sort)
  if [ -z "$files" ]; then return; fi
  local count
  count=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
  echo "── ${pkg} (${count} test files) ──"
  local f
  for f in $files; do
    ( cd "$root/packages/$pkg" && npx ts-node "$f" )
  done
}

run_pkg common    "$PWD"
run_pkg server    "$PWD"
run_pkg electron  "$PWD"
run_pkg renderer  "$PWD"

echo "── all tests passed ──"
