#!/usr/bin/env bash
# scripts/test.sh — auto-discover and run every *.test.ts / *.test.mjs / *.test.tsx
# under packages/*/src.
#
# Usage:
#   npm test                 one-shot run（不插桩，本地最快）
#   npm test -- --watch      re-run whenever any *.test.* or src/** changes
#   npm test -- --ci         CI 模式：采集覆盖率 + 判定 + 打印报告（**不判阈值**）
#   npm run test:coverage    复用采集数据出报告 + **判阈值**（≥60% 行覆盖）
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
#
# ── 「一次采集、两处判定」（2026-10-21）──────────────────────────────
# 旧结构：测试跑一遍（不插桩）→ 覆盖率**再跑一遍**（插桩）。两个后果：
#   1. **慢**：CI 的 30 分钟里有一半是那第二遍。
#   2. **数字不可信**：两次不是同一次执行 → 某个测试文件跑不起来时，它贡献的
#      覆盖数据就没了 → 覆盖率塌成"假的覆盖洞"。实测踩过：reco.test.ts 跑不
#      起来时，reco.service.ts 的覆盖率从 80.27% 塌成 32.88%，看着像天大的
#      问题，其实只是那次测试没跑成。
#
# 现在：测试**在插桩下跑**（一次），同一份执行同时给出「过没过」和「覆盖多少」：
#   - `--ci`        → 采集 + 判定 + **打印**报告（阈值不判：PR 上判全局覆盖率
#                      是粒度错配，全局数字拦不住任何具体的坏 PR）
#   - `--coverage`  → 复用同一 job 里刚采集的数据出报告 + **判阈值**（master 用）
#                     没有新鲜数据时才自己采集一遍（本地单独跑 / 每日定时任务）
set -euo pipefail

WATCH=0
CI_MODE=0
COVERAGE=0
INSTRUMENT=0
for arg in "$@"; do
  case "$arg" in
    --watch|-w) WATCH=1 ;;
    --ci)       CI_MODE=1; INSTRUMENT=1 ;;
    --coverage) COVERAGE=1; INSTRUMENT=1 ;;
  esac
done

# ── 失败收集 ───────────────────────────────────────────────────────
# FAILED_COUNT / FAILED_FILES 由 run_pkg 累加。**必须是顶层普通变量**，
# 不能用 `$(...)` 捕获子 shell 的输出——子 shell 里改的变量出不来。
FAILED_COUNT=0
FAILED_FILES=""

COVERAGE_DIR="$PWD/coverage"
COV_TMP="$COVERAGE_DIR/.tmp"
# 采集数据的"新鲜度"标记：--coverage 靠它决定复用还是重采。
COV_MARKER="$COV_TMP/.collected-at"

# ── c8 公共参数：三个 flag 缺一不可，缺了覆盖率就在骗人 ──────────────
#
# ① --all --src <dir>
#    把「从没被任何测试 import」的源文件也拉进报告。
#    没有它 → **分母 = 「被某个测试 import 过的文件」**，从没被 import 的源文件
#    既不计分子也不计分母，被静默排除。实测：renderer 72 个源文件只有 24 个
#    进报告，48 个凭空消失；被排除的 55 个文件 ≈ 11698 行全按 0% 计 →
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
  "--report-dir=$COVERAGE_DIR" "--temp-directory=$COV_TMP"
  --extension .ts --extension .tsx --all
  "--exclude=**/dist/**" "--exclude=**/*.d.ts"
  "--exclude=**/*.test.ts" "--exclude=**/*.test.tsx" "--exclude=**/*.test.mjs"
)

