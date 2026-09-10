// ─────────────────────────────────────────────────────────────
// AETHER THEATER v4-D1 — Modal/Full 屏幕（第 4 步：D1 增量）
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：03 · Screens
// 范围：补 6 个 Screen frame（Search/Liked/Settings/RecoKey/AuthError/EmptyState）
//       全部用 v4 已建 11 组件集 + 8 SVG icon + Scene/Backdrop 自由组装
//       不引新组件（避免又一轮 components SEG1-4 回归）
// 每个 SEGMENT 是一次独立的 use_figma code 参数
// 运行顺序：SEG1 → SEG2 → SEG3 → SEG4 → SEG5 → SEG6
// 配套：scripts/figma-v4-d1-command.md（执行手册）
//        scripts/figma-aether-v4-audit-d1.mjs（验收）
//        scripts/figma-v4-smoke-d1.mjs（mock 冒烟）
// ─────────────────────────────────────────────────────────────

// ============ SEG1: Screen/Search/Modal ============
const SEG1 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const ACCENT = varFill('Color/semantic/accent');
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  const hit = set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
  if (!hit) throw new Error(set.name + ' 无此 variant ' + JSON.stringify(props) + '；实际有: ' + set.children.map(c => c.name).join(' | '));
  return hit;
}
function setTextProps(inst, map) {
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let applied = false;
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) { inst.setProperties({ [k]: map[name] }); applied = true; }
    }
  }
  return applied;
}
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
function clearOld(names) { page.children.filter(n => names.includes(n.name)).forEach(n => n.remove()); }

clearOld(['Screen/Search/Modal']);
const screen = figma.createFrame();
screen.name = 'Screen/Search/Modal';
screen.resize(1440, 900);
screen.x = 1480; screen.y = 1000; // 紧跟 SourceSelect（v4 已有 @ x=0）后
screen.clipsContent = true;
screen.fills = [];
const aiContract = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/search/SearchPanel.tsx
  routes: [search]
  props: { onPlay, onClose }
  a11y: { role: dialog, keyboard: [Escape, ArrowDown, ArrowUp, Enter] }
  states: [empty, loading, results, error, timeout]
  motion: { enter: fade 240ms, exit: fade 200ms, debounce: 300ms }
  tokens: [Color/semantic/text-main, Color/semantic/glass-fill, Color/semantic/glass-stroke]
  bindings: [Scene/Backdrop, Tag/Stat, Lyrics/Line, Icon/Search]
