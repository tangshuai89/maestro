#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AI_CONTRACT 契约段共享实现 —— 变异验证
//
// 同 figma-diff.mutation.mjs 的规矩：**「测试全绿」不能证明判据是对的**。
// 唯一能证明的办法是**反证**：把实现故意改坏，看测试会不会红。
//
// 本脚本覆盖的是本次修的两个 bug：
//   ① P0：合并覆盖散文 ⇒ 人工设计文档被抹掉
//   ② P1：提取口径漂移 ⇒ 静默漏写（插件以为写过了，采集段提不出来）
//
// ⚠️ 会**原地改写**被测源码（try/finally 保证还原）。请在干净工作区跑。
//
// 用法：
//   node scripts/figma-contract-section.mutation.mjs
//   node scripts/figma-contract-section.mutation.mjs --only M3
//   node scripts/figma-contract-section.mutation.mjs --list
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(__dirname, 'lib/figma-contract-section.js');
const TEST = resolve(__dirname, 'figma-contract-section.test.mjs');

const MUTATIONS = [
  {
    id: 'M1',
    file: 'lib/figma-contract-section.js',
    from: '  const m = raw.match(/---([\\s\\S]*?)---/);',
    to: '  const m = raw.match(/---([\\s\\S]*)/);',
    why: '提取改成贪婪匹配 ⇒ 契约段后面还粘着散文 ⇒ 契约里混入散文内容',
  },
  {
    id: 'M2',
    file: 'lib/figma-contract-section.js',
    from: "  if (!raw || typeof raw !== 'string') return '';",
    to: "  if (!raw) return '';",
    why: '不校验类型 ⇒ 非字符串输入（如对象）会走进 match 并可能抛异常',
  },
  {
    id: 'M3',
    file: 'lib/figma-contract-section.js',
    from: '  return `${block}\\n\\n${existing}`;',
    to: '  return existing;',
    why: '合并丢契约段 ⇒ 写进去的东西采集段提不出来（写→读闭环断）',
  },
  {
    id: 'M4',
    file: 'lib/figma-contract-section.js',
    from: '  return `${block}\\n\\n${existing}`;',
    to: '  return `${existing}\\n\\n${block}`;',
    why: '契约段放后面 ⇒ 散文里有 --- 时采集段提错段（第一对 --- 不是契约）',
  },
  {
    id: 'M5',
    file: 'lib/figma-contract-section.js',
    from: '  return `${block}\\n\\n${existing}`;',
    to: '  return block;',
    why: '合并覆盖散文 ⇒ **人工写的设计文档被抹掉**（本次修的 P0）',
  },
  {
    id: 'M6',
    file: 'lib/figma-contract-section.js',
    from: '  if (hasContractSection(existing)) return existing;',
    to: '  if (false) return existing;',
    why: '幂等守卫失效 ⇒ 已有契约段被叠加（重复跑插件会写多份）',
  },
  {
    id: 'M7',
    file: 'lib/figma-contract-section.js',
    from: 'function hasContractSection(raw) {\n  return extractContractSection(raw).length > 0;\n}',
    to: 'function hasContractSection(raw) {\n  return String(raw ?? "").includes("AI_CONTRACT:");\n}',
    why: '「有无契约段」改成「文本含不含 AI_CONTRACT:」⇒ 散文提及被当成已写（本次修的 P1）',
  },
  {
    id: 'M8',
    file: 'lib/figma-contract-section.js',
    from: '  if (!body) return existing;',
    to: '  if (false) return existing;',
    why: '空契约段不再短路 ⇒ 写出空的 ---段 ⇒ 采集段提出来是空串（假契约）',
  },
  {
    id: 'M9',
    file: 'lib/figma-contract-section.js',
    from: "  const existing = typeof raw === 'string' ? raw.trim() : '';",
    to: "  const existing = typeof raw === 'string' ? raw : '';",
    why: '不 trim 载体现有文本 ⇒ 合并后散文前后多出空行（格式漂移）',
  },
  {
    id: 'M10',
    file: 'lib/figma-contract-section.js',
    from: '  const block = `${SECTION_FENCE}\\n${body}\\n${SECTION_FENCE}`;',
    to: '  const block = body;',
    why: '不裹 --- ⇒ 采集段提不出契约段（写→读闭环断）',
  },
  {
    id: 'M11',
    file: 'figma-snapshot-seg.js',
    from: '    const body = extractContractSection(carrier);',
    to: "    const body = ((carrier.match(/---([\\\\s\\\\S]*?)---/) || [])[1] || '').trim();",
    why: '采集段里又手写了一份 fence 正则（绕过共享实现）⇒ 两份实现 ⇒ 约定一改就静默失效',
  },
  {
    id: 'M12',
    file: 'figma-write-plugin/plugin.src.js',
    from: "const CARRIER_TEXT_NAME = 'AI_CONTRACT';",
    to: "const CARRIER_TEXT_NAME = 'AI_CONTRACT';\nconst _legacyFence = /---([\\s\\S]*?)---/;",
    why: '插件源码里又手写了一份 fence 正则 ⇒ 下次生成产物就变成两份实现',
  },
];

const argList = process.argv.slice(2);
if (argList.includes('--list')) {
  console.log(`变异清单（${MUTATIONS.length} 条）：\n`);
  for (const m of MUTATIONS) console.log(`  ${m.id}  ${m.file}\n      ${m.why}`);
  console.log('');
  process.exit(0);
}

const onlyAt = argList.indexOf('--only');
const onlyIds = onlyAt !== -1 ? argList[onlyAt + 1].split(',').map((s) => s.trim()) : null;
if (onlyIds) {
  const known = new Set(MUTATIONS.map((m) => m.id));
  const bad = onlyIds.filter((id) => !known.has(id));
  if (bad.length) {
    console.error(`❌ --only 里的未知变异 id: ${bad.join(', ')}`);
    process.exit(2);
  }
}

function runTests() {
  try {
    execFileSync('node', [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

console.log('▶ 基线检查（不变异，测试必须全绿）…');
const baseline = runTests();
if (baseline.code !== 0) {
  console.error('❌ 基线就不绿 —— 变异验证无从谈起。先修测试。');
  console.error(baseline.out.split('\n').slice(-20).join('\n'));
  process.exit(1);
}
console.log('  ✅ 基线绿\n');

let caught = 0;
const missed = [];
const targets = onlyIds ? MUTATIONS.filter((m) => onlyIds.includes(m.id)) : MUTATIONS;

for (const m of targets) {
  const target = resolve(__dirname, m.file);
  const original = readFileSync(target, 'utf8');
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) {
    console.error(`❌ ${m.id} 变异锚点不唯一（命中 ${hits} 次）—— 变异无效，先修脚本`);
    console.error(`   锚点: ${JSON.stringify(m.from.slice(0, 70))}`);
    process.exit(1);
  }
  if (m.from === m.to) {
    console.error(`❌ ${m.id} 变异是空变异（from === to）—— 不会改变任何行为，先修脚本`);
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

const restored = runTests();
console.log('');
if (restored.code !== 0) {
  console.error('❌ 还原后测试仍不绿 —— 变异脚本破坏了源码，需人工检查。');
  process.exit(1);
}
console.log('✅ 还原后测试回到绿');

console.log('');
console.log(`变异验证：${caught}/${targets.length} 被抓住`);
if (missed.length) {
  console.error('❌ 有变异存活 —— 判据有洞，必须补测试：');
  for (const m of missed) console.error(`   ${m.id}: ${m.why}`);
  process.exit(1);
}
console.log('✅ 全部被抓住');
process.exit(0);
