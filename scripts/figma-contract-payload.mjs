#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER — AI_CONTRACT 契约草案生成器
//
// 做什么：读「快照 + code-connect 映射 + 仓库现状」→ 生成
//        ① scripts/figma-contract-payload.json   （机器可读的待写清单）
//        ② scripts/figma-write-plugin/code.js    （内联 payload 的插件产物）
//        ③ 一份人可读的审阅报告（stdout）
//
// 为什么要这一步：I1 要给 34 个节点补 AI_CONTRACT 段，
// 但**契约内容不是机械推导得出来的**（详见 lib/figma-contract-payload.mjs 头注）。
// 所以本生成器只做**起草 + 标注来源**，不冒充权威。
// 真正落地靠 `scripts/figma-write-plugin/` 的本地开发插件
// —— 它的写入权限是「你自己对该文件的编辑权」，不看席位、不看套餐墙。
//
// 用法：
//   node scripts/figma-contract-payload.mjs            # 生成 + 打印报告
//   node scripts/figma-contract-payload.mjs --check    # 只校验：产物与快照是否同步
//
// 退出码：0 = 一致 / 生成成功；1 = --check 发现产物过期；2 = 输入有问题
//
// 关联：specs/figma-diff/spec.md §10 · scripts/lib/figma-contract-payload.mjs
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractPayload } from './lib/figma-contract-payload.mjs';
import sectionModule from './lib/figma-contract-section.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');

const PATHS = {
  snapshot: resolve(__dirname, 'figma-snapshot.json'),
  codeConnect: resolve(ROOT, 'figma-code-connect.json'),
  payload: resolve(__dirname, 'figma-contract-payload.json'),
  pluginSrc: resolve(__dirname, 'figma-write-plugin/plugin.src.js'),
  pluginCode: resolve(__dirname, 'figma-write-plugin/code.js'),
  rendererSrc: resolve(ROOT, 'packages/renderer/src'),
};

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

// ── 要内联进插件的共享实现 ─────────────────────────────────────
// ⚠️ 用 `fn.toString()` 取**函数源码**（不是手抄一份）⇒ 插件里跑的就是
//    scripts/lib/figma-contract-section.js 里那份被单测覆盖的实现。
//    手抄 = 两份实现 = 迟早漂移（这正是本次要修的 bug 的根因）。
//
// ⚠️ **连常量一起内联**：`mergeContractSection` 引用了模块级的 SECTION_FENCE，
//    只贴函数体的话插件里会变成 undefined（ReferenceError）。
//    ⇒ 把常量也贴进去；函数体靠 `toString()` 自带 ⇒ 引用能解析到。
const SECTION_FUNCTIONS = [
  sectionModule.extractContractSection,
  sectionModule.hasContractSection,
  sectionModule.mergeContractSection,
];
const SECTION_CONSTANTS = [`const SECTION_FENCE = ${JSON.stringify(sectionModule.SECTION_FENCE)};`];

for (const [label, p] of [
  ['快照', PATHS.snapshot],
  ['code-connect 映射表', PATHS.codeConnect],
  ['插件源码', PATHS.pluginSrc],
]) {
  if (!existsSync(p)) fail(`找不到${label}：${p}`);
}

// ── 读输入 ─────────────────────────────────────────────────────
let snapshot;
let mappings;
try {
  snapshot = JSON.parse(readFileSync(PATHS.snapshot, 'utf8'));
} catch (e) {
  fail(`快照不是合法 JSON：${e.message}`);
}
try {
  mappings = JSON.parse(readFileSync(PATHS.codeConnect, 'utf8')).mappings ?? [];
} catch (e) {
  fail(`figma-code-connect.json 不是合法 JSON：${e.message}`);
}

// ── 仓库侧：react 路径是否存在 ─────────────────────────────────
// 用途：报告里区分「契约指向的文件已存在」与「前端还没建（前端该补）」——
// 后者正是 figma:diff 的 components 腿会报的 must。
const repoFileExists = (rel) => {
  if (!rel) return false;
  return existsSync(resolve(ROOT, rel));
};

const payload = buildContractPayload({ snapshot, mappings, repoFileExists });

// ── 插件产物：把 payload 内联进 plugin.src.js ─────────────────
//
// ⚠️ payload **内联**（不是读文件、不是起本地服务器）—— 插件运行时的 API 表面越小，
//    踩坑面越小。内联 ⇒ 零 IO、零 UI、零网络。
//
// ⚠️ 「契约段提取」的实现也**内联**（`__CONTRACT_SECTION__` 占位符）。
//    原因：插件跑在 Figma 沙箱里，不能 import ⇒ 只能内联。
//    但**源码只有一份**（scripts/lib/figma-contract-section.js）——
//    生成器把它的函数体原样贴进插件 ⇒ 三端口径不可能漂移。
//    （以前插件自己写了一份 `includes('AI_CONTRACT:')`，
//      与采集段的 `/---([\s\S]*?)---/` 不一致 ⇒ 静默漏写。）
const src = readFileSync(PATHS.pluginSrc, 'utf8');
for (const placeholder of ['__PAYLOAD__', '__CONTRACT_SECTION__']) {
  if (!src.includes(placeholder)) {
    fail(
      `插件源码里找不到 ${placeholder} 占位符：${PATHS.pluginSrc}\n   （生成器靠它把产物内联进去）`,
    );
  }
}
const sectionSrc = [...SECTION_CONSTANTS, ...SECTION_FUNCTIONS.map((fn) => fn.toString())].join(
  '\n\n',
);
const code = src
  .replace('__PAYLOAD__', JSON.stringify(payload, null, 2))
  .replace('__CONTRACT_SECTION__', sectionSrc);