---\`;
page.appendChild(screen);
// FRAME 无 description 属性（仅 COMPONENT/COMPONENT_SET 有）——AI_CONTRACT 存为隐藏 TEXT 子节点，REST 走 characters
const contractNode = figma.createText();
contractNode.name = 'AI_CONTRACT';
contractNode.fontName = { family: 'Inter', style: 'Regular' };
contractNode.characters = aiContract;
contractNode.fills = []; // 不参与 03 页自有填充绑定率统计
contractNode.visible = false;
screen.appendChild(contractNode);

// 背景：Scene/Backdrop（蒙层）
const bd = findComp('Scene/Backdrop').createInstance();
bd.name = 'backdrop';
bd.opacity = 0.85;
screen.appendChild(bd);

// 模态壳（居中 960×720 玻璃面板）
const panel = figma.createFrame();
panel.name = 'modal-panel';
panel.resize(960, 720);
panel.x = 240; panel.y = 90;
panel.layoutMode = 'VERTICAL';
panel.itemSpacing = 24;
panel.primaryAxisSizingMode = 'FIXED';
panel.counterAxisSizingMode = 'FIXED';
panel.paddingTop = 32; panel.paddingBottom = 32;
panel.paddingLeft = 40; panel.paddingRight = 40;
panel.fills = [GLASS_FILL];
panel.strokes = [GLASS_STROKE];
panel.strokeWeight = 1;
panel.cornerRadius = 16;
screen.appendChild(panel);

// header 行：标题 + close
const header = figma.createFrame();
header.name = 'header';
header.layoutMode = 'HORIZONTAL';
header.primaryAxisAlignItems = 'SPACE_BETWEEN';
header.counterAxisAlignItems = 'CENTER';
header.primaryAxisSizingMode = 'FIXED';
header.counterAxisSizingMode = 'AUTO';
header.fills = [];
panel.appendChild(header);
header.layoutSizingHorizontal = 'FILL';
const tagSet = findSet('Tag/Stat');
const mkTag = (tone, live, label) => {
  const inst = findVariant(tagSet, { tone, live }).createInstance();
  setTextProps(inst, { label });
  return inst;
};
header.appendChild(mkTag('cyan', 'false', 'SEARCH // CROSS-PLATFORM'));
const close = figma.createFrame();
close.name = 'close';
close.resize(32, 32);
close.layoutMode = 'HORIZONTAL';
close.primaryAxisAlignItems = 'CENTER';
close.counterAxisAlignItems = 'CENTER';
close.fills = [];
const closeIcon = textNode('×', '×', 24, TEXT_DIM, false, false, 1);
close.appendChild(closeIcon);
header.appendChild(close);

// 搜索框（Icon/Search + 输入文本）
const searchBar = figma.createFrame();
searchBar.name = 'search-bar';
searchBar.layoutMode = 'HORIZONTAL';
searchBar.itemSpacing = 12;
searchBar.counterAxisAlignItems = 'CENTER';
searchBar.primaryAxisSizingMode = 'FIXED';
searchBar.counterAxisSizingMode = 'AUTO';
searchBar.paddingLeft = 16; searchBar.paddingRight = 16;
searchBar.paddingTop = 14; searchBar.paddingBottom = 14;
searchBar.fills = [varFill('Color/semantic/glass-fill')];
searchBar.strokes = [GLASS_STROKE];
searchBar.strokeWeight = 1;
searchBar.cornerRadius = 12;
panel.appendChild(searchBar);
searchBar.layoutSizingHorizontal = 'FILL';
const searchIcon = findComp('Icon/Search').createInstance();
searchIcon.name = 'search-icon';
searchBar.appendChild(searchIcon);
const placeholder = textNode('placeholder', '搜索歌手 / 歌名（跨平台）', 16, TEXT_MUTED);
searchBar.appendChild(placeholder);

// 平台过滤 chips（Tag/Stat 复用）
const chips = figma.createFrame();
chips.name = 'source-chips';
chips.layoutMode = 'HORIZONTAL';
chips.itemSpacing = 8;
chips.primaryAxisSizingMode = 'AUTO';
chips.counterAxisSizingMode = 'AUTO';
chips.fills = [];
panel.appendChild(chips);
const chipSpec = [
  { tone: 'cyan', live: 'true', label: 'ALL' },
  { tone: 'dim', live: 'false', label: 'Q' },
  { tone: 'dim', live: 'false', label: 'N' },
  { tone: 'dim', live: 'false', label: 'D' },
  { tone: 'dim', live: 'false', label: 'S' },
];
for (const c of chipSpec) chips.appendChild(mkTag(c.tone, c.live, c.label));

// 结果列表（用 Lyrics/Line 但字号已配 12；当作 result-row 占位）
const lyricSet = findSet('Lyrics/Line');
const list = figma.createFrame();
list.name = 'result-list';
list.layoutMode = 'VERTICAL';
list.itemSpacing = 8;
list.primaryAxisSizingMode = 'FIXED';
list.counterAxisSizingMode = 'FIXED';
list.resize(880, 440);
list.fills = [];
panel.appendChild(list);
list.layoutSizingHorizontal = 'FILL';
list.layoutSizingVertical = 'FILL';
const SAMPLE = [
  { state: 'current', text: '晴天 — 周杰伦 · 叶惠美' },
  { state: 'next', text: '孤独患者 — 陈奕迅 · 认了' },
  { state: 'next', text: '夜的第七章 — 周杰伦 · 依然范特西' },
  { state: 'next', text: 'Bohemian Rhapsody — Queen · A Night at the Opera' },
  { state: 'next', text: 'Lemon — 米津玄師 · 2018' },
  { state: 'next', text: '海阔天空 — Beyond · 1993' },
];
for (const s of SAMPLE) {
  const row = findVariant(lyricSet, { state: s.state }).createInstance();
  setTextProps(row, { text: s.text });
  list.appendChild(row);
}
// 让每个 Lyrics/Line 实例 stretch 到 100% 宽（list 是 vertical auto-layout，counter-axis = horizontal）
for (const child of list.children) child.layoutSizingHorizontal = 'FILL';

return { createdNodeIds: [screen.id], screen: 'Screen/Search/Modal' };
`;

// ============ SEG2: Screen/Liked/Modal ============
const SEG2 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const LIKED = varFill('Color/semantic/status-liked');
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  const hit = set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
  if (!hit) throw new Error(set.name + ' 无此 variant ' + JSON.stringify(props) + '；实际有: ' + set.children.map(c => c.name).join(' | '));
  return hit;
}
function setTextProps(inst, map) {
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let applied = false;
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) { inst.setProperties({ [k]: map[name] }); applied = true; }
    }
  }
  return applied;
}
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
function clearOld(names) { page.children.filter(n => names.includes(n.name)).forEach(n => n.remove()); }

clearOld(['Screen/Liked/Modal']);
const screen = figma.createFrame();
screen.name = 'Screen/Liked/Modal';
screen.resize(1440, 900);
screen.x = 2960; screen.y = 1000; // 紧跟 SEG1 (x=1480) 后
screen.clipsContent = true;
screen.fills = [];
const aiContract = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/modals/LikedLibraryModal.tsx
  routes: [liked]
  props: { session, onClose }
  a11y: { role: dialog, keyboard: [Escape, ArrowUp, ArrowDown, Enter] }
  states: [empty, loading, list, importing, imported]
  motion: { enter: fade 240ms + stagger 40ms, exit: fade 200ms }
  tokens: [Color/semantic/status-liked, Color/semantic/text-main, Color/semantic/text-dim]
  bindings: [Scene/Backdrop, Tag/Stat, Icon/Heart]
