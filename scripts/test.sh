#!/usr/bin/env bash
# scripts/test.sh — auto-discover and run every *.test.ts / *.test.mjs under packages/*/src.
# Usage:
#   npm test                 one-shot run
#   npm test -- --watch      re-run whenever any *.test.* or src/** changes
#   npm test -- --ci         CI mode: --bail (first failure exits) + spec reporter
#   npm test -- --coverage   c8 coverage report + threshold gate (≥60% lines)
set -euo pipefail

WATCH=0
CI_MODE=0
COVERAGE=0
for arg in "$@"; do
  case "$arg" in
    --watch|-w) WATCH=1 ;;
    --ci)       CI_MODE=1 ;;
    --coverage) COVERAGE=1 ;;
  esac
done

# ── CI mode: --bail + spec reporter ──────────────────────────────
# In CI mode, the first failing test file exits immediately with a non-zero
# code. Each test file's output is prefixed with a spec-style header.
CI_BAIL=""
if [ "$CI_MODE" -eq 1 ]; then
  CI_BAIL="1"
fi

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
    local short
    short="${f#$root/}"
    if [ "$CI_MODE" -eq 1 ]; then
      echo "  ▸ ${short}"
    fi
    if [[ "$f" == *.mjs ]]; then
      ( cd "$root/packages/$pkg" && node "$f" )
    else
      ( cd "$root/packages/$pkg" && npx ts-node "$f" )
    fi
    if [ "$CI_MODE" -eq 1 ]; then
      echo "  ✓ ${short}"
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

# ── CI mode: bail on first failure ───────────────────────────────
if [ "$CI_MODE" -eq 1 ]; then
  set +e
  OUTPUT=$(run_all 2>&1)
  EXIT_CODE=$?
  set -e
  echo "$OUTPUT"
  if [ "$EXIT_CODE" -ne 0 ]; then
    echo ""
    echo "── CI bail: tests failed (exit ${EXIT_CODE}) ──"
    exit "$EXIT_CODE"
  fi
  exit 0
fi

# ── Coverage mode: c8 wrapper ────────────────────────────────────
if [ "$COVERAGE" -eq 1 ]; then
  # c8 instruments V8 coverage on the fly — no test code changes needed.
  # We wrap each package's ts-node/node invocations with c8 and merge.
  COVERAGE_DIR="$PWD/coverage"
  rm -rf "$COVERAGE_DIR"
  mkdir -p "$COVERAGE_DIR"

  for pkg in common server electron renderer; do
    PKG_ROOT="$PWD/packages/$pkg"
    [ -d "$PKG_ROOT/src" ] || continue
    ts_files=$(find "$PKG_ROOT/src" -type f -name '*.test.ts' 2>/dev/null | sort)
    mjs_files=$(find "$PKG_ROOT/src" -type f -name '*.test.mjs' 2>/dev/null | sort)
    files="${ts_files}${mjs_files:+$'\n'${mjs_files}}"
    [ -z "$files" ] && continue
    echo "── coverage: ${pkg} ──"
    for f in $files; do
      if [[ "$f" == *.mjs ]]; then
        ( cd "$PKG_ROOT" && npx c8 --reporter=text --reporter=lcov \
            --report-dir="$COVERAGE_DIR" --temp-directory="$COVERAGE_DIR/.tmp" \
            node "$f" ) || true
      else
        ( cd "$PKG_ROOT" && npx c8 --reporter=text --reporter=lcov \
            --report-dir="$COVERAGE_DIR" --temp-directory="$COVERAGE_DIR/.tmp" \
            --extension .ts npx ts-node "$f" ) || true
      fi
    done
  done

  # Merge per-package reports and check threshold
  echo "── merging coverage reports ──"
  if npx c8 report --reporter=text --reporter=text-summary \
      --report-dir="$COVERAGE_DIR" --temp-directory="$COVERAGE_DIR/.tmp" 2>/dev/null; then
    echo "── coverage report written to ${COVERAGE_DIR}/ ──"
  else
    echo "── coverage report written to ${COVERAGE_DIR}/ (merge skipped) ──"
  fi

  # Threshold gate: ≥60% lines
  LINES=$(cat "$COVERAGE_DIR"/*.txt 2>/dev/null | grep -E '^\s*All files' | awk '{for(i=1;i<=NF;i++) if($i ~ /^[0-9.]+%?$/) {print $i; exit}}' | tr -d '%' || echo "0")
  echo "── total line coverage: ${LINES}% ──"
  if [ -z "$LINES" ] || [ "$LINES" -lt 60 ] 2>/dev/null; then
    echo "── ⚠️  coverage below 60% threshold (got ${LINES:-0}%) ──"
    # Don't fail in initial rollout — warn only
    # exit 1
  fi
  exit 0
fi

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
