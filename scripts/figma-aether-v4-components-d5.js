// ─────────────────────────────────────────────────────────────
// AETHER v4-D5_NEW — 02 · Components 增 10 个 component set
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：02 · Components
// 范围：把 figma-code-connect.json 里 10 个 TBD-FIGMA 占位映射
//       全部建出对应 Figma component set（28 变体），拿到真实 nodeId。
// 每个 SEGMENT 是一次独立的 use_figma code 参数
// 运行顺序：SEG1 → SEG2（先 SEG1 简单 5 组件 + 简单 3 组件，再 SEG2 复杂 2 屏 + 1 弹窗）
// 配套：scripts/figma-v4-d5-new-command.md（执行手册）
//        scripts/figma-v4-smoke-d5-new.mjs（mock 冒烟）
//        scripts/figma-code-connect-inject.mjs（注入器）
//        scripts/figma-code-connect-validate.mjs（strict 110/110 验收）
//        specs/d5-new-components/{spec,tasks,component-specs}.md
// ─────────────────────────────────────────────────────────────

// ============ 共享工具（嵌入到每个 SEG 顶部） ============
// varColor/varFill/SOL/glow/clearOld/layoutRow/placeSet/bindVar —— 沿用 v4-components.js 沙箱规则
// —— SEG 内部不再重写工具，避免 use_figma code 超 50KB 沙箱上限

// ============ SEG1: Modal/Shell + Modal/ErrorPanel + Modal/RecoLoading + SourceChip + Layout/QualityMenu ============
const SEG1 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

const SOL = (r, g, b, a = 1) => ({ type: 'SOLID', color: { r, g, b, a } });
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
const ACCENT = varFill('Color/semantic/accent');
const TEXT_MAIN = varFill('Color/semantic/text-main');
const TEXT_DIM = varFill('Color/semantic/text-dim');
const TEXT_MUTED = varFill('Color/semantic/text-muted');
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const STATUS_ERROR = varFill('Color/semantic/status-error');
const STATUS_LIKED = varFill('Color/semantic/status-liked');
const glow = (r, g, b, a, radius, spread = 0) => ([{ type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r, g, b, a }, offset: { x: 0, y: 0 }, radius, spread, visible: true }]);
function clearOld(name) {
  page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).filter(n => n.name === name).forEach(n => n.remove());
}
function placeSet(set, x, y) { set.x = x; set.y = y; }
function layoutRow(set, colW, rowH) {
  let maxX = 0, maxY = 0;
  set.children.forEach((ch, i) => { ch.x = i * colW; ch.y = 0; maxX = Math.max(maxX, ch.x + ch.width); maxY = Math.max(maxY, ch.y + ch.height); });
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
function textNode(name, str, size, color, mono, bold) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  const family = mono ? 'JetBrains Mono' : 'Inter';
  t.fontName = { family, style: bold ? 'Semi Bold' : 'Regular' };
  t.fills = [color];
  return t;
}
const BOLD = { 'Inter': 'Semi Bold', 'JetBrains Mono': 'Bold' };
function tnode(name, str, size, color, mono, bold) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  const family = mono ? 'JetBrains Mono' : 'Inter';
  t.fontName = { family, style: bold ? BOLD[family] : 'Regular' };
  t.fills = [color];
  return t;
}
const created = [];

