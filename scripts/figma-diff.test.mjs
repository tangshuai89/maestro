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
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
// 7. 端到端：构造坏快照 → 跑真脚本 → 必须报出来
// ════════════════════════════════════════════════════════════════

test('端到端: 坏快照必须让 figma-diff 报出差异且退出码非 0', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-'));
  const snapPath = join(dir, 'snap.json');
  writeFileSync(
    snapPath,
    JSON.stringify({
      schemaVersion: 1,
      capturedAt: '2026-10-29T10:00:00+08:00',
      fileKey: 'FtbRZXvzlCp4Sq9e322cQQ',
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
          variants: ['state=default'],
          contract: '',
        },
      ],
      screens: [],
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
  try {
    let out = '';
    let code = 0;
    try {
      out = execFileSync('node', [DIFF, '--json', '--snapshot', snapPath], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    } catch (e) {
      out = e.stdout ?? '';
      code = e.status ?? 1;
    }
    assert.notEqual(code, 0, '有 must 级差异时退出码必须非 0');

    const res = JSON.parse(out);
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

// ════════════════════════════════════════════════════════════════
// 8. 退化快照守卫 + 豁免机制（端到端）
// ════════════════════════════════════════════════════════════════

function runDiff(args) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', [DIFF, ...args], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    // fail() 走 console.error → stderr；stdout 只有 --json 时才有内容
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    code = e.status ?? 1;
  }
  return { code, out };
}

function writeSnapshot(dir, snapshot) {
  const p = join(dir, 'snap.json');
  writeFileSync(p, JSON.stringify(snapshot));
  return p;
}

const MIN_SNAPSHOT = {
  capturedAt: '2026-10-29T10:00:00+08:00',
  fileKey: 'FtbRZXvzlCp4Sq9e322cQQ',
  components: [
    {
      name: 'Modal/Shell',
      nodeId: '514:72',
      type: 'COMPONENT_SET',
      variants: ['Default'],
      contract:
        'AI_CONTRACT:\n  react: packages/renderer/src/components/common/Modal.tsx\n  props: {}\n  a11y: { role: dialog }\n  states: [default]',
    },
  ],
  screens: [],
  motion: { spec: [] },
};

test('端到端: 空快照（components/screens 都空）→ 退出码 2，不得当成"无差异"', () => {
  // 采集失败 / JSON 抄断 / 写成 {} —— 这些情况下比对会得到"0 差异"，
  // 门禁会绿，而真相是"根本没采到"。必须报错。
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-empty-'));
  try {
    const p = writeSnapshot(dir, { capturedAt: 'x', components: [], screens: [] });
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

test('端到端: should 级差异被豁免 → --gate 退出码 0，但仍出现在清单里', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-waive-'));
  try {
    // 未映射的组件 → should 级
    const snap = {
      ...MIN_SNAPSHOT,
      components: [
        MIN_SNAPSHOT.components[0],
        { ...MIN_SNAPSHOT.components[0], name: 'Brand/New', nodeId: '9:9' },
      ],
    };
    const p = writeSnapshot(dir, snap);
    const allowPath = join(dir, 'allow.json');
    writeFileSync(
      allowPath,
      JSON.stringify({
        allow: [{ kind: 'unmapped', reason: '测试用豁免' }],
      }),
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
    const j = JSON.parse(res.out);
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
    const snap = {
      ...MIN_SNAPSHOT,
      components: [
        {
          name: 'Screen/QueuePanel',
          nodeId: '520:14',
          type: 'COMPONENT_SET',
          variants: [],
          contract: 'AI_CONTRACT:\n  react: packages/renderer/src/components/queue/QueuePanel.tsx',
        },
      ],
    };
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
    const { code, out } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(code, 1, `must 不可豁免，必须仍然红，实际 ${code}；输出：${out.slice(0, 300)}`);
    const j = JSON.parse(out);
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
    const snap = {
      ...MIN_SNAPSHOT,
      components: [
        MIN_SNAPSHOT.components[0],
        { ...MIN_SNAPSHOT.components[0], name: 'Brand/New', nodeId: '9:9' },
      ],
    };
    const p = writeSnapshot(dir, snap);
    const allowPath = join(dir, 'allow.json');
    writeFileSync(allowPath, JSON.stringify({ allow: [{ kind: 'unmapped' }] }));
    const { code } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(code, 1, `缺 reason 不得豁免，必须仍红，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 豁免条目没有匹配条件（空 kind/lane/target）→ 不豁免一切', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-emptycond-'));
  try {
    const snap = {
      ...MIN_SNAPSHOT,
      components: [
        MIN_SNAPSHOT.components[0],
        { ...MIN_SNAPSHOT.components[0], name: 'Brand/New', nodeId: '9:9' },
      ],
    };
    const p = writeSnapshot(dir, snap);
    const allowPath = join(dir, 'allow.json');
    writeFileSync(allowPath, JSON.stringify({ allow: [{ reason: '空条件' }] }));
    const { code } = runDiff([
      '--json',
      '--gate',
      '--only',
      'components',
      '--snapshot',
      p,
      '--allowlist',
      allowPath,
    ]);
    assert.equal(code, 1, `空条件不得豁免一切，必须仍红，实际 ${code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端: 快照文件不存在 → 退出码 2（用法错误，不是 1）', () => {
  let code = 0;
  try {
    execFileSync('node', [DIFF, '--snapshot', '/tmp/definitely-not-here-xyz.json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    code = e.status ?? 0;
  }
  assert.equal(code, 2, '缺快照属用法/文件错误，应是 exit 2');
});

test('端到端: 干净快照（与仓库一致）→ 零 must/should 差异', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'figma-diff-ok-'));
  const snapPath = join(dir, 'snap.json');
  // 用仓库真实映射构造一个"与仓库一致"的快照
  const cc = JSON.parse(
    execFileSync(
      'node',
      ['-e', `console.log(require('fs').readFileSync('figma-code-connect.json','utf8'))`],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    ),
  );
  writeFileSync(
    snapPath,
    JSON.stringify({
      schemaVersion: 1,
      capturedAt: '2026-10-29T10:00:00+08:00',
      fileKey: cc.$figmaFileKey,
      components: cc.mappings
        .filter(
          (m) =>
            m._status === 'D1_DONE' && m.figmaComponent && !m.figmaComponent.startsWith('Screen/'),
        )
        .map((m) => ({
          name: m.figmaComponent,
          nodeId: m.figmaNodeId,
          type: 'COMPONENT_SET',
          variants: [],
          contract: `AI_CONTRACT:\n  react: ${m.reactPath}\n  props: {}\n  a11y: {}\n  states: []`,
        })),
      screens: [],
      motion: { spec: [] },
    }),
  );
  try {
    let out = '';
    let code = 0;
    try {
      out = execFileSync('node', [DIFF, '--json', '--snapshot', snapPath, '--only', 'components'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    } catch (e) {
      out = e.stdout ?? '';
      code = e.status ?? 1;
    }
    const res = JSON.parse(out);
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