---\`;
page.appendChild(screen);
// FRAME 无 description 属性（仅 COMPONENT/COMPONENT_SET 有）——AI_CONTRACT 存为隐藏 TEXT 子节点，REST 走 characters
const contractNode = figma.createText();
contractNode.name = 'AI_CONTRACT';
contractNode.fontName = { family: 'Inter', style: 'Regular' };
contractNode.characters = aiContract;
contractNode.fills = []; // 不参与 03 页自有填充绑定率统计
contractNode.visible = false;
screen.appendChild(contractNode);

const bd = findComp('Scene/Backdrop').createInstance();
bd.name = 'backdrop';
bd.opacity = 0.85;
screen.appendChild(bd);

const panel = figma.createFrame();
panel.name = 'modal-panel';
panel.resize(1080, 780);
panel.x = 180; panel.y = 60;
panel.layoutMode = 'VERTICAL';
panel.itemSpacing = 24;
panel.primaryAxisSizingMode = 'FIXED';
panel.counterAxisSizingMode = 'FIXED';
panel.paddingTop = 32; panel.paddingBottom = 32;
panel.paddingLeft = 40; panel.paddingRight = 40;
panel.fills = [GLASS_FILL];
panel.strokes = [GLASS_STROKE];
panel.strokeWeight = 1;
panel.cornerRadius = 16;
screen.appendChild(panel);

const header = figma.createFrame();
header.name = 'header';
header.layoutMode = 'HORIZONTAL';
header.primaryAxisAlignItems = 'SPACE_BETWEEN';
header.counterAxisAlignItems = 'CENTER';
header.primaryAxisSizingMode = 'FIXED';
header.counterAxisSizingMode = 'AUTO';
header.fills = [];
panel.appendChild(header);
header.layoutSizingHorizontal = 'FILL';
const tagSet = findSet('Tag/Stat');
const mkTag = (tone, live, label) => {
  const inst = findVariant(tagSet, { tone, live }).createInstance();
  setTextProps(inst, { label });
  return inst;
};
header.appendChild(mkTag('purple', 'false', 'LIKED LIBRARY // 1,284'));
const close = figma.createFrame();
close.name = 'close';
close.resize(32, 32);
close.layoutMode = 'HORIZONTAL';
close.primaryAxisAlignItems = 'CENTER';
close.counterAxisAlignItems = 'CENTER';
close.fills = [];
close.appendChild(textNode('×', '×', 24, TEXT_DIM, false, false, 1));
header.appendChild(close);

// 排序 + 过滤 chips
const filter = figma.createFrame();
filter.name = 'filter-row';
filter.layoutMode = 'HORIZONTAL';
filter.itemSpacing = 8;
filter.primaryAxisSizingMode = 'AUTO';
filter.counterAxisSizingMode = 'AUTO';
filter.fills = [];
panel.appendChild(filter);
for (const c of [
  { tone: 'cyan', live: 'true', label: 'ALL' },
  { tone: 'dim', live: 'false', label: 'QQ' },
  { tone: 'dim', live: 'false', label: 'NETEASE' },
  { tone: 'dim', live: 'false', label: 'DEEZER' },
  { tone: 'dim', live: 'false', label: 'SPOTIFY' },
]) filter.appendChild(mkTag(c.tone, c.live, c.label));

// 列表（用占位 frame + 模拟 row）
const list = figma.createFrame();
list.name = 'list';
list.layoutMode = 'VERTICAL';
list.itemSpacing = 8;
list.primaryAxisSizingMode = 'FIXED';
list.counterAxisSizingMode = 'FIXED';
list.resize(1000, 580);
list.fills = [];
panel.appendChild(list);
list.layoutSizingHorizontal = 'FILL';
list.layoutSizingVertical = 'FILL';
const ROWS = [
  { title: '走钢丝的人', artist: '李泉 · 2001', platform: 'QQ', state: 'liked' },
  { title: '午夜巴黎', artist: '王菲 · 寓言', platform: 'NETEASE', state: 'fanout' },
  { title: 'Bohemian Rhapsody', artist: 'Queen · 1975', platform: 'SPOTIFY', state: 'liked' },
  { title: '孤独患者', artist: '陈奕迅 · 认了', platform: 'NETEASE', state: 'liked' },
  { title: 'Lemon', artist: '米津玄師 · 2018', platform: 'DEEZER', state: 'liked' },
  { title: '海阔天空', artist: 'Beyond · 1993', platform: 'QQ', state: 'fanout' },
];
for (const r of ROWS) {
  const row = figma.createFrame();
  row.name = \`row/\${r.title}\`;
  row.layoutMode = 'HORIZONTAL';
  row.itemSpacing = 16;
  row.counterAxisAlignItems = 'CENTER';
  row.primaryAxisSizingMode = 'FIXED';
  row.counterAxisSizingMode = 'AUTO';
  row.paddingLeft = 12; row.paddingRight = 12;
  row.paddingTop = 10; row.paddingBottom = 10;
  row.fills = [varFill('Color/semantic/glass-fill')];
  row.cornerRadius = 8;
  list.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';
  // 封面缩略（占位 rect）
  const cover = figma.createRectangle();
  cover.name = 'cover';
  cover.resize(48, 48);
  cover.cornerRadius = 6;
  cover.fills = [varFill('Color/semantic/glass-fill')];
  cover.strokes = [GLASS_STROKE];
  cover.strokeWeight = 1;
  row.appendChild(cover);
  // 标题 + 艺术家
  const meta = figma.createFrame();
  meta.name = 'meta';
  meta.layoutMode = 'VERTICAL';
  meta.itemSpacing = 4;
  meta.primaryAxisSizingMode = 'AUTO';
  meta.counterAxisSizingMode = 'AUTO';
  meta.fills = [];
  meta.appendChild(textNode('title', r.title, 14, TEXT_MAIN, false, true));
  meta.appendChild(textNode('artist', r.artist, 11, TEXT_DIM));
  row.appendChild(meta);
  meta.layoutSizingHorizontal = 'FILL';
  // 平台 chip
  const platTag = mkTag('muted', 'false', r.platform);
  row.appendChild(platTag);
  // 状态 chip（liked 用 status-liked，fanout 用 accent）
  const statusTag = r.state === 'fanout'
    ? mkTag('cyan', 'true', 'FANOUT ×4')
    : mkTag('cyan', 'false', 'LIKED');
  row.appendChild(statusTag);
}

return { createdNodeIds: [screen.id], screen: 'Screen/Liked/Modal' };
`;

