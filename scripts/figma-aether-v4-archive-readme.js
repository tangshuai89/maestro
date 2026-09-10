// ─────────────────────────────────────────────────────────────
// AETHER v4 — 99 · Archive 顶部加 Archive README frame
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：99 · Archive
// 范围：在 Archive 页顶部加一个红色 outline + 警告文字的 frame，
//       说明"v3 Monster Beats 视觉稿作为设计基准保留，不再扩展"
//       + 指向 03 · Screens AETHER 剧场稿的链接
// D2 文档收尾的执行段（独立于 v4 主流程 13 段）
// 配套：scripts/figma-v4-d2-command.md（执行手册）
//        scripts/figma-v4-smoke-d2.mjs（mock 冒烟）
// ─────────────────────────────────────────────────────────────

// ============ SEG1: Archive README ============
const SEG1 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '99 · Archive') || figma.currentPage;
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

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

function textNode(name, str, size, color, mono = false, bold = false, ls) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  t.fontName = { family: mono ? 'JetBrains Mono' : 'Inter', style: bold ? 'Semi Bold' : 'Regular' };
  t.fills = [color];
  if (ls !== undefined) t.letterSpacing = { value: ls, unit: 'PIXELS' };
  return t;
}

// 幂等：先清掉旧的
const old = page.children.find(n => n.name === 'Archive README');
if (old) old.remove();

const readme = figma.createFrame();
readme.name = 'Archive README';
readme.resize(1440, 280);
readme.x = 0; readme.y = -320; // 顶部（其他 v3 frame 从 y=0 开始；放最上面）
readme.layoutMode = 'VERTICAL';
readme.itemSpacing = 16;
readme.primaryAxisSizingMode = 'FIXED';
readme.counterAxisSizingMode = 'FIXED';
readme.paddingTop = 32; readme.paddingBottom = 32;
readme.paddingLeft = 40; readme.paddingRight = 40;
readme.fills = [];
// 红色 outline（4px）+ cornerRadius 12
readme.strokes = [ERROR_RED];
readme.strokeWeight = 4;
readme.dashPattern = [12, 8];
readme.cornerRadius = 12;
readme.description = \`---
ARCHIVE_README:
  status: ARCHIVED
  visual: v3 Monster Beats Pokémon 风格
  status_note: 设计基准保留，不再开发新屏
  replacement: 03 · Screens · AETHER THEATER 剧场稿（v4）
  converged: 2026-09-10（D2）
---\`;
page.appendChild(readme);

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
titleRow.appendChild(textNode('title', 'ARCHIVED — DO NOT EXTEND', 24, ERROR_RED, false, true, 1));
titleRow.appendChild(textNode('divider', '//', 18, TEXT_MUTED, true, false, 1));
titleRow.appendChild(textNode('subtitle', 'v3 Monster Beats Pokémon 视觉', 18, TEXT_DIM));

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
body.appendChild(textNode('paragraph-1', '此页保留 v3 Monster Beats 视觉稿作为 AETHER 剧场稿的设计演进对照基准。', 14, TEXT_DIM));
body.appendChild(textNode('paragraph-2', '任何新增/修改/重命名此页内容（包括 mb-* 类、_monster-beats.scss、MonsterBeatsView 节点）都视为错误改动。', 14, TEXT_DIM));

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
linkRow.appendChild(textNode('link-label', '新视觉稿在', 12, TEXT_MUTED, true));
linkRow.appendChild(textNode('link-target', '03 · Screens · AETHER THEATER 剧场稿（v4-ABC + D1 6 屏）', 12, ACCENT, true, true));

return { createdNodeIds: [readme.id], frame: 'Archive README' };
`;

module.exports = { SEG1 };
