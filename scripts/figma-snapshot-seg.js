// ─────────────────────────────────────────────────────────────
// AETHER Figma 快照 — 只读 use_figma 段：组件集 / 屏幕 / 动效规格
//
// 为什么需要这个段：仓库侧已有四条「审计腿」，但每条各自要 FIGMA_TOKEN
// （REST 的 variables/local 要 Enterprise `file_variables:read`），
// 且**没有一条能把「设计稿要求前端做什么」汇总成一张清单**。
// 2026-10-29 盘点确认：离线腿只证明「代码 == 提交的 dump 快照」，
// 证明不了「快照 == Figma 现状」—— 快照停在 2026-10-13，之后样式改了 26 次。
//
// 替代路径：Figma MCP 的 `use_figma`（OAuth，**不需要 PAT scope**）。
// 本段纯只读：只遍历节点、只读属性，不创建/修改/删除任何节点。
//
// 用法（在支持 Figma MCP 的 agent 里把下面 SEG1 的代码作为 use_figma 的 code 参数）：
//   fileKey:   FtbRZXvzlCp4Sq9e322cQQ
//   skillNames: resource:figma-use
//   返回: { fileKey, pages, components, screens, motion, counts }
//
// 拿到返回值后（use_figma 没有 fs 权限，必须人工落盘）：
//   1. 把返回值写进 scripts/figma-snapshot.json（保持结构，外层补 capturedAt）
//   2. npm run figma:diff        # 输出差异清单
//   3. 差异清单里「需要改前端代码」那节可直接喂给 coding agent
//
// ── 载体规则（Figma Plugin API 的硬事实）────────────────────────
//   COMPONENT / COMPONENT_SET  → 有 .description
//   FRAME                       → **没有** .description（只有 PublishableMixin 才有）
//                            → 契约存为 frame 下一个隐藏 TEXT 子节点
//   D1 的 6 屏                  → TEXT 子节点名 `AI_CONTRACT`
//   D10 的 MOTION SPEC frame   → TEXT 子节点名 `MOTION_SPEC`
// 见 scripts/figma-aether-v4-audit-d1.mjs §3 与 audit-d10.mjs 的 carrierOf()。
//
// ── 为什么只取 AI_CONTRACT 段而不取 description 全文 ──────────────
// ① 返回体大小：34 个组件 × 全文 description 会到几十 KB，use_figma 返回有上限；
// ② AI 真正需要的是结构化契约那几行，散文部分对它没用；
// ③ 契约段在 description 开头，截断几乎无损（段内做精确提取，不是截断）。
// ─────────────────────────────────────────────────────────────

// ── 共享实现注入 ─────────────────────────────────────────────────
// ⚠️ 「契约段提取」**只有一份实现**（scripts/lib/figma-contract-section.js），
//    采集段 / 写入插件 / 生成器三处共用。
//
//    为什么必须共用：以前采集段手写了一份 `/---([\s\S]*?)---/`，
//    插件那边手写了另一份 `includes('AI_CONTRACT:')` ——
//    **口径不一致 ⇒ 静默漏写**：插件以为「已经写过了」而跳过，
//    采集段却提不出契约段 ⇒ 设计稿上永远没有契约，而 `figma:diff` 现场看不出异常。
//
//    怎么做到「只有一份」而三处都能用（采集段跑在 Figma 沙箱里，不能 import）：
//    ① 本文件是 CommonJS ⇒ require 时把共享实现的**函数源码**拼进 SEG1 字符串；
//    ② 写入插件由 scripts/figma-contract-payload.mjs 同样用 toString() 内联。
//    两边贴的都是同一份源码 ⇒ 不可能漂移。
const {
  SECTION_FENCE,
  extractContractSection,
  hasContractSection,
  mergeContractSection,
} = require('./lib/figma-contract-section.js');

