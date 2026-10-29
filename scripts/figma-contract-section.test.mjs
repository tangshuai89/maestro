#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AI_CONTRACT 契约段 —— 共享实现的反向验证 + 三端口径一致性
//
// 同 figma-contract-payload.test.mjs 的规矩：**测试全是反向验证** ——
// 喂构造的坏数据，断言判据/实现报出来。一个永远绿的判据等于没有判据。
//
// 本文件守两件事：
//   ① **合并不丢散文**（2026-10-29 修的 P0：插件直接 `node.description = text`
//      会把人工写的设计文档抹掉 —— 不可逆）
//   ② **三端口径一致**（采集段 / 写入插件 / 生成器共用同一份实现；
//      口径漂移 ⇒ 静默漏写，现场看不出任何异常）
//
// 用法：node scripts/figma-contract-section.test.mjs
// ─────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const section = require('./lib/figma-contract-section.js');
const { extractContractSection, hasContractSection, mergeContractSection, SECTION_FENCE } = section;

// 真实快照里的散文（人工写的设计文档）—— 用真数据，不用编的
const SNAPSHOT = JSON.parse(readFileSync(resolve(__dirname, 'figma-snapshot.json'), 'utf8'));

const BODY =
  'AI_CONTRACT:\n  react: packages/renderer/src/components/views/TheaterView.tsx\n  props: {}';

// ════════════════════════════════════════════════════════════════
// 1. extractContractSection — 提取口径
// ════════════════════════════════════════════════════════════════

test('extractContractSection: 有 --- 包裹 ⇒ 提取出段正文（不含包裹）', () => {
  const raw = `---\n${BODY}\n---\n散文`;
  assert.equal(extractContractSection(raw), BODY);
});

test('extractContractSection: 纯散文 ⇒ 空串', () => {
  assert.equal(
    extractContractSection('Holographic cover area 480×500: orbit ring + 12 ticks.'),
    '',
  );
});

test('extractContractSection: **散文里提到 AI_CONTRACT: 不算有契约段**', () => {
  // ⚠️ 这是本次修的 P1：插件以前用 `includes('AI_CONTRACT:')` 判断
  //    ⇒ 散文里顺口一提就被当成「已经写过了」而跳过 ⇒ 静默漏写。
  const raw = '这个组件的说明：参见 AI_CONTRACT: 段落（在别处定义）。';
  assert.equal(extractContractSection(raw), '');
  assert.equal(hasContractSection(raw), false, '散文提及不得被当成契约段');
});

test('extractContractSection: 只有起始 --- 没有结束 --- ⇒ 空串', () => {
  assert.equal(extractContractSection('---\nAI_CONTRACT:\n  react: x'), '');
});

test('extractContractSection: 非字符串 / null ⇒ 空串（不得抛异常）', () => {
  for (const bad of [null, undefined, 123, {}, []]) {
    assert.equal(extractContractSection(bad), '');
  }
});

test('extractContractSection: 取**第一对** ---（非贪婪）', () => {
  const raw = `---\nFIRST\n---\n---\nSECOND\n---`;
  assert.equal(extractContractSection(raw), 'FIRST');
});

// ════════════════════════════════════════════════════════════════
// 2. mergeContractSection — 合并（本次修的 P0）
// ════════════════════════════════════════════════════════════════

test('mergeContractSection: **已有散文不得被抹掉**（P0 回归）', () => {
  const prose =
    'Holographic cover area 480×500: orbit ring + 12 ticks + 280×280 holographic cover + caption.';
  const merged = mergeContractSection(prose, BODY);
  assert.ok(merged.includes(prose), '散文必须原样保留');
  assert.ok(merged.includes(BODY), '契约段必须写入');
});

test('mergeContractSection: 契约段放**前面**（采集段取第一对 ---）', () => {
  const prose = '散文';
  const merged = mergeContractSection(prose, BODY);
  assert.ok(merged.indexOf(BODY) < merged.indexOf(prose), '契约段必须在散文之前');
});

test('mergeContractSection: 合并结果**能被采集段提取回来**（写→读闭环）', () => {
  const prose = '散文';
  const merged = mergeContractSection(prose, BODY);
  assert.equal(extractContractSection(merged), BODY);
});

