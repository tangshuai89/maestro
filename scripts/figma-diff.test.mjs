#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// figma:diff 自检 — 判据能不能主动抓出坏改动
//
// 为什么有这个文件：D 系列反复吃过同一个亏 —— "测试全绿"不等于"判据对"。
// uLight eval 的教训：真模型校准只暴露假红（吵闹、会被发现），
// **暴露不了假绿**（安静、会被当成通过）——那才是危险的那种。
//
// 所以这里的测试全是**反向验证**：喂构造的坏数据，断言判据报出来。
// 一个永远绿的判据等于没有判据。
//
// 用法：node scripts/figma-diff.test.mjs
// ─────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diffTokens,
  diffComponents,
  diffDescriptions,
  diffMotion,
  summarize,
  renderMarkdown,
  parseContract,
  reactPathOf,
} from './lib/figma-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIFF = resolve(__dirname, 'figma-diff.mjs');

// ════════════════════════════════════════════════════════════════
// 1. parseContract — AI_CONTRACT 浅解析
// ════════════════════════════════════════════════════════════════

test('parseContract: 解析标准契约', () => {
  const text = [
    'AI_CONTRACT:',
    '  react: packages/renderer/src/components/common/Modal.tsx',
    '  props: { onClose: function, panelClassName?: string }',
    '  a11y: { role: dialog, keyboard: [Escape] }',
    '  states: [default, open]',
    '  tokens: [Color/semantic/accent]',
  ].join('\n');
  const c = parseContract(text);
  assert.equal(c.react, 'packages/renderer/src/components/common/Modal.tsx');
  assert.equal(c.states, '[default, open]');
  assert.ok('a11y' in c);
});

test('parseContract: 空输入 / 无 AI_CONTRACT 段 → null', () => {
  assert.equal(parseContract(''), null);
  assert.equal(parseContract(null), null);
  assert.equal(parseContract('随便一段散文，没有契约'), null);
});

test('parseContract: 只有 AI_CONTRACT: 后面没内容 → null（不是空对象）', () => {
  assert.equal(parseContract('AI_CONTRACT:'), null);
});

test('parseContract: 嵌套内容归属父 key（不被拍平成同级 key）', () => {
  // D1 的真实格式：props / a11y 下面是缩进更深的子项。
  // 若不区分缩进，`onPlay:` 会被当成与 props 平级的顶层 key →
  // `props` 的值变空、契约语义丢失。
  const text = [
    'AI_CONTRACT:',
    '  react: packages/renderer/src/components/search/SearchPanel.tsx',
    '  props:',
    '    onPlay: (items, index) => void',
    '    onClose: () => void',
    '  a11y:',
    '    role: dialog',
    '    keyboard: [Escape]',
    '  states: [empty, loading]',
  ].join('\n');
  const c = parseContract(text);
  assert.equal(c.react, 'packages/renderer/src/components/search/SearchPanel.tsx');
  assert.equal(c.states, '[empty, loading]');
  assert.ok(c.props.includes('onPlay'), `props 应包含嵌套内容，实际: ${c.props}`);
  assert.ok(c.props.includes('onClose'), `props 应包含嵌套内容，实际: ${c.props}`);
  assert.ok(c.a11y.includes('role'), `a11y 应包含嵌套内容，实际: ${c.a11y}`);
  // 嵌套 key 不能泄漏成顶层 key
  assert.equal(c.onPlay, undefined, '嵌套 key 不应成为顶层 key');
  assert.equal(c.role, undefined, '嵌套 key 不应成为顶层 key');
  // 顶层 key 集合只应是契约声明的那些
  assert.deepEqual(Object.keys(c).sort(), ['a11y', 'props', 'react', 'states']);
});

test('reactPathOf: 去引号 / 去尾逗号', () => {
  assert.equal(reactPathOf({ react: '"a/b.tsx"' }), 'a/b.tsx');
  assert.equal(reactPathOf({ react: 'a/b.tsx,' }), 'a/b.tsx');
  assert.equal(reactPathOf({}), null);
  assert.equal(reactPathOf(null), null);
});

// ════════════════════════════════════════════════════════════════
// 2. tokens 腿
// ════════════════════════════════════════════════════════════════

test('diffTokens: Figma 有、仓库没有 → must（设计稿新增令牌）', () => {
  const d = diffTokens(
    new Map([['--accent', '#00e5ff']]),
    new Map([
      ['--accent', '#00e5ff'],
      ['--new-one', '#fff'],
    ]),
  );
  const hit = d.find((x) => x.kind === 'figmaOnly');
  assert.ok(hit, '必须报出 figmaOnly');
  assert.equal(hit.severity, 'must');
  assert.equal(hit.target, 'packages/renderer/src/styles/base/_tokens.generated.scss');
});

test('diffTokens: 值不一致 → must，且 detail 里两个值都在', () => {
  const d = diffTokens(new Map([['--accent', '#00f0ff']]), new Map([['--accent', '#00e5ff']]));
  const hit = d.find((x) => x.kind === 'valueMismatch');
  assert.ok(hit, '必须报出 valueMismatch');
  assert.equal(hit.detail.repo, '#00f0ff');
  assert.equal(hit.detail.figma, '#00e5ff');
});

test('diffTokens: 仓库有、Figma 没有 → note（不占主线）', () => {
  const d = diffTokens(new Map([['--legacy', '#111']]), new Map());
  const hit = d.find((x) => x.kind === 'repoOnly');
  assert.ok(hit);
  assert.equal(hit.severity, 'note', '反向差异必须是 note，不能进主线');
});

test('diffTokens: 完全一致 → 零差异', () => {
  const m = new Map([
    ['--accent', '#00e5ff'],
    ['--ai', '#b57bff'],
  ]);
  assert.equal(diffTokens(m, m).length, 0);
});

test('diffTokens: 令牌名不重复 `--` 前缀（map key 已含 `--`）', () => {
  // parseGeneratedTokens 返回的 key 已带 `--`（`--accent`）。
  // 若渲染时再拼一次 `--`，标题会变成 `----accent` —— 这条锁死它。
  const d = diffTokens(
    new Map([['--accent', '#00e5ff']]),
    new Map([
      ['--accent', '#ff0000'],
      ['--brand-new', '#123456'],
    ]),
  );
  const mismatch = d.find((x) => x.kind === 'valueMismatch');
  const only = d.find((x) => x.kind === 'figmaOnly');
  assert.ok(mismatch.title.includes('--accent'), '标题应含 --accent');
  assert.ok(!mismatch.title.includes('----'), `标题出现重复前缀: ${mismatch.title}`);
  assert.ok(!mismatch.action.includes('----'), `动作出现重复前缀: ${mismatch.action}`);
  assert.ok(!only.title.includes('----'), `标题出现重复前缀: ${only.title}`);
  assert.ok(!only.action.includes('----'), `动作出现重复前缀: ${only.action}`);
});