// ---- 1. Modal/Shell: state=default (1 variant) ----
clearOld('Modal/Shell');
const shellC = figma.createComponent();
shellC.name = 'state=default';
shellC.resize(320, 240);
shellC.layoutMode = 'VERTICAL';
shellC.itemSpacing = 16;
shellC.primaryAxisSizingMode = 'FIXED';
shellC.counterAxisSizingMode = 'FIXED';
shellC.paddingTop = 24; shellC.paddingBottom = 24;
shellC.paddingLeft = 24; shellC.paddingRight = 24;
shellC.fills = [GLASS_FILL];
shellC.strokes = [GLASS_STROKE];
shellC.strokeWeight = 1;
shellC.cornerRadius = 16;
shellC.effects = glow(0.231, 0.608, 1, 0.18, 24, 0);
const shellHeader = figma.createFrame();
shellHeader.name = 'header';
shellHeader.layoutMode = 'HORIZONTAL';
shellHeader.primaryAxisAlignItems = 'SPACE_BETWEEN';
shellHeader.counterAxisAlignItems = 'CENTER';
shellHeader.primaryAxisSizingMode = 'FIXED';
shellHeader.counterAxisSizingMode = 'AUTO';
shellHeader.fills = [];
shellC.appendChild(shellHeader);
shellHeader.layoutSizingHorizontal = 'FILL';
shellHeader.appendChild(tnode('title', '弹窗标题', 16, TEXT_MAIN, false, true));
const shellClose = tnode('close', '×', 20, TEXT_DIM, false, false);
shellHeader.appendChild(shellClose);
const shellBody = figma.createFrame();
shellBody.name = 'body';
shellBody.layoutMode = 'VERTICAL';
shellBody.primaryAxisSizingMode = 'FIXED';
shellBody.counterAxisSizingMode = 'FIXED';
shellBody.resize(272, 120);
shellBody.fills = [];
shellC.appendChild(shellBody);
shellBody.layoutSizingHorizontal = 'FILL';
shellBody.layoutSizingVertical = 'FILL';
const shellSlot = tnode('slot', 'children', 11, TEXT_MUTED, true, false);
shellBody.appendChild(shellSlot);
shellC.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/common/Modal.tsx
  props: { onClose: function, panelClassName?: string, children: ReactNode }
  a11y: { role: dialog, keyboard: [Escape] }
  states: [default]
  tokens: [Color/semantic/glass-fill, Color/semantic/glass-stroke, Color/semantic/accent]
  bindings: []
