#!/usr/bin/env bash
# scripts/test.sh — auto-discover and run every *.test.ts / *.test.mjs under packages/*/src.
# Usage:
#   npm test                 one-shot run
#   npm test -- --watch      re-run whenever any *.test.* or src/** changes
#   npm test -- --ci         CI mode: spec-style reporter + non-zero exit on any failure
#   npm test -- --coverage   c8 coverage report + threshold gate (≥60% lines)
#
# ── 失败语义（2026-10-20 修）─────────────────────────────────────────
# 旧实现有两个互相叠加的坑：
#   1. `--ci` 分支用 `set +e` + `OUTPUT=$(run_all 2>&1)`，而 run_all 最后一条
#      命令是 `echo "── all tests passed ──"` → `$?` 恒为 0 → **测试挂了 CI 照样绿**。
#   2. 非 CI 模式全程 `set -e`，server 排第 2 → server 一红，electron(8) +
#      renderer(41) 共 49 个测试文件**永远不会执行**，信号被截断。
#
# 现在统一语义：**跑完全部测试文件，收集失败清单，最后以非零码退出**。
# 一轮跑完能看到所有断点，而不是修一个再发现下一个。
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

# ── 失败收集 ───────────────────────────────────────────────────────
# FAILED_COUNT / FAILED_FILES 由 run_pkg 累加。**必须是顶层普通变量**，
# 不能用 `$(...)` 捕获子 shell 的输出——子 shell 里改的变量出不来。
FAILED_COUNT=0
FAILED_FILES=""

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
  if [ -z "$files" ] && [ -z "$tsx_files" ]; then return 0; fi
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
    # 失败**不中断循环**：记进失败清单，跑完全部文件再统一非零退出。
    # `if ! (...)` 让 errexit 在这条命令上失效，所以外层的 set -e 不会
    # 把整个循环掐掉（掐掉 = server 一红，后面 49 个文件全不跑）。
    local ok=1
    if [[ "$f" == *.mjs ]]; then
      if ! ( cd "$root/packages/$pkg" && node "$f" ); then
        ok=0
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES="${FAILED_FILES} ${short}"
      fi
    else
      if ! ( cd "$root/packages/$pkg" && npx ts-node "$f" ); then
        ok=0
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES="${FAILED_FILES} ${short}"
      fi
    fi
    if [ "$CI_MODE" -eq 1 ]; then
      # 标记必须反映真实结果 —— 旧实现无论成败都打 ✓，挂掉的文件在日志里
      # 看着是绿的，只能靠末尾的失败清单才发现。
      if [ "$ok" -eq 1 ]; then echo "  ✓ ${short}"; else echo "  ✗ ${short}"; fi
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
        local ok=1
        if ! ( cd "$root" && npx vitest run -c "packages/$pkg/vitest.config.ts" "$f" --reporter=verbose ); then
          ok=0
          FAILED_COUNT=$((FAILED_COUNT + 1))
          FAILED_FILES="${FAILED_FILES} ${short}"
        fi
        if [ "$CI_MODE" -eq 1 ]; then
          if [ "$ok" -eq 1 ]; then echo "  ✓ ${short}"; else echo "  ✗ ${short}"; fi
        fi
      done
    else
      echo "  ⚠️  跳过 ${pkg} 的 .test.tsx（暂只支持 renderer 包）"
    fi
  fi
  return 0
}

run_all() {
  run_pkg common    "$PWD"
  run_pkg server    "$PWD"
  run_pkg electron  "$PWD"
  run_pkg renderer  "$PWD"
  if [ "$FAILED_COUNT" -gt 0 ]; then
    return 1
  fi
  echo "── all tests passed ──"
  return 0
}

# ── 失败清单 ───────────────────────────────────────────────────────
report_failures() {
  echo ""
  echo "── ${FAILED_COUNT} 个测试文件失败 ──"
  local f
  for f in $FAILED_FILES; do
    echo "  ✗ $f"
  done
}

# ── CI mode: 跑完全部 + 有失败就非零退出 ───────────────────────────
# ⚠️ 这里**不能**用 `OUTPUT=$(run_all 2>&1)` —— 那是子 shell，FAILED_COUNT
# 的累加留不下来，$? 又只反映最后一条 echo 的状态 → 旧实现就是这么假绿的。
# 直接流式输出，CI 日志里能实时看到是哪个文件挂了。
if [ "$CI_MODE" -eq 1 ]; then
  run_all || true
  if [ "$FAILED_COUNT" -gt 0 ]; then
    report_failures
    exit 1
  fi
  exit 0
