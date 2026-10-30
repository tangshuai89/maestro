#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER 快照采集插件 —— **插件本体的反向验证**（mock Figma API）
//
// 为什么必须测这个：采集插件跑在 Figma 沙箱里，本地没有 Figma。
//   ⇒ 交付一个「跑不了的产物」而不验证，等于把一个未证实的脚本交给人去跑 ——
//     而快照是 `figma:diff` 的**唯一输入**：它错了，后面所有结论都错，
//     而且**现场看不出任何异常**（这正是本仓库反复强调的「假绿」）。
//
// 本测试证明的是**插件逻辑**（遍历 / 契约段提取口径 / counts 自洽 / 剪贴板输出），
//    **不证明** Figma 桌面端的真实运行时行为（真实文件、真实页、真实剪贴板）
//    —— 那仍需在 Figma 桌面 App 跑一次确认（见 docs/figma-contract-write-guide.md）。
//
// ⚠️ 契约段提取走的是**共享实现**（scripts/lib/figma-contract-section.js），
//    与写入插件同源 ⇒ 这里测的也是那一份的真实行为。
//
// 用法：node scripts/figma-collect-plugin.test.mjs
// ─────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const CODE = readFileSync(resolve(__dirname, 'figma-collect-plugin/code.js'), 'utf8');
const PREFIX = '[aether-snapshot-collector] ';

// ── mock Figma API ────────────────────────────────────────────