// ════════════════════════════════════════════════════════════════
// 3. components 腿
// ════════════════════════════════════════════════════════════════

const COMP_EXISTS = (p) => p === 'packages/renderer/src/components/common/Modal.tsx';

test('diffComponents: 契约声明的 react 路径在仓库不存在 → must', () => {
  const comps = [
    {
      name: 'Screen/QueuePanel',
      nodeId: '520:14',
      variants: ['state=default'],
      aiContract: { react: 'packages/renderer/src/components/queue/QueuePanel.tsx' },
    },
  ];
  const d = diffComponents(comps, [], COMP_EXISTS);
  const hit = d.find((x) => x.kind === 'reactPathMissing');
  assert.ok(hit, '必须报出 reactPathMissing —— 这是「设计稿要求的组件代码里没有」');
  assert.equal(hit.severity, 'must');
  assert.equal(hit.target, 'packages/renderer/src/components/queue/QueuePanel.tsx');
});

test('diffComponents: react 路径存在 → 不报 reactPathMissing', () => {
  const comps = [
    {
      name: 'Modal/Shell',
      nodeId: '514:72',
      variants: ['state=default'],
      aiContract: { react: 'packages/renderer/src/components/common/Modal.tsx' },
    },
  ];
  const d = diffComponents(comps, [], COMP_EXISTS);
  assert.equal(d.filter((x) => x.kind === 'reactPathMissing').length, 0);
});

test('diffComponents: Figma 组件集没映射 → should', () => {
  const comps = [{ name: 'Modal/Shell', nodeId: '514:72', variants: [], aiContract: null }];
  const d = diffComponents(comps, [], COMP_EXISTS);
  const hit = d.find((x) => x.kind === 'unmapped');
  assert.ok(hit);
  assert.equal(hit.severity, 'should');
  assert.equal(hit.target, 'figma-code-connect.json');
});

test('diffComponents: nodeId 对不上 → should（组件被重建过）', () => {
  const comps = [{ name: 'Modal/Shell', nodeId: '999:1', variants: [], aiContract: null }];
  const mappings = [{ figmaComponent: 'Modal/Shell', figmaNodeId: '514:72', reactPath: 'x.tsx' }];
  const d = diffComponents(comps, mappings, COMP_EXISTS);
  const hit = d.find((x) => x.kind === 'nodeIdChanged');
  assert.ok(hit);
  assert.equal(hit.detail.mapping, '514:72');
  assert.equal(hit.detail.figma, '999:1');
});

test('diffComponents: 映射指向设计稿里不存在的组件 → note', () => {
  const mappings = [{ figmaComponent: 'Gone/Component', figmaNodeId: '1:1', reactPath: 'x.tsx' }];
  const d = diffComponents([], mappings, COMP_EXISTS);
  const hit = d.find((x) => x.kind === 'orphaned');
  assert.ok(hit);
  assert.equal(hit.severity, 'note');
});

// 2026-10-29 实测误报：Screen/*/Modal 在 Figma 里是 FRAME（快照 screens[]），
// 不是组件集 —— 映射指向它们是合法的，不能判成"设计稿里不存在"。
test('diffComponents: 映射指向 FRAME 屏幕（在 screens 里）→ 不报 orphaned', () => {
  const mappings = [
    { figmaComponent: 'Screen/Search/Modal', figmaNodeId: '466:2', reactPath: 'x.tsx' },
  ];
  const screens = [{ name: 'Screen/Search/Modal', nodeId: '466:2' }];
  const d = diffComponents([], mappings, COMP_EXISTS, screens);
  assert.equal(d.filter((x) => x.kind === 'orphaned').length, 0, '屏幕帧存在，不该报 orphaned');
});

test('diffComponents: 屏幕只参与反向查找，不会被当成组件集报 unmapped', () => {
  const screens = [{ name: 'Screen/Library', nodeId: '390:1081' }];
  const d = diffComponents([], [], COMP_EXISTS, screens);
  assert.equal(d.length, 0, '没映射的屏幕帧不该进 components 腿');
});

// ════════════════════════════════════════════════════════════════
// 4. descriptions 腿
// ════════════════════════════════════════════════════════════════

test('diffDescriptions: 缺 description → note', () => {
  const d = diffDescriptions([{ name: 'X', nodeId: '1:1', description: '' }]);
  assert.equal(d[0].kind, 'missingDescription');
  assert.equal(d[0].severity, 'note');
});

test('diffDescriptions: 有契约但没有 description 字段 → 不许误报 missingDescription', () => {
  // 采集段只回传 contract（契约段内容）+ hasDescription，
  // **不回传 description 全文**。若比对层只认 `description` 字段，
  // 每个组件都会被误报成"没有 description"（40+ 条假附注）。
  const comps = [
    {
      name: 'Modal/Shell',
      nodeId: '514:72',
      contract: 'AI_CONTRACT:\n  react: a/b.tsx',
      hasDescription: true,
      aiContract: { react: 'a/b.tsx' },
    },
  ];
  const d = diffDescriptions(comps);
  assert.equal(
    d.filter((x) => x.kind === 'missingDescription').length,
    0,
    `不该报 missingDescription，实际: ${JSON.stringify(d)}`,
  );
});

test('diffDescriptions: hasDescription=false → missingDescription', () => {
  const d = diffDescriptions([
    { name: 'X', nodeId: '1:1', contract: '', hasDescription: false, aiContract: null },
  ]);
  assert.equal(d[0].kind, 'missingDescription');
  assert.equal(d[0].severity, 'note');
});

test('diffDescriptions: 有描述但没契约段 → noAiContract，且带预览', () => {
  const d = diffDescriptions([
    {
      name: 'X',
      nodeId: '1:1',
      contract: '',
      hasDescription: true,
      descriptionPreview: '这是一个按钮，紫色，点击有涟漪',
      aiContract: null,
    },
  ]);
  assert.equal(d[0].kind, 'noAiContract');
  assert.ok(
    String(d[0].detail.descriptionPreview).includes('紫色'),
    `预览应带上描述内容，实际: ${JSON.stringify(d[0].detail)}`,
  );
});

test('diffDescriptions: 有 description 但缺 AI_CONTRACT → note', () => {
  const d = diffDescriptions([{ name: 'X', nodeId: '1:1', description: '一段散文' }]);
  assert.equal(d[0].kind, 'noAiContract');
});

test('diffDescriptions: AI_CONTRACT 缺必填字段 → note 且点名缺哪个', () => {
  const d = diffDescriptions([
    { name: 'X', nodeId: '1:1', description: 'x', aiContract: { react: 'a.tsx' } },
  ]);
  const hit = d.find((x) => x.kind === 'missingFields');
  assert.ok(hit);
  assert.deepEqual(hit.detail.missing.sort(), ['a11y', 'props', 'states']);
});

