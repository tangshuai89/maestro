// ─────────────────────────────────────────────────────────────
// AETHER v4 — AI 驱动设计稿改造 · FOUNDATIONS（第 1 步）
// 文件：FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
// 每个 SEGMENT 是一次独立的 use_figma code 参数（<8k 字符）
// 运行顺序：SEG0 → SEG1 → SEG2 → SEG3（同一次会话内依次调用）
// 规范依据：docs/figma-driven-frontend.md
// ─────────────────────────────────────────────────────────────

// ============ SEG0: 页面结构（4 Pages + 归档旧画布） ============
// 把当前页改名为归档页（v3 画布原样保留，不删），新建 4 个规范页。
const SEG0 = `
// 1. 归档（幂等）：把第一个非规范页改名为 99 · Archive；已存在则跳过。
//    注意：不能依赖 figma.currentPage——每次 use_figma 调用它都会重置回第一页。
const names = ['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion'];
const targetNames = [...names, '99 · Archive'];
let archive = figma.root.children.find(x => x.type === 'PAGE' && x.name === '99 · Archive');
if (!archive) {
  const legacy = figma.root.children.find(x => x.type === 'PAGE' && !targetNames.includes(x.name));
  if (legacy) { legacy.name = '99 · Archive'; archive = legacy; }
}

// 2. 新建 4 页（幂等：已存在则跳过）
const created = [];
for (const n of names) {
  let p = figma.root.children.find(x => x.type === 'PAGE' && x.name === n);
  if (!p) { p = figma.createPage(); p.name = n; created.push(p.id); }
}
// 3. 顺序排好（PageNode 无 index 属性，用 insertChild 移动；沙箱已验证 insertChild 可用）
const order = [...names, '99 · Archive'];
for (let target = 0; target < order.length; target++) {
  const p = figma.root.children.find(x => x.type === 'PAGE' && x.name === order[target]);
  if (p && figma.root.children.indexOf(p) !== target) figma.root.insertChild(target, p);
}
return { createdPageIds: created, archivedPageName: '99 · Archive' };
`;

