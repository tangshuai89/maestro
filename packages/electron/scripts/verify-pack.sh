#!/usr/bin/env bash
# 验收打包产物：dmg 在不在、.app 结构对不对、**sidecar server 的依赖能不能解析**。
#
# 为什么单独查 sidecar：server 是通过 extraResources 放在 `Resources/server/` 的
# （**不在 asar 里**），而它的依赖（@nestjs/core 等）没被打包进去 →
# `spawn(process.execPath, [Resources/server/main.js])` 起来后
# `require('@nestjs/core')` 会解析失败 → **app 启动即崩**。
# 这个症状在「dmg 出出来了」之后才会暴露，所以必须单独验。
set -uo pipefail
cd "$(dirname "$0")/.."

RELEASE="release"
APP="$RELEASE/mac-arm64/Maestro.app"

echo "── 产物 ─────────────────────────────────────────"
ls -lh "$RELEASE"/*.dmg 2>/dev/null || echo "❌ 没有 dmg"
echo
du -sh "$APP" 2>/dev/null || echo "❌ 没有 .app"

echo
echo "── .app 结构 ───────────────────────────────────"
ls "$APP/Contents/Resources" 2>/dev/null || echo "❌ 没有 Resources"
echo
echo "app.asar 大小："
ls -lh "$APP/Contents/Resources/app.asar" 2>/dev/null | awk '{print "  " $5}' || echo "  ❌ 没有 app.asar"

echo
echo "── 产物新鲜度（防「打进旧版本」）──────────────────"
# ⚠️ 为什么查这个：打包真正带走的是 Resources/server（server/dist）和
# Resources/renderer（renderer/dist）—— 曾经**没有**在打包前重建它们 →
# 打进去的是上一次构建的产物（实测 server/dist 比源码旧一天）→
# 「打包成功」是**假象**，发出去的是旧代码。
#
# 判据：包里的产物 mtime 必须**不早于**当前源码的最新 mtime。
# （包里的文件 mtime = 构建时刻，electron-builder 拷贝不重写 → 可比）
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC_NEWEST=$(find "$REPO_ROOT/packages/server/src" "$REPO_ROOT/packages/renderer/src" \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -exec stat -f '%m %N' {} \; 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f1)
STALE=0
for rel in "server/main.js" "renderer/index.html"; do
  f="$APP/Contents/Resources/$rel"
  [ -f "$f" ] || continue
  mt=$(stat -f '%m' "$f")
  if [ -n "$SRC_NEWEST" ] && [ "$mt" -lt "$SRC_NEWEST" ]; then
    echo "❌ $rel 比源码还旧（产物 $(date -r "$mt" '+%m-%d %H:%M') < 源码 $(date -r "$SRC_NEWEST" '+%m-%d %H:%M')）"
    echo "   → 打包前没重新构建 → 打进去的是**旧代码**。跑 npm run pack（它会自己构建全部产物）。"
    STALE=1
  else
    echo "✅ $rel 不比源码旧（$(date -r "$mt" '+%m-%d %H:%M')）"
  fi
done
[ "$STALE" -eq 0 ] || echo "❌ 产物陈旧 —— 这个包不能发。"

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
GATE_OUT=$(node "$REPO_ROOT/scripts/check-artifact-hygiene.cjs" 2>&1)
GATE_EXIT=$?
printf '%s\n' "$GATE_OUT" | sed 's/^/   /'
if [ "$GATE_EXIT" -ne 0 ]; then
  echo "   ❌ dist 目录不干净"
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
  echo "❌ 出货产物里有 $APP_TEST_COUNT 个不该出货的文件："
  printf '%s\n' "$NODE_APP_SCAN" | sed 's/^/     ✗ /'
  echo "   → 这些会跟着包发给用户。修法：各包的构建 tsconfig 排除测试 + 构建前清 dist。"
fi

echo
echo "── sidecar server ───────────────────────────────"
SERVER="$APP/Contents/Resources/server"
if [ ! -f "$SERVER/main.js" ]; then
  echo "❌ 没有 Resources/server/main.js"
  exit 0
fi
echo "server/main.js 存在"
echo "server 目录内容："
ls "$SERVER" | head -10
if [ -d "$SERVER/node_modules" ]; then
  echo "✅ server/node_modules 存在（$(ls "$SERVER/node_modules" | wc -l | tr -d ' ') 个包）"
else
  echo "❌ **没有 server/node_modules** —— sidecar 的 require 会解析失败"
fi

echo
echo "── sidecar 依赖解析实测（ELECTRON_RUN_AS_NODE）────"
ELECTRON="$APP/Contents/MacOS/Maestro"
if [ -x "$ELECTRON" ]; then
  ELECTRON_RUN_AS_NODE=1 "$ELECTRON" -e "
    try {
      const p = require.resolve('@nestjs/core', { paths: ['$SERVER'] });
      console.log('✅ @nestjs/core 解析到：' + p);
    } catch (e) {
      console.log('❌ @nestjs/core 解析失败：' + e.code);
    }
    try {
      const p = require.resolve('@maestro/common', { paths: ['$SERVER'] });
      console.log('✅ @maestro/common 解析到：' + p);
    } catch (e) {
      console.log('❌ @maestro/common 解析失败：' + e.code);
    }
  " 2>&1 | head -8
else
  echo "（找不到可执行的 $ELECTRON，跳过实测）"
fi