test('diffDescriptions: 四字段齐全 → 零差异', () => {
  const d = diffDescriptions([
    {
      name: 'X',
      nodeId: '1:1',
      description: 'x',
      aiContract: { react: 'a.tsx', props: '{}', a11y: '{}', states: '[]' },
    },
  ]);
  assert.equal(d.length, 0);
});

// ════════════════════════════════════════════════════════════════
// 5. motion 腿
// ════════════════════════════════════════════════════════════════

test('diffMotion: 设计稿有、仓库没有 → must', () => {
  const d = diffMotion([{ id: 'anim-1', component: 'X' }], [], new Set());
  const hit = d.find((x) => x.kind === 'figmaOnly');
  assert.ok(hit);
  assert.equal(hit.severity, 'must');
  assert.equal(hit.target, 'specs/motion-spec.json');
});

test('diffMotion: 仓库有、设计稿没有 → note', () => {
  const d = diffMotion([], [{ id: 'anim-1' }], new Set());
  const hit = d.find((x) => x.kind === 'repoOnly');
  assert.ok(hit);
  assert.equal(hit.severity, 'note');
});

test('diffMotion: 代码里没登记的 @keyframes → should（列出全部名字）', () => {
  const d = diffMotion([], [{ id: 'known' }], new Set(['known', 'ghost-a', 'ghost-b']));
  const hit = d.find((x) => x.kind === 'unregisteredKeyframes');
  assert.ok(hit);
  assert.equal(hit.severity, 'should');
  assert.deepEqual(hit.detail.unregistered.sort(), ['ghost-a', 'ghost-b']);
});

// ════════════════════════════════════════════════════════════════
// 6. 汇总与渲染
// ════════════════════════════════════════════════════════════════

test('diffMotion: @keyframes 登记判定按 token 精确比对，不是子串匹配', () => {
  // 子串匹配（JSON.stringify(spec).includes(k)）会把散文里的 "faded-out"
  // 当成名为 "fade" 的 keyframe 已登记 → 漏报（2026-10-29 独立评审实测）。
  const d = diffMotion(
    [],
    [{ id: 'a', description: 'the faded-out transition' }],
    new Set(['fade']),
  );
  const hit = d.find((x) => x.kind === 'unregisteredKeyframes');
  assert.ok(hit, '"fade" 必须被报成未登记（子串匹配会漏报）');
  assert.deepEqual(hit.detail.unregistered, ['fade']);
});

test('diffMotion: spec 里以整词出现的 keyframe 名算已登记', () => {
  const d = diffMotion([], [{ id: 'a', keyframes: ['th-spin'] }], new Set(['th-spin', 'other']));
  const hit = d.find((x) => x.kind === 'unregisteredKeyframes');
  assert.ok(hit);
  assert.deepEqual(hit.detail.unregistered, ['other']);
});

