// ─────────────────────────────────────────────────────────────
// AETHER THEATER v4-ABC — SVG 线性图标库（P0 补充）
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：02 · Components
// 用途：替换 Unicode 字符图标（⏮⏭▶⏸ 等），供 AI 直接还原前端（lucide 风格内联 SVG）
// 运行：在 foundations 之后、components SEG1-4 之前执行（Button/Icon、Core/Play 依赖）
// 每个图标是独立 COMPONENT（24×24，stroke 绑定 TEXT_MAIN），经 INSTANCE_SWAP 引用
// ─────────────────────────────────────────────────────────────

const SEG1 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
await figma.setCurrentPageAsync(page);

const SOL = (r, g, b, a = 1) => (/** @type {SolidPaint} */ ({ type: 'SOLID', color: { r, g, b, a } }));
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
  const c = raw && typeof raw === 'object' && 'r' in raw && 'g' in raw && 'b' in raw ? (/** @type {RGB | RGBA} */ (raw)) : { r: 1, g: 0, b: 1, a: 1 };
  return { color: { r: c.r, g: c.g, b: c.b, a: 'a' in c ? c.a : 1 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: vv.id } } };
};
const varFill = (name) => { const c = varColor(name); return (/** @type {SolidPaint} */ (c.boundVariables ? { type: 'SOLID', ...c } : { type: 'SOLID', color: c.color })); };
const TEXT_MAIN = varFill('Color/semantic/text-main');
const created = [];

// lucide 风格线性图标（24×24 viewBox，stroke 2，创建后重绑变量）
const ICONS = [
  ['Icon/Prev', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>', '上一首（lucide skip-back）'],
  ['Icon/Next', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>', '下一首（lucide skip-forward）'],
  ['Icon/Play', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>', '播放（lucide play）'],
  ['Icon/Pause', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>', '暂停（lucide pause）'],
  ['Icon/Shuffle', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>', '随机（lucide shuffle）'],
  ['Icon/Repeat', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>', '循环（lucide repeat）'],
  ['Icon/Heart', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>', '收藏（lucide heart）'],
  ['Icon/Search', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', '搜索（lucide search）'],
];
// 清理旧图标组件
page.findAllWithCriteria({ types: ['COMPONENT'] }).filter(n => n.name.startsWith('Icon/')).forEach(n => n.remove());

let x = 40, y = 2300; // 图标放在组件集下方空白区
for (const [name, svg, desc] of ICONS) {
  const comp = figma.createComponent();
  comp.name = name;
  comp.resize(24, 24);
  // auto-layout 容器 + 矢量 FILL：实例 resize 时容器缩放、矢量跟随填满——
  // 绝对定位矢量不随容器缩放（导致图标锚左上不居中），FILL 是正确姿势
  comp.layoutMode = 'HORIZONTAL';
  comp.primaryAxisSizingMode = 'FIXED';
  comp.counterAxisSizingMode = 'FIXED';
  comp.primaryAxisAlignItems = 'CENTER';
  comp.counterAxisAlignItems = 'CENTER';
  const vec = figma.createNodeFromSvg(svg);
  comp.appendChild(vec); // 先挂到 auto-layout 容器，再设 FILL（沙箱规则）
  vec.layoutSizingHorizontal = 'FILL';
  vec.layoutSizingVertical = 'FILL';
  // 描边重绑 TEXT_MAIN（变量绑定）
  const vector = comp.findAllWithCriteria({ types: ['VECTOR'] })[0] || vec;
  vector.strokes = [TEXT_MAIN];
  vector.fills = [];
  comp.x = x; comp.y = y;
  comp.description = desc + '（SVG 线性图标，stroke 绑定 text-main；经 INSTANCE_SWAP 使用）';
  x += 60;
  if (x > 500) { x = 40; y += 60; }
  created.push(comp.id);
}
return { createdNodeIds: created, icons: ICONS.map(i => i[0]) };
`;

module.exports = { SEG1 };