---\`;
created.push(shellC.id);
const shellSet = figma.combineAsVariants([shellC], page);
shellSet.name = 'Modal/Shell';
shellSet.description = shellC.description;
layoutRow(shellSet, 360, 280);
placeSet(shellSet, 40, 4400);

// ---- 2. Modal/ErrorPanel: state=collapsed, expanded (2 variants) ----
clearOld('Modal/ErrorPanel');
const errComps = [];
for (const st of ['collapsed', 'expanded']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(480, st === 'collapsed' ? 60 : 200);
  c.layoutMode = 'VERTICAL';
  c.itemSpacing = 12;
  c.primaryAxisSizingMode = st === 'collapsed' ? 'FIXED' : 'AUTO';
  c.counterAxisSizingMode = 'FIXED';
  c.paddingTop = 16; c.paddingBottom = 16;
  c.paddingLeft = 16; c.paddingRight = 16;
  c.fills = [GLASS_FILL];
  c.strokes = [STATUS_ERROR];
  c.strokeWeight = 1;
  c.cornerRadius = 10;
  // summary row
  const sum = figma.createFrame();
  sum.name = 'summary';
  sum.layoutMode = 'HORIZONTAL';
  sum.itemSpacing = 10;
  sum.counterAxisAlignItems = 'CENTER';
  sum.primaryAxisSizingMode = 'FIXED';
  sum.counterAxisSizingMode = 'AUTO';
  sum.fills = [];
  c.appendChild(sum);
  sum.layoutSizingHorizontal = 'FILL';
  sum.appendChild(tnode('icon', '⚠', 20, STATUS_ERROR, false, true));
  const msgKey = c.addComponentProperty('message', 'TEXT', '播放失败，请检查网络连接');
  const firstLine = tnode('firstLine', '播放失败，请检查网络连接', 13, TEXT_MAIN, false, false);
  firstLine.componentPropertyReferences = { characters: msgKey };
  sum.appendChild(firstLine);
  firstLine.layoutSizingHorizontal = 'FILL';
  sum.appendChild(tnode('toggle', st === 'expanded' ? '▾' : '▸', 14, TEXT_DIM, false, false));
  if (st === 'expanded') {
    const detail = figma.createFrame();
    detail.name = 'detail';
    detail.layoutMode = 'VERTICAL';
    detail.itemSpacing = 8;
    detail.primaryAxisSizingMode = 'AUTO';
    detail.counterAxisSizingMode = 'FIXED';
    detail.fills = [];
    c.appendChild(detail);
    detail.layoutSizingHorizontal = 'FILL';
    const pre = tnode('pre', '播放失败，请检查网络连接\\nerrno=ECONNRESET', 11, TEXT_DIM, true, false);
    pre.componentPropertyReferences = { characters: msgKey };
    detail.appendChild(pre);
    pre.layoutSizingHorizontal = 'FILL';
    const actions = figma.createFrame();
    actions.name = 'actions';
    actions.layoutMode = 'HORIZONTAL';
    actions.itemSpacing = 8;
    actions.primaryAxisSizingMode = 'AUTO';
    actions.counterAxisSizingMode = 'AUTO';
    actions.fills = [];
    detail.appendChild(actions);
    actions.appendChild(tnode('copy', '复制', 11, TEXT_DIM, false, false));
    actions.appendChild(tnode('close', '关闭', 11, TEXT_DIM, false, false));
  }
  errComps.push(c);
  created.push(c.id);
}
const errSet = figma.combineAsVariants(errComps, page);
errSet.name = 'Modal/ErrorPanel';
layoutRow(errSet, 520, 220);
placeSet(errSet, 440, 4400);
errSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/common/ErrorPanel.tsx
  props: { message: string, onClose: function }
  a11y: { role: alert, keyboard: [Enter, Escape] }
  states: [collapsed, expanded]
  tokens: [Color/semantic/glass-fill, Color/semantic/status-error, Color/semantic/text-main]
  bindings: []
---\`;
created.push(errSet.id);

// ---- 3. Modal/RecoLoading: state=loading, error (2 variants) ----
clearOld('Modal/RecoLoading');
const rlComps = [];
for (const st of ['loading', 'error']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(360, 120);
  c.layoutMode = 'VERTICAL';
  c.itemSpacing = 12;
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'FIXED';
  c.paddingTop = 20; c.paddingBottom = 20;
  c.paddingLeft = 20; c.paddingRight = 20;
  c.fills = [GLASS_FILL];
  c.strokes = [GLASS_STROKE];
  c.strokeWeight = 1;
  c.cornerRadius = 12;
  c.appendChild(tnode('icon', st === 'error' ? '✕' : '◉', 40, ACCENT, false, true));
  c.appendChild(tnode('label', st === 'loading' ? 'AI 正在为你挑选...' : '推荐失败', 14, TEXT_MAIN, false, true));
  const sub = tnode('sub', st === 'loading' ? '基于 1,284 首歌' : '请稍后重试', 11, TEXT_DIM, true, false);
  c.appendChild(sub);
  // 暴露 librarySize / errorText prop：使用 default value；变体差异写在 chars 上是约定，靠 description 提示
  rlComps.push(c);
  created.push(c.id);
}
const rlSet = figma.combineAsVariants(rlComps, page);
rlSet.name = 'Modal/RecoLoading';
layoutRow(rlSet, 400, 160);
placeSet(rlSet, 1480, 4400);
rlSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/common/RecoLoading.tsx
  props: { librarySize: number, onClose?: function }
  a11y: { role: status, aria-live: polite, keyboard: [Escape] }
  states: [loading, error]
  tokens: [Color/semantic/glass-fill, Color/semantic/accent, Color/semantic/text-main]
  bindings: [Scene/Backdrop]
---\`;
created.push(rlSet.id);

// ---- 4. SourceChip: platform=qq, netease, deezer, spotify (4 variants) ----
clearOld('SourceChip');
const PF_COLOR = {
  qq: { fill: varFill('Color/semantic/platform-qq'), r: 1, g: 0.851, b: 0.239 },
  netease: { fill: varFill('Color/semantic/platform-netease'), r: 1, g: 0.231, b: 0.361 },
  deezer: { fill: varFill('Color/semantic/platform-deezer'), r: 0.239, g: 0.608, b: 1 },
  spotify: { fill: varFill('Color/semantic/platform-spotify'), r: 0.239, g: 1, b: 0.635 },
};
const PF_LETTER = { qq: 'Q', netease: 'N', deezer: 'D', spotify: 'S' };
const chipComps = [];
for (const pf of ['qq', 'netease', 'deezer', 'spotify']) {
  const c = figma.createComponent();
  c.name = 'platform=' + pf;
  c.layoutMode = 'HORIZONTAL';
  c.itemSpacing = 4;
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.paddingTop = 4; c.paddingBottom = 4;
  c.paddingLeft = 8; c.paddingRight = 8;
  c.fills = [SOL(1, 1, 1, 0.06)];
  c.strokes = [PF_COLOR[pf].fill];
  c.strokeWeight = 1;
  c.cornerRadius = 8;
  c.appendChild(tnode('letter', PF_LETTER[pf], 12, PF_COLOR[pf].fill, false, true));
  // ★ 默认不显示（用 instance override 控制 isBest）
  const star = tnode('best', '★', 12, ACCENT, false, true);
  star.visible = false;
  c.appendChild(star);
  // 暴露 isBest instance override
  const visKey = c.addComponentProperty('isBest', 'BOOLEAN', false);
  star.componentPropertyReferences = { visible: visKey };
  chipComps.push(c);
  created.push(c.id);
}
const chipSet = figma.combineAsVariants(chipComps, page);
chipSet.name = 'SourceChip';
layoutRow(chipSet, 100, 50);
placeSet(chipSet, 1960, 4400);
chipSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/search/SourceChip.tsx
  props: { source: UnifiedSourceInfo, isBest: boolean }
  a11y: { role: status, title: 有版权/无版权 }
  states: [default, best, no-rights]
  tokens: [Color/semantic/platform-qq, platform-netease, platform-deezer, platform-spotify, accent]
  bindings: []
---\`;
created.push(chipSet.id);

// ---- 5. Layout/QualityMenu: quality=standard, high, lossless (3 variants) ----
clearOld('Layout/QualityMenu');
const QUALITY_LABELS = { standard: '标准', high: '极高 320', lossless: '无损' };
const qmComps = [];
for (const q of ['standard', 'high', 'lossless']) {
  const c = figma.createComponent();
  c.name = 'quality=' + q;
  c.layoutMode = 'HORIZONTAL';
  c.itemSpacing = 6;
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.paddingTop = 6; c.paddingBottom = 6;
  c.paddingLeft = 12; c.paddingRight = 12;
  c.fills = [GLASS_FILL];
  c.strokes = [q === 'lossless' ? ACCENT : (q === 'high' ? varFill('Color/semantic/accent-soft') : GLASS_STROKE)];
  c.strokeWeight = 1;
  c.cornerRadius = 8;
  c.appendChild(tnode('label', QUALITY_LABELS[q], 12, TEXT_MAIN, false, false));
  c.appendChild(tnode('chevron', '▾', 10, TEXT_DIM, false, false));
  // disabled: BOOLEAN instance override
  const dKey = c.addComponentProperty('disabled', 'BOOLEAN', false);
  c.opacity = 1;
  // 用 setProperties 后改 opacity（apply to children）；simplest: bound prop 留给 Figma
  c.setProperties({ [dKey]: false });
  qmComps.push(c);
  created.push(c.id);
}
const qmSet = figma.combineAsVariants(qmComps, page);
qmSet.name = 'Layout/QualityMenu';
layoutRow(qmSet, 200, 50);
placeSet(qmSet, 2440, 4400);
qmSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/layout/QualityMenu.tsx
  props: { quality: enum[standard|high|lossless], onSelect: function }
  a11y: { role: menu, keyboard: [Enter, Escape, ArrowUp, ArrowDown] }
  states: [standard, high, lossless]
  tokens: [Color/semantic/glass-fill, Color/semantic/accent, Color/semantic/accent-soft, text-main]
  bindings: [SourceMenu]
---\`;
created.push(qmSet.id);

return { createdNodeIds: created, sets: ['Modal/Shell', 'Modal/ErrorPanel', 'Modal/RecoLoading', 'SourceChip', 'Layout/QualityMenu'] };
`;