test('summarize: 按腿与按严重度计数', () => {
  const s = summarize([
    { lane: 'tokens', severity: 'must' },
    { lane: 'tokens', severity: 'note' },
    { lane: 'motion', severity: 'should' },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.byLane.tokens, 2);
  assert.equal(s.bySeverity.must, 1);
});

test('renderMarkdown: note 不进「需要改前端代码」段（对应 10-24 归档决策）', () => {
  const md = renderMarkdown(
    [
      {
        lane: 'components',
        kind: 'k',
        severity: 'must',
        title: 'A',
        detail: {},
        action: 'do A',
        target: 'a.tsx',
      },
      {
        lane: 'descriptions',
        kind: 'k',
        severity: 'note',
        title: 'B',
        detail: {},
        action: 'do B',
        target: null,
      },
    ],
    { capturedAt: 'x', fileKey: 'y' },
  );
  const mainSection = md.split('## 附注')[0];
  assert.ok(mainSection.includes('A'), 'must 项必须在主线段');
  assert.ok(!mainSection.includes('B'), 'note 项不得进主线段');
  assert.ok(md.includes('不占待办清单位置'), '附注段要说明为什么不占待办位置');
});

// ════════════════════════════════════════════════════════════════
// 7-8. 端到端：构造坏快照 → 跑真脚本 → 必须报出来
//
// ⚠️ 这一段的每一条都是**绕过路径的封堵**：2026-10-29 独立评审实测出 6 条
//    "改坏了判据但测试仍然全绿"的变异（删快照 / 退化快照 / motion 采集失败 /
//    屏幕不走正向检查 / 调用点不传 screens / 豁免不按 kind 过滤）——
//    这里每一条都要有对应的封堵用例。
// ════════════════════════════════════════════════════════════════

/** 跑真脚本。stdout / stderr 分开 —— --json 的输出只能从 stdout 取。 */
function runDiff(args) {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execFileSync('node', [DIFF, ...args], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
    code = e.status ?? 1;
  }
  return { code, stdout, stderr, out: stdout + stderr };
}

/** 合法快照夹具：counts 必须与数组长度一致（脚本会交叉校验） */
function buildSnapshot({ components = [], screens = [], motion = { spec: [] }, ...rest } = {}) {
  return {
    capturedAt: '2026-10-29T10:00:00+08:00',
    fileKey: 'FtbRZXvzlCp4Sq9e322cQQ',
    components,
    screens,
    motion,
    counts: {
      components: components.length,
      screens: screens.length,
      motionEntries: Array.isArray(motion?.spec) ? motion.spec.length : 0,
    },
    ...rest,
  };
}

function writeSnapshot(dir, snapshot) {
  const p = join(dir, 'snap.json');
  writeFileSync(p, JSON.stringify(snapshot));
  return p;
}

/** 断言脚本是**干净地跑完**的（不是崩了）—— 崩溃时 stdout 为空、退出码恰好也是 1，
 *  只看退出码区分不出"正确地不豁免"和"脚本崩了"（2026-10-29 变异 M11/M22 就是这么漏网的）。 */
function assertCleanJson(stdout, label) {
  assert.ok(stdout.trim().length > 0, `${label}：脚本应当有 JSON 输出（崩溃时 stdout 为空）`);
  return JSON.parse(stdout);
}

const MODAL_COMPONENT = {
  name: 'Modal/Shell',
  nodeId: '514:72',
  type: 'COMPONENT_SET',
  variants: ['Default'],
  contract:
    'AI_CONTRACT:\n  react: packages/renderer/src/components/common/Modal.tsx\n  props: {}\n  a11y: { role: dialog }\n  states: [default]',
};

const MIN_SNAPSHOT = buildSnapshot({ components: [MODAL_COMPONENT] });

/** 造一个"未映射"的组件（should 级） */
const unmappedComponent = (name = 'Brand/New', nodeId = '9:9') => ({
  ...MODAL_COMPONENT,
  name,
  nodeId,
});

test('端到端: 坏快照必须让 figma-diff 报出差异且退出码非 0', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-'));
  try {
    const snapPath = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          {
            name: 'Screen/QueuePanel',
            nodeId: '520:14',
            type: 'COMPONENT_SET',
            variants: ['state=default', 'state=empty'],
            contract:
              'AI_CONTRACT:\n  react: packages/renderer/src/components/queue/QueuePanel.tsx\n  props: {}\n  a11y: { role: region }\n  states: [default, empty]',
          },
          {
            name: 'Modal/Shell',
            nodeId: '999:1',
            type: 'COMPONENT_SET',
            variants: [],
            contract: '',
          },
        ],
        motion: {
          spec: [
            {
              id: 'figma-only-anim',
              category: 'ambient',
              component: 'X',
              trigger: 'ON_LOAD',
              duration_ms: 100,
            },
          ],
        },
      }),
    );
    const { code, stdout } = runDiff(['--json', '--snapshot', snapPath]);
    assert.notEqual(code, 0, '有 must 级差异时退出码必须非 0');

    const res = JSON.parse(stdout);
    // 生效差异 + 已豁免差异都要看（豁免表见 scripts/figma-diff-allowlist.json）
    const kinds = [...res.diffs, ...(res.waived ?? [])].map((d) => d.kind);
    assert.ok(kinds.includes('reactPathMissing'), '必须抓到「设计稿要求的组件代码里没有」');
    assert.ok(kinds.includes('unmapped'), '必须抓到没映射的组件集');
    assert.ok(kinds.includes('nodeIdChanged'), '必须抓到 nodeId 对不上');
    assert.ok(kinds.includes('figmaOnly'), '必须抓到设计稿有、仓库没有的动效');
    assert.ok(kinds.includes('unregisteredKeyframes'), '必须抓到没登记的 @keyframes');

    const missing = res.diffs.find((d) => d.kind === 'reactPathMissing');
    assert.equal(missing.target, 'packages/renderer/src/components/queue/QueuePanel.tsx');
    assert.ok(
      res.diffs.some((d) => d.kind === 'reactPathMissing' && d.severity === 'must'),
      '「设计稿要求但代码没有」必须是 must 级',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 守卫类：绕过路径的封堵 ───────────────────────────────────────

test('端到端: 空快照（components/screens 都空）→ 退出码 2，不得当成"无差异"', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-empty-'));
  try {
    const p = writeSnapshot(dir, buildSnapshot({ components: [], screens: [] }));
    const { code, out } = runDiff(['--json', '--snapshot', p]);
    assert.equal(code, 2, `空快照必须是 exit 2，实际 ${code}；输出：${out.slice(0, 200)}`);
    assert.ok(out.includes('空'), `错误信息应说明是空快照，实际：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: components/screens 不是数组 → 退出码 2', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-badshape-'));
  try {
    const p = writeSnapshot(dir, { capturedAt: 'x', components: 'oops', screens: [] });
    const { code } = runDiff(['--json', '--snapshot', p]);
    assert.equal(code, 2, `结构不对必须是 exit 2，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 快照缺 counts → 退出码 2（不是采集段的产物形状）', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-nocounts-'));
  try {
    const p = writeSnapshot(dir, {
      capturedAt: 'x',
      components: [MODAL_COMPONENT],
      screens: [],
      motion: { spec: [] },
    });
    const { code, out } = runDiff(['--json', '--snapshot', p]);
    assert.equal(code, 2, `缺 counts 必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
    assert.ok(out.includes('counts'), `错误信息应点名 counts，实际：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: counts 与数组长度对不上 → 退出码 2（抄断被截断）', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-countmismatch-'));
  try {
    // 只抄了 1 个组件，但 counts 还写着 35 —— 截断的信号
    const p = writeSnapshot(dir, {
      ...buildSnapshot({ components: [MODAL_COMPONENT] }),
      counts: { components: 35, screens: 15, motionEntries: 20 },
    });
    const { code, out } = runDiff(['--json', '--snapshot', p]);
    assert.equal(code, 2, `counts 对不上必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
    assert.ok(out.includes('counts'), `错误信息应点名 counts，实际：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: motion 采集失败（parseError）→ 退出码 2，不得当成"没有动效"', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-moterr-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [MODAL_COMPONENT],
        motion: { spec: [], parseError: 'Unexpected token }' },
      }),
    );
    const { code, out } = runDiff(['--json', '--snapshot', p]);
    assert.equal(code, 2, `motion 解析失败必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
    assert.ok(out.includes('MOTION'), `错误信息应点名 MOTION SPEC，实际：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: motion missing:true（没找到 MOTION SPEC frame）→ 退出码 2', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-motmiss-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [MODAL_COMPONENT],
        motion: { spec: [], missing: true },
      }),
    );
    const { code } = runDiff(['--json', '--snapshot', p]);
    assert.equal(code, 2, `motion missing 必须是 exit 2，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: motion 不是对象 → 退出码 2', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-motionull-'));
  try {
    const p = writeSnapshot(dir, buildSnapshot({ components: [MODAL_COMPONENT], motion: null }));
    const { code } = runDiff(['--json', '--snapshot', p]);
    assert.equal(code, 2, `motion 非法必须是 exit 2，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 快照文件不存在 → 退出码 2（不能静默跳过当门禁绿）', () => {
  const { code, out } = runDiff(['--snapshot', '/tmp/definitely-not-here-xyz.json']);
  assert.equal(code, 2, `缺快照必须是 exit 2，实际 ${code}`);
  assert.ok(out.includes('基线'), `错误信息应说明它是门禁基线，实际：${out.slice(0, 200)}`);
});

