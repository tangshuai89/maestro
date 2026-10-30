#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER 契约写入插件 —— **插件本体的反向验证**（mock Figma API）
//
// 为什么必须测这个：插件代码（`scripts/figma-write-plugin/code.js`）
// 是**唯一一行都没被执行过**的部分 —— 它跑在 Figma 沙箱里，本地没有 Figma。
// ⇒ 之前只有语法检查（`node --check`）⇒ 载体分支、幂等守卫、错误处理
// 全都只是「看着对」。按本仓库的规矩「判据类交付必须可验证」，
// 这里用 mock 的 Figma API **真跑一遍**插件。
//
// ⚠️ 本测试证明的是**插件逻辑**（载体选择 / 合并语义 / 幂等 / 错误处理），
//    **不证明** Figma 桌面端的真实运行时行为（字体加载、跨页、通知）
//    —— 那仍需在 Figma 桌面 App 跑一次确认（见 docs/figma-contract-write-guide.md）。
//
// 用法：node scripts/figma-write-plugin.test.mjs
// ─────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const CODE = readFileSync(resolve(__dirname, 'figma-write-plugin/code.js'), 'utf8');
const PAYLOAD = JSON.parse(readFileSync(resolve(__dirname, 'figma-contract-payload.json'), 'utf8'));
const PROSE = 'Holographic cover area 480×500: orbit ring + 12 ticks + 280×280 cover.';
const PREFIX = '[aether-contract-writer] ';
const FALLBACK_WRITE = {
  nodeId: '999:10',
  name: 'Synth/Component',
  kind: 'component',
  type: 'COMPONENT_SET',
  carrier: 'description',
  carrierText:
    '---\nAI_CONTRACT:\n  react: packages/renderer/src/App.tsx\n  props: {}\n  a11y: { role: group, keyboard: [] }\n  states: []\n  tokens: []\n  bindings: []\n  draft: true\n---',
};

/** code.js 里内联的 payload 字面量（生成器用 JSON.stringify(payload, null, 2) 写的）。 */
const PAYLOAD_LITERAL = JSON.stringify(PAYLOAD, null, 2);

/**
 * 造一个最小 Figma API mock。
 *
 * ⚠️ 必须实现的 API 面（插件里用到的）：
 *   loadAllPagesAsync / getNodeByIdAsync / loadFontAsync / listAvailableFontsAsync
 *   createText / notify / closePlugin / mixed / root
 */
function mockFigma({ nodes = new Map(), fonts = [{ family: 'Inter', style: 'Regular' }] } = {}) {
  const log = { notified: [], closed: [], loadedFonts: [], createdText: [] };
  const figma = {
    root: { children: [] },
    mixed: Symbol('figma.mixed'),
    async loadAllPagesAsync() {},
    async getNodeByIdAsync(id) {
      return nodes.get(id) ?? null;
    },
    async loadFontAsync(name) {
      log.loadedFonts.push(name);
    },
    async listAvailableFontsAsync() {
      return fonts;
    },
    createText() {
      const t = {
        type: 'TEXT',
        name: '',
        characters: '',
        fontName: null,
        visible: true,
        x: 0,
        y: 0,
      };
      log.createdText.push(t);
      return t;
    },
    notify(msg) {
      log.notified.push(msg);
    },
    closePlugin(msg) {
      log.closed.push(msg);
    },
  };
  figma.__log = log;
  return figma;
}

/**
 * 跑插件，返回 { report, log }。
 *
 * ⚠️ 插件末尾是 `main().catch(...)`（**不 await**）⇒ 必须让事件循环转起来
 *    等它把 closePlugin 调完，否则会在 main 跑完之前就断言。
 */
async function runPlugin(figma, code = CODE) {
  const logs = [];
  const origLog = console.log;
  // ⚠️ 必须跟「本次运行前」比：连续跑两次时 closePlugin 已经被调用过一次，
  //    若等 `closed.length === 0` 会**立即退出** ⇒ 本次的报告没被捕获，
  //    还可能串到下一个测试的捕获窗口里（实测踩过）。
  const closedBefore = figma.__log.closed.length;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await new AsyncFunction('figma', code)(figma);
    for (let i = 0; i < 200 && figma.__log.closed.length === closedBefore; i++) {
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    console.log = origLog;
  }
  const line = logs.find((l) => l.startsWith(PREFIX));
  const report = line ? JSON.parse(line.slice(PREFIX.length)) : null;
  return { report, log: figma.__log };
}

