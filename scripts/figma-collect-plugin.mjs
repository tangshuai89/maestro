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
import { createHash } from 'node:crypto';
import { DEFAULT_PORT } from './figma-snapshot-receiver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const CHECK = process.argv.includes('--check');
const PLACEHOLDER = '/* __COLLECTOR__ */';
const BUILD_PLACEHOLDER = '__BUILD__';

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
if (!src.includes(BUILD_PLACEHOLDER)) {
  fail(`插件源码里找不到构建号占位符 ${BUILD_PLACEHOLDER}：${PATHS.pluginSrc}`);
}

// ── 端口一致性（同一个事实写在三个文件里）────────────────────────
// 接收器端口的**单一事实源** = scripts/figma-snapshot-receiver.mjs 的 DEFAULT_PORT。
// 插件源码与 manifest.json 里各写了一份「域名 + 端口」⇒ 会漂移 ⇒ 插件连不上接收器，
// 而**现场看不出任何异常**（只会看到「剪贴板写入失败」这种兜底提示）。
// ⇒ 这里断言：三处端口必须一致，不一致就**报错**，不产出对不上的插件。
const manifestPath = resolve(__dirname, 'figma-collect-plugin/manifest.json');
if (!existsSync(manifestPath)) fail(`找不到 manifest：${manifestPath}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  fail(`manifest.json 解析失败：${e.message}`);
}
const net = manifest.networkAccess ?? {};
const domains = [...(net.allowedDomains ?? []), ...(net.devAllowedDomains ?? [])];

// ⚠️ **只能用 `localhost`，不能用 IP**（2026-10-30 实测踩到）：
//    Figma 的 manifest 校验器会直接拒绝 IP 形式的域名 ——
//    「Invalid value for allowedDomains. 'http://127.0.0.1:4771' must be a
//    valid URL」⇒ **插件根本加载不了**，现象是 Figma 弹一条红条、插件不出现。
//    ⇒ 这里把它当成**门禁**：IP 形式一律报错，不放行。
const want = `http://localhost:${DEFAULT_PORT}`;
if (!src.includes(`${want}/snapshot`)) {
  fail(
    `插件源码里的接收器地址与端口不一致：期望 ${want}/snapshot` +
      `（接收器 DEFAULT_PORT=${DEFAULT_PORT}）`,
  );
}
if (!domains.includes(want)) {
  fail(`manifest.json 的 networkAccess 里缺少 ${want}（接收器 DEFAULT_PORT=${DEFAULT_PORT}）`);
}
for (const d of domains) {
  // ① IP 形式：Figma 拒绝加载
  if (/^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/.*)?$/.test(d)) {
    fail(
      `manifest.json 的 networkAccess 里不许用 IP 形式：${d}\n` +
        `   ⇒ Figma 的 manifest 校验器会拒绝加载插件` +
        `（"'${d}' must be a valid URL"）⇒ 改用 http://localhost:<port>。`,
    );
  }
  // ② 残留的**旧端口**（换了端口忘了改 manifest 的典型漂移）
  const m = /^http:\/\/localhost:(\d+)$/.exec(d);
  if (m && Number(m[1]) !== DEFAULT_PORT) {
    fail(`manifest.json 里的 ${d} 与接收器端口 ${DEFAULT_PORT} 不一致（残留的旧端口？）`);
  }
}

// ── fileKey 一致性（SEG1 自带的常量 vs 仓库的单一事实源）────────────
// ⚠️ **公开插件拿不到 figma.fileKey**（官方文档：只有私有插件和 Figma 自家资源有；
//    enablePrivatePluginApi 对本地开发插件无效）⇒ 采集段只能**自带常量**。
//    而仓库的单一事实源是 figma-code-connect.json 的 $figmaFileKey
//    （code-connect 映射本来就绑在这个文件上）⇒ 两处必须一致，漂移就报错。
const codeConnectPath = resolve(ROOT, 'figma-code-connect.json');
if (!existsSync(codeConnectPath)) fail(`找不到 ${codeConnectPath}`);
let figmaFileKey;
try {
  figmaFileKey = JSON.parse(readFileSync(codeConnectPath, 'utf8')).$figmaFileKey;
} catch (e) {
  fail(`figma-code-connect.json 解析失败：${e.message}`);
}
if (typeof figmaFileKey !== 'string' || !figmaFileKey.trim()) {
  fail('figma-code-connect.json 里没有 $figmaFileKey（采集段没有别的 fileKey 来源）');
}
if (!SEG1.includes(`'${figmaFileKey}'`)) {
  fail(
    `采集段里的 fileKey 常量与 figma-code-connect.json 的 $figmaFileKey 不一致\n` +
      `   期望：${figmaFileKey}\n` +
      `   ⇒ 改 scripts/figma-snapshot-seg.js 的 EXPECTED_FILE_KEY，或改 code-connect 的 $figmaFileKey。`,
  );
}

// ⚠️ **必须用函数形式的 replacement** ——
//    `str.replace(占位符, 字符串)` 时替换串里的 `$&` / `$1` / `$'` 是**特殊语法**，
//    会被展开成别的东西 ⇒ SEG1 被悄悄改形 ⇒ 采集结果错得没痕迹。
//    函数形式（`() => SEG1`）按**字面量**替换，不会被解释。
//
// ⚠️ 构建号 = **输入**（SEG1 + 插件源码）的哈希 ⇒ 内容变则号变，
//    两个不同版本不会同号。注入到插件里、印在通知上 ⇒
//    一眼看出「Figma 跑的是不是磁盘上这份」（Figma 会缓存已导入的开发插件）。
const build = createHash('sha256')
  .update(SEG1)
  .update('\u0000')
  .update(src)
  .digest('hex')
  .slice(0, 8);
const code = src.replace(PLACEHOLDER, () => SEG1).replace(BUILD_PLACEHOLDER, () => build);

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
