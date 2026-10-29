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

const SEG1 = `
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
const contractOf = (node) => {
  const raw = carrierOf(node);
  const m = raw.match(/---([\\s\\S]*?)---/);
  return m ? m[1].trim() : '';
};

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
const out = { fileKey: figma.currentPage && figma.fileKey ? figma.fileKey : null, pages: [], components: [], screens: [], motion: null };

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
    const m = carrier.match(/---([\\s\\S]*?)---/);
    let motion = null;
    if (m) {
      try {
        const parsed = JSON.parse(m[1].trim());
        motion = { spec: parsed.spec || [], version: parsed.MOTION_SPEC || null, rawLength: m[1].trim().length };
      } catch (e) {
        motion = { spec: [], version: null, parseError: String(e && e.message ? e.message : e), rawLength: m[1].trim().length };
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

module.exports = { SEG1 };