// ============ SEG3: Screen/Settings/Full ============
const SEG3 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const ACCENT = varFill('Color/semantic/accent');
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  const hit = set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
  if (!hit) throw new Error(set.name + ' 无此 variant ' + JSON.stringify(props) + '；实际有: ' + set.children.map(c => c.name).join(' | '));
  return hit;
}
function setTextProps(inst, map) {
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let applied = false;
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) { inst.setProperties({ [k]: map[name] }); applied = true; }
    }
  }
  return applied;
}
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
function clearOld(names) { page.children.filter(n => names.includes(n.name)).forEach(n => n.remove()); }

clearOld(['Screen/Settings/Full']);
const screen = figma.createFrame();
screen.name = 'Screen/Settings/Full';
screen.resize(1440, 900);
screen.x = 4440; screen.y = 1000; // 紧跟 SEG2 (x=2960) 后
screen.clipsContent = true;
screen.fills = [];
const aiContract = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/modals/SettingsModal.tsx
  routes: [settings]
  props: { onClose }
  a11y: { role: dialog, keyboard: [Escape, Tab] }
  states: [idle, busy, ok, err]
  motion: { enter: fade 240ms, exit: fade 200ms }
  tokens: [Color/semantic/glass-fill, Color/semantic/glass-stroke, Color/semantic/text-main]
  bindings: [Scene/Backdrop, Tag/Stat, Button/Text]
