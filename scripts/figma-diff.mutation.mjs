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
    from: "    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';",
    to: "    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '（未写理由也放行）';",
    why: '豁免条目不要求 reason（"随手加一条就能过门禁"）',
  },
  {
    id: 'M12',
    file: 'figma-diff.mjs',
    from: '    if (!entry.kind && !entry.lane && !entry.target) continue; // 空条件不许豁免一切',
    to: '    // 空条件也豁免',
    why: '空匹配条件的豁免条目豁免掉一切差异',
  },

  // ── 2026-10-29 独立评审（Claude Code）实测出的 6 条存活变异 ──
  // 评审在沙箱里跑了 11 条候选变异，6 条存活 —— 说明当时的测试没在测它声称的东西。
  // 下面这 6 条 + 我补的防绕过变体，就是把那个洞永久封住。
  {
    id: 'M13',
    file: 'figma-diff.mjs',
    from: 'diffComponents(components, mappings, repoFileExists, screens)',
    to: 'diffComponents(components, mappings, repoFileExists)',
    why: '调用点不传 screens（屏幕就不参与反向查找 → 30 条 orphaned 误报）',
  },
  {
    id: 'M14',
    file: 'figma-diff.mjs',
    from: "if (wants('tokens') && figmaTokens.size) {",
    to: 'if (false) {',
    why: '整条关掉 tokens 腿（此前路径写死，任何针对它的变异都测不到）',
  },
  {
    id: 'M15',
    file: 'figma-diff.mjs',
    from: '    if (entry.kind && entry.kind !== diff.kind) continue;',
    to: '    // 不按 kind 过滤',
    why: '豁免不按 kind 过滤 → 豁免 A 顺带豁免 B',
  },
  {
    id: 'M16',
    file: 'figma-diff.mjs',
    from: '    if (entry.target && entry.target !== diff.target) continue;',
    to: '    // 不按 target 过滤',
    why: '豁免不按 target 过滤',
  },
  {
    id: 'M17',
    file: 'lib/figma-snapshot.mjs',
    from: "    .replace(/^['\"]|['\"]$/g, '')\n",
    to: '',
    why: 'react 路径不清洗引号 → 带引号的路径被判成"文件不存在"（假 must）',
  },
  {
    id: 'M18',
    file: 'lib/figma-snapshot.mjs',
    from: 'for (const comp of allNodes) {',
    to: 'for (const comp of snapshotComponents) {',
    why: '屏幕不走正向检查（屏幕的 react 路径/重建完全看不见）',
  },

  // ── 防绕过类：让门禁在"不该绿"的时候变绿 ──
  {
    id: 'M19',
    file: 'figma-diff.mjs',
    from: 'for (const [k, actual] of Object.entries(expected)) {\n  if (counts[k] !== actual) {',
    to: 'for (const [k, actual] of Object.entries(expected)) {\n  if (false) {',
    why: 'counts 交叉校验失效（只抄了 1 个组件的截断快照能通过 → 门禁假绿）',
  },
  {
    id: 'M20',
    file: 'figma-diff.mjs',
    from: 'if (snapshot.motion.parseError) {',
    to: 'if (false) {',
    why: 'motion 采集失败不报错 → motion 腿的 must 永远报不出来',
  },
  {
    id: 'M21',
    file: 'figma-diff.mjs',
    from: 'if (!existsSync(PATHS.snapshot)) {\n  fail(',
    to: 'if (!existsSync(PATHS.snapshot)) {\n  if (true) { process.exit(0); }\n  fail(',
    why: '快照缺失时 exit 0 → `git rm` 快照就能让门禁变绿（最直接的绕过）',
  },
  {
    id: 'M22',
    file: 'figma-diff.mjs',
    from: "    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';",
    to: "    const reason = String(entry.reason ?? '').trim();",
    why: '豁免条目的 reason 只判空不判类型 → reason:true（布尔）也会生效',
  },
  {
    id: 'M23',
    file: 'lib/figma-snapshot.mjs',
    from: 'const unregistered = [...codeKeyframes].filter((k) => !specTokens.has(k));',
    to: 'const unregistered = [...codeKeyframes].filter((k) => !JSON.stringify(repoSpec).includes(k));',
    why: '@keyframes 回到子串匹配 → 散文里的普通单词被当成"已登记"（漏报）',
  },
  {
    id: 'M24',
    file: 'figma-diff.mjs',
    from: 'if (only !== null && !LANES.includes(only)) {',
    to: 'if (false) {',
    why: '--only 拼错不报错 → 静默跑成 0 条差异',
  },

  // ── 2026-10-29 第二轮独立评审：2 条存活变异 + 2 个新引入的回退 + 1 个退化输入 ──
  // 第一轮封堵后，评审用自己的变异集再跑一遍，又找出 6 个洞。
  // 下面每一条都对应**一个具体的、可复现的**输入，不是假想。
  {
    id: 'M25',
    file: 'figma-diff.mjs',
    from: '    if (entry.lane && entry.lane !== diff.lane) continue;',
    to: '    // 不按 lane 过滤',
    why: '豁免不按 lane 过滤 → 一条 motion 的豁免把 components 的 should 也豁免掉（评审实测存活）',
  },
  {
    id: 'M26',
    file: 'figma-diff.mjs',
    from:
      'for (const c of components) {\n' +
      '  const rp = reactPathOf(c.aiContract);\n' +
      '  if (rp) c.aiContract.react = rp;\n' +
      '}',
    to: 'for (const c of components) {\n  // 调用点不再清洗 react 路径\n}',
    why: '组件调用点不清洗 react 路径 → 报给 agent 的是带引号的死路径（评审实测存活 S6 的组件侧）',
  },
  {
    id: 'M27',
    file: 'figma-diff.mjs',
    from:
      'for (const s of screens) {\n' +
      '  const rp = reactPathOf(s.aiContract);\n' +
      '  if (rp) s.aiContract.react = rp;\n' +
      '}',
    to: 'for (const s of screens) {\n  // 调用点不再清洗 react 路径\n}',
    why: '屏幕调用点不清洗 react 路径 → 带引号的值像"不是路径" → 屏幕的 must 静默消失（评审实测存活 S6）',
  },
  {
    id: 'M28',
    file: 'lib/figma-snapshot.mjs',
    from: '    const skipNonPath = isScreen && !looksLikeRepoPath(reactPath);',
    to: '    const skipNonPath = !looksLikeRepoPath(reactPath);',
    why: '组件集也享受"不像路径就跳过"的豁免 → `react: xxx.tsx（待新建）` 静默漏报（评审实测的回退 B）',
  },
  {
    id: 'M29',
    file: 'lib/figma-snapshot.mjs',
    from:
      '    if (!exact && map.figmaNodeId && comp.nodeId && map.figmaNodeId !== comp.nodeId) {\n' +
      '      const mappedName = nodeIdToName.get(map.figmaNodeId);\n' +
      '      if (mappedName !== comp.name) {',
    to:
      '    if (!exact && map.figmaNodeId && comp.nodeId && map.figmaNodeId !== comp.nodeId) {\n' +
      '      const mappedName = nodeIdToName.get(map.figmaNodeId);\n' +
      '      if (false) {',
    why: '映射的 nodeId 抄成另一个**存在**的节点时不报（评审实测的回退 C · 组件侧）',
  },
  {
    id: 'M30',
    file: 'lib/figma-snapshot.mjs',
    from:
      '        // 映射 id 还在但**指向别的名字** ⇒ 抄错节点了 ⇒ 也报。\n' +
      '        if (mappedName !== comp.name) {',
    to:
      '        // 映射 id 还在但**指向别的名字** ⇒ 抄错节点了 ⇒ 也报。\n' + '        if (false) {',
    why: '屏幕侧的"映射抄错节点"检查被摘掉（评审实测的回退 C · 屏幕侧）',
  },
  {
    id: 'M31',
    file: 'figma-diff.mjs',
    from: "if (wants('tokens') && (!tokenDumpMeta.present || tokenDumpMeta.variables === 0)) {",
    to: "if (wants('tokens') && !tokenDumpMeta.present) {",
    why: 'token dump 的 variables 是空数组时静默跳过 tokens 腿（评审实测的退化输入）',
  },
  {
    id: 'M32',
    file: 'figma-diff.mjs',
    from: "if (!snapshot.motion || typeof snapshot.motion !== 'object') {",
    to: 'if (false) {',
    why: 'motion 非对象时不报错 → 采集失败被当成"没有动效"',
  },
  {
    id: 'M33',
    file: 'figma-diff.mjs',
    from: 'if (!Array.isArray(snapshot.motion.spec)) {',
    to: 'if (false) {',
    why: 'motion.spec 不是数组时不报错 → motion 腿静默跑成 0 条差异',
  },
  {
    id: 'M34',
    file: 'lib/figma-snapshot.mjs',
    from: "    .replace(/,$/, '')\n    .replace(/^['\"]|['\"]$/g, '')",
    to: "    .replace(/^['\"]|['\"]$/g, '')\n    .replace(/,$/, '')",
    why: 'reactPathOf 的清洗顺序倒过来（先去引号再去逗号）→ 路径尾部残留引号 → 假的 must',
  },
  {
    id: 'M35',
    file: 'figma-diff.mjs',
    from: '} else if (ccAt !== -1) {',
    to: '} else if (false) {',
    why: '显式指定 --code-connect 却不存在的文件时不报错 → 静默当成空映射表，差异清单失真',
  },
  {
    id: 'M36',
    file: 'figma-diff.mjs',
    from: '  if (mappings.length === 0) {',
    to: '  if (false) {',
    why: 'code-connect 映射表存在但为空时不报错 → 全都变 unmapped → 而 unmapped 在豁免表里 → 门禁假绿',
  },
  {
    id: 'M37',
    file: 'lib/figma-snapshot.mjs',
    from: '    const isScreen = comp._isScreen === true;',
    to: '    const isScreen = true;',
    why: '「是不是屏幕」不按来源判 → 组件集白拿屏幕的「不像路径就跳过」豁免 → 撞名组件集静默漏报',
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

// --only <id>：只跑指定的几条（迭代单条变异时省时间）。
//   --only M30  或  --only M25,M26
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

// ── 跑测试，返回 exit code ─────────────────────────────────────
function runTests() {
  try {
    execFileSync('node', [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// ── 行为指纹：跑真实快照，比对差异清单的 JSON ──────────────────
// 用途：区分两种「存活」——
//   ① **判据没被测到**（真洞）：变异改变了行为，但测试没红 ⇒ 必须修；
//   ② **等效变异**（假洞）：变异压根没改变行为（写错了锚点）⇒ 是变异脚本自己的 bug，
//      不是判据的洞。
// 两者都表现为"测试全绿"，但结论完全相反。2026-10-29 实测：M30 被我写成
// `const _ignored = true` 这种空变异，差点被当成"判据有洞"去改判据。
function behaviorFingerprint() {
  try {
    const out = execFileSync('node', [resolve(__dirname, 'figma-diff.mjs'), '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const j = JSON.parse(out);
    // 只取影响判定的部分：差异清单 + 统计。repoHead 之类的会随 git 状态变。
    return JSON.stringify({ diffs: j.diffs, stats: j.stats });
  } catch (e) {
    return `__error__:${e.status ?? 1}:${String(e.stdout ?? '').slice(0, 120)}`;
  }
}

const BASE_FINGERPRINT = behaviorFingerprint();

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
      // 测试全绿 —— 先分清是「真洞」还是「等效变异」
      const fp = behaviorFingerprint();
      if (fp === BASE_FINGERPRINT) {
        equivalent.push(m);
        console.log(
          `⚠️  ${m.id} 测试全绿，但**行为指纹没变** ⇒ 这是**等效变异**（锚点写错了，压根没改到判据），不是判据的洞。`,
        );
        console.log(`      ${m.why}`);
      } else {
        missed.push(m);
        console.log(`❌ ${m.id} 没被抓住（测试仍然全绿，但行为已变）— ${m.why}`);
      }
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
console.log(`变异验证：${caught}/${targets.length} 被抓住`);
if (equivalent.length) {
  console.error(
    `⚠️  等效变异 ${equivalent.length} 条（锚点写错，没改到判据）：${equivalent.map((m) => m.id).join(', ')}`,
  );
  console.error('   ⇒ 这是**变异脚本自己的 bug**，不是判据的洞 —— 修锚点，别改判据。');
}
if (missed.length) {
  console.error(`❌ 漏网 ${missed.length} 条：${missed.map((m) => m.id).join(', ')}`);
  console.error('   ⇒ 这些判据**没被测到**，等于没有判据。');
}
if (missed.length || equivalent.length) process.exit(1);
console.log('✅ 全部变异都被抓住 —— 判据是可验证的');
process.exit(0);