// ============ SEG2: Layout/SourceMenu + Layout/DeezerPresetSelect + Screen/SourceSelect + Titlebar + Modal/NeteaseCookie ============
const SEG2 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

const SOL = (r, g, b, a = 1) => ({ type: 'SOLID', color: { r, g, b, a } });
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
const ACCENT = varFill('Color/semantic/accent');
const TEXT_MAIN = varFill('Color/semantic/text-main');
const TEXT_DIM = varFill('Color/semantic/text-dim');
const TEXT_MUTED = varFill('Color/semantic/text-muted');
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const STATUS_SYNC = varFill('Color/semantic/status-sync');
const STATUS_LIKED = varFill('Color/semantic/status-liked');
const glow = (r, g, b, a, radius, spread = 0) => ([{ type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r, g, b, a }, offset: { x: 0, y: 0 }, radius, spread, visible: true }]);
function clearOld(name) {
  page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).filter(n => n.name === name).forEach(n => n.remove());
}
function placeSet(set, x, y) { set.x = x; set.y = y; }
function layoutRow(set, colW, rowH) {
  let maxX = 0, maxY = 0;
  set.children.forEach((ch, i) => { ch.x = i * colW; ch.y = 0; maxX = Math.max(maxX, ch.x + ch.width); maxY = Math.max(maxY, ch.y + ch.height); });
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
const BOLD = { 'Inter': 'Semi Bold', 'JetBrains Mono': 'Bold' };
function tnode(name, str, size, color, mono, bold) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  const family = mono ? 'JetBrains Mono' : 'Inter';
  t.fontName = { family, style: bold ? BOLD[family] : 'Regular' };
  t.fills = [color];
  return t;
}
const created = [];