fi

# ── Coverage mode: c8 wrapper ────────────────────────────────────
if [ "$COVERAGE" -eq 1 ]; then
  # c8 instruments V8 coverage on the fly — no test code changes needed.
  # We wrap each package's ts-node/node/vitest invocations with c8 and merge.
  COVERAGE_DIR="$PWD/coverage"
  rm -rf "$COVERAGE_DIR"
  mkdir -p "$COVERAGE_DIR"

  # ── c8 公共参数：三个 flag 缺一不可，缺了覆盖率就在骗人 ──────────
  #
  # ① --all --src <dir>
  #    把「从没被任何测试 import」的源文件也拉进报告。
  #    旧实现没有它 → **分母 = 「被某个测试 import 过的文件」**，
  #    从没被 import 的源文件既不计分子也不计分母，被静默排除。
  #    实测：renderer 72 个源文件只有 24 个进报告，48 个凭空消失；
  #    被排除的 55 个文件 ≈ 11698 行全按 0% 计 →
  #    报告自报 85.63%，把所有源文件放进分母的诚实口径只有 **61.67%**。
  #
  # ② --extension .tsx
  #    .tsx 源文件也要插桩。否则 TheaterView.tsx 这种「有 25 个通过的组件测试」
  #    的文件在报告里是 0% —— 测得很好，却因为扩展名没被计入而看不见。
  #
  # ③ --exclude ...
  #    排除编译产物 / 测试文件自身 / .d.ts。否则 common/dist（编译产物）与
  #    common/src（源码）双计，数值虚高 0.98pp。
  #
  # 用 `--exclude=<pattern>` 单参形式 + 引号，避免 `**` 被 shell 提前展开。
  C8_COMMON=(
    --clean=false --reporter=lcov
    "--report-dir=$COVERAGE_DIR" "--temp-directory=$COVERAGE_DIR/.tmp"
    --extension .ts --extension .tsx --all
    "--exclude=**/dist/**" "--exclude=**/*.d.ts"
    "--exclude=**/*.test.ts" "--exclude=**/*.test.tsx" "--exclude=**/*.test.mjs"
  )

  for pkg in common server electron renderer; do
    PKG_ROOT="$PWD/packages/$pkg"
    [ -d "$PKG_ROOT/src" ] || continue
    ts_files=$(find "$PKG_ROOT/src" -type f -name '*.test.ts' 2>/dev/null | sort)
    mjs_files=$(find "$PKG_ROOT/src" -type f -name '*.test.mjs' 2>/dev/null | sort)
    tsx_files=$(find "$PKG_ROOT/src" -type f -name '*.test.tsx' 2>/dev/null | sort)
    files="${ts_files}${mjs_files:+$'\n'${mjs_files}}"
    [ -z "$files" ] && [ -z "$tsx_files" ] && continue
    echo "── coverage: ${pkg} ──"
    for f in $files; do
      # c8 会把被测进程的退出码透传出来，所以 rc!=0 就是测试挂了。
      # 旧写法是 `|| true` —— 失败被整个吞掉，覆盖率步骤永远绿。
      rc=0
      if [[ "$f" == *.mjs ]]; then
        # --clean=false: don't wipe .tmp between files — we need to accumulate
        # coverage across all test files for a correct merged report.
        # .mjs tests import .ts source via the ESM loader; without
        # --extension .ts c8 only counts .js files and the coverage is 0%.
        ( cd "$PKG_ROOT" && npx c8 "${C8_COMMON[@]}" --src src node "$f" ) || rc=$?
      else
        ( cd "$PKG_ROOT" && npx c8 "${C8_COMMON[@]}" --src src npx ts-node "$f" ) || rc=$?
      fi
      if [ "$rc" -ne 0 ]; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES="${FAILED_FILES} ${f#$PKG_ROOT/}"
      fi
    done
    # React 组件 .test.tsx：走 vitest（依赖 happy-dom + @testing-library/react）。
    # **这层以前完全不进覆盖率** —— 16+ 个组件测试文件（186+ 用例）白跑，
    # 对应的 .tsx 源文件在报告里全是 0%。vitest 的 worker 进程会继承
    # NODE_V8_COVERAGE，所以 c8 照样能收到它的覆盖数据（实测 Modal.tsx → 100%）。
    if [ "$pkg" = "renderer" ] && [ -n "$tsx_files" ]; then
      for f in $tsx_files; do
        rc=0
        ( cd "$PWD" && npx c8 "${C8_COMMON[@]}" --src "packages/$pkg/src" \
            npx vitest run -c "packages/$pkg/vitest.config.ts" "$f" --reporter=dot ) || rc=$?
        if [ "$rc" -ne 0 ]; then
          FAILED_COUNT=$((FAILED_COUNT + 1))
          FAILED_FILES="${FAILED_FILES} ${f#$PKG_ROOT/}"
        fi
      done
    fi
  done

  # Merge per-package reports and check threshold
  echo "── merging coverage reports ──"
  # c8 report reads all accumulated V8 coverage from .tmp and produces a merged
  # text table (stdout) + lcov.info. The text table has an "All files" row with
  # per-column percentages.
  #
  # ⚠️ **报告步骤也必须带 --all --src** —— 只在采集步骤加是不够的：
  # c8 report 默认只输出「V8 覆盖率里实际出现过的文件」，而**从没被任何测试
  # import 过的源文件根本不在 V8 覆盖率里**，于是会被静默排除在分母之外。
  # 实测：不带 --all 的报告 111 条目（缺 37 个文件 / 7234 行）；
  # 带上之后 141 条目，缺的那些以 0% 出现 —— 这才是诚实的分母。
  # --src 可以给多次（每个包一次）。
  REPORT=$(npx c8 report --reporter=text --reporter=lcov \
      --report-dir="$COVERAGE_DIR" --temp-directory="$COVERAGE_DIR/.tmp" \
      --all \
      --src "$PWD/packages/common/src" --src "$PWD/packages/server/src" \
      --src "$PWD/packages/renderer/src" --src "$PWD/packages/electron/src" \
      --extension .ts --extension .tsx \
      "--exclude=**/dist/**" "--exclude=**/*.d.ts" \
      "--exclude=**/*.test.ts" "--exclude=**/*.test.tsx" "--exclude=**/*.test.mjs" \
      2>/dev/null || true)
  echo "$REPORT"
  echo "── coverage report written to ${COVERAGE_DIR}/ ──"

  # ── 有测试文件失败 → 覆盖率数字不可用（先看这段再看百分比）────────
  # 这是最容易骗人的一环：**失败的文件不产生（或只产生部分）覆盖数据**，
  # 于是「某个测试文件跑不起来」会伪装成「这块代码没测」——
  # 实测踩过：`reco.test.ts` 跑不起来时，reco.service.ts 覆盖率从 80.27%
  # 塌成 11.1%，看起来像个天大的覆盖洞，其实只是那个测试文件没跑成。
  # 覆盖率是**二手结论**；指认「核心逻辑没测」之前，先确认那个测试文件本身是绿的。
  if [ "$FAILED_COUNT" -gt 0 ]; then
    echo ""
    echo "── ⚠️  本次有 ${FAILED_COUNT} 个测试文件失败 ──"
    echo "   失败的文件不产生（或只产生部分）覆盖数据 → 下面的覆盖率**偏低**。"
    echo "   这不是覆盖率的问题，是测试没过。先修测试，再谈覆盖率门槛。"
    for f in $FAILED_FILES; do
      echo "     ✗ $f"
    done
    echo ""
  fi

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
  if [ "$FAILED_COUNT" -gt 0 ]; then
    report_failures
    exit 1
  fi
  exit 0
fi

if [ "$WATCH" -eq 0 ]; then
  run_all || true
  if [ "$FAILED_COUNT" -gt 0 ]; then
    report_failures
    exit 1
  fi
  exit 0
fi

# --watch: cheap mtime polling. No chokidar / fs.watch dependency — we just
# re-run whenever any *.test.ts or src/** is newer than the last run.
SENTINEL="$(mktemp -t maestro-test.XXXXXX)"
touch "$SENTINEL"
trap 'rm -f "$SENTINEL"' EXIT

run_all || true
echo "── watching for changes (Ctrl-C to exit) ──"

while true; do
  sleep 1
  if [ -n "$(find packages -type f \( -name '*.test.ts' -o -name '*.test.mjs' -o -path '*/src/*' \) -newer "$SENTINEL" -print -quit)" ]; then
    touch "$SENTINEL"
    echo
    echo "── change detected, re-running tests ──"
    # 每轮重置失败计数，否则上轮的失败会让本轮的结论一直是「failed」
    FAILED_COUNT=0
    FAILED_FILES=""
    if ! run_all; then
      report_failures
      echo "── tests failed; will retry on next change ──"
    fi
  fi
done
