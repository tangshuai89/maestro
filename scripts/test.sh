#!/usr/bin/env bash
# scripts/test.sh — auto-discover and run every *.test.ts under packages/*/src.
# Usage: npm test
set -euo pipefail

run_pkg() {
  local pkg="$1"
  local root="$2"
  # Collect absolute paths so we can `cd` into the package without
  # breaking the file locations.
  local files
  files=$(find "$root/packages/$pkg/src" -type f -name '*.test.ts' | sort)
  if [ -z "$files" ]; then return; fi
  local count
  count=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
  echo "── ${pkg} (${count} test files) ──"
  # shellcheck disable=SC2086
  ( cd "$root/packages/$pkg" && npx ts-node $files )
}

run_pkg server    "$PWD"
run_pkg electron  "$PWD"
run_pkg renderer  "$PWD"

echo "── all tests passed ──"
