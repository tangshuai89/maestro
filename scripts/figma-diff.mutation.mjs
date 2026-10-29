#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// figma:diff 变异验证 — 「改坏判据，测试必须红」
//
// 为什么有这个文件（2026-10-29 教训）：
//   判据类工具的"测试全绿"**不能证明判据是对的**。
//   真模型/真数据校准只暴露**假红**（吵闹，会被发现）；
//   **假绿**（模型答错了但判据也不认 → 安静通过）才是危险的那种。
//   所以唯一能证明判据有效的办法是**反证**：把判据故意改坏，
//   看测试会不会红。改坏了测试还绿 ⇒ 这个判据没被测到 ⇒ 等于没判据。
//
// 本脚本是**可复现**的变异验证（不是一次性手测）：
//   对每个变异 → 改坏源码 → 跑 figma-diff.test.mjs → 断言至少 1 个测试红
//   → 还原源码。任何一步失败都 exit 1。
//
// 用法：
//   node scripts/figma-diff.mutation.mjs          # 跑变异验证
//   node scripts/figma-diff.mutation.mjs --list   # 只列变异项
//
// ⚠️ 会**原地改写**被测源码（try/finally 保证还原）。
//    请在干净工作区跑；跑完用 git diff 确认已还原。
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(__dirname, 'lib/figma-snapshot.mjs');
const TEST = resolve(__dirname, 'figma-diff.test.mjs');

// ── 变异清单 ───────────────────────────────────────────────────
// file: 被改的文件（相对 scripts/）
// from: 待替换的原文（必须唯一命中，否则视为变异无效）
// to:   改坏后的代码
// why:  这条变异代表哪一类"判据失效"
const MUTATIONS = [
  {
    id: 'M1',
    file: 'lib/figma-snapshot.mjs',
    from: "kind: 'reactPathMissing',\n          severity: 'must',",
    to: "kind: 'reactPathMissing',\n          severity: 'note',",
    why: '把"契约声明的 react 文件不存在"从 must 降级为 note（主线丢失真问题）',
  },
  {
    id: 'M2',
    file: 'lib/figma-snapshot.mjs',
    from: 'if (indent <= baseIndent) {',
    to: 'if (indent < baseIndent) {',
    why: 'parseContract 不再区分缩进层级 → 嵌套 key 泄漏成顶层、props/a11y 被拍平',
  },
  {
    id: 'M3',
    file: 'lib/figma-snapshot.mjs',
    from: 'unregisteredKeyframes',
    to: 'unregisteredKeyframesDISABLED',
    why: '关掉 @keyframes 未登记检测（motion 腿变哑）',
  },
  {
    id: 'M4',
    file: 'lib/figma-snapshot.mjs',
    from: "const main = diffs.filter((d) => d.severity !== 'note');",
    to: 'const main = diffs;',
    why: '让 note（设计稿侧待办）也进主线段（违反 10-24 归档决策的方向铁律）',
  },
  {
    id: 'M5',
    file: 'lib/figma-snapshot.mjs',
    from: "target: 'packages/renderer/src/styles/base/_tokens.generated.scss',\n        }),\n      );\n    } else if (repoTokens.get(name) !== value) {",
    to: "target: 'packages/renderer/src/styles/base/_WRONG.scss',\n        }),\n      );\n    } else if (repoTokens.get(name) !== value) {",
    why: '令牌差异的 target 指错文件（agent 拿到清单会改错地方）',
  },
  {
    id: 'M6',
    file: 'lib/figma-snapshot.mjs',
    from: `const hasSemantic = (comp) =>
  comp.hasDescription !== undefined
    ? Boolean(comp.hasDescription)
    : Boolean(String(comp.description ?? '').trim());`,
    to: `const hasSemantic = (comp) => Boolean(String(comp.description ?? '').trim());`,
    why: 'descriptions 腿只认 description 全文字段 → 忽略采集段的 hasDescription → 全量误报',
  },
  {
    id: 'M7',
    file: 'lib/figma-snapshot.mjs',
    from: 'title: `设计稿新增令牌 ${css}`,',
    to: 'title: `设计稿新增令牌 --${name}`,',
    why: '令牌名重复 `--` 前缀（渲染成 ----accent）',
  },
  {
    id: 'M8',
    file: 'lib/figma-snapshot.mjs',
    from: 'const missing = REQUIRED_AI_CONTRACT_FIELDS.filter((f) => comp.aiContract[f] === undefined);',
    to: 'const missing = [];',
    why: '关掉"AI_CONTRACT 缺必填字段"检测',
  },
  {
    id: 'M9',
    file: 'figma-diff.mjs',
    from: "  if (diff.severity === 'must') return null; // must 不可豁免",
    to: '  // must 也允许豁免',
    why: '允许豁免 must 级差异（真问题被"为了过门禁"豁免掉）',
  },
  {
    id: 'M10',
    file: 'figma-diff.mjs',
    from: 'if (rawComponents.length === 0 && rawScreens.length === 0) {',
    to: 'if (false) {',
    why: '退化快照守卫失效（空/截断的快照被当成"设计稿没有差异"→ 门禁假绿）',
  },
  {
    id: 'M11',
    file: 'figma-diff.mjs',
    from: '    if (!entry.reason || !String(entry.reason).trim()) continue; // 无 reason = 未登记',
    to: '    // 无 reason 也豁免',
    why: '豁免条目不要求 reason（"随手加一条就能过门禁"）',
  },
  {
    id: 'M12',
    file: 'figma-diff.mjs',
    from: '    if (!entry.kind && !entry.lane && !entry.target) continue; // 空条件不许豁免一切',
    to: '    // 空条件也豁免',
    why: '空匹配条件的豁免条目豁免掉一切差异',
  },
];