/**
 * 把共享实现转成「可放进 SEG1 模板字符串」的源码。
 *
 * ⚠️ **转义怎么做**（这里踩过一次坑）：
 *    SEG1 是个模板字符串，里面要放含反斜杠的函数源码（正则里的 `\s`）。
 *    · 模板的 `${...}` 插值是**字面替换** —— 插进来的内容**不再被模板解析**；
 *      所以不能指望「模板帮我把 `\\s` 还原成 `\s`」。
 *    · 也不能**预先**把 `\` 翻倍 —— 那样输出里留下 `\\s`，
 *      正则变成「匹配字面反斜杠」⇒ 提取永远失败。
 *    ⇒ 唯一可靠的做法：**先在模板之外拼好最终字符串**（见下），
 *      模板只负责承载不含反斜杠的固定部分。
 *
 * ⇒ 共享实现直接拼进 SEG1（不进模板）：
 *    拼接时把 `\` 换成 `\\` 是给**模板**用的；
 *    但既然最终字符串是拼出来的，就该拼**最终形态**（`\s` 一个反斜杠），
 *    不经过任何模板求值 ⇒ 不用转义。
 */
const SHARED_SECTION_SRC = [
  `const SECTION_FENCE = ${JSON.stringify(SECTION_FENCE)};`,
  extractContractSection.toString(),
  hasContractSection.toString(),
  mergeContractSection.toString(),
].join('\n\n');

const SEG1_PART1 = `
// ── 共享实现（由 scripts/lib/figma-contract-section.js 内联）──
// ⚠️ **不要手改这段**：它来自共享实现，手改会让采集段与写入插件口径漂移（⇒ 静默漏写）。
`;

