#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER — 快照采集插件的生成器
//
// 干什么：把 `scripts/figma-snapshot-seg.js` 里的 **SEG1**（唯一的采集实现）
//        贴进 `scripts/figma-collect-plugin/plugin.src.js` 的占位符里，
//        产出 `scripts/figma-collect-plugin/code.js`（插件真正加载的文件）。
//
// 为什么要生成而不是直接手写 code.js：
//   SEG1 里嵌着**共享实现**（scripts/lib/figma-contract-section.js 的函数源码）
//   —— 采集段跑在 Figma 沙箱里不能 import，只能内联。
//   ⇒ SEG1 **只有一份**（在这个文件里），插件产物由它派生 ⇒ 口径不可能漂移。
//   （漂移的后果：采集段提不出插件写进去的契约段 ⇒ 快照永远显示「没契约」
//     ⇒ 现场看不出任何异常 —— 这正是当初 P1 那个静默漏写 bug 的根因。）
//
// 用法：
//   node scripts/figma-collect-plugin.mjs            # 生成
//   node scripts/figma-collect-plugin.mjs --check    # 只校验：产物与 SEG1 是否同步
//
// 退出码：0 = 一致 / 生成成功；1 = --check 发现产物过期；2 = 输入有问题
//
// 关联：scripts/figma-snapshot-seg.js · scripts/figma-collect-plugin/
//       · scripts/figma-collect-plugin.test.mjs
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const CHECK = process.argv.includes('--check');
const PLACEHOLDER = '/* __COLLECTOR__ */';

const PATHS = {
  pluginSrc: resolve(__dirname, 'figma-collect-plugin/plugin.src.js'),
  pluginCode: resolve(__dirname, 'figma-collect-plugin/code.js'),
  seg: resolve(__dirname, 'figma-snapshot-seg.js'),
};

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

for (const [label, p] of [
  ['插件源码', PATHS.pluginSrc],
  ['采集段', PATHS.seg],
]) {
  if (!existsSync(p)) fail(`找不到${label}：${p}`);
}

// ── 取 SEG1（唯一实现）────────────────────────────────────────
let SEG1;
try {
  ({ SEG1 } = require(PATHS.seg));
} catch (e) {
  fail(`采集段加载失败：${e.message}`);
}
if (typeof SEG1 !== 'string' || !SEG1.includes('JSON.stringify(out)')) {
  fail('采集段导出的 SEG1 不像预期（缺 JSON.stringify(out)）');
}

// ── 生成 code.js ─────────────────────────────────────────────
const src = readFileSync(PATHS.pluginSrc, 'utf8');
if (!src.includes(PLACEHOLDER)) {
  fail(`插件源码里找不到占位符 ${PLACEHOLDER}：${PATHS.pluginSrc}`);
}

// ⚠️ **必须用函数形式的 replacement** ——
//    `str.replace(占位符, 字符串)` 时替换串里的 `$&` / `$1` / `$'` 是**特殊语法**，
//    会被展开成别的东西 ⇒ SEG1 被悄悄改形 ⇒ 采集结果错得没痕迹。
//    函数形式（`() => SEG1`）按**字面量**替换，不会被解释。
const code = src.replace(PLACEHOLDER, () => SEG1);

// ⚠️ SEG1 里带 `await` 与顶层 `return` ⇒ 它必须待在 async 函数体内。
//    这里断言它确实被放进了函数里（而不是悬在顶层）。
if (!/async function collectSnapshot\(\)\s*\{[\s\S]*JSON\.stringify\(out\)/.test(code)) {
  fail('生成的 code.js 里 SEG1 不在 collectSnapshot() 函数体内（顶层 await/return 会直接语法错）');
}

if (CHECK) {
  if (!existsSync(PATHS.pluginCode)) {
    console.error(`❌ 缺 ${PATHS.pluginCode}`);
    console.error('\n   ⇒ 跑 `node scripts/figma-collect-plugin.mjs` 生成。');
    process.exit(1);
  }
  if (readFileSync(PATHS.pluginCode, 'utf8') !== code) {
    console.error('❌ 采集插件产物与 SEG1 不同步');
    console.error('\n   ⇒ 跑 `node scripts/figma-collect-plugin.mjs` 重新生成。');
    console.error('   （SEG1 改了但插件没重生成 ⇒ 插件采到的口径与仓库里的不一致 ⇒ 快照不可信。）');
    process.exit(1);
  }
  console.log('✅ 采集插件产物与 SEG1 同步');
  process.exit(0);
}

writeFileSync(PATHS.pluginCode, code, 'utf8');
console.log(`✅ 已生成 ${PATHS.pluginCode.replace(ROOT + '/', '')}（${code.length} 字节）`);