test('端到端: --only 拼错 → 退出码 2（不能静默跑成 0 条差异）', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-badlane-'));
  try {
    const p = writeSnapshot(dir, MIN_SNAPSHOT);
    const { code, out } = runDiff(['--json', '--snapshot', p, '--only', 'component']);
    assert.equal(code, 2, `拼错的 lane 必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
    assert.ok(out.includes('--only'), `错误信息应点名 --only，实际：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 豁免机制 ─────────────────────────────────────────────────────

test('端到端: should 级差异被豁免 → --gate 退出码 0，但仍出现在清单里', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-waive-'));
  try {
    const snap = buildSnapshot({ components: [MODAL_COMPONENT, unmappedComponent()] });
    const p = writeSnapshot(dir, snap);
    const allowPath = join(dir, 'allow.json');
    writeFileSync(
      allowPath,
      JSON.stringify({ allow: [{ kind: 'unmapped', reason: '测试用豁免' }] }),
    );

    const res = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(res.code, 0, `豁免后不该红，实际 ${res.code}：${res.out.slice(0, 300)}`);
    const j = JSON.parse(res.stdout);
    assert.ok(
      (j.waived ?? []).some((d) => d.kind === 'unmapped'),
      '豁免项必须出现在 waived 里（不能悄悄消失）',
    );
    assert.ok(
      (j.waived ?? []).every((d) => d.waivedReason && d.waivedReason.trim()),
      '豁免项必须带理由',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: must 级差异永远不可豁免 → --gate 仍退出码 1', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-mustw-'));
  try {
    const snap = buildSnapshot({
      components: [
        {
          name: 'Screen/QueuePanel',
          nodeId: '520:14',
          type: 'COMPONENT_SET',
          variants: [],
          contract: 'AI_CONTRACT:\n  react: packages/renderer/src/components/queue/QueuePanel.tsx',
        },
      ],
    });
    const p = writeSnapshot(dir, snap);
    const allowPath = join(dir, 'allow.json');
    // ⚠️ 必须把 unmapped 也豁免掉 —— 否则这条测试里还剩别的 should 项撑着
    //    exit 1，就算 `must` 被豁免了也看不出区别（变异验证 M9 就是这么漏网的）。
    writeFileSync(
      allowPath,
      JSON.stringify({
        allow: [
          { kind: 'unmapped', reason: '测试用豁免（让 must 成为唯一的生效差异）' },
          { kind: 'reactPathMissing', reason: '试图豁免 must' },
        ],
      }),
    );
    const { code, stdout } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(code, 1, `must 不可豁免，必须仍然红，实际 ${code}；输出：${stdout.slice(0, 300)}`);
    const j = assertCleanJson(stdout, 'must 不可豁免');
    assert.ok(
      j.diffs.some((d) => d.kind === 'reactPathMissing'),
      'must 项必须仍在生效差异里（没被豁免掉）',
    );
    assert.equal(
      (j.waived ?? []).filter((d) => d.kind === 'reactPathMissing').length,
      0,
      'must 项不得出现在 waived 里',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 豁免条目缺 reason → 视为未登记，不豁免', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-noreason-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({ components: [MODAL_COMPONENT, unmappedComponent()] }),
    );
    const allowPath = join(dir, 'allow.json');
    writeFileSync(allowPath, JSON.stringify({ allow: [{ kind: 'unmapped' }] }));
    const { code, stdout } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    // 缺 reason 不得豁免：脚本须干净跑完（不能崩），否则退出码相同分不出来
    assertCleanJson(stdout, '缺 reason 不得豁免');
    assert.equal(code, 1, `缺 reason 不得豁免，必须仍红，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 豁免条目 reason 是非字符串（true）→ 不得豁免', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-badreason-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({ components: [MODAL_COMPONENT, unmappedComponent()] }),
    );
    const allowPath = join(dir, 'allow.json');
    writeFileSync(allowPath, JSON.stringify({ allow: [{ kind: 'unmapped', reason: true }] }));
    const { code, stdout } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    // reason 非字符串不得豁免：脚本须干净跑完（不能崩），否则退出码相同分不出来
    assertCleanJson(stdout, 'reason 非字符串不得豁免');
    assert.equal(code, 1, `reason 非字符串不得豁免，必须仍红，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 豁免条目没有匹配条件（空 kind/lane/target）→ 不豁免一切', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-emptycond-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({ components: [MODAL_COMPONENT, unmappedComponent()] }),
    );
    const allowPath = join(dir, 'allow.json');
    writeFileSync(allowPath, JSON.stringify({ allow: [{ reason: '空条件' }] }));
    const { code, stdout } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    // 空条件不得豁免一切：脚本须干净跑完（不能崩），否则退出码相同分不出来
    assertCleanJson(stdout, '空条件不得豁免一切');
    assert.equal(code, 1, `空条件不得豁免一切，必须仍红，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 豁免按 kind 过滤 —— 豁免 A 不该顺带豁免 B', () => {
  // 独立评审实测：把 kind 过滤整行删掉，38 个测试仍然全绿 ⇒ 判据没被测到。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-kindfilter-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({ components: [MODAL_COMPONENT, unmappedComponent()] }),
    );
    const allowPath = join(dir, 'allow.json');
    // 只豁免 unregisteredKeyframes（另一类），不该豁免 unmapped
    writeFileSync(
      allowPath,
      JSON.stringify({ allow: [{ kind: 'unregisteredKeyframes', reason: '不该命中这条' }] }),
    );
    const { code, stdout } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(code, 1, `豁免不该跨 kind 生效，必须仍红，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 豁免按 target 过滤 —— target 不符不该豁免', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-targetfilter-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({ components: [MODAL_COMPONENT, unmappedComponent()] }),
    );
    const allowPath = join(dir, 'allow.json');
    writeFileSync(
      allowPath,
      JSON.stringify({
        allow: [{ kind: 'unmapped', target: 'some/other/file.json', reason: 'target 不符' }],
      }),
    );
    const { code, stdout } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(code, 1, `target 不符不得豁免，必须仍红，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 屏幕也必须走正向检查（独立评审实测出的盲区）────────────────────

test('端到端: 映射到 Screen/* 的屏幕不得被误报 orphaned（调用点必须传 screens）', () => {
  // 独立评审实测的变异 S1：调用点不传 screens，38 个测试仍然全绿 ⇒ 没人测这一点。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-screens-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [MODAL_COMPONENT],
        screens: [
          {
            name: 'Screen/Search/Modal',
            nodeId: '466:2',
            type: 'FRAME',
            contract: '',
          },
        ],
      }),
    );
    const { code, stdout } = runDiff([
      '--json',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      join(dir, 'none.json'),
    ]);
    // allowlist 指向不存在的文件 → 没有任何豁免
    const j = JSON.parse(stdout);
    const orphaned = (j.diffs ?? []).filter((d) => d.kind === 'orphaned');
    // 仓库真实映射里另外 29 条在这个小快照里也不存在 → 会 orphaned，
    // 所以只断言「没有一条 orphaned 指向 Screen/Search/Modal」。
    assert.equal(
      orphaned.filter((o) => String(o.title).includes('Screen/Search/Modal')).length,
      0,
      `Screen/Search/Modal 有映射就不该报 orphaned，实际：${JSON.stringify(orphaned.map((o) => o.title))}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 屏幕的 react 路径不存在 → must（屏幕也走正向检查）', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-screenreact-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [MODAL_COMPONENT],
        screens: [
          {
            name: 'Screen/Search/Modal',
            nodeId: '466:2',
            type: 'FRAME',
            contract:
              'AI_CONTRACT:\n  react: packages/renderer/src/components/search/NoSuchFile.tsx\n  props: {}\n  a11y: {}\n  states: []',
          },
        ],
      }),
    );
    const { code, stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = JSON.parse(stdout);
    const hit = (j.diffs ?? []).find((d) => d.kind === 'reactPathMissing');
    assert.ok(hit, `屏幕的 react 路径不存在必须报 must，实际：${JSON.stringify(j.diffs)}`);
    assert.equal(hit.severity, 'must');
    assert.ok(hit.title.includes('屏幕'), `标题应说明是屏幕，实际：${hit.title}`);
    assert.notEqual(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 屏幕的 react 值不是路径（复用说明）→ 不得报假的 must', () => {
  // 真实数据：Screen/EmptyState/Full 的 react 是「(复用 TheaterView 条件渲染)」
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-screenreuse-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [MODAL_COMPONENT],
        screens: [
          {
            name: 'Screen/EmptyState/Full',
            nodeId: '479:2',
            type: 'FRAME',
            contract:
              'AI_CONTRACT:\n  react: (复用 TheaterView 条件渲染)\n  props: {}\n  a11y: {}\n  states: []',
          },
        ],
      }),
    );
    const { stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = JSON.parse(stdout);
    assert.equal(
      (j.diffs ?? []).filter((d) => d.kind === 'reactPathMissing').length,
      0,
      '非路径的 react 值不得报 reactPathMissing',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 屏幕被重建过（nodeId 对不上）→ nodeIdChanged', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-screennode-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [MODAL_COMPONENT],
        screens: [
          {
            name: 'Screen/Search/Modal',
            nodeId: '999:9', // 映射里写的是 466:2 → 被重建过
            type: 'FRAME',
            contract: '',
          },
        ],
      }),
    );
    const { stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = JSON.parse(stdout);
    const hit = (j.diffs ?? []).find((d) => d.kind === 'nodeIdChanged');
    assert.ok(
      hit,
      `屏幕被重建必须报 nodeIdChanged，实际：${JSON.stringify((j.diffs ?? []).map((d) => d.kind))}`,
    );
    assert.ok(hit.title.includes('Screen/Search/Modal'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 屏幕的映射抄成另一个**存在**的节点 → 必须报 nodeIdChanged', () => {
  // 回归 C 的屏幕侧：只看"映射 id 在不在快照里"查不出"抄到了别的节点"。
  // 组件侧已有同款用例（见下），屏幕侧之前只覆盖了"id 完全不存在"。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-screenwrongnode-'));
  try {
    const cc = JSON.parse(
      execFileSync(
        'node',
        ['-e', `console.log(require('fs').readFileSync('figma-code-connect.json','utf8'))`],
        { cwd: ROOT, encoding: 'utf8' },
      ),
    );
    const searchModal = cc.mappings.find((m) => m.figmaComponent === 'Screen/Search/Modal');
    const other = cc.mappings.find(
      (m) => m.figmaComponent && m.figmaComponent !== 'Screen/Search/Modal',
    );
    const ccPath = join(dir, 'cc.json');
    writeFileSync(
      ccPath,
      JSON.stringify({
        ...cc,
        mappings: cc.mappings.map((m) =>
          m.figmaComponent === 'Screen/Search/Modal' ? { ...m, figmaNodeId: other.figmaNodeId } : m,
        ),
      }),
    );
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          MODAL_COMPONENT,
          // 「另一个节点」必须**真的在快照里**，否则命中的是"节点已消失"分支而不是"抄错节点"
          {
            ...MODAL_COMPONENT,
            name: other.figmaComponent,
            nodeId: other.figmaNodeId,
          },
        ],
        screens: [
          {
            name: 'Screen/Search/Modal',
            nodeId: searchModal.figmaNodeId,
            type: 'FRAME',
            contract: '',
          },
        ],
      }),
    );
    const { stdout } = runDiff([
      '--json',
      '--only',
      'components',
      '--snapshot',
      p,
      '--code-connect',
      ccPath,
    ]);
    const j = assertCleanJson(stdout, '屏幕映射抄错节点');
    const hit = (j.diffs ?? []).find((d) => d.kind === 'nodeIdChanged');
    assert.ok(
      hit,
      `屏幕映射抄到别的节点必须报 nodeIdChanged，实际：${JSON.stringify((j.diffs ?? []).map((d) => d.kind))}`,
    );
    assert.equal(hit.detail.mappedTo, other.figmaComponent);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 同名不同类（组件集 + 同名屏幕）→ 不得误报 nodeIdChanged', () => {
  // 真实数据：`Screen/SourceSelect` 既是 02 页的 COMPONENT_SET（515:133，
  // code-connect 映射指的就是它），又是 03 页的同名 FRAME（314:1432）。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-samename-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          {
            name: 'Screen/SourceSelect',
            nodeId: '515:133',
            type: 'COMPONENT_SET',
            variants: [],
            contract: '',
          },
        ],
        screens: [{ name: 'Screen/SourceSelect', nodeId: '314:1432', type: 'FRAME', contract: '' }],
      }),
    );
    const { stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = JSON.parse(stdout);
    assert.equal(
      (j.diffs ?? []).filter((d) => d.kind === 'nodeIdChanged').length,
      0,
      '同名不同类不该误报 nodeIdChanged',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── tokens 腿必须可测（独立评审实测：整条关掉测试仍全绿）──────────

test('端到端: tokens 腿能被真正跑到 —— 值不一致必须报 must', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-tokens-'));
  try {
    const p = writeSnapshot(dir, MIN_SNAPSHOT);
    const dumpPath = join(dir, 'dump.json');
    // 一个与仓库生成物**不同**的颜色 → valueMismatch（must）
    writeFileSync(
      dumpPath,
      JSON.stringify({
        variables: [
          {
            name: 'Color/primitive/bg-top',
            resolvedType: 'COLOR',
            value: { r: 0.9, g: 0.1, b: 0.1, a: 1 },
          },
        ],
      }),
    );
    const { code, stdout } = runDiff([
      '--json',
      '--only',
      'tokens',
      '--snapshot',
      p,
      '--token-dump',
      dumpPath,
    ]);
    const j = JSON.parse(stdout);
    const hit = (j.diffs ?? []).find((d) => d.kind === 'valueMismatch');
    assert.ok(hit, `tokens 值不一致必须报 valueMismatch，实际：${JSON.stringify(j.diffs)}`);
    assert.equal(hit.severity, 'must');
    assert.notEqual(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: token dump 退化成 {} → 退出码 2（不能静默跳过 tokens 腿）', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-baddump-'));
  try {
    const p = writeSnapshot(dir, MIN_SNAPSHOT);
    const dumpPath = join(dir, 'dump.json');
    writeFileSync(dumpPath, JSON.stringify({}));
    const { code, out } = runDiff([
      '--json',
      '--only',
      'tokens',
      '--snapshot',
      p,
      '--token-dump',
      dumpPath,
    ]);
    assert.equal(code, 2, `dump 退化必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── react 路径清洗必须端到端生效 ─────────────────────────────────

test('端到端: 契约里的 react 路径带引号/尾逗号 → 仍能正确判定存在与否', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-quoted-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          {
            ...MODAL_COMPONENT,
            contract:
              'AI_CONTRACT:\n  react: "packages/renderer/src/components/common/Modal.tsx",\n  props: {}\n  a11y: {}\n  states: []',
          },
        ],
      }),
    );
    const { stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = JSON.parse(stdout);
    assert.equal(
      (j.diffs ?? []).filter((d) => d.kind === 'reactPathMissing').length,
      0,
      '带引号的路径应被清洗后再判定（该文件确实存在）',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 第二轮独立评审（2026-10-29）新增的封堵用例 ──────────────────

test('端到端: 豁免只写 lane:motion → components 腿的差异不该被顺带豁免', () => {
  // 独立评审实测的存活变异 S4：豁免表只写 {lane:'motion', reason}，
  // 去掉 lane 过滤后，components 腿的 unmapped（should）也被豁免 ⇒ 门禁假绿。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-lane-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({ components: [MODAL_COMPONENT, unmappedComponent()] }),
    );
    const allowPath = join(dir, 'allow.json');
    writeFileSync(
      allowPath,
      JSON.stringify({ allow: [{ lane: 'motion', reason: '只该豁免 motion 腿' }] }),
    );
    const { code, stdout } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(code, 1, `lane 不符不得豁免，必须仍红，实际 ${code}`);
    assertCleanJson(stdout, 'lane 过滤');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 屏幕的 react 路径带引号 + 文件不存在 → 必须报 must', () => {
  // 独立评审实测的存活变异 S6 的**屏幕侧**表现：清洗发生在**调用点**
  // （figma-diff.mjs 里 `reactPathOf(c.aiContract)` 写回 aiContract.react）。
  // 屏幕的豁免判据是 `isScreen && !looksLikeRepoPath(reactPath)` ——
  // 带引号的值不像路径 ⇒ 会被跳过 ⇒ **调用点不清洗 ⇒ 屏幕的 must 静默消失**。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-screenquoted-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [MODAL_COMPONENT],
        screens: [
          {
            name: 'Screen/Search/Modal',
            nodeId: '466:2',
            type: 'FRAME',
            contract:
              'AI_CONTRACT:\n  react: "packages/renderer/src/components/search/NoSuchFile.tsx"\n  props: {}\n  a11y: {}\n  states: []',
          },
        ],
      }),
    );
    const { code, stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = assertCleanJson(stdout, '屏幕带引号路径');
    const hit = (j.diffs ?? []).find((d) => d.kind === 'reactPathMissing');
    assert.ok(
      hit,
      `屏幕的带引号路径不存在必须报 must，实际：${JSON.stringify((j.diffs ?? []).map((d) => d.kind))}`,
    );
    assert.equal(hit.severity, 'must');
    assert.notEqual(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 契约里的 react 路径带引号 + 文件不存在 → 必须报 must', () => {
  // 独立评审实测的存活变异 S6：M17 改的是 lib 里的 reactPathOf（被单元测试抓住），
  // 但**调用点**不再清洗路径这件事没有端到端用例。
  // 关键：带引号的值若没被清洗，looksLikeRepoPath 会判它"不是路径"而跳过 ⇒ must 0。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-quotedmissing-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          {
            ...MODAL_COMPONENT,
            name: 'Modal/Gone',
            nodeId: '7:7',
            contract:
              'AI_CONTRACT:\n  react: "packages/renderer/src/components/gone/Gone.tsx"\n  props: {}\n  a11y: {}\n  states: []',
          },
        ],
      }),
    );
    const { code, stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = assertCleanJson(stdout, '带引号且不存在');
    const hit = (j.diffs ?? []).find((d) => d.kind === 'reactPathMissing');
    assert.ok(hit, `带引号且不存在的路径必须报 must，实际：${JSON.stringify(j.diffs)}`);
    assert.equal(hit.severity, 'must');
    // 报出来的路径必须是**清洗后**的（否则 coding agent 拿到的是带引号的死路径）
    assert.ok(
      !String(hit.detail.reactPath).includes('"'),
      `报出的 react 路径应已去掉引号，实际：${hit.detail.reactPath}`,
    );
    assert.notEqual(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 组件集的 react 值带注释后缀（不像路径）→ 仍必须报 must', () => {
  // 独立评审实测的回退 B：`react: xxx.tsx（待新建）` 这种写法，
  // 之前被"不像路径就跳过"的豁免静默漏报（组件集不该享受那个豁免 —— 那是给屏幕的）。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-annotated-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          {
            ...MODAL_COMPONENT,
            name: 'Screen/QueuePanel',
            nodeId: '520:14',
            contract:
              'AI_CONTRACT:\n  react: packages/renderer/src/components/queue/QueuePanel.tsx（待新建）\n  props: {}\n  a11y: {}\n  states: []',
          },
        ],
      }),
    );
    const { code, stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = assertCleanJson(stdout, '组件集带注释后缀');
    const hit = (j.diffs ?? []).find((d) => d.kind === 'reactPathMissing');
    assert.ok(hit, `组件集不像路径的 react 值也必须报 must，实际：${JSON.stringify(j.diffs)}`);
    assert.notEqual(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 映射的 nodeId 抄成另一个**存在**的节点 → 必须报 nodeIdChanged', () => {
  // 独立评审实测的回退 C：只看"映射 id 在不在快照里"查不出"抄到了别的节点"。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-wrongnode-'));
  try {
    const cc = JSON.parse(
      execFileSync(
        'node',
        ['-e', `console.log(require('fs').readFileSync('figma-code-connect.json','utf8'))`],
        { cwd: ROOT, encoding: 'utf8' },
      ),
    );
    const shell = cc.mappings.find((m) => m.figmaComponent === 'Modal/Shell');
    const errPanel = cc.mappings.find((m) => m.figmaComponent === 'Modal/ErrorPanel');
    // 把 Modal/Shell 的映射改成指向 ErrorPanel 的 nodeId（模拟抄错节点）
    const ccPath = join(dir, 'cc.json');
    writeFileSync(
      ccPath,
      JSON.stringify({
        ...cc,
        mappings: cc.mappings.map((m) =>
          m.figmaComponent === 'Modal/Shell' ? { ...m, figmaNodeId: errPanel.figmaNodeId } : m,
        ),
      }),
    );
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          {
            ...MODAL_COMPONENT,
            name: 'Modal/Shell',
            nodeId: shell.figmaNodeId,
          },
          {
            ...MODAL_COMPONENT,
            name: 'Modal/ErrorPanel',
            nodeId: errPanel.figmaNodeId,
          },
        ],
      }),
    );
    const { stdout } = runDiff([
      '--json',
      '--only',
      'components',
      '--snapshot',
      p,
      '--code-connect',
      ccPath,
    ]);
    const j = assertCleanJson(stdout, '映射抄错节点');
    const hit = (j.diffs ?? []).find(
      (d) => d.kind === 'nodeIdChanged' && String(d.title).includes('Modal/Shell'),
    );
    assert.ok(
      hit,
      `映射抄到别的节点必须报 nodeIdChanged，实际：${JSON.stringify((j.diffs ?? []).map((d) => d.kind))}`,
    );
    assert.equal(hit.detail.mappedTo, 'Modal/ErrorPanel');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: --code-connect 指定的文件不存在 → 退出码 2（不能静默当成空映射表）', () => {
  // 空映射表 ⇒ 所有组件都变成 unmapped ⇒ 差异清单失真，而退出码还是"正常的 1"。
  // 显式指定了路径却找不到 ⇒ 是调用方的错 ⇒ 必须 exit 2。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-nocc-'));
  try {
    const p = writeSnapshot(dir, MIN_SNAPSHOT);
    const { code, out } = runDiff([
      '--json',
      '--only',
      'components',
      '--snapshot',
      p,
      '--code-connect',
      join(dir, 'no-such-code-connect.json'),
    ]);
    assert.equal(code, 2, `显式指定的映射表缺失必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 组件集与屏幕撞名时，组件集**不能**享受屏幕的豁免', () => {
  // 真实数据 `Screen/SourceSelect`：既是 02 页的 COMPONENT_SET（515:133），
  // 又是 03 页的同名 FRAME（314:1432）。
  // 「是不是屏幕」必须按**来源**判而不是按**名字**判 ——
  // 否则那个组件集会白拿「不像路径就跳过」的豁免 ⇒ 它的 react 值写成
  // 非路径时**静默漏报**（组件集不该有这条豁免）。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-collide-'));
  try {
    const p = writeSnapshot(
      dir,
      buildSnapshot({
        components: [
          {
            ...MODAL_COMPONENT,
            name: 'Screen/SourceSelect',
            nodeId: '515:133',
            contract:
              'AI_CONTRACT:\n  react: packages/renderer/src/components/source-select/Pending.tsx（待新建）\n  props: {}\n  a11y: {}\n  states: []',
          },
        ],
        screens: [
          {
            name: 'Screen/SourceSelect',
            nodeId: '314:1432',
            type: 'FRAME',
            contract: '',
          },
        ],
      }),
    );
    const { stdout } = runDiff(['--json', '--only', 'components', '--snapshot', p]);
    const j = assertCleanJson(stdout, '撞名组件集');
    const hit = (j.diffs ?? []).find(
      (d) => d.kind === 'reactPathMissing' && d.detail?.nodeId === '515:133',
    );
    assert.ok(
      hit,
      `撞名的**组件集**必须按组件规则报 must（不得享受屏幕豁免），实际：${JSON.stringify((j.diffs ?? []).map((d) => [d.kind, d.detail?.nodeId]))}`,
    );
    assert.equal(hit.severity, 'must');
    assert.ok(hit.title.includes('组件'), `标题应说明是组件，实际：${hit.title}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: code-connect 映射表是空的 → 退出码 2（不能静默变成"全都未映射"）', () => {
  // 退化输入：映射表存在但 0 条映射 ⇒ 所有组件都变成 unmapped，
  // 而 unmapped 正好在豁免表里 ⇒ 门禁照样绿 —— 与「空 token dump」同一种假绿。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-emptycc-'));
  try {
    const p = writeSnapshot(dir, MIN_SNAPSHOT);
    const ccPath = join(dir, 'cc.json');
    writeFileSync(ccPath, JSON.stringify({ mappings: [] }));
    const { code, out } = runDiff([
      '--json',
      '--only',
      'components',
      '--snapshot',
      p,
      '--code-connect',
      ccPath,
    ]);
    assert.equal(code, 2, `空映射表必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: token dump 的 variables 是空数组 → 退出码 2（不能静默跳过）', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-emptydump-'));
  try {
    const p = writeSnapshot(dir, MIN_SNAPSHOT);
    const dumpPath = join(dir, 'dump.json');
    writeFileSync(dumpPath, JSON.stringify({ variables: [] }));
    const { code, out } = runDiff([
      '--json',
      '--only',
      'tokens',
      '--snapshot',
      p,
      '--token-dump',
      dumpPath,
    ]);
    assert.equal(code, 2, `空变量数组必须是 exit 2，实际 ${code}：${out.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: motion 非对象 / motion.spec 非数组 → 退出码 2（隔离用例）', () => {
  // 隔离要点：counts.motionEntries 传 null，让 counts 校验**不**拦，
  // 只有 motion 自身的检查能拦 —— 否则这两条守卫是"被 counts 顺带挡住"的，测不到。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-motioniso-'));
  try {
    const p1 = writeSnapshot(dir, buildSnapshot({ components: [MODAL_COMPONENT], motion: null }));
    // counts 与 null 的 motion 对齐（不靠 counts 拦）
    const raw1 = JSON.parse(readFileSync(p1, 'utf8'));
    raw1.counts.motionEntries = null;
    writeFileSync(p1, JSON.stringify(raw1));
    const r1 = runDiff(['--json', '--snapshot', p1]);
    assert.equal(r1.code, 2, `motion 非对象必须是 exit 2，实际 ${r1.code}`);

    const p2 = writeSnapshot(dir, buildSnapshot({ components: [MODAL_COMPONENT], motion: {} }));
    const raw2 = JSON.parse(readFileSync(p2, 'utf8'));
    raw2.counts.motionEntries = null;
    writeFileSync(p2, JSON.stringify(raw2));
    const r2 = runDiff(['--json', '--snapshot', p2]);
    assert.equal(r2.code, 2, `motion.spec 非数组必须是 exit 2，实际 ${r2.code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 干净快照 ─────────────────────────────────────────────────────

test('端到端: 干净快照（与仓库一致）→ 零 must/should 差异', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-ok-'));
  try {
    const cc = JSON.parse(
      execFileSync(
        'node',
        ['-e', `console.log(require('fs').readFileSync('figma-code-connect.json','utf8'))`],
        { cwd: ROOT, encoding: 'utf8' },
      ),
    );
    const snapPath = writeSnapshot(
      dir,
      buildSnapshot({
        fileKey: cc.$figmaFileKey,
        components: cc.mappings
          .filter(
            (m) =>
              m._status === 'D1_DONE' &&
              m.figmaComponent &&
              !m.figmaComponent.startsWith('Screen/'),
          )
          .map((m) => ({
            name: m.figmaComponent,
            nodeId: m.figmaNodeId,
            type: 'COMPONENT_SET',
            variants: [],
            contract: `AI_CONTRACT:\n  react: ${m.reactPath}\n  props: {}\n  a11y: {}\n  states: []`,
          })),
      }),
    );
    const { code, stdout } = runDiff(['--json', '--snapshot', snapPath, '--only', 'components']);
    const res = JSON.parse(stdout);
    const bad = res.diffs.filter((d) => d.severity === 'must' || d.severity === 'should');
    assert.equal(
      bad.length,
      0,
      `干净快照不该有主线差异，实际：${JSON.stringify(bad.map((b) => b.kind))}`,
    );
    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