# ── 失败清单 ───────────────────────────────────────────────────────
report_failures() {
  echo ""
  echo "── ${FAILED_COUNT} 个测试文件失败 ──"
  local f
  for f in $FAILED_FILES; do
    echo "  ✗ $f"
  done
}

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
  ts_files="${ts_files}${mjs_files:+$'\n'${mjs_files}}"
  files="$ts_files"
  tsx_files=$(find "$root/packages/$pkg/src" -type f -name '*.test.tsx' 2>/dev/null | sort)
  if [ -z "$files" ] && [ -z "$tsx_files" ]; then return 0; fi
  # 注意：`grep -c .` 零匹配时会**同时**打印 "0" 并以 1 退出，所以 `|| echo 0` 会再补一个 "0"，
  # 命令替换拿到 "0\n0"，算术展开直接语法错误（$(( 4 + 0⏎0 ))）。用 `|| true` 只吞退出码。
  local count=$(( $(printf '%s\n' "$files" 2>/dev/null | grep -c . || true) + $(printf '%s\n' "$tsx_files" 2>/dev/null | grep -c . || true) ))
  echo "── ${pkg} (${count} test files) ──"
  local f
  for f in $files; do
    local short="${f#$root/}"
    if [ "$CI_MODE" -eq 1 ]; then
      echo "  ▸ ${short}"
    fi
    # 失败**不中断循环**：记进失败清单，跑完全部文件再统一非零退出。
    # `if ! (...)` 让 errexit 在这条命令上失效，所以外层的 set -e 不会
    # 把整个循环掐掉（掐掉 = server 一红，后面 49 个文件全不跑）。
    local ok=1
    if [[ "$f" == *.mjs ]]; then
      if [ "$INSTRUMENT" -eq 1 ]; then
        # .mjs tests import .ts source via the ESM loader; without
        # --extension .ts c8 only counts .js files and the coverage is 0%.
        ( cd "$root/packages/$pkg" && npx c8 "${C8_COMMON[@]}" --src src node "$f" ) || ok=0
      else
        ( cd "$root/packages/$pkg" && node "$f" ) || ok=0
      fi
    else
      if [ "$INSTRUMENT" -eq 1 ]; then
        ( cd "$root/packages/$pkg" && npx c8 "${C8_COMMON[@]}" --src src npx ts-node "$f" ) || ok=0
      else
        ( cd "$root/packages/$pkg" && npx ts-node "$f" ) || ok=0
      fi
    fi
    if [ "$ok" -eq 0 ]; then
      FAILED_COUNT=$((FAILED_COUNT + 1))
      FAILED_FILES="${FAILED_FILES} ${short}"
      if [ "$CI_MODE" -eq 1 ]; then echo "  ✗ ${short}"; fi
    elif [ "$CI_MODE" -eq 1 ]; then
      echo "  ✓ ${short}"
    fi
  done
  # React 组件 .test.tsx：**一次 vitest 跑全部**（快），失败再逐个跑归因。
  #
  # 为什么批处理：原来每个 .test.tsx 都单独起一次 vitest（每次都要完整 discover
  # 再过滤），17 个文件 ≈ 10 分钟 —— CI 的大头。批处理后只剩一次。
  # 失败归因保留：批量失败时再逐个跑一遍，定位到具体文件（慢，但只在失败时）。
  if [ "$pkg" = "renderer" ] && [ -n "$tsx_files" ]; then
    local ok=1
    if [ "$INSTRUMENT" -eq 1 ]; then
      ( cd "$root" && npx c8 "${C8_COMMON[@]}" --src "packages/$pkg/src" \
          npx vitest run -c "packages/$pkg/vitest.config.ts" --reporter=dot ) || ok=0
    else
      ( cd "$root" && npx vitest run -c "packages/$pkg/vitest.config.ts" --reporter=dot ) || ok=0
    fi
    if [ "$ok" -eq 0 ]; then
      echo "  ⚠️ 组件测试批量失败 → 逐个归因"
      for f in $tsx_files; do
        local short="${f#$root/}"
        if [ "$CI_MODE" -eq 1 ]; then echo "  ▸ ${short}"; fi
        local rc=0
        # 相对路径（见下面说明）：vitest 的 include 是 realpath，绝对 filter
        # 在有软链的路径下匹配不上 → 整段静默不跑
        ( cd "$root" && npx vitest run -c "packages/$pkg/vitest.config.ts" "${f#$PWD/}" --reporter=dot ) || rc=$?
        if [ "$rc" -ne 0 ]; then
          FAILED_COUNT=$((FAILED_COUNT + 1))
          FAILED_FILES="${FAILED_FILES} ${short}"
          [ "$CI_MODE" -eq 1 ] && echo "  ✗ ${short}"
        elif [ "$CI_MODE" -eq 1 ]; then
          echo "  ✓ ${short}"
        fi
      done
    elif [ "$CI_MODE" -eq 1 ]; then
      local tsx_count
      tsx_count=$(printf '%s\n' "$tsx_files" | grep -c . || true)
      echo "  ✓ ${tsx_count} 个组件测试文件（批量，一次 vitest）"
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

# ── 采集 / 报告 / 阈值 ─────────────────────────────────────────────
# 覆盖率报告（只读已有采集数据）。
c8_report() {
  npx c8 report --reporter=text --reporter=lcov \
    "--report-dir=$COVERAGE_DIR" "--temp-directory=$COV_TMP" \
    --all \
    --src "$PWD/packages/common/src" --src "$PWD/packages/server/src" \
    --src "$PWD/packages/renderer/src" --src "$PWD/packages/electron/src" \
    --extension .ts --extension .tsx \
    "--exclude=**/dist/**" "--exclude=**/*.d.ts" \
    "--exclude=**/*.test.ts" "--exclude=**/*.test.tsx" "--exclude=**/*.test.mjs" \
    2>/dev/null || true
}