const argList = process.argv.slice(2);

function listMutations() {
  console.log(`变异清单（${MUTATIONS.length} 条）：\n`);
  for (const m of MUTATIONS) {
    console.log(`  ${m.id}  ${m.file}`);
    console.log(`      ${m.why}`);
  }
  console.log('');
}

if (argList.includes('--list')) {
  listMutations();
  process.exit(0);
}

// ── 跑测试，返回 exit code ─────────────────────────────────────
function runTests() {
  try {
    execFileSync('node', [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// ── 基线：不变异时测试必须是绿的（否则谈不上"变坏被抓"）──────
console.log('▶ 基线检查（不变异，测试必须全绿）…');
const baseline = runTests();
if (baseline.code !== 0) {
  console.error('❌ 基线就不绿 —— 变异验证无从谈起。先修测试。');
  console.error(baseline.out.split('\n').slice(-20).join('\n'));
  process.exit(1);
}
console.log('  ✅ 基线绿\n');

// ── 逐个变异 ───────────────────────────────────────────────────
let caught = 0;
const missed = [];

for (const m of MUTATIONS) {
  const target = resolve(__dirname, m.file);
  const original = readFileSync(target, 'utf8');
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) {
    console.error(`❌ ${m.id} 变异锚点不唯一（命中 ${hits} 次）—— 变异无效，先修脚本`);
    console.error(`   锚点: ${JSON.stringify(m.from.slice(0, 70))}`);
    process.exit(1);
  }

  try {
    writeFileSync(target, original.replace(m.from, m.to), 'utf8');
    const res = runTests();
    if (res.code !== 0) {
      caught++;
      const red = (res.out.match(/^not ok /gm) || []).length;
      console.log(`✅ ${m.id} 被抓住（${red || '≥1'} 个测试红） — ${m.why}`);
    } else {
      missed.push(m);
      console.log(`❌ ${m.id} 没被抓住（测试仍然全绿）— ${m.why}`);
    }
  } finally {
    writeFileSync(target, original, 'utf8');
  }
}

// ── 还原后再跑一次，确认回到绿 ────────────────────────────────
const restored = runTests();
console.log('');
if (restored.code !== 0) {
  console.error('❌ 还原后测试仍不绿 —— 变异脚本破坏了源码，需人工检查。');
  process.exit(1);
}
console.log('✅ 还原后测试回到绿');

console.log('');
console.log(`变异验证：${caught}/${MUTATIONS.length} 被抓住`);
if (missed.length) {
  console.error(`❌ 漏网 ${missed.length} 条：${missed.map((m) => m.id).join(', ')}`);
  console.error('   ⇒ 这些判据**没被测到**，等于没有判据。');
  process.exit(1);
}
console.log('✅ 全部变异都被抓住 —— 判据是可验证的');
process.exit(0);