---\`;
page.appendChild(screen);
// FRAME 无 description 属性（仅 COMPONENT/COMPONENT_SET 有）——AI_CONTRACT 存为隐藏 TEXT 子节点，REST 走 characters
const contractNode = figma.createText();
contractNode.name = 'AI_CONTRACT';
contractNode.fontName = { family: 'Inter', style: 'Regular' };
contractNode.characters = aiContract;
contractNode.fills = []; // 不参与 03 页自有填充绑定率统计
contractNode.visible = false;
screen.appendChild(contractNode);

const bd = findComp('Scene/Backdrop').createInstance();
bd.name = 'backdrop';
screen.appendChild(bd);

const canvas = figma.createFrame();
canvas.name = 'canvas';
canvas.layoutMode = 'VERTICAL';
canvas.itemSpacing = 24;
canvas.primaryAxisSizingMode = 'AUTO';
canvas.counterAxisSizingMode = 'FIXED';
canvas.resize(960, 100);
canvas.x = 240; canvas.y = 80;
canvas.fills = [];
screen.appendChild(canvas);

const tagSet = findSet('Tag/Stat');
const mkTag = (tone, live, label) => {
  const inst = findVariant(tagSet, { tone, live }).createInstance();
  setTextProps(inst, { label });
  return inst;
};
const btnSet = findSet('Button/Text');
for (const t of btnSet.findAllWithCriteria({ types: ['TEXT'] })) {
  for (const seg of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(seg.fontName);
}
const mkButton = (tone, state, label) => {
  const inst = findVariant(btnSet, { tone, state }).createInstance();
  // Button/Text 无 TEXT 组件属性，label 烘死在各 variant 的文本层里 → 直接覆盖实例文本
  if (!setTextProps(inst, { label })) {
    for (const t of inst.findAllWithCriteria({ types: ['TEXT'] })) {
      t.characters = label;
      // Button/Text 是固定宽 88 的非 auto-layout 组件。实例内不能改 x/y
      // （"This property cannot be overridden in an instance: relative-transform"），
      // 只能把实例整体加宽，让长文案左右留白对称、不溢出胶囊
      const pad = Math.max(0, t.x);
      const need = Math.ceil(t.x + t.width + pad);
      if (need > inst.width) inst.resize(need, inst.height);
    }
  }
  return inst;
};

// header
const header = figma.createFrame();
header.name = 'header';
header.layoutMode = 'HORIZONTAL';
header.primaryAxisAlignItems = 'SPACE_BETWEEN';
header.counterAxisAlignItems = 'CENTER';
header.primaryAxisSizingMode = 'FIXED';
header.counterAxisSizingMode = 'AUTO';
header.fills = [];
canvas.appendChild(header);
header.layoutSizingHorizontal = 'FILL';
header.appendChild(mkTag('cyan', 'false', 'SETTINGS // CONFIG'));
header.appendChild(textNode('esc-hint', 'ESC to close', 10, TEXT_MUTED, true));

// 3 个 section
function buildSection(tagLabel, hint, bodyBuilder) {
  const sec = figma.createFrame();
  sec.name = \`section/\${tagLabel}\`;
  sec.layoutMode = 'VERTICAL';
  sec.itemSpacing = 12;
  sec.primaryAxisSizingMode = 'AUTO';
  sec.counterAxisSizingMode = 'FIXED';
  sec.resize(960, 100);
  sec.paddingTop = 20; sec.paddingBottom = 20;
  sec.paddingLeft = 24; sec.paddingRight = 24;
  sec.fills = [GLASS_FILL];
  sec.strokes = [GLASS_STROKE];
  sec.strokeWeight = 1;
  sec.cornerRadius = 12;
  canvas.appendChild(sec);
  sec.layoutSizingHorizontal = 'FILL';
  sec.appendChild(mkTag('cyan', 'false', tagLabel));
  sec.appendChild(textNode(\`hint-\${tagLabel}\`, hint, 12, TEXT_DIM));
  bodyBuilder(sec);
}

buildSection('AUTO-BACKUP', '每日自动备份会话快照到本地目录', (sec) => {
  const row = figma.createFrame();
  row.name = 'row';
  row.layoutMode = 'HORIZONTAL';
  row.itemSpacing = 16;
  row.counterAxisAlignItems = 'CENTER';
  row.primaryAxisSizingMode = 'FIXED';
  row.counterAxisSizingMode = 'AUTO';
  row.fills = [];
  sec.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';
  row.appendChild(textNode('path', '~/.maestro/backups', 11, TEXT_MUTED, true));
  const spacer = figma.createFrame();
  spacer.name = 'spacer';
  spacer.fills = [];
  row.appendChild(spacer);
  spacer.resize(1, 1);
  spacer.layoutSizingHorizontal = 'FILL';
  spacer.layoutSizingVertical = 'FILL';
  row.appendChild(mkTag('muted', 'false', '5 BACKUPS'));
  row.appendChild(mkButton('default', 'default', '立即备份'));
});

buildSection('EXPORT-SNAPSHOT', '加密导出全部凭据 + 收藏 + 偏好', (sec) => {
  const row = figma.createFrame();
  row.name = 'row';
  row.layoutMode = 'HORIZONTAL';
  row.itemSpacing = 16;
  row.counterAxisAlignItems = 'CENTER';
  row.primaryAxisSizingMode = 'FIXED';
  row.counterAxisSizingMode = 'AUTO';
  row.fills = [];
  sec.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';
  row.appendChild(mkButton('accent', 'default', '导出加密快照'));
  const spacer = figma.createFrame();
  spacer.name = 'spacer';
  spacer.fills = [];
  row.appendChild(spacer);
  spacer.resize(1, 1);
  spacer.layoutSizingHorizontal = 'FILL';
  spacer.layoutSizingVertical = 'FILL';
  row.appendChild(textNode('pass-hint', '口令自动生成，可修改', 10, TEXT_MUTED, true));
});

buildSection('IMPORT-MERGE', '从 .maestro-backup 文件恢复数据', (sec) => {
  const row = figma.createFrame();
  row.name = 'row';
  row.layoutMode = 'HORIZONTAL';
  row.itemSpacing = 16;
  row.counterAxisAlignItems = 'CENTER';
  row.primaryAxisSizingMode = 'FIXED';
  row.counterAxisSizingMode = 'AUTO';
  row.fills = [];
  sec.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';
  row.appendChild(mkButton('default', 'default', '选择文件'));
  row.appendChild(mkButton('default', 'disabled', '导入并合并'));
  const spacer = figma.createFrame();
  spacer.name = 'spacer';
  spacer.fills = [];
  row.appendChild(spacer);
  spacer.resize(1, 1);
  spacer.layoutSizingHorizontal = 'FILL';
  spacer.layoutSizingVertical = 'FILL';
  row.appendChild(textNode('merge-hint', '需输入导出时设置的口令', 10, TEXT_MUTED, true));
});

return { createdNodeIds: [screen.id], screen: 'Screen/Settings/Full' };
`;

// ============ SEG4: Screen/RecoKey/Modal ============
const SEG4 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const ACCENT = varFill('Color/semantic/accent');
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  const hit = set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
  if (!hit) throw new Error(set.name + ' 无此 variant ' + JSON.stringify(props) + '；实际有: ' + set.children.map(c => c.name).join(' | '));
  return hit;
}
function setTextProps(inst, map) {
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let applied = false;
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) { inst.setProperties({ [k]: map[name] }); applied = true; }
    }
  }
  return applied;
}
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
function clearOld(names) { page.children.filter(n => names.includes(n.name)).forEach(n => n.remove()); }

clearOld(['Screen/RecoKey/Modal']);
const screen = figma.createFrame();
screen.name = 'Screen/RecoKey/Modal';
screen.resize(1440, 900);
screen.x = 5920; screen.y = 1000;
screen.clipsContent = true;
screen.fills = [];
const aiContract = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/modals/RecoKeyModal.tsx
  routes: [reco-key]
  props: { onSave, onClose }
  a11y: { role: dialog, keyboard: [Escape, Enter, Tab] }
  states: [empty, typing, valid, saving, saved, error]
  motion: { enter: fade 200ms, exit: fade 200ms }
  tokens: [Color/semantic/accent, Color/semantic/text-dim, Color/semantic/glass-fill]
  bindings: [Scene/Backdrop, Tag/Stat, Button/Text]
