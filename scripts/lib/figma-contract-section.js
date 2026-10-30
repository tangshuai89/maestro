// ─────────────────────────────────────────────────────────────
// AETHER — AI_CONTRACT 契约段：**唯一**的实现
//
// 为什么是 CommonJS（.js 而不是 .mjs）：
//   三处都要用同一份实现，而它们的运行环境不同：
//     ① 采集段 scripts/figma-snapshot-seg.js      —— **CommonJS**（要复制粘贴进 Figma 沙箱）
//     ② 生成器 scripts/lib/figma-contract-payload.mjs —— ESM
//     ③ 写入插件 scripts/figma-write-plugin/      —— Figma 沙箱（纯 JS，无 import）
//   ⇒ .js 让 ①③ 能直接 require/内联；② 用 ESM 的 default import 拿（Node 双向兼容，已实测）。
//   （与仓库惯例一致：scripts/*.js = CommonJS，ESM 用 .mjs。）
//
// ⚠️ **比对层 scripts/lib/figma-snapshot.mjs 不用这份实现**（别再往里加）：
//   它消费的是采集段**已经提取好的契约原文**（snapshot 的 `contract` 字段），
//   只做 YAML 浅解析，**根本不做 fence 提取** ⇒ 没有口径可漂移。
//   （本文件头早期版本把②写成了比对层，属文档漂移，2026-10-29 已更正。）
//
// 为什么必须共用一份（三处以前各写一份 ⇒ 静默漏写）：
//   · 采集段：从载体文本里按 `/---([\s\S]*?)---/` 提取契约段
//   · 插件：判断「这个节点有没有契约段」+ 把契约段合进载体
//   · 生成器：判断「这个节点是不是已经写过契约」+ 生成载体文本
//   三处口径一旦不一致，就会出现**插件以为自己写过了（跳过）而采集段提不出来** ⇒
//   设计稿上永远没有契约段，而 `figma:diff` 那边现场看不出任何异常（典型的假绿）。
//
// 载体规则（Figma Plugin API 的硬事实）：
//   COMPONENT / COMPONENT_SET → 有 .description
//   FRAME                    → **没有** .description（只有 PublishableMixin 有）
//                             → 契约存为 frame 下一个隐藏 TEXT 子节点
//
// ⚠️ 本文件是**纯函数**，不碰 fs / 不 spawn ⇒ 可离线单测（反向验证）。
//
// 关联：specs/figma-diff/spec.md §10.4.1 · scripts/figma-contract-payload.mjs
//       · scripts/figma-write-plugin/
// ─────────────────────────────────────────────────────────────

/** 契约段在载体里的包裹标记。 */
const SECTION_FENCE = '---';

/** 契约段的段名（FRAME 的隐藏 TEXT 子节点也用这个名字）。 */
const CONTRACT_SECTION_NAME = 'AI_CONTRACT';

/**
 * 从载体文本里提取 AI_CONTRACT 段。
 *
 * ⚠️ **提取口径 = 有没有 `---` 包裹**，不是「文本里有没有 AI_CONTRACT 字样」。
 *    两者不一样：散文里顺口提一句「AI_CONTRACT:」不该被当成有契约段。
 *    而只有 `---` 包裹才算 —— 采集段（沙箱里没有 YAML parser）就是这么提的，
 *    写入插件必须用**同一个**口径，否则会出现「插件以为写过了、采集段提不出」。
 *
 * @param {string} raw 载体原文（description / TEXT 子节点的 characters）
 * @returns {string} 契约段正文（不含 `---` 包裹）；没有则空串
 */
function extractContractSection(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/---([\s\S]*?)---/);
  return m ? m[1].trim() : '';
}

/**
 * 载体里**有没有**契约段。
 *
 * 判据 = 能提取出非空的段。
 * ⚠️ 不要写成 `raw.includes('AI_CONTRACT:')` —— 那是散文提及，不是契约段。
 */
function hasContractSection(raw) {
  return extractContractSection(raw).length > 0;
}

/**
 * 把契约段**合进**已有载体文本，不覆盖。
 *
 * ⚠️ **这是修 bug 的核心**：真实快照里 21 个组件**已有人工写的散文 description**
 *    （例：「Holographic cover area 480×500: orbit ring + 12 ticks…」）。
 *    直接 `node.description = text` 会**把那些设计文档抹掉** —— 不可逆。
 *
 * 契约段放**前面**、散文放**后面**：
 *   · 采集段用 `/---([\s\S]*?)---/` 提取 —— 非贪婪，**取第一对 `---`**。
 *     契约段在前 ⇒ 提取到的就是契约段；散文在前 ⇒ 散文里若出现 `---` 会提错。
 *   · 与既有 10 份人工契约的形态一致（契约段在 description 开头）。
 *
 * @param {string} raw       载体现有文本
 * @param {string} section   契约段正文（**不含** `---` 包裹）
 * @returns {string} 合并后的载体文本
 */
function mergeContractSection(raw, section) {
  const existing = typeof raw === 'string' ? raw.trim() : '';
  const body = typeof section === 'string' ? section.trim() : '';
  if (!body) return existing;
  const block = `${SECTION_FENCE}\n${body}\n${SECTION_FENCE}`;
  if (!existing) return block;
  // 已经有契约段了 ⇒ 原样返回（不叠加、不覆盖）
  if (hasContractSection(existing)) return existing;
  return `${block}\n\n${existing}`;
}

module.exports = {
  SECTION_FENCE,
  CONTRACT_SECTION_NAME,
  extractContractSection,
  hasContractSection,
  mergeContractSection,
};