// ============ SEG1: 变量集合（AETHER 全量令牌） ============
// 集合沿用 'AETHER'（幂等合并），颜色分 primitive/semantic 两层，
// spacing/radius/duration 用 FLOAT，easing 用 STRING（Figma 变量无 easing 类型）。
const SEG1 = `
// 1. 集合
let col = figma.variables.getLocalVariableCollections().find(c => c.name === 'AETHER');
if (!col) col = figma.variables.createVariableCollection('AETHER');
const modeId = col.modes[0].modeId;
const created = [];
function upsert(name, type, value, scopes) {
  let v = figma.variables.getLocalVariables().find(x => x.name === name && x.variableCollectionId === col.id);
  if (!v) { v = figma.variables.createVariable(name, col, type); created.push(v.id); }
  v.setValueForMode(modeId, value);
  if (scopes) v.scopes = scopes;
  return v;
}
// setValueForMode 要求裸值：COLOR 传 {r,g,b,a}、FLOAT/STRING 传原始值；只有 VARIABLE_ALIAS 带 type 字段（沙箱已验证）
const C = (r, g, b, a = 1) => ({ r, g, b, a });
const N = v => v;
const S = v => v;

// 2. Color / primitive（原始色板）——先清理 v3 遗留的无分组旧变量（未绑定，可安全删）
for (const v of figma.variables.getLocalVariables().filter(x => x.variableCollectionId === col.id && !x.name.includes('/'))) {
  try { v.remove(); } catch (e) { /* 若被绑定则保留 */ }
}
const PRIM = [
  ['Color/primitive/bg-top', C(0.039, 0.020, 0.094)],
  ['Color/primitive/bg-bottom', C(0.008, 0.008, 0.039)],
  ['Color/primitive/neon-cyan', C(0, 0.898, 1)],
  ['Color/primitive/electric-purple', C(0.357, 0.169, 1)],
  ['Color/primitive/acid-purple', C(0.710, 0.482, 1)],
  ['Color/primitive/off-white', C(0.961, 0.941, 0.910)],
  ['Color/primitive/heart-red', C(1, 0.231, 0.361)],
  ['Color/primitive/neon-green', C(0.239, 1, 0.635)],
  ['Color/primitive/warning-yellow', C(1, 0.851, 0.239)],
  ['Color/primitive/info-blue', C(0.239, 0.608, 1)],
];
for (const [name, val] of PRIM) upsert(name, 'COLOR', val, ['ALL_FILLS', 'EFFECT_COLOR']);

// 3. Color / semantic（语义色；可 alias 的一律 alias）
const cyan = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/neon-cyan' && x.variableCollectionId === col.id);
const purple = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/electric-purple' && x.variableCollectionId === col.id);
const acid = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/acid-purple' && x.variableCollectionId === col.id);
const white = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/off-white' && x.variableCollectionId === col.id);
const red = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/heart-red' && x.variableCollectionId === col.id);
const green = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/neon-green' && x.variableCollectionId === col.id);
const yellow = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/warning-yellow' && x.variableCollectionId === col.id);
const blue = figma.variables.getLocalVariables().find(x => x.name === 'Color/primitive/info-blue' && x.variableCollectionId === col.id);
const A = id => ({ type: 'VARIABLE_ALIAS', id });
const SEM = [
  ['Color/semantic/accent', A(cyan.id)],
  ['Color/semantic/accent-purple', A(purple.id)],
  ['Color/semantic/ai', A(acid.id)],
  ['Color/semantic/text-main', A(white.id)],
  ['Color/semantic/text-dim', C(0.961, 0.941, 0.910, 0.4)],
  ['Color/semantic/text-muted', C(0.961, 0.941, 0.910, 0.1)],
  ['Color/semantic/glass-fill', C(1, 1, 1, 0.06)],
  ['Color/semantic/glass-fill-strong', C(1, 1, 1, 0.08)],
  ['Color/semantic/glass-stroke', C(1, 1, 1, 0.12)],
  ['Color/semantic/track', C(1, 1, 1, 0.2)],
  ['Color/semantic/white', C(1, 1, 1, 1)],
  ['Color/semantic/status-liked', A(red.id)],
  ['Color/semantic/status-sync', A(green.id)],
  ['Color/semantic/platform-qq', A(yellow.id)],
  ['Color/semantic/platform-netease', A(red.id)],
  ['Color/semantic/platform-deezer', A(blue.id)],
  ['Color/semantic/platform-spotify', A(green.id)],
];
for (const [name, val] of SEM) upsert(name, 'COLOR', val, ['ALL_FILLS', 'EFFECT_COLOR']);

// 4. Spacing / Radius / Motion（数值与字符串变量）
for (const v of [2, 4, 8, 12, 16, 24, 32, 48, 64, 96]) upsert('Spacing/' + v, 'FLOAT', N(v), ['WIDTH_HEIGHT', 'GAP']); // 沙箱 VariableScope 枚举无 WIDTH/HEIGHT/ALL_SPACING/PADDING_*
for (const v of [8, 10, 12, 14, 16, 20, 24]) upsert('Radius/' + v, 'FLOAT', N(v), ['CORNER_RADIUS']); // 沙箱无 ALL_CORNERS；10/14 为组件实测值
upsert('Motion/duration-fast', 'FLOAT', N(120));
upsert('Motion/duration-base', 'FLOAT', N(240));
upsert('Motion/duration-slow', 'FLOAT', N(400));
upsert('Motion/duration-xslow', 'FLOAT', N(700));
upsert('Motion/ease-out', 'STRING', S('cubic-bezier(0.16,1,0.3,1)'));
upsert('Motion/ease-spring', 'STRING', S('cubic-bezier(0.34,1.56,0.64,1)'));
upsert('Motion/ease-in-out', 'STRING', S('ease-in-out'));

return { collectionId: col.id, createdVariableIds: created, total: figma.variables.getLocalVariables().filter(v => v.variableCollectionId === col.id).length };
`;