// ---- 6. Layout/SourceMenu: provider=qq, netease, deezer, spotify (4 variants) ----
clearOld('Layout/SourceMenu');
const SM_LABEL = { qq: 'QQ 音乐', netease: '网易云', deezer: 'Deezer', spotify: 'Spotify' };
const SM_GLYPH = { qq: 'Q', netease: '♪', deezer: '≋', spotify: '◉' };
const SM_COLOR = {
  qq: { fill: varFill('Color/semantic/platform-qq'), r: 1, g: 0.851, b: 0.239 },
  netease: { fill: varFill('Color/semantic/platform-netease'), r: 1, g: 0.231, b: 0.361 },
  deezer: { fill: varFill('Color/semantic/platform-deezer'), r: 0.239, g: 0.608, b: 1 },
  spotify: { fill: varFill('Color/semantic/platform-spotify'), r: 0.239, g: 1, b: 0.635 },
};
const smComps = [];
for (const p of ['qq', 'netease', 'deezer', 'spotify']) {
  const c = figma.createComponent();
  c.name = 'provider=' + p;
  c.layoutMode = 'HORIZONTAL';
  c.itemSpacing = 6;
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.paddingTop = 6; c.paddingBottom = 6;
  c.paddingLeft = 10; c.paddingRight = 10;
  c.fills = [GLASS_FILL];
  c.strokes = [SM_COLOR[p].fill];
  c.strokeWeight = 1;
  c.cornerRadius = 8;
  c.appendChild(tnode('glyph', SM_GLYPH[p], 14, SM_COLOR[p].fill, false, true));
  c.appendChild(tnode('label', SM_LABEL[p], 12, TEXT_MAIN, false, false));
  c.appendChild(tnode('switch', '⇄', 10, TEXT_DIM, false, false));
  const dKey = c.addComponentProperty('disabled', 'BOOLEAN', false);
  c.setProperties({ [dKey]: false });
  smComps.push(c);
  created.push(c.id);
}
const smSet = figma.combineAsVariants(smComps, page);
smSet.name = 'Layout/SourceMenu';
layoutRow(smSet, 180, 50);
placeSet(smSet, 2840, 4400);
smSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/layout/SourceMenu.tsx
  props: { provider: enum[qq|netease|deezer|spotify], onSelect: function }
  a11y: { role: menu, keyboard: [Enter, Escape, ArrowUp, ArrowDown] }
  states: [qq, netease, deezer, spotify]
  tokens: [Color/semantic/glass-fill, Color/semantic/platform-qq, platform-netease, platform-deezer, platform-spotify]
  bindings: [QualityMenu]
