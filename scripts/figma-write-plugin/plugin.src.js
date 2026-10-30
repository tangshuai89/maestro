// ─────────────────────────────────────────────────────────────
// AETHER — AI_CONTRACT 写入插件（源码；code.js 是它的生成物）
//
// 干什么：把 `figma-contract-payload.json` 里的草案契约段写进当前打开的
//        Figma 文件 —— COMPONENT(SET) 写 .description，FRAME 写隐藏 TEXT 子节点。
//
// 为什么是「本地开发插件」而不是 MCP 写工具（2026-10-29 实测 + 查官方文档）：
//   · 官方：「Creating a development plugin is supported on any plan」
//   · 插件的写入权限 = **你自己对该文件的编辑权**，不看席位类型、不看套餐墙
//   · 不吃 MCP 配额（200/天那个计数器管的是 MCP 工具调用）
//   ⇒ 不必等席位升级，也不必把文件搬进教育团队
//
// 为什么 payload 内联（而不是读文件 / 起本地服务器）：
//   插件运行时的 API 表面越小 ⇒ 踩坑面越小。内联 ⇒ **零 IO、零 UI、零网络**。
//   代价是 payload 变了要重新生成 code.js —— 一条命令的事。
//
// ⚠️ 运行前提（都是实测踩过的坑）：
//   ① 必须用 **Figma 桌面 App**（浏览器版读不到本地 manifest.json）
//   ② 必须处于 **Design 模式**，不是 Dev Mode（Dev Mode 下插件只读；
//      `Shift+D` 是双向切换开关，不是单向入口）
//   ③ 目标文件必须是 **editable**（不是 view-only）
//   ④ 改 TEXT 节点内容前必须 **loadFontAsync**
//
// 幂等：只写「当前还没有契约段」的节点 ⇒ 重复跑不会重复覆盖、不会叠加。
//
// 关联：scripts/figma-contract-payload.mjs（生成器）· scripts/lib/figma-contract-payload.mjs
//       · specs/figma-diff/spec.md §10
// ─────────────────────────────────────────────────────────────

// ⚠️ 下面这行由生成器替换（不要手改 code.js，要改 plugin.src.js）
const PAYLOAD = __PAYLOAD__;

// ⚠️ 下面这段由生成器替换 —— 「契约段提取」的唯一实现（与采集段/生成器同源）。
//    以前插件自己写了一份 `includes('AI_CONTRACT:')` 的判断，
//    与采集段的 `---…---` 提取**口径不一致** ⇒ 静默漏写。
__CONTRACT_SECTION__;

const CARRIER_TEXT_NAME = 'AI_CONTRACT';

/** 载体原文（description 优先；FRAME 走隐藏 TEXT 子节点）。 */
function carrierRawOf(node) {
  try {
    if (typeof node.description === 'string' && node.description) return node.description;
  } catch (e) {
    /* 有些节点类型没有 description 字段 */
  }
  try {
    for (const c of node.children ?? []) {
      if (c.type === 'TEXT' && c.name === CARRIER_TEXT_NAME) {
        return String(c.characters ?? '');
      }
    }
  } catch (e) {
    /* 某些节点没有 children */
  }
  return '';
}

/** 载体里是否已经有契约段 —— 幂等守卫（第二道；第一道在生成器里）。 */
function hasContract(node) {
  return hasContractSection(carrierRawOf(node));
}

/**
 * 找一个能用的字体。
 *
 * 为什么需要：设置 TEXT 节点的 characters 前必须先 loadFontAsync
 * （官方：「Calling this function is necessary to modify any property of a text node
 * that may cause the rendered text to change, including .characters」）。
 *
 * 加载的字体必须**在 Figma 编辑器里已可用**（官方：loadFontAsync 不会从网络下载字体）。
 * 而 manifest 文档明确写了：「we preload the Inter font for use in plugins」
 * ⇒ Inter 这条路几乎必然成功，先试它。
 *
 * 兜底用 `listAvailableFontsAsync()`（**不用** `figma.root.findAll`）：
 *   · findAll 在 dynamic-page 模式下只遍历**当前页** ⇒ 找不到别页的字体；
 *   · findAll 遍历整个文件很慢（大文件上尤其明显）；
 *   · listAvailableFontsAsync 直接问编辑器「有哪些字体可用」，不遍历节点。
 */
async function pickFont() {
  try {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    return { family: 'Inter', style: 'Regular' };
  } catch (e) {
    /* 预载的 Inter 不可用（少见）⇒ 走兜底 */
  }
  try {
    const available = await figma.listAvailableFontsAsync();
    for (const f of available ?? []) {
      const name = f?.fontName;
      if (!name || name.family === 'Inter') continue;
      try {
        await figma.loadFontAsync(name);
        return name;
      } catch (e) {
        /* 换下一个 */
      }
    }
  } catch (e) {
    /* listAvailableFontsAsync 不可用 ⇒ 无兜底 */
  }
  return null;
}

async function writeDescription(node, text) {
  if (!('description' in node)) {
    // COMPONENT / COMPONENT_SET 有 description；其它类型没有
    throw new Error(`节点类型 ${node.type} 没有 description 字段`);
  }
  // ⚠️ **合并，不覆盖**：真实快照里多数目标组件已有人工写的散文 description
  //    （例：「Holographic cover area 480×500: orbit ring + 12 ticks…」）。
  //    直接赋值会把那些设计文档抹掉 ⇒ 不可逆的数据丢失。
  node.description = mergeContractSection(node.description, extractContractSection(text));
}