---\`;
page.appendChild(screen);
// FRAME 无 description 属性（仅 COMPONENT/COMPONENT_SET 有）——AI_CONTRACT 存为隐藏 TEXT 子节点，REST 走 characters
const contractNode = figma.createText();
contractNode.name = 'AI_CONTRACT';
contractNode.fontName = { family: 'Inter', style: 'Regular' };
contractNode.characters = aiContract;
contractNode.fills = []; // 不参与 03 页自有填充绑定率统计
contractNode.visible = false;
screen.appendChild(contractNode);

const bd = findComp('Scene/Backdrop').createInstance();
bd.name = 'backdrop';
bd.opacity = 0.85;
screen.appendChild(bd);

const panel = figma.createFrame();
panel.name = 'modal-panel';
panel.resize(640, 480);
panel.x = 400; panel.y = 210;
panel.layoutMode = 'VERTICAL';
panel.itemSpacing = 24;
panel.primaryAxisSizingMode = 'FIXED';
panel.counterAxisSizingMode = 'FIXED';
panel.paddingTop = 36; panel.paddingBottom = 36;
panel.paddingLeft = 40; panel.paddingRight = 40;
panel.fills = [GLASS_FILL];
panel.strokes = [GLASS_STROKE];
panel.strokeWeight = 1;
panel.cornerRadius = 16;
screen.appendChild(panel);

const tagSet = findSet('Tag/Stat');
const mkTag = (tone, live, label) => {
  const inst = findVariant(tagSet, { tone, live }).createInstance();
  setTextProps(inst, { label });
  return inst;
};
const btnSet = findSet('Button/Text');
for (const t of btnSet.findAllWithCriteria({ types: ['TEXT'] })) {
  for (const seg of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(seg.fontName);
}
const mkButton = (tone, state, label) => {
  const inst = findVariant(btnSet, { tone, state }).createInstance();
  // Button/Text 无 TEXT 组件属性，label 烘死在各 variant 的文本层里 → 直接覆盖实例文本
  if (!setTextProps(inst, { label })) {
    for (const t of inst.findAllWithCriteria({ types: ['TEXT'] })) {
      t.characters = label;
      // Button/Text 是固定宽 88 的非 auto-layout 组件。实例内不能改 x/y
      // （"This property cannot be overridden in an instance: relative-transform"），
      // 只能把实例整体加宽，让长文案左右留白对称、不溢出胶囊
      const pad = Math.max(0, t.x);
      const need = Math.ceil(t.x + t.width + pad);
      if (need > inst.width) inst.resize(need, inst.height);
    }
  }
  return inst;
};

panel.appendChild(mkTag('cyan', 'false', 'DEEPSEEK API KEY'));

// hint
const hint = textNode('hint', '需要 DeepSeek API key 才能用 AI 推荐。没账号先去 platform.deepseek.com 申请一个，存到本地不外发。', 13, TEXT_DIM);
hint.layoutAlign = 'STRETCH';
panel.appendChild(hint);
hint.layoutSizingHorizontal = 'FILL';

// input
const input = figma.createFrame();
input.name = 'input';
input.layoutMode = 'HORIZONTAL';
input.itemSpacing = 12;
input.counterAxisAlignItems = 'CENTER';
input.primaryAxisSizingMode = 'FIXED';
input.counterAxisSizingMode = 'AUTO';
input.paddingLeft = 16; input.paddingRight = 16;
input.paddingTop = 14; input.paddingBottom = 14;
input.fills = [varFill('Color/semantic/glass-fill')];
input.strokes = [GLASS_STROKE];
input.strokeWeight = 1;
input.cornerRadius = 10;
panel.appendChild(input);
input.layoutSizingHorizontal = 'FILL';
input.appendChild(textNode('placeholder', 'sk-...', 14, TEXT_MUTED, true));

// actions
const actions = figma.createFrame();
actions.name = 'actions';
actions.layoutMode = 'HORIZONTAL';
actions.itemSpacing = 12;
actions.primaryAxisAlignItems = 'MAX';
actions.counterAxisAlignItems = 'CENTER';
actions.primaryAxisSizingMode = 'FIXED';
actions.counterAxisSizingMode = 'AUTO';
actions.fills = [];
panel.appendChild(actions);
actions.layoutSizingHorizontal = 'FILL';
actions.appendChild(mkButton('default', 'default', '取消'));
actions.appendChild(mkButton('accent', 'default', '保存'));

return { createdNodeIds: [screen.id], screen: 'Screen/RecoKey/Modal' };
`;

// ============ SEG5: Screen/AuthError/Full ============
const SEG5 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const ERR = varFill('Color/semantic/status-error');
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  const hit = set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
  if (!hit) throw new Error(set.name + ' 无此 variant ' + JSON.stringify(props) + '；实际有: ' + set.children.map(c => c.name).join(' | '));
  return hit;
}
function setTextProps(inst, map) {
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let applied = false;
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) { inst.setProperties({ [k]: map[name] }); applied = true; }
    }
  }
  return applied;
}
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
function clearOld(names) { page.children.filter(n => names.includes(n.name)).forEach(n => n.remove()); }

