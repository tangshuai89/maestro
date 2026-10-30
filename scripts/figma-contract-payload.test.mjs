#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AI_CONTRACT 契约草案生成器 — 自检
//
// 同 figma-diff.test.mjs 的规矩：**测试全是反向验证** —— 喂构造的坏数据，
// 断言判据/推导报出来。一个永远绿的判据等于没有判据。
//
// 本文件重点守三件事（都是「静默出错最贵」的地方）：
//   ① **不编造**：推不出来的字段不得凭空生成（尤其 react 路径）
//   ② **格式对**：载体文本必须用 `---` 裹住 —— 不裹下次采集提不出契约段
//   ③ **推导不越界**：states 只认 `state=` 前缀；platform=/quality= 不是状态
//
// 用法：node scripts/figma-contract-payload.test.mjs
// ─────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveStates,
  deriveProps,
  deriveA11y,
  buildContractBody,
  buildCarrierText,
  carrierOf,
  buildContractPayload,
  SECTION_FENCE,
} from './lib/figma-contract-payload.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ════════════════════════════════════════════════════════════════
// 1. deriveStates — 只认 state= 前缀
// ════════════════════════════════════════════════════════════════

test('deriveStates: 认 state= 前缀', () => {
  assert.deepEqual(deriveStates(['state=idle', 'state=hover']), ['idle', 'hover']);
});

test('deriveStates: **不认** platform= / provider= / quality= / tone= / size=（那些是别的维度）', () => {
  // 实证：已完成的 SourceChip 变体是 platform=qq|…，但 states 是 [default,best,no-rights]
  // ⇒ 变体维度 ≠ 状态维度。把 platform= 当状态就是推错。
  assert.deepEqual(deriveStates(['platform=qq', 'provider=netease', 'quality=high']), []);
});

test('deriveStates: 复合变体里只取 state= 的那一维', () => {
  assert.deepEqual(deriveStates(['size=sm, state=default', 'size=md, state=hover']), [
    'default',
    'hover',
  ]);
  assert.deepEqual(deriveStates(['platform=qq, state=idle', 'platform=qq, state=active']), [
    'idle',
    'active',
  ]);
  assert.deepEqual(deriveStates(['tone=cyan, live=false']), []);
});

test('deriveStates: 去重且保序', () => {
  assert.deepEqual(deriveStates(['state=b', 'state=a', 'state=b']), ['b', 'a']);
});

test('deriveStates: 垃圾输入不得抛异常', () => {
  assert.deepEqual(deriveStates(null), []);
  assert.deepEqual(deriveStates(undefined), []);
  assert.deepEqual(deriveStates([null, 123, {}]), []);
  assert.deepEqual(deriveStates(['state=']), []);
});

// ════════════════════════════════════════════════════════════════
// 2. deriveProps — 映射签名 → 契约 props
// ════════════════════════════════════════════════════════════════

test('deriveProps: type 末尾带 ? ⇒ 写成 name?: type', () => {
  const r = deriveProps({ props: { panelClassName: { type: 'string?' } } });
  assert.equal(r.text, '{ panelClassName?: string }');
  assert.equal(r.present, true);
});

test('deriveProps: 普通 type ⇒ name: type', () => {
  const r = deriveProps({
    props: { onClose: { type: 'function' }, children: { type: 'ReactNode' } },
  });
  assert.equal(r.text, '{ onClose: function, children: ReactNode }');
});

test('deriveProps: 没有 type 的项跳过（不编类型）', () => {
  const r = deriveProps({ props: { a: { figmaProp: '（回调）' }, b: { type: 'string' } } });
  assert.equal(r.text, '{ b: string }');
});

test('deriveProps: 没有 props / props 不是对象 ⇒ 空对象且 present=false', () => {
  assert.deepEqual(deriveProps(undefined), { text: '{}', present: false });
  assert.deepEqual(deriveProps({ props: null }), { text: '{}', present: false });
  assert.deepEqual(deriveProps({ props: {} }), { text: '{}', present: false });
});

// ════════════════════════════════════════════════════════════════
// 3. deriveA11y — 族惯例
// ════════════════════════════════════════════════════════════════