test('mergeContractSection: 已有契约段 ⇒ 原样返回（幂等，不叠加不覆盖）', () => {
  const once = mergeContractSection('散文', BODY);
  const twice = mergeContractSection(once, 'AI_CONTRACT:\n  react: OTHER.tsx');
  assert.equal(twice, once, '第二次合并不得改变任何东西');
});

test('mergeContractSection: 载体现有文本为空 ⇒ 只写契约段', () => {
  const merged = mergeContractSection('', BODY);
  assert.equal(merged, `---\n${BODY}\n---`);
  assert.equal(extractContractSection(merged), BODY);
});

test('mergeContractSection: 载体现有文本是空白 ⇒ 等价于空', () => {
  assert.equal(mergeContractSection('   \n  ', BODY), `---\n${BODY}\n---`);
});

test('mergeContractSection: 契约段正文为空 ⇒ 原样返回（不写空段）', () => {
  assert.equal(mergeContractSection('散文', ''), '散文');
  assert.equal(mergeContractSection('散文', '   '), '散文');
});

test('mergeContractSection: 散文里有 --- 时，提取仍拿到契约段（段在前）', () => {
  const prose = '第一段\n---\n第二段';
  const merged = mergeContractSection(prose, BODY);
  assert.equal(extractContractSection(merged), BODY, '契约段在前 ⇒ 不会被散文里的 --- 干扰');
});

// ════════════════════════════════════════════════════════════════
// 3. 真实快照回归：所有「有散文无契约」的节点，合并不丢散文
// ════════════════════════════════════════════════════════════════

test('真实快照: 21 个「有散文无契约」的节点 ⇒ 合并后散文全在', () => {
  const nodes = [...(SNAPSHOT.components ?? []), ...(SNAPSHOT.screens ?? [])];
  const proseOnly = nodes.filter((n) => n.hasDescription && !n.hasContract);
  assert.ok(proseOnly.length > 0, '快照里应当有「有散文无契约」的节点');

  for (const n of proseOnly) {
    const preview = String(n.descriptionPreview ?? '');
    if (!preview) continue;
    // ⚠️ 比较用 trim 后的散文：合并实现会对载体现有文本做 trim
    //    （去首尾空白，语义无损）⇒ 直接拿未 trim 的原文 includes 会假红。
    //    （实测抓到过：Controls/Transport 的预览末尾有个尾随空格。）
    const trimmed = preview.trim();
    const merged = mergeContractSection(preview, BODY);
    assert.ok(merged.includes(trimmed), `${n.name}: 散文丢了`);
    assert.equal(extractContractSection(merged), BODY, `${n.name}: 契约段提取不到`);
    // 散文必须**逐字**保留（不只是「包含」）
    const prosePart = merged.slice(merged.indexOf('---', 4) + 3).trim();
    assert.equal(prosePart, trimmed, `${n.name}: 散文被改动了`);
  }
});

// ════════════════════════════════════════════════════════════════
// 4. 三端口径一致（本次修的 P1）
// ════════════════════════════════════════════════════════════════

/** 把采集段 SEG1 里的共享实现抠出来，在沙箱里跑（模拟 Figma 沙箱）。 */
function sandboxOfSeg1() {
  const { SEG1 } = require('./figma-snapshot-seg.js');
  const start = SEG1.indexOf('const SECTION_FENCE');
  const end = SEG1.indexOf('// ── 只读遍历');
  assert.ok(start >= 0 && end > start, '采集段里找不到共享实现');
  // eslint-disable-next-line no-new-func
  return new Function(
    `${SEG1.slice(start, end)}\nreturn { extractContractSection, hasContractSection };`,
  )();
}

test('三端口径一致: 采集段（SEG1 内联）与共享实现行为相同', () => {
  const seg = sandboxOfSeg1();
  const cases = [
    '',
    '纯散文',
    '散文里提到 AI_CONTRACT: 字样',
    `---\n${BODY}\n---`,
    `---\n${BODY}\n---\n散文`,
    `---\nFIRST\n---\n---\nSECOND\n---`,
    '---\n未闭合',
  ];
  for (const c of cases) {
    assert.equal(
      seg.extractContractSection(c),
      extractContractSection(c),
      `提取结果不一致：${JSON.stringify(c.slice(0, 30))}`,
    );
    assert.equal(
      seg.hasContractSection(c),
      hasContractSection(c),
      `有无契约段判断不一致：${JSON.stringify(c.slice(0, 30))}`,
    );
  }
});