clearOld(['Screen/AuthError/Full']);
const screen = figma.createFrame();
screen.name = 'Screen/AuthError/Full';
screen.resize(1440, 900);
screen.x = 7400; screen.y = 1000;
screen.clipsContent = true;
screen.fills = [];
const aiContract = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/common/AuthErrorPanel.tsx
  routes: [auth-error]
  props: { provider, error, onRetry, onReLogin, onSwitch, onPasteCookie?, onDismiss }
  a11y: { role: alert, keyboard: [Escape, Enter] }
  states: [cancelled, timeout, invalid, expired, protocol-missing, backend-down, unknown]
  motion: { enter: fade 200ms, ambient: tag pulse 2400ms }
  tokens: [Color/semantic/status-error, Color/semantic/text-main, Color/semantic/glass-fill]
  bindings: [Scene/Backdrop, Tag/Stat, Button/Text]
---\`;
page.appendChild(screen);
// FRAME 无 description 属性（仅 COMPONENT/COMPONENT_SET 有）——AI_CONTRACT 存为隐藏 TEXT 子节点，REST 走 characters
const contractNode = figma.createText();
contractNode.name = 'AI_CONTRACT';
contractNode.fontName = { family: 'Inter', style: 'Regular' };
contractNode.characters = aiContract;
contractNode.fills = []; // 不参与 03 页自有填充绑定率统计
contractNode.visible = false;
screen.appendChild(contractNode);

const bd = findComp('Scene/Backdrop').createInstance();
bd.name = 'backdrop';
bd.opacity = 0.95;
screen.appendChild(bd);

const panel = figma.createFrame();
panel.name = 'alert-panel';
panel.resize(800, 360);
panel.x = 320; panel.y = 270;
panel.layoutMode = 'VERTICAL';
panel.itemSpacing = 20;
panel.primaryAxisSizingMode = 'FIXED';
panel.counterAxisSizingMode = 'FIXED';
panel.paddingTop = 32; panel.paddingBottom = 32;
panel.paddingLeft = 40; panel.paddingRight = 40;
panel.fills = [GLASS_FILL];
panel.strokes = [varFill('Color/semantic/status-error')];
panel.strokeWeight = 1;
panel.cornerRadius = 16;
screen.appendChild(panel);

const tagSet = findSet('Tag/Stat');
const mkTag = (tone, live, label) => {
  const inst = findVariant(tagSet, { tone, live }).createInstance();
  setTextProps(inst, { label });
  return inst;
};
const btnSet = findSet('Button/Text');
for (const t of btnSet.findAllWithCriteria({ types: ['TEXT'] })) {
  for (const seg of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(seg.fontName);
}
const mkButton = (tone, state, label) => {
  const inst = findVariant(btnSet, { tone, state }).createInstance();
  // Button/Text 无 TEXT 组件属性，label 烘死在各 variant 的文本层里 → 直接覆盖实例文本
  if (!setTextProps(inst, { label })) {
    for (const t of inst.findAllWithCriteria({ types: ['TEXT'] })) {
      t.characters = label;
      // Button/Text 是固定宽 88 的非 auto-layout 组件。实例内不能改 x/y
      // （"This property cannot be overridden in an instance: relative-transform"），
      // 只能把实例整体加宽，让长文案左右留白对称、不溢出胶囊
      const pad = Math.max(0, t.x);
      const need = Math.ceil(t.x + t.width + pad);
      if (need > inst.width) inst.resize(need, inst.height);
    }
  }
  return inst;
};

// error code tag
panel.appendChild(mkTag('red', 'true', 'FATAL // AUTH_TIMEOUT'));

// title
const title = textNode('title', '登录超时（120s），请重试', 28, TEXT_MAIN, false, true);
panel.appendChild(title);

// message
const msg = textNode('message', '从 platform.deepseek.com 重新申请一个 key... （示例消息文本）', 14, TEXT_DIM);
msg.layoutAlign = 'STRETCH';
panel.appendChild(msg);
msg.layoutSizingHorizontal = 'FILL';

// actions
const actions = figma.createFrame();
actions.name = 'actions';
actions.layoutMode = 'HORIZONTAL';
actions.itemSpacing = 12;
actions.primaryAxisAlignItems = 'MIN';
actions.counterAxisAlignItems = 'CENTER';
actions.primaryAxisSizingMode = 'AUTO';
actions.counterAxisSizingMode = 'AUTO';
actions.fills = [];
panel.appendChild(actions);
actions.appendChild(mkButton('accent', 'default', '重试'));
actions.appendChild(mkButton('default', 'default', '重新登录'));
actions.appendChild(mkButton('default', 'default', '粘贴 cookie'));
actions.appendChild(mkButton('default', 'default', '切换音源'));
actions.appendChild(mkButton('default', 'default', '关闭'));

return { createdNodeIds: [screen.id], screen: 'Screen/AuthError/Full' };
`;

// ============ SEG6: Screen/EmptyState/Full ============
const SEG6 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const ACCENT = varFill('Color/semantic/accent');
const LIKED = varFill('Color/semantic/status-liked');
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  const hit = set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
  if (!hit) throw new Error(set.name + ' 无此 variant ' + JSON.stringify(props) + '；实际有: ' + set.children.map(c => c.name).join(' | '));
  return hit;
}
function setTextProps(inst, map) {
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let applied = false;
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) { inst.setProperties({ [k]: map[name] }); applied = true; }
    }
  }
  return applied;
}
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
function clearOld(names) { page.children.filter(n => names.includes(n.name)).forEach(n => n.remove()); }