test('deriveA11y: 按组件名前缀给最小角色', () => {
  assert.equal(deriveA11y('Icon/Prev').role, 'img');
  assert.equal(deriveA11y('Button/Text').role, 'button');
  assert.equal(deriveA11y('Input/Text').role, 'textbox');
});

test('deriveA11y: 未知族 ⇒ 空对象（不编造角色）', () => {
  const r = deriveA11y('Zzz/Unknown');
  assert.equal(r.role, null);
  assert.equal(r.text, '{}');
});

test('deriveA11y: keyboard 一律留空（键位是设计决定，猜错代价大）', () => {
  assert.match(deriveA11y('Button/Text').text, /keyboard: \[\]/);
});

// ════════════════════════════════════════════════════════════════
// 4. 载体文本 — 必须用 --- 裹（最容易踩的格式坑）
// ════════════════════════════════════════════════════════════════

test('buildCarrierText: 必须用 --- 裹住', () => {
  const text = buildCarrierText('AI_CONTRACT:\n  react: x.tsx');
  assert.ok(text.startsWith(SECTION_FENCE), '开头必须有 ---');
  assert.ok(text.endsWith(SECTION_FENCE), '结尾必须有 ---');
  // 采集段用 /---([\s\S]*?)---/ 提取 ⇒ 必须能原样提回来
  const m = text.match(/---([\s\S]*?)---/);
  assert.ok(m, '必须能被采集段的正则提取到');
  assert.equal(m[1].trim(), 'AI_CONTRACT:\n  react: x.tsx');
});

test('buildCarrierText: 段里含 --- 时也不能截断（不多包一层）', () => {
  const text = buildCarrierText('AI_CONTRACT:\n  react: x.tsx');
  assert.equal(text.split(SECTION_FENCE).length - 1, 2, '只应有一对 ---');
});

// ════════════════════════════════════════════════════════════════
// 5. 契约正文 — 字段顺序与 draft 标记
// ════════════════════════════════════════════════════════════════