test('三端口径一致: 写入插件（code.js 内联）与共享实现行为相同', () => {
  const code = readFileSync(resolve(__dirname, 'figma-write-plugin/code.js'), 'utf8');
  const start = code.indexOf('const SECTION_FENCE');
  const end = code.indexOf('const CARRIER_TEXT_NAME');
  assert.ok(start >= 0 && end > start, '插件产物里找不到共享实现');

  // eslint-disable-next-line no-new-func
  const plugin = new Function(
    `${code.slice(start, end)}\nreturn { extractContractSection, hasContractSection, mergeContractSection };`,
  )();

  const cases = [
    '',
    '纯散文',
    '散文里提到 AI_CONTRACT: 字样',
    `---\n${BODY}\n---`,
    `---\n${BODY}\n---\n散文`,
  ];
  for (const c of cases) {
    assert.equal(plugin.extractContractSection(c), extractContractSection(c));
    assert.equal(plugin.hasContractSection(c), hasContractSection(c));
    assert.equal(
      plugin.mergeContractSection(c, BODY),
      mergeContractSection(c, BODY),
      `合并结果不一致：${JSON.stringify(c.slice(0, 30))}`,
    );
  }
});

test('三端口径一致: 生成器产出的载体文本能被采集段提取回来', () => {
  const payload = JSON.parse(
    readFileSync(resolve(__dirname, 'figma-contract-payload.json'), 'utf8'),
  );
  assert.ok(payload.writes.length > 0);
  for (const w of payload.writes) {
    const extracted = extractContractSection(w.carrierText);
    assert.ok(extracted.length > 0, `${w.name}: 载体文本提不出契约段`);
    assert.ok(extracted.includes('AI_CONTRACT:'), `${w.name}: 提取到的段里没有 AI_CONTRACT`);
    assert.ok(extracted.includes('react:'), `${w.name}: 提取到的段里没有 react`);
  }
});

// ════════════════════════════════════════════════════════════════
// 5. 单一实现的**结构性守卫**（防「又手写了一份」）
// ════════════════════════════════════════════════════════════════
//
// ⚠️ 为什么光靠「三端口径一致」不够：
//    那条测试只证明**当下**三处行为一致；有人新写一份 fence 正则放进采集段，
//    行为可能暂时仍然一致（同样的正则）⇒ 测试绿，但已经变成**两份实现**。
//    两份实现迟早漂移 ⇒ 漂移的表现是**静默失效**（motion 腿提不出 JSON、门禁全绿）。
//
// ⇒ 这里断言的是**结构**，不是行为：
//    fence 正则在采集段/插件产物里**只允许出现一次**，且必须在共享实现区域内。

/** fence 正则的字面源码（共享实现里那一份）。 */
const FENCE_RE_LITERAL = '/---([\\s\\S]*?)---/';

/** 统计 [start, end) **之外**还有几处 fence 正则。 */
function countFenceOutside(text, start, end) {
  const outside = text.slice(0, start) + text.slice(end);
  return outside.split(FENCE_RE_LITERAL).length - 1;
}

test('单一实现: 采集段里 fence 正则只在共享实现区域内出现', () => {
  const { SEG1 } = require('./figma-snapshot-seg.js');
  const start = SEG1.indexOf('const SECTION_FENCE');
  const end = SEG1.indexOf('// ── 只读遍历');
  assert.ok(start >= 0 && end > start, '采集段里找不到共享实现区域');
  assert.equal(
    countFenceOutside(SEG1, start, end),
    0,
    '采集段在共享实现之外又手写了一份 fence 正则 ⇒ 两份实现 ⇒ 迟早漂移（静默失效）',
  );
  assert.equal(
    SEG1.split(FENCE_RE_LITERAL).length - 1,
    1,
    '采集段里 fence 正则应恰好一处（共享实现那一处）',
  );
});

test('单一实现: 写入插件产物里 fence 正则只在共享实现区域内出现', () => {
  const code = readFileSync(resolve(__dirname, 'figma-write-plugin/code.js'), 'utf8');
  const start = code.indexOf('const SECTION_FENCE');
  const end = code.indexOf('const CARRIER_TEXT_NAME');
  assert.ok(start >= 0 && end > start, '插件产物里找不到共享实现区域');
  assert.equal(
    countFenceOutside(code, start, end),
    0,
    '插件产物在共享实现之外又手写了一份 fence 正则 ⇒ 两份实现 ⇒ 迟早漂移',
  );
  assert.equal(
    code.split(FENCE_RE_LITERAL).length - 1,
    1,
    '插件产物里 fence 正则应恰好一处（共享实现那一处）',
  );
});

