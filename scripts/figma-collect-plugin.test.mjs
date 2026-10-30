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

/**
 * mock Figma API。
 *
 * ⚠️ **fileKey 默认 undefined 是刻意的**（2026-10-30 实测踩到）：
 *    官方 API 文档写明 `figma.fileKey`「Only private plugins and Figma-owned
 *    resources have access to this … For all other plugins, this property
 *    returns undefined」⇒ **本地开发插件（公开插件）永远拿不到 fileKey**。
 *    mock 若给它塞一个 fileKey，就会掩盖「采集段必须自带 fileKey」这件事。
 */
function mockFigma({ pages, fileKey = undefined, clipboardFails = false } = {}) {
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
  // ⚠️ **忠实模拟 dynamic-page 模式**：本插件 manifest 是
  //    `documentAccess: "dynamic-page"` ⇒ `figma.currentPage` **初始为 null**
  //    （必须先 setCurrentPageAsync 才有值）。
  //    ⚠️ 之前这里偷懒设成了 pages[0] ⇒ **掩盖了一个真 bug**：
  //    SEG1 曾用 `figma.currentPage && figma.fileKey ? … : null` 取 fileKey
  //    ⇒ 真实 Figma 里取成 null（2026-10-30 实测：接收器拒收「fileKey 缺失」）。
  //    ⇒ 现在 mock 忠实还原：**初始 null**，由 SEG1 自己 setCurrentPageAsync 切页。
  log.currentPage = null;
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
 *
 * ⚠️ `fetch` 以**参数**注入（`new AsyncFunction('figma', 'fetch', code)`）：
 *    函数参数会遮蔽同名全局 ⇒ 插件里的 fetch 打到 mock 上，
 *    **绝不会**真的去连 127.0.0.1:4771（测试里不允许真网络）。
 */
async function runPlugin(figma, code = CODE, fetchImpl = refuseFetch) {
  const logs = [];
  const origLog = console.log;
  const closedBefore = figma.__log.closed.length;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await new AsyncFunction('figma', 'fetch', code)(figma, fetchImpl);
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
  return { snapshot, log: figma.__log, logs };
}

/** 默认 fetch：模拟「本机没开接收器」⇒ 连接被拒（最常见的降级起点）。 */
async function refuseFetch() {
  throw new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:4771');
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
    assert.equal(
      figma.fileKey,
      undefined,
      '⚠️ mock 失真：公开插件拿不到 figma.fileKey（官方文档）⇒ mock 必须忠实还原 undefined',
    );

    assert.equal(log.loadedPages, 1, '⚠️ dynamic-page 模式必须先 loadAllPagesAsync');
    assert.equal(log.clipboard.length, 1, '快照 JSON 应写进剪贴板');
    const fromClipboard = JSON.parse(log.clipboard[0]);
    assert.equal(fromClipboard.components.length, 1);
    assert.equal(fromClipboard.screens.length, 1);
  });

  it('采集: **公开插件 + dynamic-page** ⇒ fileKey 仍要有值（两个真实前提）', async () => {
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [componentSet('1:1', 'Hologram/Cover', CONTRACT)],
    };
    const figma = mockFigma({ pages: [compPage] });
    // ⚠️ mock 必须**忠实还原真实 Figma 的两个前提**（缺一个都会掩盖 bug）：
    //    ① dynamic-page：currentPage 初始为 null
    //       （之前 mock 偷懒设成 pages[0] ⇒ 掩盖了「fileKey 取成 null」的 bug，
    //        2026-10-30 在真实 Figma 里才暴露：接收器拒收「fileKey 缺失」）。
    //    ② 公开插件：figma.fileKey 恒为 undefined
    //       （官方文档：只有私有插件 + Figma 自家资源有；
    //        enablePrivatePluginApi 对本地开发插件无效 ⇒ fileKey 只能自带）。
    assert.equal(figma.currentPage, null, '⚠️ mock 失真 ⇒ 这条回归测试就白写了');
    assert.equal(figma.fileKey, undefined, '⚠️ mock 失真 ⇒ 公开插件拿不到 fileKey');

    const { snapshot } = await runPlugin(figma);
    assert.equal(
      snapshot.fileKey,
      'FtbRZXvzlCp4Sq9e322cQQ',
      '⚠️ fileKey 不能依赖 figma.currentPage / figma.fileKey ⇒ 必须自带常量',
    );
  });

  it('采集: 通知里带**构建号**（判断 Figma 跑的是不是磁盘上这份）', async () => {
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [componentSet('1:1', 'Hologram/Cover', CONTRACT)],
    };
    const figma = mockFigma({ pages: [compPage] });
    const { log } = await runPlugin(figma);

    const notice = log.notified.join('\n');
    const m = /build ([0-9a-f]{8})/.exec(notice);
    assert.ok(m, '通知应带 8 位构建号');
    assert.notEqual(m[1], '__BUILD__', '⚠️ 占位符没被替换 ⇒ 生成器没注入构建号');

    // ⚠️ 必须与**磁盘上产物**的构建号一致 ⇒ 通知里的号能唯一标识「跑的是哪份代码」。
    //    （Figma 桌面端会缓存已导入的开发插件 ⇒ 不带这个号就只能靠猜。）
    const onDisk = /const PLUGIN_BUILD = '([0-9a-f]{8})'/.exec(CODE);
    assert.ok(onDisk, '产物里应有构建号');
    assert.equal(m[1], onDisk[1], '通知里的构建号应与产物一致');
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

  it('采集: 接收器 + 剪贴板都失败 ⇒ 不抛异常，JSON 仍进 console，通知里说清', async () => {
    const compPage = {
      type: 'PAGE',
      name: '02 · Components',
      children: [componentSet('1:1', 'Hologram/Cover', CONTRACT)],
    };
    const figma = mockFigma({ pages: [compPage], clipboardFails: true });
    const { snapshot, log } = await runPlugin(figma);

    assert.ok(snapshot, '两条路都挂了也要产出快照');
    assert.equal(log.clipboard.length, 0);
    assert.ok(log.notified.length >= 1);
    const notice = log.notified.join('\n');
    assert.match(notice, /剪贴板/, '通知要点明剪贴板失败');
    assert.match(notice, /落盘/, '通知要点明落盘也失败（别让人以为文件已经写好了）');
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

// ════════════════════════════════════════════════════════════════
// 4. 落盘通道：POST 本机接收器（主路径）→ 剪贴板 → console（兜底）
//
//    为什么单独测：实测 `figma.clipboard.writeText` 在 Figma 桌面 App 里
//    **直接失败** ⇒ 落盘链路断在最后一步。改走官方文档支持的
//    `devAllowedDomains`（本地开发服务器）⇒ 插件 POST，接收器落盘。
//    ⚠️ 这三条路是**降级链**，通知必须说清走通了哪条 ——
//       否则用户看到「失败」却不知道文件到底写没写。
// ════════════════════════════════════════════════════════════════

describe('AETHER 快照采集插件 · 落盘通道（mock fetch）', () => {
  const compPage = {
    type: 'PAGE',
    name: '02 · Components',
    children: [componentSet('1:1', 'Hologram/Cover', CONTRACT)],
  };

  it('接收器 POST 成功 ⇒ 通知报「已落盘」，且**不再走剪贴板**', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, target: 'x' }) };
    };
    const figma = mockFigma({ pages: [compPage] });
    const { snapshot, log } = await runPlugin(figma, CODE, fetchImpl);

    assert.equal(calls.length, 1, '成功时只该请求一次');
    assert.equal(
      calls[0].url,
      'http://localhost:4771/snapshot',
      '⚠️ 只能用 localhost：Figma 的 manifest 校验器拒绝 IP 形式',
    );
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(
      calls[0].init.headers['Content-Type'],
      'text/plain;charset=utf-8',
      '⚠️ 必须 text/plain ⇒ 不触发 CORS 预检（application/json 会预检）',
    );

    // POST 出去的 body 必须**就是**那份快照（不是别的什么）
    const posted = JSON.parse(calls[0].init.body);
    assert.equal(posted.components.length, snapshot.components.length);
    assert.equal(posted.screens.length, snapshot.screens.length);
    assert.ok(posted.capturedAt, 'POST 的 body 应带 capturedAt');
    assert.equal(posted.counts.components, posted.components.length, 'counts 必须自洽');

    assert.equal(log.clipboard.length, 0, '落盘成功就不该再折腾剪贴板');
    assert.match(log.notified.join('\n'), /已落盘/, '通知要点明已落盘');
    assert.ok(
      !/剪贴板/.test(log.notified.join('\n')),
      '走通主路径时通知里不该再提剪贴板（免得人以为还要手动粘）',
    );
  });

  it('插件只请求 **localhost** 一个地址（IP 形式会被 Figma 的 manifest 拒绝）', async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const figma = mockFigma({ pages: [compPage] });
    const { log } = await runPlugin(figma, CODE, fetchImpl);

    assert.deepEqual(seen, ['http://localhost:4771/snapshot']);
    assert.ok(
      !seen.some((u) => /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(u)),
      '⚠️ 插件不许请求 IP 形式：Figma 的 manifest 校验器会拒绝加载插件',
    );
    assert.match(log.notified.join('\n'), /已落盘/);
  });

  it('接收器返回非 2xx ⇒ 当失败处理（不是「成功」）', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const figma = mockFigma({ pages: [compPage] });
    const { log } = await runPlugin(figma, CODE, fetchImpl);

    assert.equal(log.clipboard.length, 1, 'HTTP 500 ⇒ 应降级到剪贴板');
    assert.ok(!/已落盘/.test(log.notified.join('\n')), '⚠️ 非 2xx 不许说「已落盘」');
  });

  it('接收器 + 剪贴板都失败 ⇒ 通知说清两条路都挂了，JSON 仍在 console', async () => {
    const figma = mockFigma({ pages: [compPage], clipboardFails: true });
    const { snapshot, log, logs } = await runPlugin(figma, CODE, refuseFetch);

    assert.ok(snapshot, '两条路都挂了也要产出快照（console 兜底）');
    const notice = log.notified.join('\n');
    assert.match(notice, /落盘/);
    assert.match(notice, /剪贴板/);
    assert.match(notice, /console/, '⚠️ 必须告诉人还能从 console 捞');
    assert.ok(
      logs.some((l) => l.startsWith(PREFIX) && l.includes('"components"')),
      'console 里必须还有完整 JSON',
    );
  });

  it('接收器抛异常（沙箱里 fetch 直接炸）⇒ 插件不崩，降级到剪贴板', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch is not a function');
    };
    const figma = mockFigma({ pages: [compPage] });
    const { snapshot, log } = await runPlugin(figma, CODE, fetchImpl);

    assert.ok(snapshot, 'fetch 炸了也要产出快照');
    assert.equal(log.clipboard.length, 1, '应降级到剪贴板');
    assert.equal(log.closed.length, 1, '插件必须正常收尾');
  });
});
