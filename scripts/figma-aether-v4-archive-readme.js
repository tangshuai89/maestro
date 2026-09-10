// ─────────────────────────────────────────────────────────────
// AETHER v4 — 99 · Archive 顶部加 Archive README frame
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：99 · Archive
// 范围：在 Archive 页顶部加一个红色 outline + 警告文字的 frame，
//       说明"此页是 AETHER THEATER A/B/C 三版探索稿（v4 视觉基准），只读不扩展"
//       + 指向 03 · Screens 的链接
// 注（2026-09-10 实跑核实）：99 · Archive 里是 AETHER THEATER 宇宙剧场 A/B/C，
//       不是 v3 Monster Beats——README 文案按实际内容写
// D2 文档收尾的执行段（独立于 v4 主流程 13 段）
// 配套：scripts/figma-v4-d2-command.md（执行手册）
//        scripts/figma-v4-smoke-d2.mjs（mock 冒烟）
// ─────────────────────────────────────────────────────────────

// ============ SEG1: Archive README ============
const SEG1 = `
// 非当前页的 children 可能只部分水合（读不到已有子节点）——用 getNodeByIdAsync 强制水合，
// 否则下面的幂等清理会漏掉已存在的 Archive README，重跑就变成叠两份
const pageMeta = figma.root.children.find(p => p.type === 'PAGE' && p.name === '99 · Archive');
const page = pageMeta ? await figma.getNodeByIdAsync(pageMeta.id) : figma.currentPage;
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Bold' });

const varColor = (name) => {
  const vv = figma.variables.getLocalVariables().find(x => x.name === name);
  if (!vv) return { color: { r: 1, g: 0, b: 1, a: 1 }, boundVariables: null };
  let raw = null, cur = vv, depth = 0;
  while (cur && depth < 8) {
    const col = figma.variables.getLocalVariableCollections().find(c => c.id === cur.variableCollectionId);
    raw = cur.valuesByMode[col ? col.modes[0].modeId : null];
    if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'VARIABLE_ALIAS') { cur = figma.variables.getLocalVariables().find(x => x.id === raw.id); depth++; }
    else break;
  }
  const c = raw && typeof raw === 'object' && 'r' in raw && 'g' in raw && 'b' in raw ? raw : { r: 1, g: 0, b: 1, a: 1 };
  return { color: { r: c.r, g: c.g, b: c.b, a: 'a' in c ? c.a : 1 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: vv.id } } };
};
const varFill = (name) => { const c = varColor(name); return c.boundVariables ? { type: 'SOLID', ...c } : { type: 'SOLID', color: c.color }; };
const TEXT_MAIN = varFill('Color/semantic/text-main');
const TEXT_DIM = varFill('Color/semantic/text-dim');
const TEXT_MUTED = varFill('Color/semantic/text-muted');
const ACCENT = varFill('Color/semantic/accent');
const ERROR_RED = varFill('Color/semantic/status-error');

// JetBrains Mono 没有 'Semi Bold'（只有 Bold / Medium / ExtraBold）——按字族取各自的加粗名
const BOLD_STYLE = { 'Inter': 'Semi Bold', 'JetBrains Mono': 'Bold' };
function textNode(name, str, size, color, mono = false, bold = false, ls) {
  const t = figma.createText();
  const family = mono ? 'JetBrains Mono' : 'Inter';
  t.name = name; t.characters = str; t.fontSize = size;
  t.fontName = { family, style: bold ? BOLD_STYLE[family] : 'Regular' };
  t.fills = [color];
  if (ls !== undefined) t.letterSpacing = { value: ls, unit: 'PIXELS' };
  return t;
}

// 幂等：先清掉旧的
for (const n of page.children.filter(x => x.name === 'Archive README')) n.remove();

const readme = figma.createFrame();
readme.name = 'Archive README';
readme.resize(1440, 280);
readme.x = 1540; readme.y = -320; // 对齐 A 稿（x=1540）正上方；A/B/C 三稿都在 y=0
readme.layoutMode = 'VERTICAL';
readme.itemSpacing = 16;
readme.primaryAxisSizingMode = 'FIXED';
readme.counterAxisSizingMode = 'FIXED';
readme.paddingTop = 32; readme.paddingBottom = 32;
readme.paddingLeft = 40; readme.paddingRight = 40;
readme.fills = [varFill('Color/primitive/bg-top')]; // 不能留空：Archive 页画布是浅灰，暗色主题文字会看不见
// 红色 outline（4px）+ cornerRadius 12
readme.strokes = [ERROR_RED];
readme.strokeWeight = 4;
readme.dashPattern = [12, 8];
readme.cornerRadius = 12;
const archiveMeta = \`---
ARCHIVE_README:
  status: BASELINE（只读参考，非待开发）
  content: AETHER THEATER 宇宙剧场 A / B / C 三版探索稿（v4）
  role: 03 · Screens 的视觉基准来源；scripts/figma-aether-v4-screens.js 照 A 稿画
  rule: 不在此页新增 / 修改 / 重命名任何 frame
  replacement: 新屏一律画在 03 · Screens（v4-ABC 12 屏 + D1 6 屏）
  converged: 2026-09-10（D2）
---\`;
page.appendChild(readme);
// FRAME 无 description 属性（仅 COMPONENT/COMPONENT_SET 有）——元数据存为隐藏 TEXT 子节点，REST 走 characters
const metaNode = figma.createText();
metaNode.name = 'ARCHIVE_README';
metaNode.fontName = { family: 'Inter', style: 'Regular' };
metaNode.characters = archiveMeta;
metaNode.fills = [];
metaNode.visible = false;
readme.appendChild(metaNode);

// title 行（warning icon + 标题）
const titleRow = figma.createFrame();
titleRow.name = 'title-row';
titleRow.layoutMode = 'HORIZONTAL';
titleRow.itemSpacing = 12;
titleRow.counterAxisAlignItems = 'CENTER';
titleRow.primaryAxisSizingMode = 'AUTO';
titleRow.counterAxisSizingMode = 'AUTO';
titleRow.fills = [];
readme.appendChild(titleRow);
titleRow.appendChild(textNode('icon', '⚠', 32, ERROR_RED, false, true));
titleRow.appendChild(textNode('title', 'BASELINE — DO NOT EXTEND', 24, ERROR_RED, false, true, 1));
titleRow.appendChild(textNode('divider', '//', 18, TEXT_MUTED, true, false, 1));
titleRow.appendChild(textNode('subtitle', 'AETHER THEATER 探索稿 A / B / C', 18, TEXT_DIM));

// body（说明）
const body = figma.createFrame();
body.name = 'body';
body.layoutMode = 'VERTICAL';
body.itemSpacing = 8;
body.primaryAxisSizingMode = 'AUTO';
body.counterAxisSizingMode = 'FIXED';
body.resize(1360, 100);
body.fills = [];
readme.appendChild(body);
body.layoutSizingHorizontal = 'FILL';
body.appendChild(textNode('paragraph-1', '此页保留 v4 剧场稿的三版探索（宇宙剧场 A / B / C），作为 03 · Screens 的视觉基准来源——scripts/figma-aether-v4-screens.js 就是照 A 稿画的。', 14, TEXT_DIM));
body.appendChild(textNode('paragraph-2', '只读参考：不在此页新增 / 修改 / 重命名任何 frame。改动这三张会让 03 · Screens 失去可对照的基准。', 14, TEXT_DIM));

// 链接行（指向 03 · Screens）
const linkRow = figma.createFrame();
linkRow.name = 'link-row';
linkRow.layoutMode = 'HORIZONTAL';
linkRow.itemSpacing = 8;
linkRow.counterAxisAlignItems = 'CENTER';
linkRow.primaryAxisSizingMode = 'AUTO';
linkRow.counterAxisSizingMode = 'AUTO';
linkRow.fills = [];
readme.appendChild(linkRow);
linkRow.appendChild(textNode('arrow', '→', 14, ACCENT, true, true));
linkRow.appendChild(textNode('link-label', '新屏一律画在', 12, TEXT_MUTED));
linkRow.appendChild(textNode('link-target', '03 · Screens（v4-ABC 12 屏 + D1 6 屏）', 12, ACCENT, true, true));

return { createdNodeIds: [readme.id], frame: 'Archive README' };
`;

module.exports = { SEG1 };