# 有没有「新鲜」的采集数据可复用。
#
# 判据是**源文件有没有比采集时刻更新**（find -newer，POSIX 通用），不是
# 「过了多久」—— 机器慢 / 中间断了一下都不该导致重采（本地跑一遍插桩套件
# 要 10 分钟，按时间窗判定会在最需要复用的时候失效）。
# 采集时刻 = 标记文件自己的 mtime（写 marker 时顺手就有了）。
cov_data_is_fresh() {
  [ -f "$COV_MARKER" ] || return 1
  local newer
  newer=$(find packages -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
    -newer "$COV_MARKER" -print -quit 2>/dev/null || true)
  [ -z "$newer" ]
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

# 阈值判定：≥60% 行覆盖。参数 = c8 报告文本。
coverage_threshold_gate() {
  local REPORT="$1"
  # Parse the "All files" row from the text report. Columns are pipe-delimited:
  # File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Ln.
  # Field 5 (1-indexed by awk -F'|') is % Lines.
  local LINES
  LINES=$(echo "$REPORT" | grep -E 'All files' | tail -1 | awk -F'|' '{gsub(/[ %]/, "", $5); print $5}')
  if [ -z "$LINES" ]; then LINES=0; fi
  echo "── total line coverage: ${LINES}% ──"
  if awk -v l="$LINES" 'BEGIN{exit !(l < 60)}'; then
    echo "── ⚠️  coverage below 60% threshold (got ${LINES}%) ──"
    return 1
  fi
  echo "── ✅ coverage meets 60% line threshold ──"
  return 0
}

# ── 采集锁 ─────────────────────────────────────────────────────────
# 采集会 `rm -rf coverage/` 再重建 —— 两个采集同时跑会**互相删对方的
# .tmp 数据**，出来的报告是半截的（实测踩过：报告数字莫名其妙偏低）。
# mkdir 是原子的 → 用它当锁。
LOCK_DIR="$COVERAGE_DIR/.lock"
acquire_collect_lock() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "── 另一次覆盖率采集正在进行（锁：${LOCK_DIR}）──"
    echo "   等它跑完；确认没有别的采集在跑的话，删掉这个目录再来。"
    exit 1
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
}

# ── 主流程 ─────────────────────────────────────────────────────────

# 1) 决定是否采集
COLLECT=0
if [ "$INSTRUMENT" -eq 1 ]; then
  if [ "$COVERAGE" -eq 1 ] && cov_data_is_fresh; then
    echo "── 复用已有采集数据（源文件未变动）──"
  else
    COLLECT=1
    acquire_collect_lock
    rm -rf "$COVERAGE_DIR"
    mkdir -p "$COV_TMP"
  fi
fi

# 2) 跑测试（采集模式下套 c8 —— 一次执行同时给出「过没过」和「覆盖多少」）
if [ "$COLLECT" -eq 1 ]; then
  INSTRUMENT=1
fi
run_all || true
if [ "$COLLECT" -eq 1 ]; then
  date +%s > "$COV_MARKER"
fi

# 3) 判定
if [ "$FAILED_COUNT" -gt 0 ]; then
  report_failures
  exit 1
fi

# 4) 覆盖率报告（采集模式下打印；--coverage 还要判阈值）
if [ "$INSTRUMENT" -eq 1 ]; then
  REPORT=$(c8_report)
  echo "$REPORT"
  echo "── coverage report written to ${COVERAGE_DIR}/ ──"
  if [ "$FAILED_COUNT" -gt 0 ]; then
    echo ""
    echo "── ⚠️  本次有 ${FAILED_COUNT} 个测试文件失败 ──"
    echo "   失败的文件不产生（或只产生部分）覆盖数据 → 下面的覆盖率**偏低**。"
    for f in $FAILED_FILES; do echo "     ✗ $f"; done
    echo ""
  fi
  if [ "$COVERAGE" -eq 1 ]; then
    coverage_threshold_gate "$REPORT" || exit 1
  fi
fi

if [ "$WATCH" -eq 0 ]; then
  exit 0
fi

# --watch: cheap mtime polling. No chokidar / fs.watch dependency — we just
# re-run whenever any *.test.ts or src/** is newer than the last run.
SENTINEL="$(mktemp -t maestro-test.XXXXXX)"
touch "$SENTINEL"
trap 'rm -f "$SENTINEL"' EXIT

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
    run_all || true
    if [ "$FAILED_COUNT" -gt 0 ]; then
      report_failures
      echo "── tests failed; will retry on next change ──"
    fi
  fi
done