test('buildContractBody: 字段顺序固定，react 在 props 前', () => {
  const body = buildContractBody({ react: 'a.tsx', props: '{}', a11y: '{}', states: ['x'] });
  const lines = body.split('\n');
  assert.equal(lines[0], 'AI_CONTRACT:');
  assert.match(lines[1], /^ {2}react: /);
  assert.match(lines[2], /^ {2}props: /);
  assert.match(lines[3], /^ {2}a11y: /);
  assert.match(lines[4], /^ {2}states: \[/);
});

test('buildContractBody: draft 标记可关（权威契约不带）', () => {
  const withDraft = buildContractBody({
    react: 'a',
    props: '{}',
    a11y: '{}',
    states: [],
    draft: true,
  });
  const without = buildContractBody({
    react: 'a',
    props: '{}',
    a11y: '{}',
    states: [],
    draft: false,
  });
  assert.match(withDraft, /draft: true/);
  assert.doesNotMatch(without, /draft:/);
});

test('buildContractBody: 必填字段一个都不能少', () => {
  const body = buildContractBody({ react: 'a', props: '{}', a11y: '{}', states: [] });
  for (const f of ['react', 'props', 'a11y', 'states']) {
    assert.ok(new RegExp(`^ {2}${f}: `, 'm').test(body), `缺必填字段 ${f}`);
  }
});

// ════════════════════════════════════════════════════════════════
// 6. carrierOf — 载体类型
// ════════════════════════════════════════════════════════════════

test('carrierOf: COMPONENT / COMPONENT_SET ⇒ description', () => {
  assert.equal(carrierOf('COMPONENT'), 'description');
  assert.equal(carrierOf('COMPONENT_SET'), 'description');
});

test('carrierOf: FRAME ⇒ text-child（FRAME 没有 .description）', () => {
  assert.equal(carrierOf('FRAME'), 'text-child');
});

test('carrierOf: 其它类型 ⇒ null（跳过，不硬塞）', () => {
  assert.equal(carrierOf('GROUP'), null);
  assert.equal(carrierOf('INSTANCE'), null);
  assert.equal(carrierOf(undefined), null);
});

// ════════════════════════════════════════════════════════════════
// 7. buildContractPayload — 整体行为
// ════════════════════════════════════════════════════════════════

const NODE = (over = {}) => ({
  name: 'Modal/Shell',
  nodeId: '514:72',
  type: 'COMPONENT_SET',
  variants: ['state=default'],
  contract: '',
  ...over,
});

const MAPPING = (over = {}) => ({
  figmaComponent: 'Modal/Shell',
  figmaNodeId: '514:72',
  reactPath: 'packages/renderer/src/components/common/Modal.tsx',
  props: { onClose: { type: 'function' } },
  ...over,
});

test('buildContractPayload: 契约里的 states 内容必须与 variants 推导一致', () => {
  // ⚠️ 这条是被**变异验证**逼出来的：原来只断言"必填字段在不在"，
  //    于是「把 states 清空」这条变异**逃逸了**（M7）。
  //    ⇒ 断言必须查**内容**，不能只查字段在不在。
  const p = buildContractPayload({
    snapshot: { components: [NODE({ variants: ['state=idle', 'state=hover'] })], screens: [] },
    mappings: [MAPPING()],
  });
  assert.match(p.writes[0].contractBody, /states: \[idle, hover\]/);
});

test('buildContractPayload: 契约里的 props / a11y / react 内容必须与推导一致', () => {
  const p = buildContractPayload({
    snapshot: { components: [NODE({ name: 'Button/Text' })], screens: [] },
    mappings: [
      MAPPING({
        figmaComponent: 'Button/Text',
        props: { onClick: { type: 'function' }, label: { type: 'string?' } },
      }),
    ],
  });
  const body = p.writes[0].contractBody;
  assert.match(body, /react: packages\/renderer\/src\/components\/common\/Modal\.tsx/);
  assert.match(body, /props: \{ onClick: function, label\?: string \}/);
  assert.match(body, /a11y: \{ role: button, keyboard: \[\] \}/);
});

test('buildContractPayload: 契约里的 states 内容必须与 variants 推导一致（屏）', () => {
  const p = buildContractPayload({
    snapshot: {
      components: [],
      screens: [
        NODE({
          name: 'Screen/Search',
          nodeId: '1:1',
          type: 'FRAME',
          variants: ['state=empty', 'state=ready'],
        }),
      ],
    },
    mappings: [MAPPING({ figmaComponent: 'Screen/Search', figmaNodeId: '1:1' })],
  });
  assert.match(p.writes[0].contractBody, /states: \[empty, ready\]/);
});

test('buildContractPayload: 已有契约 ⇒ 跳过（幂等第一道闸）', () => {
  const p = buildContractPayload({
    snapshot: { components: [NODE({ contract: 'AI_CONTRACT:\n  react: x' })], screens: [] },
    mappings: [MAPPING()],
  });
  assert.equal(p.writes.length, 0);
  assert.equal(p.skipped[0].reason, 'already-has-contract');
});

test('buildContractPayload: 无映射 ⇒ 跳过，且**不得编 react 路径**', () => {
  // 关键防线：编一个路径 = 给前端发一条它永远不会兑现的 must
  const p = buildContractPayload({
    snapshot: { components: [NODE({ name: 'Icon/Prev', nodeId: '9:9' })], screens: [] },
    mappings: [],
  });
  assert.equal(p.writes.length, 0);
  assert.equal(p.skipped[0].reason, 'no-react-mapping');
  const dump = JSON.stringify(p);
  assert.doesNotMatch(dump, /\.tsx/, 'skipped 的节点不得出现任何 tsx 路径');
});

test('buildContractPayload: 映射的 nodeId 指向别的节点 ⇒ 不采用该映射', () => {
  // 同名不同类：Screen/SourceSelect 既是 COMPONENT_SET 又是同名 FRAME。
  // 映射指 515:133，而当前节点是 314:1432 ⇒ 不能拿它的 reactPath。
  const p = buildContractPayload({
    snapshot: {
      components: [],
      screens: [NODE({ name: 'Screen/SourceSelect', nodeId: '314:1432', type: 'FRAME' })],
    },
    mappings: [MAPPING({ figmaComponent: 'Screen/SourceSelect', figmaNodeId: '515:133' })],
  });
  assert.equal(p.writes.length, 0, 'nodeId 不匹配的映射不得被采用');
  assert.equal(p.skipped[0].reason, 'no-react-mapping');
});

test('buildContractPayload: 产出里每个字段都有 provenance', () => {
  const p = buildContractPayload({
    snapshot: { components: [NODE()], screens: [] },
    mappings: [MAPPING()],
  });
  assert.equal(p.writes.length, 1);
  const prov = p.writes[0].provenance;
  for (const f of ['react', 'props', 'a11y', 'states', 'tokens', 'bindings']) {
    assert.ok(prov[f], `provenance 缺 ${f}`);
  }
  assert.equal(prov.react, 'mapping');
});

test('buildContractPayload: 契约段必带 draft 标记（机器起草的必须说清楚）', () => {
  const p = buildContractPayload({
    snapshot: { components: [NODE()], screens: [] },
    mappings: [MAPPING()],
  });
  assert.match(p.writes[0].contractBody, /draft: true/);
});

test('buildContractPayload: 载体文本能被采集段的正则提取回来（写→读闭环）', () => {
  const p = buildContractPayload({
    snapshot: { components: [NODE()], screens: [] },
    mappings: [MAPPING()],
  });
  const w = p.writes[0];
  const m = w.carrierText.match(/---([\s\S]*?)---/);
  assert.ok(m, '载体文本必须能被 /---([\\s\\S]*?)---/ 提取');
  assert.equal(m[1].trim(), w.contractBody, '提取出来的段必须与契约正文一致');
});

test('buildContractPayload: FRAME ⇒ text-child 载体', () => {
  const p = buildContractPayload({
    snapshot: {
      components: [],
      screens: [NODE({ name: 'Screen/Search', nodeId: '1:1', type: 'FRAME' })],
    },
    mappings: [MAPPING({ figmaComponent: 'Screen/Search', figmaNodeId: '1:1' })],
  });
  assert.equal(p.writes[0].carrier, 'text-child');
});

test('buildContractPayload: react 文件不存在 ⇒ reactExists=false（前端该补）', () => {
  const p = buildContractPayload({
    snapshot: { components: [NODE()], screens: [] },
    mappings: [MAPPING()],
    repoFileExists: () => false,
  });
  assert.equal(p.writes[0].reactExists, false);
});

test('buildContractPayload: 快照缺 components/screens ⇒ 不得抛异常', () => {
  const p = buildContractPayload({ snapshot: {}, mappings: [] });
  assert.equal(p.writes.length, 0);
  assert.equal(p.skipped.length, 0);
});

// ════════════════════════════════════════════════════════════════
// 8. 端到端：真实快照跑一遍，产物必须自洽
// ════════════════════════════════════════════════════════════════

test('端到端: 真实快照 → payload 自洽（必填字段齐 / 不编路径 / 载体可提取）', () => {
  const snapshot = JSON.parse(readFileSync(resolve(__dirname, 'figma-snapshot.json'), 'utf8'));
  const cc = JSON.parse(readFileSync(resolve(ROOT, 'figma-code-connect.json'), 'utf8'));
  const p = buildContractPayload({ snapshot, mappings: cc.mappings, repoFileExists: () => true });

  assert.ok(p.writes.length > 0, '真实快照应当有可写的节点');
  for (const w of p.writes) {
    for (const f of ['react', 'props', 'a11y', 'states']) {
      assert.ok(new RegExp(`^ {2}${f}: `, 'm').test(w.contractBody), `${w.name} 缺必填字段 ${f}`);
    }
    assert.ok(w.carrierText.includes('AI_CONTRACT:'));
    assert.ok(w.carrierText.includes(SECTION_FENCE));
    assert.match(w.carrierText.match(/---([\s\S]*?)---/)[1], /react: \S+/);
  }
  // 跳过的节点一个都不许带路径
  for (const s of p.skipped) {
    if (s.reason === 'no-react-mapping') {
      assert.ok(!s.path, 'skipped 项不得携带路径');
    }
  }
});