const payloadText = JSON.stringify(payload, null, 2) + '\n';

// ── --check：产物是否与当前快照同步 ─────────────────────────────
// 为什么要有：payload 是**生成物**。快照一更新（设计稿变了），
// payload 就过期 ⇒ 不重生成的话，写进 Figma 的是**旧契约**，
// 而现场看不出任何异常（插件照样跑成功）⇒ 典型的假绿。
if (CHECK) {
  const stale = [];
  if (!existsSync(PATHS.payload)) stale.push(`缺 ${PATHS.payload}`);
  else if (readFileSync(PATHS.payload, 'utf8') !== payloadText) stale.push(`payload 与快照不同步`);
  if (!existsSync(PATHS.pluginCode)) stale.push(`缺 ${PATHS.pluginCode}`);
  else if (readFileSync(PATHS.pluginCode, 'utf8') !== code) stale.push(`插件产物与快照不同步`);

  if (stale.length) {
    console.error('❌ 契约草案产物过期：');
    for (const s of stale) console.error(`   · ${s}`);
    console.error('\n   ⇒ 跑 `node scripts/figma-contract-payload.mjs` 重新生成。');
    console.error('   （设计稿变了但草案没跟上 ⇒ 会把旧契约写回 Figma，而现场看不出异常。）');
    process.exit(1);
  }
  console.log('✅ 契约草案产物与快照同步');
  process.exit(0);
}

// ── 生成 ───────────────────────────────────────────────────────
writeFileSync(PATHS.payload, payloadText, 'utf8');
writeFileSync(PATHS.pluginCode, code, 'utf8');

// ── 报告 ───────────────────────────────────────────────────────
const needFrontend = payload.writes.filter((w) => !w.reactExists);
const needReview = payload.writes.filter((w) => w.provenance.a11y === 'convention');

console.log('# AI_CONTRACT 契约草案 — 审阅报告\n');
console.log(`快照：\`${PATHS.snapshot.replace(ROOT + '/', '')}\` · fileKey \`${payload.fileKey}\``);
console.log(`快照采集于：${payload.snapshotCapturedAt ?? '(未记录)'}\n`);
console.log(
  `待写 **${payload.writes.length}** 个 · 跳过 **${payload.skipped.length}** 个` +
    `（共 ${payload.stats.total} 个节点）\n`,
);

console.log('## 跳过的（**没写**，附原因）\n');
const reasonText = {
  'already-has-contract': '已有契约段（幂等，不覆盖）',
  'no-react-mapping':
    '**无 code-connect 映射 ⇒ 前端无归属**。不编路径 —— 假路径会给前端发一条它永远不会兑现的 must',
  'unsupported-carrier:COMPONENT': '载体不支持',
};
for (const s of payload.skipped) {
  console.log(`- \`${s.name}\` — ${reasonText[s.reason] ?? s.reason}`);
}
console.log('');

console.log('## 待写的（**草案**，每字段都标了来源）\n');
console.log('| 节点 | 载体 | react | 文件已存在 | props | a11y | states |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const w of payload.writes) {
  console.log(
    `| \`${w.name}\` | ${w.carrier} | \`${w.contractBody.split('\n')[1].replace('  react: ', '')}\` | ` +
      `${w.reactExists ? '✓' : '**✗ 前端该建**'} | ${w.provenance.props} | ${w.provenance.a11y} | ${w.provenance.states} |`,
  );
}
console.log('');

if (needFrontend.length) {
  console.log(`### ⚠️ 这 ${needFrontend.length} 个组件指向的文件在仓库里还不存在\n`);
  console.log(
    '它们就是 `figma:diff` 的 components 腿会报的 **must** ——「设计稿要求前端建这些组件」。',
  );
  console.log(
    '写完契约后重跑采集，新快照会让 components 腿从「覆盖 10 个组件」变成「覆盖 35 个」。\n',
  );
  for (const w of needFrontend)
    console.log(`- \`${w.name}\` → \`${w.contractBody.split('\n')[1].replace('  react: ', '')}\``);
  console.log('');
}

console.log(
  `### ⚠️ 这 ${needReview.length} 个组件的 a11y 是**按名字语义推断**的（provenance=convention）\n`,
);
console.log('设计稿上本来就没有契约段 ⇒ 设计稿没规定无障碍语义。');
console.log(
  '这里给的是「按名字该有的最小角色约定」，**keyboard 一律留空**（键位是真正的设计决定，猜错代价大）。',
);
console.log('**请审阅后修正** —— 契约段里已标 `draft: true`，提醒这是机器起草的。\n');

console.log('## 落地步骤\n');
console.log('```bash');
console.log('# 1. 生成产物（已自动执行）');
console.log('npm run figma:payload');
console.log('');
console.log('# 2. 在 Figma 桌面 App 里导入插件');
console.log('#    Plugins → Development → Import plugin from manifest');
console.log('#    选 scripts/figma-write-plugin/manifest.json');
console.log('#    ⚠️ 必须在 Design 模式（不是 Dev Mode）');
console.log('');
console.log('# 3. 打开 AETHER 文件 → 运行插件 → 看通知里的「应用 N 条」');
console.log('');
console.log('# 4. 回到仓库重跑采集，产出新快照（用 scripts/figma-snapshot-seg.js 的 SEG1）');
console.log('#    然后 npm run figma:diff 看 components 腿覆盖了多少');
console.log('```');
console.log('');
console.log(
  `产物：\`${PATHS.payload.replace(ROOT + '/', '')}\` · ` +
    `\`${PATHS.pluginCode.replace(ROOT + '/', '')}\``,
);