/** 递归收集指定类型的子孙节点（对齐 figma.findAllWithCriteria 的语义）。 */
function findAllWithCriteria(node, types) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children ?? []) {
      if (types.includes(c.type)) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

function mockFigma({ pages, fileKey = 'FtbRZXvzlCp4Sq9e322cQQ', clipboardFails = false } = {}) {
  const log = { notified: [], closed: [], clipboard: [], loadedPages: 0, currentPage: null };
  const figma = {
    root: { children: pages },
    fileKey,
    get currentPage() {
      return log.currentPage;
    },
    async loadAllPagesAsync() {
      log.loadedPages++;
    },
    async setCurrentPageAsync(page) {
      log.currentPage = page;
    },
    clipboard: {
      async writeText(text) {
        if (clipboardFails) throw new Error('clipboard unavailable');
        log.clipboard.push(text);
      },
    },
    notify(msg) {
      log.notified.push(msg);
    },
    closePlugin(msg) {
      log.closed.push(msg);
    },
  };
  // ⚠️ 真 Figma 里 `figma.currentPage` **永远有值**（用户所在的页）⇒ 初始就设上。
  //    否则 SEG1 里的 `figma.currentPage && figma.fileKey ? … : null` 会取到 null
  //    ⇒ 快照的 fileKey 变 null（假失败，mock 造成的）。
  log.currentPage = pages[0] ?? null;
  for (const p of pages) p.findAllWithCriteria = (opts) => findAllWithCriteria(p, opts.types);
  figma.__log = log;
  return figma;
}

/** 造一个组件集节点（description 是语义载体）。 */
function componentSet(id, name, description) {
  return { id, name, type: 'COMPONENT_SET', description, children: [] };
}

/** 造一个屏幕帧（契约在隐藏 TEXT 子节点里）。 */
function screenFrame(id, name, carrierText) {
  const children = [];
  if (carrierText !== undefined) {
    children.push({ id: `${id}c`, name: 'AI_CONTRACT', type: 'TEXT', characters: carrierText });
  }
  return { id, name, type: 'FRAME', children };
}

/**
 * 跑插件，返回 { snapshot, log }。
 *
 * ⚠️ 插件末尾是 `main().catch(...)`（**不 await**）⇒ 必须让事件循环转起来
 *    等它把 closePlugin 调完，否则会在 main 跑完之前就断言。
 */
async function runPlugin(figma, code = CODE) {
  const logs = [];
  const origLog = console.log;
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
  // ⚠️ 取**能解析成 JSON 的那一行** —— 插件还可能打别的以同一前缀开头的行
  //    （如剪贴板失败的 ERROR 行）⇒ 只按前缀找会抓到它 ⇒ JSON.parse 炸。
  let snapshot = null;
  for (const l of logs) {
    if (!l.startsWith(PREFIX)) continue;
    try {
      snapshot = JSON.parse(l.slice(PREFIX.length));
      break;
    } catch {
      /* 不是 JSON 行 ⇒ 继续找 */
    }
  }
  return { snapshot, log: figma.__log };
}

const CONTRACT = '---\nAI_CONTRACT:\n  react: packages/renderer/src/App.tsx\n  props: {}\n---';
const PROSE = 'Holographic cover area 480×500: orbit ring + 12 ticks.';

// ════════════════════════════════════════════════════════════════
// 1. 基本形状：counts 自洽、capturedAt 补上、剪贴板拿到 JSON
// ════════════════════════════════════════════════════════════════

describe('AETHER 快照采集插件（mock Figma API）', () => {
  it('采集: counts 三数与数组长度逐一相等 + capturedAt 被补上 + JSON 进剪贴板', async () => {
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [componentSet('1:1', 'Hologram/Cover', CONTRACT)],
    };
    const screenPage = {
      type: 'PAGE',
      name: '03 · Screens',
      children: [screenFrame('2:1', 'Screen/Search', CONTRACT)],
    };
    const figma = mockFigma({ pages: [compPage, screenPage] });
    const { snapshot, log } = await runPlugin(figma);

    assert.ok(snapshot, '插件应输出快照 JSON');
    assert.equal(snapshot.counts.components, snapshot.components.length);
    assert.equal(snapshot.counts.screens, snapshot.screens.length);
    assert.equal(snapshot.counts.motionEntries, 0);
    assert.ok(snapshot.capturedAt, 'capturedAt 应被补上');
    assert.match(snapshot.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.equal(snapshot.fileKey, 'FtbRZXvzlCp4Sq9e322cQQ');

    assert.equal(log.loadedPages, 1, '⚠️ dynamic-page 模式必须先 loadAllPagesAsync');
    assert.equal(log.clipboard.length, 1, '快照 JSON 应写进剪贴板');
    const fromClipboard = JSON.parse(log.clipboard[0]);
    assert.equal(fromClipboard.components.length, 1);
    assert.equal(fromClipboard.screens.length, 1);
  });

  // ════════════════════════════════════════════════════════════════
  // 2. 契约段提取口径（与写入插件同源 ⇒ 写→读闭环）
  // ════════════════════════════════════════════════════════════════

  it('采集: 有 --- 段 ⇒ hasContract=true；只有散文 ⇒ hasContract=false 且有预览', async () => {
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [
        componentSet('1:1', 'Hologram/Cover', `${CONTRACT}\n${PROSE}`),
        componentSet('1:2', 'Lyrics/Line', PROSE),
        componentSet('1:3', 'Core/Play', ''),
      ],
    };
    const figma = mockFigma({ pages: [compPage] });
    const { snapshot } = await runPlugin(figma);

    const byName = Object.fromEntries(snapshot.components.map((c) => [c.name, c]));
    assert.equal(byName['Hologram/Cover'].hasContract, true, '有契约段 ⇒ hasContract=true');
    assert.equal(byName['Hologram/Cover'].hasDescription, true);
    assert.equal(byName['Hologram/Cover'].contract.includes('AI_CONTRACT:'), true);
    assert.ok(!byName['Hologram/Cover'].contract.includes(PROSE), '契约段里不该混进散文');

    assert.equal(byName['Lyrics/Line'].hasContract, false, '只有散文 ⇒ 没有契约段');
    assert.equal(byName['Lyrics/Line'].hasDescription, true, '有散文 ⇒ hasDescription=true');
    assert.ok(byName['Lyrics/Line'].descriptionPreview.includes('orbit ring'), '散文预览要有内容');

    assert.equal(byName['Core/Play'].hasDescription, false, '空 ⇒ 无语义');
    assert.equal(byName['Core/Play'].hasContract, false);
    assert.equal(byName['Core/Play'].descriptionPreview, '');
  });

  it('采集: 散文里提到 AI_CONTRACT: **不算**有契约段（与写入插件同口径）', async () => {
    const tricky = `这个组件的说明：参见 AI_CONTRACT: 段落（在别处定义）。${PROSE}`;
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [componentSet('1:1', 'Tricky', tricky)],
    };
    const figma = mockFigma({ pages: [compPage] });
    const { snapshot } = await runPlugin(figma);

    assert.equal(
      snapshot.components[0].hasContract,
      false,
      '⚠️ 散文提及不得被当成「已写过」—— 否则写完契约后快照仍显示没写（静默漏写）',
    );
    assert.equal(snapshot.components[0].hasDescription, true);
  });

  it('采集: FRAME 的契约从隐藏 TEXT 子节点里提出来', async () => {
    const screenPage = {
      type: 'PAGE',
      name: '03 · Screens',
      children: [
        screenFrame('2:1', 'Screen/Search', CONTRACT),
        screenFrame('2:2', 'Screen/Library', undefined),
      ],
    };
    const figma = mockFigma({ pages: [screenPage] });
    const { snapshot } = await runPlugin(figma);

    const byName = Object.fromEntries(snapshot.screens.map((s) => [s.name, s]));
    assert.equal(byName['Screen/Search'].hasContract, true, 'TEXT 载体里的段应提得出来');
    assert.ok(byName['Screen/Search'].contract.includes('AI_CONTRACT:'));
    assert.equal(byName['Screen/Library'].hasContract, false, '没有载体 ⇒ 没契约段');
  });

  // ════════════════════════════════════════════════════════════════
  // 3. 兜底路径：剪贴板挂了也不能崩（JSON 仍进 console）
  // ════════════════════════════════════════════════════════════════

  it('采集: 剪贴板写入失败 ⇒ 不抛异常，JSON 仍进 console，通知里说清', async () => {
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [componentSet('1:1', 'Hologram/Cover', CONTRACT)],
    };
    const figma = mockFigma({ pages: [compPage], clipboardFails: true });
    const { snapshot, log } = await runPlugin(figma);

    assert.ok(snapshot, '剪贴板失败也要产出快照');
    assert.equal(log.clipboard.length, 0);
    assert.ok(log.notified.length >= 1);
    assert.match(log.notified.join('\n'), /剪贴板/, '通知要点明剪贴板失败');
    assert.equal(log.closed.length, 1, 'closePlugin 应被调用一次');
    assert.equal(typeof log.closed[0], 'string', '⚠️ closePlugin 只接受字符串');
  });

  it('采集: 通知里带**带契约段的数量**（数字说话，不靠人眼判断）', async () => {
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [componentSet('1:1', 'A', CONTRACT), componentSet('1:2', 'B', PROSE)],
    };
    const figma = mockFigma({ pages: [compPage] });
    const { log } = await runPlugin(figma);

    const notice = log.notified.join('\n');
    assert.match(notice, /组件 2/, '通知应报组件数');
    assert.match(notice, /带契约段 1\/2/, '通知应报「几个节点带契约段」');
  });
});
