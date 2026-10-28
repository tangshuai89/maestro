#!/usr/bin/env bash
# 验收打包产物：dmg 在不在、.app 结构对不对、**sidecar server 的依赖能不能解析**。
#
# ## ⚠️ 退出码（2026-10-28 改）
#
# 以前这个脚本**永远 exit 0** —— 哪怕它满屏 ❌。它是个「报告」，不是门禁。
# ⇒ 「出厂 app 能不能起来」这条路径**实际上没有任何门禁**（CI 打不了 dmg，
#   只有这个脚本能查；��本该守的地方它不守）。
#
# 现在：**有 ❌ 就 exit 1**（全部检查都过才 exit 0）。
#   - 失败项会**逐条列出来**（不只是一句「有问题」）
#   - `--no-dmg`：只造了 .app、没造 dmg 时用（CI 的 macOS job 走这条路
#     —— `electron-builder --dir` 出 .app 不出 dmg，省掉 hdiutil 的时间与失败面）
#
# ⚠️ 同一类坑本脚本早前踩过：「构建成功」是假象（`node ... | sed` 的退出码是
#    sed 的，恒 0）。所以这里**不用管道取退出码**，一律单独捕获。
#
# 为什么单独查 sidecar：server 是通过 extraResources 放在 `Resources/server/` 的
# （**不在 asar 里**），而它的依赖（@nestjs/core 等）没被打包进去 →
# `spawn(process.execPath, [Resources/server/main.js])` 起来后
# `require('@nestjs/core')` 会解析失败 → **app 启动即崩**。
# 这个症状在「dmg 出出来了」之后才会暴露，所以必须单独验。
set -uo pipefail

# ⚠️ **路径要在 cd 之前、且用绝对路径算好**（2026-10-28 修的真 bug）：
#   原来 `cd "$(dirname "$0")/.."` 之后，再用**相对**的 `$0` 算 REPO_ROOT
#   → `$0` 相对于**新的 cwd** 解释 → 解析到不存在的地方 → REPO_ROOT 变成空
#   → 「产物新鲜度」检查**静默跳过**（本地也是！脚本里 `find` 一个不存在的
#   目录 → SRC_NEWEST 为空 → 那段 if 永远不进 → **没人发现它一直没跑**）。
#   CI 从仓库根调用时更直接：cd 失败 → `REPO_ROOT` 为空 →
#   `node /scripts/check-artifact-hygiene.cjs` → 模块找不到 → 门禁误报「dist 不干净」。
# ⇒ 用 `${BASH_SOURCE[0]}`（脚本自己的路径）先 `cd ... && pwd` 取绝对路径。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$SCRIPT_DIR/.."

# ── 参数 ──
REQUIRE_DMG=1
for arg in "$@"; do
  case "$arg" in
    --no-dmg) REQUIRE_DMG=0 ;;   # 只造了 .app（CI 的 --dir 路径）
    *) echo "用法: verify-pack.sh [--no-dmg]" >&2; exit 2 ;;
  esac
done

# ── 失败累加器：所有 ❌ 都往这儿记，最后统一 exit 1 ──
FAIL_COUNT=0
FAILURES=()
fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("$1")
  echo "❌ $1"
}

RELEASE="release"
APP="$RELEASE/mac-arm64/Maestro.app"

