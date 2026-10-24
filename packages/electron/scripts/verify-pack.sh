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