---\`;
created.push(smSet.id);

// ---- 7. Layout/DeezerPresetSelect: state=default, hover, open (3 variants) ----
clearOld('Layout/DeezerPresetSelect');
const dsComps = [];
for (const st of ['default', 'hover', 'open']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.layoutMode = 'HORIZONTAL';
  c.itemSpacing = 8;
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'FIXED';
  c.resize(200, 32);
  c.paddingLeft = 12; c.paddingRight = 12;
  c.fills = [st === 'open' ? SOL(1, 1, 1, 0.12) : (st === 'hover' ? SOL(1, 1, 1, 0.10) : GLASS_FILL)];
  c.strokes = [st === 'open' ? ACCENT : GLASS_STROKE];
  c.strokeWeight = 1;
  c.cornerRadius = 8;
  c.appendChild(tnode('text', '亚洲流行 · 24 辑', 12, st === 'hover' || st === 'open' ? TEXT_MAIN : TEXT_DIM, false, false));
  c.appendChild(tnode('chevron', st === 'open' ? '▴' : '▾', 10, st === 'open' ? ACCENT : TEXT_DIM, false, true));
  dsComps.push(c);
  created.push(c.id);
}
const dsSet = figma.combineAsVariants(dsComps, page);
dsSet.name = 'Layout/DeezerPresetSelect';
layoutRow(dsSet, 240, 60);
placeSet(dsSet, 3640, 4400);
dsSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/layout/DeezerPresetSelect.tsx
  props: { editorials: DeezerEditorial[], value: string, onChange: function }
  a11y: { role: combobox, keyboard: [Enter, Space, ArrowUp, ArrowDown] }
  states: [default, hover, open]
  tokens: [Color/semantic/glass-fill, Color/semantic/accent, Color/semantic/text-main]
  bindings: [SourceMenu]
---\`;
created.push(dsSet.id);

// ---- 8. Screen/SourceSelect: state=empty, ready (2 variants，整屏 1440x900) ----
clearOld('Screen/SourceSelect');
const ssComps = [];
for (const st of ['empty', 'ready']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(1440, 900);
  c.fills = [SOL(0.04, 0.04, 0.08, 1)];
  c.clipsContent = true;
  // 4 张 ProviderCard 占位
  const cards = figma.createFrame();
  cards.name = 'cards';
  cards.layoutMode = 'HORIZONTAL';
  cards.itemSpacing = 24;
  cards.primaryAxisAlignItems = 'CENTER';
  cards.counterAxisAlignItems = 'CENTER';
  cards.primaryAxisSizingMode = 'AUTO';
  cards.counterAxisSizingMode = 'AUTO';
  cards.fills = [];
  cards.x = 280; cards.y = 390;
  c.appendChild(cards);
  for (const p of ['Q', 'N', 'D', 'S']) {
    const card = figma.createFrame();
    card.name = 'card/' + p;
    card.layoutMode = 'VERTICAL';
    card.itemSpacing = 8;
    card.primaryAxisAlignItems = 'CENTER';
    card.counterAxisAlignItems = 'CENTER';
    card.primaryAxisSizingMode = 'FIXED';
    card.counterAxisSizingMode = 'FIXED';
    card.resize(192, 240);
    card.fills = [GLASS_FILL];
    card.strokes = [st === 'ready' && p === 'Q' ? STATUS_SYNC : GLASS_STROKE];
    card.strokeWeight = 1;
    card.cornerRadius = 16;
    card.appendChild(tnode('badge', p, 40, TEXT_MAIN, false, true));
    card.appendChild(tnode('name', p, 14, TEXT_MAIN, false, true));
    card.appendChild(tnode('status', st === 'ready' && p === 'Q' ? '已登录' : '未连接', 11, TEXT_DIM, true, false));
    cards.appendChild(card);
  }
  // 标题占位
  const title = tnode('title', '选择音乐来源', 28, TEXT_MAIN, false, true);
  title.x = 580; title.y = 150;
  c.appendChild(title);
  const sub = tnode('sub', '挑一个音源，开始你的宇宙剧场', 14, TEXT_DIM, false, false);
  sub.x = 620; sub.y = 200;
  c.appendChild(sub);
  ssComps.push(c);
  created.push(c.id);
}
const ssSet = figma.combineAsVariants(ssComps, page);
ssSet.name = 'Screen/SourceSelect';
layoutRow(ssSet, 1480, 940);
placeSet(ssSet, 40, 4760);
ssSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/source-select/SourceSelect.tsx
  routes: [source-select]
  props: { onSelect: function }
  a11y: { role: application, keyboard: [Enter, ArrowLeft, ArrowRight] }
  states: [empty, ready]
  tokens: [Color/semantic/glass-fill, Color/semantic/status-sync, Color/semantic/text-main]
  bindings: [Scene/Backdrop, Tag/Stat]
---\`;
created.push(ssSet.id);

// ---- 9. Titlebar: state=logged-out, logged-in, logging-in (3 variants, 1440x40) ----
clearOld('Titlebar');
const tbComps = [];
for (const st of ['logged-out', 'logged-in', 'logging-in']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.layoutMode = 'HORIZONTAL';
  c.itemSpacing = 12;
  c.primaryAxisAlignItems = 'MIN';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'FIXED';
  c.resize(1440, 40);
  c.paddingLeft = 16; c.paddingRight = 16;
  c.fills = [SOL(0.04, 0.04, 0.08, 0.92)];
  c.strokes = [GLASS_STROKE];
  c.strokeWeight = 1;
  c.cornerRadius = 0;
  // brand
  c.appendChild(tnode('brand', 'AETHER ENGINE v3.0', 12, TEXT_MAIN, false, true));
  c.appendChild(tnode('protocol', 'SYSTEM PROTOCOL', 9, TEXT_DIM, true, false));
  // search / reco / liked
  c.appendChild(tnode('search-btn', '🔍 搜索', 11, TEXT_MAIN, false, false));
  c.appendChild(tnode('reco-btn', '🎲 推荐', 11, TEXT_MAIN, false, false));
  c.appendChild(tnode('liked-btn', '❤', 11, STATUS_LIKED, false, true));
  // account 按钮（变体差异）
  if (st === 'logged-out') c.appendChild(tnode('account', '登录', 11, ACCENT, false, true));
  else if (st === 'logged-in') c.appendChild(tnode('account', 'tangshuai', 11, TEXT_MAIN, false, false));
  else c.appendChild(tnode('account', '登录中…', 11, TEXT_DIM, false, false));
  c.appendChild(tnode('settings', '⚙', 11, TEXT_DIM, false, false));
  c.appendChild(tnode('reset', '↺', 11, TEXT_DIM, false, false));
  tbComps.push(c);
  created.push(c.id);
}
const tbSet = figma.combineAsVariants(tbComps, page);
tbSet.name = 'Titlebar';
layoutRow(tbSet, 1480, 80);
placeSet(tbSet, 40, 5760);
tbSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/layout/Titlebar.tsx
  props: { provider, onSwitchProvider, deezerEditorials, deezerPreset, onChangeDeezerPreset, onOpenSearch, recoStatus, recoRunning, onReco, qqQuality, onChangeQuality, loggedIn, loggingIn, accountName, onLogin, onAccount, onReset, likedCount, onOpenLiked, onOpenSettings }
  a11y: { role: toolbar, keyboard: [Tab, Enter, Escape] }
  states: [logged-out, logged-in, logging-in]
  tokens: [Color/semantic/text-main, Color/semantic/accent, Color/semantic/status-liked]
  bindings: [SourceMenu, QualityMenu, DeezerPresetSelect, Button/Text]
---\`;
created.push(tbSet.id);

// ---- 10. Modal/NeteaseCookie: state=empty, qr-shown, cookie-paste, submitting (4 variants, 480x400) ----
clearOld('Modal/NeteaseCookie');
const ncComps = [];
for (const st of ['empty', 'qr-shown', 'cookie-paste', 'submitting']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(480, 400);
  c.layoutMode = 'VERTICAL';
  c.itemSpacing = 16;
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'FIXED';
  c.paddingTop = 32; c.paddingBottom = 24;
  c.paddingLeft = 32; c.paddingRight = 32;
  c.fills = [GLASS_FILL];
  c.strokes = [GLASS_STROKE];
  c.strokeWeight = 1;
  c.cornerRadius = 16;
  c.appendChild(tnode('title', '网易云登录', 18, TEXT_MAIN, false, true));
  // body 容器（按 state 切换内容）
  const body = figma.createFrame();
  body.name = 'body';
  body.layoutMode = 'VERTICAL';
  body.itemSpacing = 12;
  body.primaryAxisAlignItems = 'CENTER';
  body.counterAxisAlignItems = 'CENTER';
  body.primaryAxisSizingMode = 'FIXED';
  body.counterAxisSizingMode = 'FIXED';
  body.resize(416, 220);
  body.fills = [];
  c.appendChild(body);
  if (st === 'empty') {
    body.appendChild(tnode('hint', '扫码或粘贴 cookie', 13, TEXT_DIM, false, false));
  } else if (st === 'qr-shown') {
    const qr = figma.createRectangle();
    qr.name = 'qr';
    qr.resize(200, 200);
    qr.fills = [SOL(1, 1, 1, 0.9)];
    qr.strokes = [GLASS_STROKE];
    qr.strokeWeight = 1;
    qr.cornerRadius = 4;
    body.appendChild(qr);
  } else if (st === 'cookie-paste') {
    const ta = figma.createRectangle();
    ta.name = 'textarea';
    ta.resize(280, 120);
    ta.fills = [SOL(1, 1, 1, 0.04)];
    ta.strokes = [GLASS_STROKE];
    ta.strokeWeight = 1;
    ta.cornerRadius = 6;
    body.appendChild(ta);
    body.appendChild(tnode('submit-btn', '登录', 12, ACCENT, false, true));
  } else if (st === 'submitting') {
    body.appendChild(tnode('spinner', '◌', 32, ACCENT, false, true));
    body.appendChild(tnode('label', '提交中...', 13, TEXT_DIM, false, false));
  }
  // footer
  const footer = figma.createFrame();
  footer.name = 'footer';
  footer.layoutMode = 'HORIZONTAL';
  footer.itemSpacing = 8;
  footer.primaryAxisAlignItems = 'CENTER';
  footer.counterAxisAlignItems = 'CENTER';
  footer.primaryAxisSizingMode = 'AUTO';
  footer.counterAxisSizingMode = 'AUTO';
  footer.fills = [];
  c.appendChild(footer);
  footer.appendChild(tnode('confirm', '确认', 12, TEXT_MAIN, false, false));
  footer.appendChild(tnode('cancel', '取消', 12, TEXT_DIM, false, false));
  ncComps.push(c);
  created.push(c.id);
}
const ncSet = figma.combineAsVariants(ncComps, page);
ncSet.name = 'Modal/NeteaseCookie';
layoutRow(ncSet, 520, 440);
placeSet(ncSet, 1560, 5760);
ncSet.description = \`---
AI_CONTRACT:
  react: packages/renderer/src/components/modals/NeteaseCookieModal.tsx
  props: { onSuccess: function, onClose: function }
  a11y: { role: dialog, keyboard: [Escape, Enter] }
  states: [empty, qr-shown, cookie-paste, submitting]
  tokens: [Color/semantic/glass-fill, Color/semantic/accent, Color/semantic/text-main, Color/semantic/status-error]
  bindings: [Modal/Shell]
---\`;
created.push(ncSet.id);

return { createdNodeIds: created, sets: ['Layout/SourceMenu', 'Layout/DeezerPresetSelect', 'Screen/SourceSelect', 'Titlebar', 'Modal/NeteaseCookie'] };
`;

module.exports = { SEG1, SEG2 };