echo "── 产物 ─────────────────────────────────────────"
if ls -lh "$RELEASE"/*.dmg >/dev/null 2>&1; then
  ls -lh "$RELEASE"/*.dmg
elif [ "$REQUIRE_DMG" -eq 1 ]; then
  fail "没有 dmg（release/*.dmg 不存在）—— 跑 npm run pack 造一个"
else
  echo "（--no-dmg：跳过 dmg 检查）"
fi
echo
if du -sh "$APP" >/dev/null 2>&1; then
  du -sh "$APP"
else
  fail "没有 .app（$APP 不存在）"
fi

echo
echo "── .app 结构 ───────────────────────────────────"
if ls "$APP/Contents/Resources" >/dev/null 2>&1; then
  ls "$APP/Contents/Resources"
else
  fail "没有 Resources（$APP/Contents/Resources 不存在）"
fi
echo
echo "app.asar 大小："
if ls -lh "$APP/Contents/Resources/app.asar" 2>/dev/null | awk '{print "  " $5}'; then
  :
else
  fail "没有 app.asar（$APP/Contents/Resources/app.asar 不存在）"
fi

echo
echo "── 产物新鲜度（防「打进旧版本」）──────────────────"
# ⚠️ 为什么查这个：打包真正带走的是 Resources/server（server/dist）和
# Resources/renderer（renderer/dist）—— 曾经**没有**在打包前重建它们 →
# 打进去的是上一次构建的产物（实测 server/dist 比源码旧一天）→
# 「打包成功」是**假象**，发出去的是旧代码。
#
# 判据：包里的产物 mtime 必须**不早于**当前源码的最新 mtime。
# （包里的文件 mtime = 构建时刻，electron-builder 拷贝不重写 → 可比）
SRC_NEWEST=$(find "$REPO_ROOT/packages/server/src" "$REPO_ROOT/packages/renderer/src" \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -exec stat -f '%m %N' {} \; 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f1)
# ⚠️ **必须把「比的是什么」打出来** —— 否则「没找到源码 → 静默跳过」这件事
#    根本看不出来（这正是 REPO_ROOT 算错时发生的事：检查一直在跳过，没人发现）。
if [ -z "$SRC_NEWEST" ]; then
  fail "找不到源码（\$REPO_ROOT/packages/{server,renderer}/src）→ 新鲜度检查没法做"
else
  echo "   （比对的基准：源码最新的一处改动 $(date -r "$SRC_NEWEST" '+%m-%d %H:%M')）"
fi
STALE=0
for rel in "server/main.js" "renderer/index.html"; do
  f="$APP/Contents/Resources/$rel"
  [ -f "$f" ] || continue
  mt=$(stat -f '%m' "$f")
  if [ -n "$SRC_NEWEST" ] && [ "$mt" -lt "$SRC_NEWEST" ]; then
    fail "$rel 比源码还旧（产物 $(date -r "$mt" '+%m-%d %H:%M') < 源码 $(date -r "$SRC_NEWEST" '+%m-%d %H:%M')）—— 打包前没重新构建 → 打进去的是**旧代码**。跑 npm run pack（它会自己构建全部产物）。"
  else
    echo "✅ $rel 不比源码旧（$(date -r "$mt" '+%m-%d %H:%M')）"
  fi
done


echo
echo "── 出货产物不许带测试代码 ─────────────────────────"
# 判据分两层：
#   ① 仓库里的 dist 目录 → 跑 CI 那个门禁（判据更全：还查**陈旧产物**）
#   ② 打好的 .app        → 端到端查（asar + sidecar），CI 打不了 dmg，只能在这查
#
# ⚠️ 为什么必须单独查：打包把 server/dist、renderer/dist **整个目录**拷进
#    Resources/，而 electron 的 build.files 把 dist 下所有文件收进 asar
#    → **dist 里有什么，用户手里就什么**。
#    实测抓出过一个**从没提交过**的本地调试残留（reco/_tmp-dbg2.js）——
#    它已经跟着一个 dmg 出过货。
#
# ⚠️ 判据有两类，别只查文件名：
#   · 文件名含 .test. / .spec.  → foo.test.js
#   · **路径里**有 test / e2e / test-helpers 这样的目录段 → test-helpers/in-process-http.js
#     （后者文件名完全正常，只看文件名会漏掉 —— 实测 server 的测试夹具就是这么漏出去的）
echo "① 仓库 dist 目录（CI 同一个门禁）："
# ⚠️ 不能写成 `node ... | sed` —— 管道的退出码是 sed 的（恒 0）→ 门禁红了也看不出来。
#   这正是本脚本早前踩过的坑（「构建成功」是假象）。
# ⚠️ **--require-built**：没构建过 = **失败**，不是跳过。
#   「跳过」= 门禁形同虚设（同一个原则，CI 的 artifact-hygiene job 已经这么用）。
#   没有 dist → 谈不上「产物干不干净」。
GATE_OUT=$(node "$REPO_ROOT/scripts/check-artifact-hygiene.cjs" --require-built 2>&1)
GATE_EXIT=$?
printf '%s\n' "$GATE_OUT" | sed 's/^/   /'
if [ "$GATE_EXIT" -ne 0 ]; then
  fail "dist 目录不干净（check-artifact-hygiene.cjs 报了问题）—— 见上面的清单"
fi
echo
echo "② 打好的 .app（asar + sidecar）："
NODE_APP_SCAN=$(node -e "
  const path = require('path');
  const fs = require('fs');
  const asar = require('@electron/asar');
  const resources = path.join(process.argv[1], 'Contents', 'Resources');
  const fileRe = /\.(test|spec)\./;
  const dirRe = /(^|\/)(tests?|e2e|__tests__|test-helpers)(\/|$)/;
  const bad = [];
  const archive = path.join(resources, 'app.asar');
  try {
    if (fs.existsSync(archive)) {
      for (const f of asar.listPackage(archive)) {
        const base = f.split('/').pop();
        if (fileRe.test(base) || dirRe.test(f)) bad.push('app.asar' + f);
      }
    }
  } catch (e) {
    bad.push('app.asar 读取失败: ' + e.message);
  }
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        // ⚠️ node_modules 里**只有我们自己发布的包**要查（@maestro/common）：
        //    第三方包自带 test/ 目录是**正常的**（busboy/test/、minimist/test/ …）
        //    —— 实测不排除它们会一次报出 120+ 个假阳性，门禁直接被噪音淹掉。
        if (e.name === 'node_modules') {
          const scope = path.join(dir, e.name, '@maestro');
          if (fs.existsSync(scope)) walk(scope, rel + '/@maestro');
          continue;
        }
        walk(path.join(dir, e.name), r);
      } else if (e.isFile() && (fileRe.test(e.name) || dirRe.test(r))) bad.push(r);
    }
  };
  for (const sub of ['server', 'renderer']) {
    const d = path.join(resources, sub);
    if (fs.existsSync(d)) walk(d, sub);
  }
  for (const b of bad) console.log(b);
" "$APP" 2>/dev/null)
APP_TEST_COUNT=$(printf '%s' "$NODE_APP_SCAN" | grep -c . || true)
if [ "${APP_TEST_COUNT:-0}" -eq 0 ]; then
  echo "✅ app.asar / Resources/server / Resources/renderer 里都没有测试代码"
else
  fail "出货产物里有 $APP_TEST_COUNT 个不该出货的文件："
  printf '%s\n' "$NODE_APP_SCAN" | sed 's/^/     ✗ /'
  echo "   → 这些会跟着包发给用户。修法：各包的构建 tsconfig 排除测试 + 构建前清 dist。"
fi

echo
echo "── sidecar server ───────────────────────────────"
SERVER="$APP/Contents/Resources/server"
if [ ! -f "$SERVER/main.js" ]; then
  fail "没有 Resources/server/main.js —— sidecar 根本不在包里"
  # 后面每一项都依赖它 → 直接收尾（退出码仍是 1）
  echo
  echo "── 结论 ─────────────────────────────────────────"
  echo "❌ $FAIL_COUNT 项失败："
  for f in "${FAILURES[@]}"; do echo "   ✗ $f"; done
  exit 1
fi
echo "server/main.js 存在"
echo "server 目录内容："
ls "$SERVER" | head -10
if [ -d "$SERVER/node_modules" ]; then
  echo "✅ server/node_modules 存在（$(ls "$SERVER/node_modules" | wc -l | tr -d ' ') 个包）"
else
  fail "**没有 server/node_modules** —— sidecar 的 require 会解析失败 → app 启动即崩"
fi

echo
echo "── sidecar 依赖解析实测（ELECTRON_RUN_AS_NODE）────"
ELECTRON="$APP/Contents/MacOS/Maestro"
if [ -x "$ELECTRON" ]; then
  # ⚠️ **node -e 自己 exit(1)**，脚本看它的退出码 —— 不能只看它打印了什么
  #    （管道会吞掉退出码，那是本脚本早前踩过的坑）。
  RESOLVE_OUT=$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON" -e "
    let bad = 0;
    for (const m of ['@nestjs/core', '@maestro/common']) {
      try {
        const p = require.resolve(m, { paths: ['$SERVER'] });
        console.log('✅ ' + m + ' 解析到：' + p);
      } catch (e) {
        bad++;
        console.log('❌ ' + m + ' 解析失败：' + e.code);
      }
    }
    process.exit(bad ? 1 : 0);
  " 2>&1)
  RESOLVE_RC=$?
  printf '%s\n' "$RESOLVE_OUT" | head -8
  if [ "$RESOLVE_RC" -ne 0 ]; then
    fail "出厂 sidecar 的依赖解析失败（见上）→ app 启动即崩"
  fi
else
  fail "找不到可执行的 $ELECTRON —— 出厂 app 连二进制都没进包"
fi

echo
echo "── 出厂 sidecar 实测（真的起一次）──────────────────"
# 判据：把出厂的 `Resources/server/main.js` **真的起一次**，探它一个接口。
#
# ⚠️ 为什么必须真起：上面的检查只验证了「依赖能解析」（require.resolve）——
#   那**不覆盖**「进程起不来 / 端口不通 / 鉴权头不对 / 环境变量没生效」
#   这一整类出货事故。实测踩过：sidecar 缺 @nestjs/core → app 启动即崩，
#   而 dmg 那时候已经出来了（要等用户装上才发现）。
#
# 用 `ELECTRON_RUN_AS_NODE=1` 把它当纯 node 进程跑 → 不需要 GUI、不需要签名。
# 探 `/storage/info`（不依赖任何平台凭据 → 不会因为没配 Spotify/Deezer 而误报）。
if [ ! -x "$ELECTRON" ]; then
  echo "（找不到可执行的 $ELECTRON，跳过）"
else
  # 端口要**现找一个空闲的** —— 写死端口会撞上"上次跑剩下来的 sidecar"
  # （实测踩到：脚本中途报错退出 → sidecar 变孤儿进程 → 下次跑端口被占 →
  #  误报成"出厂 sidecar 起不来"）。
  SIDECAR_PROBE_PORT=$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});")
  SIDECAR_PROBE_TOKEN="verify-pack-$$"
  SIDECAR_PROBE_DIR="$(mktemp -d)"
  ELECTRON_RUN_AS_NODE=1 \
    PORT="$SIDECAR_PROBE_PORT" \
    STORAGE_DIR="$SIDECAR_PROBE_DIR/.storage" \
    STORAGE_BACKUP_DIR="$SIDECAR_PROBE_DIR/backups" \
    MAESTRO_INTERNAL_TOKEN="$SIDECAR_PROBE_TOKEN" \
    "$ELECTRON" "$SERVER/main.js" > "$SIDECAR_PROBE_DIR/server.log" 2>&1 &
  SIDECAR_PROBE_PID=$!

  # ⚠️ 收尾要**保证**执行：脚本中途出错退出时，sidecar 会变成孤儿进程
  #    （占着端口 + 一直跑着）。trap 挂 EXIT。
  cleanup_probe() {
    kill "$SIDECAR_PROBE_PID" 2>/dev/null
    rm -rf "$SIDECAR_PROBE_DIR" 2>/dev/null
  }
  trap cleanup_probe EXIT

  SIDECAR_READY=0
  for _ in $(seq 1 60); do
    if curl -sf -H "X-Maestro-Token: $SIDECAR_PROBE_TOKEN" \
      "http://127.0.0.1:${SIDECAR_PROBE_PORT}/storage/info" > /dev/null 2>&1; then
      SIDECAR_READY=1
      break
    fi
    # 进程提前退出 → 不用再等了
    if ! kill -0 "$SIDECAR_PROBE_PID" 2>/dev/null; then break; fi
    sleep 0.25
  done

  if [ "$SIDECAR_READY" -eq 1 ]; then
    echo "✅ 出厂 sidecar 起来了，/storage/info 有响应（端口 ${SIDECAR_PROBE_PORT}）"
  else
    fail "**出厂 sidecar 起不来 / 接口不通** —— 这个包不能发"
    echo "   最后几行日志："
    tail -6 "$SIDECAR_PROBE_DIR/server.log" 2>/dev/null | sed 's/^/     /'
  fi

  # 收尾：精确停这个 PID（不要 pkill —— 会误杀别的进程）
  cleanup_probe
  trap - EXIT
fi

echo
echo "── 结论 ─────────────────────────────────────────"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "✅ 全部检查通过（出厂产物可以发）"
  exit 0
fi
echo "❌ $FAIL_COUNT 项失败："
for f in "${FAILURES[@]}"; do echo "   ✗ $f"; done
echo
echo "   → 这些问题会**跟着包发给用户**（最严重的一种是「app 装上就崩」）。"
exit 1