/** SEG1 尾段（模板字面量，不含共享实现 ⇒ 不涉及转义问题）。 */
const SEG1_PART2 = `
// ── 只读遍历（不创建 / 不修改 / 不删除任何节点）──
const pageByName = (n) => figma.root.children.find((p) => p.name === n);
// 不做 findAllWithCriteriaAsync 特性探测：use_figma 运行时读不存在的属性会直接抛错
// （不返回 undefined），探测本身就会炸。setCurrentPageAsync 之后同步 API 即可用。
const findAll = async (node, types) => node.findAllWithCriteria({ types });

// 契约载体：COMPONENT(SET) 走 .description；FRAME 走隐藏 TEXT 子节点
const carrierOf = (node) =>
  node.description ||
  (node.children || []).find(
    (c) => c.type === 'TEXT' && (c.name === 'AI_CONTRACT' || c.name === 'MOTION_SPEC')
  )?.characters ||
  '';

// 只取 ---...--- 契约段（AI 要的是结构化那几行，不是散文）
//
// ⚠️ **extractContractSection 是共享实现**（scripts/lib/figma-contract-section.js），
//    由本文件 require 时内联进来 —— 采集段跑在 Figma 沙箱里不能 import，
//    但**源码只有一份**（写入插件那边也是同一份 toString() 内联）。
//    以前这里手写了一份提取正则，插件那边又手写了另一份「文本里含 AI_CONTRACT:」的判断，
//    三端口径不一致 ⇒ 插件以为写过了而采集段提不出来 ⇒ 静默漏写。
const contractOf = (node) => extractContractSection(carrierOf(node));

// 语义载体信息：有没有描述 / 有描述但没契约段时给一段预览
//
// 为什么必须带上：比对层的 descriptions 腿要判「这个节点到底有没有语义」。
// 只回传 contract（段内容）的话，"载体为空" 和 "载体有内容但没 ---段" 两种情况
// 会被混成同一种 —— 前者是真缺，后者是"写了散文没写契约"，处置方式不同。
// 预览只在「有载体但没契约段」时才回传（那正是需要人看的少数情况），
// 常规路径只多两个布尔量，返回体几乎不涨。
const semanticOf = (node) => {
  const raw = carrierOf(node);
  const hasDescription = Boolean(raw && raw.trim());
  const hasContract = Boolean(contractOf(node));
  return {
    hasDescription,
    hasContract,
    descriptionPreview:
      hasDescription && !hasContract ? String(raw).trim().slice(0, 120) : '',
  };
};

const pages = figma.root.children.filter((p) => p.type === 'PAGE');
// ⚠️ **fileKey 直接取 figma.fileKey**，不要用「figma.currentPage && figma.fileKey」：
//    本插件的 manifest 是 documentAccess:"dynamic-page" ⇒ **figma.currentPage
//    初始为 null**（必须先 setCurrentPageAsync 才有值）⇒ 那行写法在真实 Figma 里
//    会把 fileKey 取成 **null**（2026-10-30 实测：接收器拒收「fileKey 缺失」）。
//    而 figma.fileKey 是**文档级**属性，跟当前页无关 ⇒ 直接取。
//
// ⚠️ 这段注释在 SEG1_PART2 这个**模板字符串**里 ⇒ 里面**不许出现反引号**，
//    否则模板会被截断（require 时直接抛 "Unexpected identifier"）。
const out = { fileKey: figma.fileKey || null, pages: [], components: [], screens: [], motion: null };

// ── 02 · Components ──────────────────────────────────────────
const compPage = pageByName('02 · Components');
if (compPage) {
  await figma.setCurrentPageAsync(compPage);
  const sets = await findAll(compPage, ['COMPONENT_SET']);
  const loose = await findAll(compPage, ['COMPONENT']);
  const setIds = new Set(sets.map((s) => s.id));

  for (const s of sets) {
    out.components.push({
      name: s.name,
      nodeId: s.id,
      type: 'COMPONENT_SET',
      variants: (s.children || []).map((c) => c.name),
      contract: contractOf(s),
      ...semanticOf(s),
    });
  }
  // 不在 set 里的孤立 COMPONENT（单个变体被拉出来的情况）
  for (const c of loose) {
    if (setIds.has(c.id)) continue;
    const parentIsSet = c.parent && c.parent.type === 'COMPONENT_SET';
    if (parentIsSet) continue;
    out.components.push({
      name: c.name,
      nodeId: c.id,
      type: 'COMPONENT',
      variants: [c.name],
      contract: contractOf(c),
      ...semanticOf(c),
    });
  }
}

// ── 03 · Screens ─────────────────────────────────────────────
const screenPage = pageByName('03 · Screens');
if (screenPage) {
  await figma.setCurrentPageAsync(screenPage);
  const frames = await findAll(screenPage, ['FRAME']);
  for (const f of frames) {
    if (!f.name.startsWith('Screen/')) continue;
    out.screens.push({
      name: f.name,
      nodeId: f.id,
      type: 'FRAME',
      contract: contractOf(f),
      ...semanticOf(f),
    });
  }
}

// ── 04 · Motion · MOTION SPEC ────────────────────────────────
const motionPage = pageByName('04 · Motion');
if (motionPage) {
  await figma.setCurrentPageAsync(motionPage);
  const specFrame = (motionPage.children || []).find((n) => n.name === 'MOTION SPEC');
  if (specFrame) {
    const carrier = carrierOf(specFrame);
    // ⚠️ **也走共享实现**：MOTION SPEC 的 JSON 用的就是同一套「---」包裹约定，
    //    这里若手写第二份正则 ⇒ 约定一改（fence 换了写法）motion 腿会**静默失效**
    //    （提不出 JSON ⇒ spec 空 ⇒ 门禁看不出任何异常）。
    const body = extractContractSection(carrier);
    let motion = null;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        motion = { spec: parsed.spec || [], version: parsed.MOTION_SPEC || null, rawLength: body.length };
      } catch (e) {
        motion = { spec: [], version: null, parseError: String(e && e.message ? e.message : e), rawLength: body.length };
      }
    }
    out.motion = motion || { spec: [], version: null, missing: true };
  }
}

out.pages = pages.map((p) => p.name);
out.counts = {
  components: out.components.length,
  screens: out.screens.length,
  motionEntries: out.motion ? out.motion.spec.length : 0,
};
return JSON.stringify(out);
`;

/**
 * SEG1 最终形态 = 头 + 共享实现 + 尾。
 *
 * ⚠️ **为什么用拼接而不是模板插值**：
 *    模板的 `${...}` 是**字面替换**（插进来的内容不再被模板解析），
 *    而共享实现里有反斜杠（正则的 `\s`）。
 *    · 预先翻倍 ⇒ 输出留下 `\\s` ⇒ 正则匹配字面反斜杠 ⇒ 提取永远失败；
 *    · 不翻倍   ⇒ 插值是字面的，本来就没事 —— 但**这依赖插值不再解析**这一事实，
 *      太脆（改一行就可能踩）。
 *    ⇒ 改成**在模板之外拼好最终字符串**：没有第二层求值 ⇒ 不用转义 ⇒ 不会错。
 */
const SEG1 = SEG1_PART1 + SHARED_SECTION_SRC + SEG1_PART2;

module.exports = { SEG1 };