test('单一实现: 插件源码里 fence 正则只出现在占位符注入区内', () => {
  // ⚠️ 源码也要守：产物是生成物，源码里多写一份 ⇒ 下次生成就会带进产物。
  const src = readFileSync(resolve(__dirname, 'figma-write-plugin/plugin.src.js'), 'utf8');
  const start = src.indexOf('__CONTRACT_SECTION__');
  const end = src.indexOf('const CARRIER_TEXT_NAME');
  assert.ok(start >= 0 && end > start, '插件源码里找不到注入区');
  assert.equal(
    countFenceOutside(src, start, end),
    0,
    '插件源码在注入区之外又手写了一份 fence 正则 ⇒ 下次生成就变成两份实现',
  );
});

// ════════════════════════════════════════════════════════════════
// 6. 采集段端到端：**真跑一遍** SEG1（最小 figma mock）
// ════════════════════════════════════════════════════════════════
//
// ⚠️ 为什么必须真跑：SEG1 是「贴给 use_figma 执行的代码字符串」，
//    不参与任何构建/测试 ⇒ 它坏了（语法错、提取口径错）**没有任何门禁会发现**，
//    直到你手工跑一次采集、发现快照是空的/错的。
//    （实测抓到过：在模板字符串的注释里写了反引号 ⇒ 模板被截断 ⇒ SEG1 整段语法错，
//      而当时所有既有测试都是绿的 —— 因为没人跑过它。）
//
// 做法：造一个最小 figma mock（页面 / 组件集 / 屏幕 / MOTION SPEC），
// 用 AsyncFunction 执行 SEG1，断言三条腿的产出。

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * 造一个带 findAllWithCriteria 的假节点（真实 API 返回的是**后代**，不含自身）。
 *
 * ⚠️ `characters` 必须带上：屏幕/MOTION SPEC 的契约存在**隐藏 TEXT 子节点**里
 *    （采集段读的是 `c.characters`）—— mock 漏了它 ⇒ 契约提不出来（假红）。
 */
function mockNode({ id, name, type, description = '', characters = '', children = [] }) {
  const node = { id, name, type, description, characters, children };
  node.findAllWithCriteria = ({ types }) => {
    const out = [];
    const walk = (n) => {
      for (const c of n.children ?? []) {
        if (!types || types.includes(c.type)) out.push(c);
        walk(c);
      }
    };
    walk(node);
    return out;
  };
  return node;
}

/**
 * 补上 parent 链。
 *
 * ⚠️ 必须有：采集段判「孤立 COMPONENT」靠的是 `c.parent.type === 'COMPONENT_SET'`
 *    （真实 Figma 节点都有 parent）。mock 里少了 parent ⇒ set 内的变体会被
 *    误当成孤立组件重复计入 ⇒ 组件数虚高。
 */
function linkParents(node, parent = null) {
  node.parent = parent;
  for (const c of node.children ?? []) linkParents(c, node);
}