// ============ SEG2: Text Styles + Effect Styles ============
const SEG2 = `
// 1. 字体加载（Text Style 创建需要）
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

const created = [];
function upsertTextStyle(name, family, style, size, ls, lh) {
  let ts = figma.getLocalTextStyles().find(s => s.name === name);
  if (!ts) { ts = figma.createTextStyle(); ts.name = name; created.push(ts.id); }
  ts.fontName = { family, style };
  ts.fontSize = size;
  if (ls !== undefined) ts.letterSpacing = (/** @type {LetterSpacing} */ ((/** @type {LetterSpacing} */ ({ value: ls, unit: 'PIXELS' }))));
  if (lh !== undefined) ts.lineHeight = { value: lh, unit: 'PIXELS' };
}
upsertTextStyle('AETHER/Display-44', 'Inter', 'Semi Bold', 44, -1, 52);
upsertTextStyle('AETHER/Title-30', 'Inter', 'Semi Bold', 30, -0.5, 38);
upsertTextStyle('AETHER/Title-28', 'Inter', 'Semi Bold', 28, -0.5, 34);
upsertTextStyle('AETHER/Body-18', 'Inter', 'Regular', 18, undefined, 26);
upsertTextStyle('AETHER/Body-16', 'Inter', 'Regular', 16, undefined, 24);
upsertTextStyle('AETHER/Caption-12', 'Inter', 'Regular', 12, undefined, 18);
upsertTextStyle('AETHER/Mono-10', 'JetBrains Mono', 'Regular', 10, 2, 14);
upsertTextStyle('AETHER/Mono-9', 'JetBrains Mono', 'Regular', 9, 2, 12);
// 剧场稿追加（v4-ABC）
upsertTextStyle('AETHER/Title-40', 'Inter', 'Semi Bold', 40, -1, 48);
upsertTextStyle('AETHER/Body-20', 'Inter', 'Regular', 20, undefined, 28);
upsertTextStyle('AETHER/Mono-16', 'JetBrains Mono', 'Regular', 16, 1, 22);

// 2. Effect Styles（玻璃 / 光晕）
function upsertEffectStyle(name, effects) {
  let es = figma.getLocalEffectStyles().find(s => s.name === name);
  if (!es) { es = figma.createEffectStyle(); es.name = name; created.push(es.id); }
  es.effects = effects;
}
upsertEffectStyle('AETHER/Glass/Card', (/** @type {Effect[]} */ ([
  { type: 'BACKGROUND_BLUR', radius: 24, visible: true },
  { type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 8 }, radius: 32, spread: 0, visible: true },
])));
upsertEffectStyle('AETHER/Glass/Overlay', (/** @type {Effect[]} */ ([
  { type: 'BACKGROUND_BLUR', radius: 16, visible: true },
  { type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 4 }, radius: 16, spread: 0, visible: true },
])));
upsertEffectStyle('AETHER/Glow/Cyan', (/** @type {Effect[]} */ ([
  { type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r: 0, g: 0.898, b: 1, a: 0.5 }, offset: { x: 0, y: 0 }, radius: 20, spread: 4, visible: true },
])));
upsertEffectStyle('AETHER/Glow/Purple', (/** @type {Effect[]} */ ([
  { type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r: 0.357, g: 0.169, b: 1, a: 0.35 }, offset: { x: 0, y: 8 }, radius: 40, spread: 0, visible: true },
])));

return { createdStyleIds: created, textStyles: figma.getLocalTextStyles().length, effectStyles: figma.getLocalEffectStyles().length };
`;