/** 用一份合成 payload 替换掉 code.js 里内联的那份（按生成器的同一份序列化方式）。 */
function withPayload(writes) {
  const start = CODE.indexOf(PAYLOAD_LITERAL);
  assert.ok(start >= 0, 'code.js 里应能找到内联的 payload 字面量');
  return CODE.replace(PAYLOAD_LITERAL, JSON.stringify({ ...PAYLOAD, writes }, null, 2));
}

// ════════════════════════════════════════════════════════════════
// 1. 载体分支：description / text-child
// ════════════════════════════════════════════════════════════════

describe('AETHER 契约写入插件（mock Figma API）', () => {
  it('插件: description 载体 ⇒ 契约段写进 description 且**散文原样保留**', async () => {
    const write = PAYLOAD.writes.find((w) => w.carrier === 'description') ?? FALLBACK_WRITE;

    const node = {
      id: write.nodeId,
      name: write.name,
      type: 'COMPONENT_SET',
      description: PROSE,
      children: [],
    };
    const figma = mockFigma({ nodes: new Map([[write.nodeId, node]]) });
    const { report, log } = await runPlugin(figma, withPayload([write]));

    assert.ok(report, '插件应输出报告');
    assert.equal(report.applied.length, 1);
    assert.equal(report.failed.length, 0);
    assert.ok(node.description.startsWith('---\n'), '契约段应放最前面');
    assert.ok(node.description.includes('AI_CONTRACT:'), '契约段应写进去');
    assert.ok(node.description.includes(PROSE), '⚠️ 散文不得被抹掉（P0 回归）');

    // 写→读闭环：采集段用的提取口径必须能把它提回来，且契约段里不混散文
    const extracted = node.description.match(/---([\s\S]*?)---/)[1];
    assert.ok(extracted.includes('AI_CONTRACT:'), '采集段应能提取出契约段');
    assert.ok(!extracted.includes(PROSE), '契约段里不该混进散文');

    assert.equal(log.closed.length, 1, 'closePlugin 应被调用一次');
    assert.equal(typeof log.closed[0], 'string', '⚠️ closePlugin 只接受字符串（官方签名）');
    assert.ok(log.notified.length >= 1, '应有一条通知');
  });

  it('插件: text-child 载体 ⇒ 建隐藏 TEXT 子节点（名字 AI_CONTRACT）', async () => {
    const synth = {
      nodeId: '999:1',
      name: 'Synth/Frame',
      kind: 'screen',
      type: 'FRAME',
      carrier: 'text-child',
      carrierText: '---\nAI_CONTRACT:\n  react: packages/renderer/src/App.tsx\n---',
    };
    const node = {
      id: synth.nodeId,
      name: synth.name,
      type: 'FRAME',
      children: [],
      appendChild(c) {
        this.children.push(c);
      },
    };
    const figma = mockFigma({ nodes: new Map([[synth.nodeId, node]]) });
    const { report } = await runPlugin(figma, withPayload([synth]));

    assert.equal(report.applied.length, 1);
    assert.equal(report.failed.length, 0);
    assert.equal(node.children.length, 1, '应新建一个 TEXT 子节点');
    const holder = node.children[0];
    assert.equal(holder.name, 'AI_CONTRACT');
    assert.equal(holder.visible, false, '载体 TEXT 必须隐藏');
    assert.ok(holder.characters.includes('AI_CONTRACT:'));
    assert.ok(holder.characters.startsWith('---\n'), '契约段应放最前面');
  });

  it('插件: text-child 载体遇到**已有**的载体节点 ⇒ 合并不覆盖，且加载它自己的字体', async () => {
    const synth = {
      nodeId: '999:2',
      name: 'Synth/Frame2',
      kind: 'screen',
      type: 'FRAME',
      carrier: 'text-child',
      carrierText: '---\nAI_CONTRACT:\n  react: packages/renderer/src/App.tsx\n---',
    };
    const existing = {
      id: synth.nodeId,
      name: 'AI_CONTRACT',
      type: 'TEXT',
      characters: '人工写的说明文字。',
      fontName: { family: 'Inter', style: 'Bold' },
      visible: false,
      x: 0,
      y: 0,
    };
    const node = {
      id: synth.nodeId,
      name: synth.name,
      type: 'FRAME',
      children: [existing],
      appendChild(c) {
        this.children.push(c);
      },
    };
    const figma = mockFigma({ nodes: new Map([[synth.nodeId, node]]) });
    const { report } = await runPlugin(figma, withPayload([synth]));

    assert.equal(report.applied.length, 1);
    assert.equal(node.children.length, 1, '不应新建第二个载体节点');
    assert.ok(existing.characters.includes('人工写的说明文字。'), '⚠️ 原有说明不得被抹掉');
    assert.ok(existing.characters.includes('AI_CONTRACT:'), '契约段应被合并进去');
    assert.ok(
      figma.__log.loadedFonts.some((f) => f && f.family === 'Inter' && f.style === 'Bold'),
      '⚠️ 改 characters 前必须先加载**该节点自己的**字体',
    );
  });

  // ════════════════════════════════════════════════════════════════
  // 2. 幂等：已有契约段 ⇒ 跳过，不叠加、不覆盖
  // ════════════════════════════════════════════════════════════════

  it('插件: 载体里已有契约段 ⇒ 跳过（幂等），一个字节都不改', async () => {
    const write = PAYLOAD.writes[0] ?? FALLBACK_WRITE;
    const existing = `---\nAI_CONTRACT:\n  react: already.tsx\n---\n${PROSE}`;
    const node = {
      id: write.nodeId,
      name: write.name,
      type: 'COMPONENT_SET',
      description: existing,
      children: [],
    };
    const figma = mockFigma({ nodes: new Map([[write.nodeId, node]]) });
    const { report } = await runPlugin(figma, withPayload([write]));

    assert.equal(report.applied.length, 0, '已有契约段 ⇒ 不该写');
    const entry = report.skipped.find((s) => s.nodeId === write.nodeId);
    assert.equal(entry?.reason, 'already-has-contract');
    assert.equal(node.description, existing, '幂等命中时一个字都不能改');
  });

  it('插件: **散文里提到 AI_CONTRACT: 不算已写过** ⇒ 仍然要写（P1 回归）', async () => {
    const write = PAYLOAD.writes[0] ?? FALLBACK_WRITE;
    const tricky = `这个组件的说明：参见 AI_CONTRACT: 段落（在别处定义）。${PROSE}`;
    const node = {
      id: write.nodeId,
      name: write.name,
      type: 'COMPONENT_SET',
      description: tricky,
      children: [],
    };
    const figma = mockFigma({ nodes: new Map([[write.nodeId, node]]) });
    const { report } = await runPlugin(figma, withPayload([write]));

    assert.equal(report.applied.length, 1, '散文提及不得被当成「已写过」');
    assert.ok(node.description.includes(tricky), '原散文必须原样保留');
    assert.ok(node.description.includes('\n---\n'), '契约段必须被写进去');
  });

  it('插件: 连跑两次 ⇒ 第二次全部跳过（不叠加）', async () => {
    const write = PAYLOAD.writes[0] ?? FALLBACK_WRITE;
    const node = {
      id: write.nodeId,
      name: write.name,
      type: 'COMPONENT_SET',
      description: PROSE,
      children: [],
    };
    const figma = mockFigma({ nodes: new Map([[write.nodeId, node]]) });
    const code = withPayload([write]);

    const first = await runPlugin(figma, code);
    const afterFirst = node.description;
    const second = await runPlugin(figma, code);

    assert.equal(first.report.applied.length, 1);
    assert.equal(second.report.applied.length, 0, '第二次不应再写');
    const entry = second.report.skipped.find((s) => s.nodeId === write.nodeId);
    assert.equal(entry?.reason, 'already-has-contract');
    assert.equal(node.description, afterFirst, '第二次不得改动内容');
  });

  // ════════════════════════════════════════════════════════════════
  // 3. 错误路径：节点找不到 / 字体不可用
  // ════════════════════════════════════════════════════════════════

  it('插件: 节点找不到 ⇒ skipped(node-not-found)，不抛异常', async () => {
    const figma = mockFigma({ nodes: new Map() }); // 空 ⇒ 全都找不到
    const { report } = await runPlugin(figma, withPayload([FALLBACK_WRITE]));

    assert.ok(report, '应输出报告');
    assert.equal(report.failed.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.ok(report.skipped.every((s) => s.reason === 'node-not-found'));
  });

  it('插件: 字体一个都加载不了 ⇒ 仍然产出可读摘要（closePlugin 收到字符串）', async () => {
    const write = PAYLOAD.writes[0] ?? FALLBACK_WRITE;
    const node = {
      id: write.nodeId,
      name: write.name,
      type: 'COMPONENT_SET',
      description: PROSE,
      children: [],
    };
    const figma = mockFigma({ nodes: new Map([[write.nodeId, node]]) });
    figma.loadFontAsync = async () => {
      throw new Error('no font');
    };
    figma.listAvailableFontsAsync = async () => [];
    const { report, log } = await runPlugin(figma, withPayload([write]));

    assert.ok(report, '报告应存在');
    assert.equal(log.closed.length, 1);
    assert.equal(typeof log.closed[0], 'string', '⚠️ closePlugin 只接受字符串');
    assert.match(log.closed[0], /应用|失败/, '摘要应可读');
  });
});