/** 最小 figma mock：三条腿各放一个「有契约」「只有散文」的节点。 */
function mockFigma() {
  const CONTRACT_TEXT =
    'AI_CONTRACT:\n  react: packages/renderer/src/components/views/TheaterView.tsx';
  const PROSE = 'Holographic cover area 480×500: orbit ring + 12 ticks.';

  const setWithContract = mockNode({
    id: '1:3',
    name: 'Button/Text',
    type: 'COMPONENT_SET',
    description: `---\n${CONTRACT_TEXT}\n---\n${PROSE}`,
    children: [mockNode({ id: '1:5', name: 'Primary', type: 'COMPONENT', description: PROSE })],
  });
  const setProseOnly = mockNode({
    id: '1:2',
    name: 'Ring/Progress',
    type: 'COMPONENT_SET',
    description: PROSE,
  });
  const looseComp = mockNode({
    id: '1:4',
    name: 'Icon/Dislike',
    type: 'COMPONENT',
    description: PROSE,
  });

  const compPage = mockNode({
    id: '10',
    name: '02 · Components',
    type: 'PAGE',
    children: [setWithContract, setProseOnly, looseComp],
  });

  const theater = mockNode({
    id: '2:1',
    name: 'Screen/Theater',
    type: 'FRAME',
    children: [
      mockNode({
        id: '2:2',
        name: 'AI_CONTRACT',
        type: 'TEXT',
        characters: `---\n${CONTRACT_TEXT}\n---\n${PROSE}`,
      }),
    ],
  });
  const screenNoContract = mockNode({
    id: '2:3',
    name: 'Screen/SourceSelect',
    type: 'FRAME',
  });
  const notAScreen = mockNode({ id: '2:4', name: 'Toolbar', type: 'FRAME' });
  const screenPage = mockNode({
    id: '20',
    name: '03 · Screens',
    type: 'PAGE',
    children: [theater, screenNoContract, notAScreen],
  });

  const motionFrame = mockNode({
    id: '3:1',
    name: 'MOTION SPEC',
    type: 'FRAME',
    children: [
      mockNode({
        id: '3:2',
        name: 'MOTION_SPEC',
        type: 'TEXT',
        characters:
          '动效规格说明\n---\n{"spec":[{"id":"btn-play-hover","duration_ms":120}],"MOTION_SPEC":"v4"}\n---',
      }),
    ],
  });
  const motionPage = mockNode({
    id: '30',
    name: '04 · Motion',
    type: 'PAGE',
    children: [motionFrame],
  });

  const root = { children: [compPage, screenPage, motionPage] };
  linkParents(root);
  return {
    root,
    currentPage: compPage,
    fileKey: 'FtbRZXvzlCp4Sq9e322cQQ',
    async setCurrentPageAsync() {},
  };
}

test('采集段端到端: SEG1 能跑通并产出三条腿的结果', async () => {
  const { SEG1 } = require('./figma-snapshot-seg.js');
  const raw = await new AsyncFunction('figma', SEG1)(mockFigma());
  const out = JSON.parse(raw);

  // counts 与数组长度必须逐一相等（spec §5.3 的硬规则）
  assert.equal(out.counts.components, out.components.length);
  assert.equal(out.counts.screens, out.screens.length);
  assert.equal(out.counts.motionEntries, out.motion.spec.length);

  const byId = (arr, id) => arr.find((n) => n.nodeId === id);

  // 组件腿
  assert.equal(out.components.length, 3, '组件集 2 + 孤立组件 1（set 内的变体不该重复计入）');
  const withContract = byId(out.components, '1:3');
  assert.ok(withContract, 'Button/Text 没被采到');
  assert.ok(withContract.contract.includes('react:'), '有契约段的组件应提取出契约');
  assert.equal(withContract.hasContract, true);
  assert.equal(withContract.hasDescription, true);
  assert.equal(withContract.descriptionPreview, '', '有契约段就不该再给散文预览');
  assert.deepEqual(withContract.variants, ['Primary']);

  const proseOnly = byId(out.components, '1:2');
  assert.ok(proseOnly, 'Ring/Progress 没被采到');
  assert.equal(proseOnly.contract, '', '纯散文不该提取出契约');
  assert.equal(proseOnly.hasContract, false);
  assert.equal(proseOnly.hasDescription, true);
  assert.ok(proseOnly.descriptionPreview.includes('Holographic'), '散文预览应保留内容');

  assert.ok(byId(out.components, '1:4'), '孤立组件 Icon/Dislike 应被采到');
  assert.equal(byId(out.components, '1:5'), undefined, 'set 内的变体不该单独计入');

  // 屏幕腿
  assert.equal(out.screens.length, 2, '只收 Screen/ 开头的 FRAME');
  const theater = byId(out.screens, '2:1');
  assert.ok(theater, 'Screen/Theater 没被采到');
  assert.ok(theater.contract.includes('react:'), '隐藏 TEXT 子节点里的契约应被提取');
  assert.equal(byId(out.screens, '2:4'), undefined, '非 Screen/ 命名的 FRAME 不该进屏幕腿');

  // 动效腿（这条腿以前是采集段里**唯一**手写 fence 正则的地方）
  assert.equal(out.motion.spec.length, 1, 'MOTION SPEC 的 JSON 应被提取并解析');
  assert.equal(out.motion.spec[0].id, 'btn-play-hover');
  assert.equal(out.motion.version, 'v4');
  assert.equal(out.motion.parseError, undefined, '动效段不应有解析错误');
});