clearOld(['Screen/EmptyState/Full']);
const screen = figma.createFrame();
screen.name = 'Screen/EmptyState/Full';
screen.resize(1440, 900);
screen.x = 8880; screen.y = 1000;
screen.clipsContent = true;
screen.fills = [];
const aiContract = \`---
AI_CONTRACT:
  react: (复用 TheaterView 条件渲染)
  routes: [empty]
  props: (无)
  a11y: { role: status, keyboard: [Tab, Enter] }
  states: [empty]
  motion: { enter: fade 400ms, ambient: heart idle 4s }
  tokens: [Color/semantic/text-dim, Color/semantic/text-muted, Color/semantic/accent]
  bindings: [Scene/Backdrop, Tag/Stat, Button/Text, Icon/Heart]
---\`;
page.appendChild(screen);
// FRAME 无 description 属性（仅 COMPONENT/COMPONENT_SET 有）——AI_CONTRACT 存为隐藏 TEXT 子节点，REST 走 characters
const contractNode = figma.createText();
contractNode.name = 'AI_CONTRACT';
contractNode.fontName = { family: 'Inter', style: 'Regular' };
contractNode.characters = aiContract;
contractNode.fills = []; // 不参与 03 页自有填充绑定率统计
contractNode.visible = false;
screen.appendChild(contractNode);

const bd = findComp('Scene/Backdrop').createInstance();
bd.name = 'backdrop';
screen.appendChild(bd);

// 居中容器
const center = figma.createFrame();
center.name = 'center';
center.layoutMode = 'VERTICAL';
center.itemSpacing = 32;
center.primaryAxisAlignItems = 'CENTER';
center.counterAxisAlignItems = 'CENTER';
center.primaryAxisSizingMode = 'AUTO';
center.counterAxisSizingMode = 'AUTO';
center.resize(640, 100);
center.x = 400; center.y = 280;
center.fills = [];
screen.appendChild(center);

// 居中 illustration：双层环 + 心
const illu = figma.createFrame();
illu.name = 'illustration';
illu.layoutMode = 'NONE';
illu.resize(220, 220);
illu.fills = [];
center.appendChild(illu);
// outer ring
const ringOuter = figma.createEllipse();
ringOuter.name = 'ring-outer';
ringOuter.resize(220, 220);
ringOuter.x = 0; ringOuter.y = 0;
ringOuter.fills = [];
ringOuter.strokes = [GLASS_STROKE];
ringOuter.strokeWeight = 1;
illu.appendChild(ringOuter);
// inner ring
const ringInner = figma.createEllipse();
ringInner.name = 'ring-inner';
ringInner.resize(140, 140);
ringInner.x = 40; ringInner.y = 40;
ringInner.fills = [];
ringInner.strokes = [varFill('Color/semantic/accent')];
ringInner.strokeWeight = 1;
ringInner.opacity = 0.4;
illu.appendChild(ringInner);
// heart icon (居中)
const heart = findComp('Icon/Heart').createInstance();
heart.name = 'heart';
heart.resize(80, 80);
heart.x = 70; heart.y = 70;
illu.appendChild(heart);

const tagSet = findSet('Tag/Stat');
const mkTag = (tone, live, label) => {
  const inst = findVariant(tagSet, { tone, live }).createInstance();
  setTextProps(inst, { label });
  return inst;
};
const btnSet = findSet('Button/Text');
for (const t of btnSet.findAllWithCriteria({ types: ['TEXT'] })) {
  for (const seg of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(seg.fontName);
}
const mkButton = (tone, state, label) => {
  const inst = findVariant(btnSet, { tone, state }).createInstance();
  // Button/Text 无 TEXT 组件属性，label 烘死在各 variant 的文本层里 → 直接覆盖实例文本
  if (!setTextProps(inst, { label })) {
    for (const t of inst.findAllWithCriteria({ types: ['TEXT'] })) {
      t.characters = label;
      // Button/Text 是固定宽 88 的非 auto-layout 组件。实例内不能改 x/y
      // （"This property cannot be overridden in an instance: relative-transform"），
      // 只能把实例整体加宽，让长文案左右留白对称、不溢出胶囊
      const pad = Math.max(0, t.x);
      const need = Math.ceil(t.x + t.width + pad);
      if (need > inst.width) inst.resize(need, inst.height);
    }
  }
  return inst;
};

center.appendChild(mkTag('cyan', 'false', 'AETHER ENGINE // IDLE'));
const title = textNode('title', '连接第一个音乐源', 28, TEXT_MAIN, false, true);
center.appendChild(title);
const sub = textNode('subtitle', '选择一个平台开始听 — 凭据只存在本地', 14, TEXT_DIM);
center.appendChild(sub);

const cta = figma.createFrame();
cta.name = 'cta';
cta.layoutMode = 'HORIZONTAL';
cta.itemSpacing = 12;
cta.primaryAxisAlignItems = 'CENTER';
cta.counterAxisAlignItems = 'CENTER';
cta.primaryAxisSizingMode = 'AUTO';
cta.counterAxisSizingMode = 'AUTO';
cta.fills = [];
center.appendChild(cta);
cta.appendChild(mkButton('accent', 'default', '去登录'));
cta.appendChild(mkButton('default', 'default', '了解更多'));

return { createdNodeIds: [screen.id], screen: 'Screen/EmptyState/Full' };
`;

module.exports = { SEG1, SEG2, SEG3, SEG4, SEG5, SEG6 };