async function writeTextChild(node, text, font) {
  let holder = null;
  for (const c of node.children ?? []) {
    if (c.type === 'TEXT' && c.name === CARRIER_TEXT_NAME) {
      holder = c;
      break;
    }
  }
  if (!holder) {
    if (!font) throw new Error('找不到可加载的字体，无法新建 TEXT 节点');
    holder = figma.createText();
    holder.name = CARRIER_TEXT_NAME;
    // ⚠️ **必须显式设 fontName**（且在设 characters 之前）：
    //    `figma.createText()` 建出来的节点用的是**文档默认字体**，
    //    而我们加载的 `font` 可能是兜底找来的**别的**字体
    //    ⇒ 不对齐的话，设置 `.characters` 会抛
    //    「Cannot set text without loading font」（官方：改 characters 前必须先加载该节点的字体）。
    //    `font` 已在 pickFont() 里 loadFontAsync 过 ⇒ 这里设 fontName 是允许的。
    holder.fontName = font;
    node.appendChild(holder);
    // 放回父节点的原点，宽度给 0（隐藏节点不需要布局）
    holder.x = node.x ?? 0;
    holder.y = node.y ?? 0;
  } else {
    // ⚠️ **已存在的 TEXT 节点**：它自己的字体可能与 `font` 不同
    //    ⇒ 改 `.characters` 前必须先加载**它自己的**字体
    //    （官方：改 characters 前必须先加载该节点的字体，否则抛错）。
    //    `fontName === figma.mixed`（混排）时无法逐段加载 ⇒ 跳过（不动这个节点）。
    const own = holder.fontName;
    if (own && own !== figma.mixed) {
      try {
        await figma.loadFontAsync(own);
      } catch (e) {
        throw new Error(`载体 TEXT 节点的字体加载失败：${own.family} ${own.style}`);
      }
    }
  }
  // ⚠️ 同样**合并，不覆盖**：TEXT 子节点里可能已有人写的说明文字。
  holder.characters = mergeContractSection(holder.characters, extractContractSection(text));
  holder.visible = false; // 隐藏载体：采集段按名字找，不看 visible
  return holder;
}

async function main() {
  const report = { applied: [], skipped: [], failed: [] };

  // 目标节点在别的页上 ⇒ 必须先载入所有页。
  // ⚠️ manifest 里 `documentAccess: dynamic-page` ⇒ Figma **不会**在插件启动时装载全部页面；
  //    官方文档明确：dynamic-page 模式下访问全文件节点（findAll / findOne / 跨页 getNodeByIdAsync）
  //    前必须先 `await figma.loadAllPagesAsync()`，否则读未加载页的子节点会**抛错**。
  try {
    await figma.loadAllPagesAsync();
  } catch (e) {
    report.failed.push({ name: '(loadAllPagesAsync)', error: String(e) });
  }

  const font = await pickFont();
  if (!font) {
    report.failed.push({ name: '(font)', error: '文档里没有任何可加载的字体，无法写 TEXT 节点' });
  }

  for (const w of PAYLOAD.writes ?? []) {
    try {
      // ⚠️ **用 getNodeByIdAsync（不是已废弃的同步 getNodeById）**。
      //    官方文档：同步版已废弃；dynamic-page 模式下未加载的页读子节点会抛错。
      //    （前面已 await loadAllPagesAsync ⇒ 全部页已加载 ⇒ 异步版能取到所有页的节点。）
      const node = await figma.getNodeByIdAsync(w.nodeId);
      if (!node) {
        report.skipped.push({ name: w.name, nodeId: w.nodeId, reason: 'node-not-found' });
        continue;
      }
      if (hasContract(node)) {
        report.skipped.push({ name: w.name, nodeId: w.nodeId, reason: 'already-has-contract' });
        continue;
      }
      if (w.carrier === 'description') {
        await writeDescription(node, w.carrierText);
      } else if (w.carrier === 'text-child') {
        await writeTextChild(node, w.carrierText, font);
      } else {
        report.skipped.push({
          name: w.name,
          nodeId: w.nodeId,
          reason: `unknown-carrier:${w.carrier}`,
        });
        continue;
      }
      report.applied.push({ name: w.name, nodeId: w.nodeId, carrier: w.carrier });
    } catch (e) {
      report.failed.push({
        name: w.name,
        nodeId: w.nodeId,
        error: String(e && e.message ? e.message : e),
      });
    }
  }

  const summary =
    `AETHER 契约写入：应用 ${report.applied.length} · 跳过 ${report.skipped.length} · 失败 ${report.failed.length}` +
    `（共 ${(PAYLOAD.writes ?? []).length} 条待写）`;
  figma.notify(summary);

  // 把完整报告交给调用方（开发模式下会进 console）
  console.log('[aether-contract-writer] ' + JSON.stringify(report));

  // ⚠️ closePlugin 只接受**字符串**（官方签名 `closePlugin(message?: string)`）。
  //    传对象会被忽略 ⇒ 调用方拿不到任何结果。⇒ 传摘要字符串。
  //    失败项要在摘要里点名 —— 否则用户只知道「失败 3」却不知道是哪 3 个。
  const failedNames = report.failed.map((f) => f.name).join('、');
  figma.closePlugin(failedNames ? `${summary}　失败：${failedNames}` : summary);
}

main().catch((e) => {
  figma.notify(`AETHER 契约写入异常：${String(e && e.message ? e.message : e)}`);
  figma.closePlugin(`AETHER 契约写入异常：${String(e && e.message ? e.message : e)}`);
});
