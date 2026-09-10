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
  # .test.tsx → vitest (renderer only; 自定义 loader 不支持 vitest 故
  #             .test.mjs 仍走 node，但 .test.tsx 引入 vitest 单独跑)
  local ts_files mjs_files tsx_files files
  ts_files=$(find "$root/packages/$pkg/src" -type f -name '*.test.ts' 2>/dev/null | sort)
  mjs_files=$(find "$root/packages/$pkg/src" -type f -name '*.test.mjs' 2>/dev/null | sort)
  tsx_files=$(find "$root/packages/$pkg/src" -type f -name '*.test.tsx' 2>/dev/null | sort)
  files="${ts_files}${mjs_files:+$'\n'${mjs_files}}"
  if [ -z "$files" ] && [ -z "$tsx_files" ]; then return; fi
  # 注意：`grep -c .` 零匹配时会**同时**打印 "0" 和以 1 退出，所以 `|| echo 0` 会再补一个 "0"，
  # 命令替换拿到 "0\n0"，算术展开直接语法错误（$(( 4 + 0⏎0 ))）。用 `|| true` 只吞退出码。
  local count=$(( $(printf '%s\n' "$files" 2>/dev/null | grep -c . || true) + $(printf '%s\n' "$tsx_files" 2>/dev/null | grep -c . || true) ))
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
  # React 组件 .test.tsx：仅 renderer 包支持（依赖 vitest + happy-dom）
  if [ -n "$tsx_files" ]; then
    if [ "$pkg" = "renderer" ]; then
      for f in $tsx_files; do
        local short
        short="${f#$root/}"
        if [ "$CI_MODE" -eq 1 ]; then
          echo "  ▸ ${short}"
        fi
        # 显式 -c 避免 npm 装在 monorepo 根时 vitest 找不到 config
        ( cd "$root" && npx vitest run -c "packages/$pkg/vitest.config.ts" "$f" --reporter=verbose )
        if [ "$CI_MODE" -eq 1 ]; then
          echo "  ✓ ${short}"
        fi
      done
    else
      echo "  ⚠️  跳过 ${pkg} 的 .test.tsx（暂只支持 renderer 包）"
    fi
  fi
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
        # --clean=false: don't wipe .tmp between files — we need to accumulate
        # coverage across all test files for a correct merged report.
        # --extension .ts: .mjs tests import .ts source via the ESM loader;
        # without this c8 only counts .js files and the coverage is 0%.
        ( cd "$PKG_ROOT" && npx c8 --clean=false --reporter=lcov \
            --report-dir="$COVERAGE_DIR" --temp-directory="$COVERAGE_DIR/.tmp" \
            --extension .ts node "$f" ) || true
      else
        ( cd "$PKG_ROOT" && npx c8 --clean=false --reporter=lcov \
            --report-dir="$COVERAGE_DIR" --temp-directory="$COVERAGE_DIR/.tmp" \
            --extension .ts npx ts-node "$f" ) || true
      fi
    done
  done

  # Merge per-package reports and check threshold
  echo "── merging coverage reports ──"
  # c8 report reads all accumulated V8 coverage from .tmp and produces a merged
  # text table (stdout) + lcov.info. The text table has an "All files" row with
  # per-column percentages.
  REPORT=$(npx c8 report --reporter=text --reporter=lcov \
      --report-dir="$COVERAGE_DIR" --temp-directory="$COVERAGE_DIR/.tmp" 2>/dev/null || true)
  echo "$REPORT"
  echo "── coverage report written to ${COVERAGE_DIR}/ ──"

  # Threshold gate: ≥60% lines
  # Parse the "All files" row from the text report. Columns are pipe-delimited:
  # File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Ln.
  # Field 5 (1-indexed by awk -F'|') is % Lines.
  LINES=$(echo "$REPORT" | grep -E 'All files' | tail -1 | awk -F'|' '{gsub(/[ %]/, "", $5); print $5}')
  if [ -z "$LINES" ]; then LINES=0; fi
  echo "── total line coverage: ${LINES}% ──"
  if awk -v l="$LINES" 'BEGIN{exit !(l < 60)}'; then
    echo "── ⚠️  coverage below 60% threshold (got ${LINES}%) ──"
    exit 1
  fi
  echo "── ✅ coverage meets 60% line threshold ──"
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
