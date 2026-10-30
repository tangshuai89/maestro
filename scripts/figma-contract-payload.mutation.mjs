#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AI_CONTRACT 契约草案生成器 — 变异验证
//
// 同 figma-diff.mutation.mjs 的规矩：**「测试全绿」不能证明判据是对的**。
// 唯一能证明的办法是**反证**：把推导规则故意改坏，看测试会不会红。
//
// 与 figma-diff.mutation.mjs 的差别（本脚本）：
//   · 不需要「行为指纹」那层 —— 这里改坏的是**纯函数**，
//     指纹必然变（返回值直接变了）。但仍保留空变异守卫。
//   · 变异清单覆盖的是**三条红线**：
//     ① 不编造（推不出来的不许生成）
//     ② 格式对（载体必须用 --- 裹住、写→读能闭环）
//     ③ 推导不越界（states 只认 state= 前缀；映射必须 nodeId 严格相等）
//
// ⚠️ 会**原地改写**被测源码（try/finally 保证还原）。请在干净工作区跑。
//
// 用法：
//   node scripts/figma-contract-payload.mutation.mjs
//   node scripts/figma-contract-payload.mutation.mjs --only M5
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(__dirname, 'lib/figma-contract-payload.mjs');
const TEST = resolve(__dirname, 'figma-contract-payload.test.mjs');

const MUTATIONS = [
  {
    id: 'M1',
    file: 'lib/figma-contract-payload.mjs',
    from: '    const m = /(?:^|,)\\s*state=([^,]+)/.exec(String(v));',
    to: '    const m = /(?:^|,)\\s*([^=,\\s]+)=([^,]+)/.exec(String(v));',
    why: 'states 推导不再只认 state= 前缀 ⇒ platform=/quality=/tone= 被当成状态',
  },
  {
    id: 'M2',
    file: 'lib/figma-contract-payload.mjs',
    from: '      if (s && !out.includes(s)) out.push(s);',
    to: '      if (s) out.push(s);',
    why: 'states 去重失效 ⇒ 重复状态进契约',
  },
  {
    id: 'M3',
    file: 'lib/figma-contract-payload.mjs',
    from: "    if (rawType.endsWith('?')) parts.push(`${name}?: ${rawType.slice(0, -1).trim()}`);",
    to: '    parts.push(`${name}: ${rawType}`);',
    why: 'props 的可选标记（`name?:`）丢失 ⇒ 契约把可选 prop 说成必填',
  },
  {
    id: 'M4',
    file: 'lib/figma-contract-payload.mjs',
    from: "  return { text: '{}', role: null };",
    to: "  return { text: '{ role: button, keyboard: [] }', role: 'button' };",
    why: 'a11y 命中不了时编一个角色 ⇒ 凭空造设计事实',
  },
  {
    id: 'M5',
    file: 'lib/figma-contract-section.js',
    from: '  const block = `${SECTION_FENCE}\\n${body}\\n${SECTION_FENCE}`;',
    to: '  const block = body;',
    why: '载体不用 --- 包裹 ⇒ 下次采集提不出契约段（写→读闭环断）',
  },
  {
    id: 'M6',
    file: 'lib/figma-contract-payload.mjs',
    from: "  if (draft) lines.push('  draft: true');",
    to: "  if (false) lines.push('  draft: true');",
    why: 'draft 标记被去掉 ⇒ 机器起草的契约冒充人工权威',
  },
  {
    id: 'M7',
    file: 'lib/figma-contract-payload.mjs',
    from: "    `  states: [${states.join(', ')}]`,",
    to: '    `  states: []`,',
    why: 'states 字段被清空 ⇒ 契约丢了状态维度',
  },
  {
    id: 'M8',
    file: 'lib/figma-contract-payload.mjs',
    from: "  if (nodeType === 'FRAME') return 'text-child';",
    to: "  if (nodeType === 'FRAME') return 'description';",
    why: 'FRAME 走 description 载体 ⇒ FRAME 根本没有 description 字段，插件会写失败',
  },
  {
    id: 'M9',
    file: 'lib/figma-contract-payload.mjs',
    from: '    if (node.contract && String(node.contract).trim()) {',
    to: '    if (false) {',
    why: '幂等第一道闸失效 ⇒ 已有契约的节点被覆盖',
  },
  {
    id: 'M10',
    file: 'lib/figma-contract-payload.mjs',
    from: '    if (!react) {',
    to: '    if (false) {',
    why: '「无映射就跳过」失效 ⇒ 凭空造 react 路径（给前端发假的 must）',
  },
  {
    id: 'M11',
    file: 'lib/figma-contract-payload.mjs',
    from: '    const mapping = candidates.find((m) => m.figmaNodeId && m.figmaNodeId === nodeId) ?? null;',
    to: '    const mapping = candidates[0] ?? null;',
    why: '映射的 nodeId 不再严格相等 ⇒ 同名不同类时会把别人的 react 归属安上（回退 C）',
  },
  {
    id: 'M12',
    file: 'lib/figma-contract-payload.mjs',
    from: "  if (nodeType === 'FRAME') return 'text-child';\n  return null;",
    to: "  if (nodeType === 'FRAME') return 'text-child';\n  return 'description';",
    why: '未知载体类型被硬塞成 description ⇒ 往不支持的节点上写',
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
const equivalent = [];
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
  console.error(`❌ 漏网 ${missed.length} 条：${missed.map((m) => m.id).join(', ')}`);
  console.error('   ⇒ 这些推导规则**没被测到**，等于没有判据。');
  process.exit(1);
}
console.log('✅ 全部变异都被抓住 —— 推导规则是可验证的');
process.exit(0);