// ============ SEG3: README frame（01 · Foundations 页） ============
// AI 每次审计第一件事就是读它：文件结构 / 命名 / 令牌 / 组件清单 / 动效约定 / 审计标准
const SEG3 = `
// 自定位页面：不依赖 currentPage（每次 use_figma 调用会重置回第一页）
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '01 · Foundations') || figma.currentPage;
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

// 幂等：删除旧 README 重建
const old = page.children.find(n => n.name === 'README — AI CONTRACT');
if (old) old.remove();

const W = 1440;
const frame = figma.createFrame();
frame.name = 'README — AI CONTRACT';
frame.resize(W, 40);
frame.x = 0; frame.y = 0;
frame.fills = [(/** @type {SolidPaint} */ ({ type: 'SOLID', color: { r: 0.02, g: 0.02, b: 0.1, a: 1 } }))];
frame.clipsContent = false;
page.appendChild(frame);

const LINES = [
  '# AETHER DESIGN CONTRACT — 本文件是 AI 驱动的设计稿',
  '# 结构: 01 Foundations(本页) / 02 Components / 03 Screens / 04 Motion',
  '',
  '## 命名规范（硬性）',
  '- 组件名: 类别/名称，如 Button/Icon；变体: 属性=值，如 state=hover',
  '- 变体属性名 = 代码状态名: state=default|hover|active|disabled → CSS :hover/.active/[disabled]',
  '- 图层名语义化，禁止 Frame 123 / Rectangle 456',
  '- 同一组件集内跨变体图层名必须一致（Smart Animate 匹配前提）',
  '',
  '## 令牌（集合 AETHER，本页变量）',
  '- Color/primitive/* 原始色；Color/semantic/* 语义色（多数 alias 到 primitive；text-dim/track/white 等带透明度者为独立值）',
  '- Spacing/*（2-96）Radius/*（8/10/12/14/16/20/24）为 FLOAT 变量；Motion/duration-* 为 FLOAT，Motion/ease-* 为 STRING',
  '- Text Styles: AETHER/Display-44 Title-40 Title-30 Title-28 Body-20 Body-18 Body-16 Caption-12 Mono-16 Mono-10 Mono-9',
  '- Effect Styles: AETHER/Glass/Card Glass/Overlay Glow/Cyan Glow/Purple',
  '- 所有节点颜色必须绑定变量，禁止硬编码 hex',
  '',
  '## 代码映射（Figma → SCSS）',
  '- Color/semantic/accent → --accent；text-main→--text-main；glass-fill→--glass-fill',
  '- Spacing/8 → --space-2(8px)；Radius/16 → --radius-md；Display-44 → 44px/字距-1',
  '- Motion/duration-* 与 ease-* 直接生成 CSS transition/animation 参数',
  '',
  '## 组件清单（02 页）— AETHER THEATER 基准（v4-ABC）',
  '- Scene/Backdrop（组件：Nebula+Stardust+Horizon 内建）',
  '- State/RecoUnconfigured（组件：AI 未配置引导态）',
  '- Ring/Sound: state=idle|playing（2）',
  '- Hologram/Cover: state=idle|playing|loading|no-cover（4，TEXT 属性 songTitle/artist/quality/heartCount；封面=图片挂载点，渐变+♪ 为缺失 fallback）',
  '- Lyrics/Line: state=prev|current|next|empty（4，empty=无歌词降级态）',
  '- Core/Play: state=idle|hover|pressed|playing（4）',
  '- Button/Like: state=unliked|liked|fanout（3，跨平台红心 + fanOutCount 徽章）',
  '- Button/Icon: size=sm|md × state=default|hover|active|disabled（8）',
  '- Badge/Platform: platform=qq|netease|deezer|spotify × state=idle|active（8）',
  '- Tag/Stat: tone=cyan|dim|muted|red|green × live=false|true（10）',
  '- Ring/Progress: state=idle|hover|dragging（3，TEXT 属性 tCur/tTotal）',
  '- Card/Neural: state=default|hover（2，TEXT 属性 song/artist/match）',
  '- Controls/Transport: state=playing|paused（2）',
  '',
  '## 动效约定（04 页 + 组件交互）',
  '- 三层编码: 变体即关键帧 + 原型连线(Smart Animate) + MOTION SPEC 文本表',
  '- 参数驱动动效（音频反应类）在 SPEC 表标注数据源，代码端用 CSS 变量实现',
  '',
  '## 演示数据语义化（03 页屏幕文本，AI 还原硬性约定）',
  '- 屏幕内所有具体数值/文案均为演示占位，还原时必须绑定数据源，禁止硬编码：',
  '- heart-count \\'1,284\\' → 收藏数（播放器状态/云端同步，绑定 heartCount）',
  '- telemetry \\'BUFF 99.4% // LAT 47ms\\' → 缓冲质量 + 延迟遥测（绑定实时状态）',
  '- Ring/Progress TEXT props tCur/tTotal（\\'02:14\\' / \\'04:52\\'）→ 当前/总时长',
  '- Tag cyan \\'T: 02:14 / S: 0.82\\' → 播放时钟 + 歌词同步度',
  '- Tag muted \\'TRANSCRIBING // CORE 02\\' → 歌词转写状态标签（状态机文案）',
  '- Tag purple \\'DEEP.SEEK // NEURAL FEED\\' → AI 推荐来源标签',
  '- Hologram/Cover TEXT props songTitle/artist/quality（走钢丝的人/李泉…）→ 歌曲元数据',
  '- HUD wordmark/kicker（AETHER ENGINE v3.0 / SYSTEM PROTOCOL）→ 产品名/协议版本常量',
  '',
  '## 审计标准（scripts/figma-aether-v4-audit.mjs）',
  '- 4 页齐全；README 存在；集合 AETHER 变量 ≥40；Text Styles ≥11；Effect Styles ≥4',
  '- 02 页组件集 10 个且变体数匹配；03 页屏幕 ≥4 且从实例组装；04 页 SPEC 表存在',
  '- 03 页无硬编码颜色（fills 全部带 boundVariables）；原型连线 ≥12 条',
];

const padding = 32;
const lh = 16;
frame.resize(W, padding * 2 + LINES.length * lh);
const rows = [];
LINES.forEach((line, i) => {
  const t = figma.createText();
  t.name = 'row-' + String(i).padStart(2, '0');
  t.characters = line || ' ';
  t.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  t.fontSize = 10;
  t.letterSpacing = (/** @type {LetterSpacing} */ ((/** @type {LetterSpacing} */ ({ value: 0.3, unit: 'PIXELS' }))));
  const isTitle = line.startsWith('#');
  const isSection = line.startsWith('## ');
  t.fills = [(/** @type {SolidPaint} */ ({ type: 'SOLID', color: isTitle ? { r: 0, g: 0.898, b: 1, a: 1 } : isSection ? { r: 0.710, g: 0.482, b: 1, a: 1 } : { r: 0.961, g: 0.941, b: 0.910, a: 0.75 } }))];
  t.x = padding; t.y = padding + i * lh;
  frame.appendChild(t);
  rows.push(t.id);
});
return { readmeNodeId: frame.id, lineNodeIds: rows, lineCount: LINES.length };
`;

module.exports = { SEG0, SEG1, SEG2, SEG3 };
