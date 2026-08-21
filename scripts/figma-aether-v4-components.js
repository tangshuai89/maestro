// ─────────────────────────────────────────────────────────────
// AETHER THEATER v4-ABC — 剧场稿组件库（第 2 步）
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：02 · Components
// 基准：99 · Archive 页 AETHER THEATER — 宇宙剧场 · A（见 docs/aether-theater-v4-spec.md）
// 每个 SEGMENT 是一次独立的 use_figma code 参数
// 运行顺序：SEG1 → SEG2 → SEG3 → SEG4（先跑 foundations）
// 已固化沙箱规则：自定位页面 + setCurrentPageAsync、append→addProperty→setReference、
// DROP_SHADOW 带 blendMode、setValueForMode 裸值、变量绑定（varFill）
// ─────────────────────────────────────────────────────────────

// ============ SEG1: Scene/Backdrop + Ring/Sound(2) + Ring/Progress(3) ============
const SEG1 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

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
const ACCENT = varFill('Color/semantic/accent');
const TEXT_MAIN = varFill('Color/semantic/text-main');
const TEXT_DIM = varFill('Color/semantic/text-dim');
const TEXT_MUTED = varFill('Color/semantic/text-muted');
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const WHITE = varFill('Color/semantic/white');
const CYAN = ACCENT;
const DIM = TEXT_DIM;
const MUTED = TEXT_MUTED;
const glow = (r, g, b, a, radius, spread = 0) => (/** @type {DropShadowEffect[]} */ ([{ type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r, g, b, a }, offset: { x: 0, y: 0 }, radius, spread, visible: true }]));
function clearOld(name) {
  page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).filter(n => n.name === name).forEach(n => n.remove());
}
function layoutGrid(set, colKey, colVals, rowKey, rowVals, colW, rowH) {
  let maxX = 0, maxY = 0;
  for (const ch of set.children) {
    const props = Object.fromEntries(ch.name.split(', ').map(p => p.split('=')));
    ch.x = (colVals.indexOf(props[colKey]) || 0) * colW;
    ch.y = (rowVals.indexOf(props[rowKey]) || 0) * rowH;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  }
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
// 组件集平铺错位：Backdrop 占左上 (40,40)；组件集从 x=1540 起 4 列网格（避免全部堆在原点）
function placeSet(set, x, y) {
  set.x = x; set.y = y;
}
function bindVar(node, prop, varName) {
  const v = figma.variables.getLocalVariables().find(x => x.name === varName);
  if (v) node.setBoundVariable(prop, v);
}
// 实例 resize 不会缩放内部绝对定位的 SVG 矢量（保持 24×24 锚左上）——
// 必须同步 resize 矢量并把锚点归零，图标才会真正居中
function fitIcon(inst, size) {
  inst.resize(size, size);
  try {
    const vec = inst.findAllWithCriteria({ types: ['VECTOR'] })[0];
    if (vec) { vec.resize(size, size); vec.x = 0; vec.y = 0; }
  } catch (e) { /* 实例内 override 失败时降级为仅实例 resize */ }
}
function layoutRow(set, colW, rowH) {
  let maxX = 0, maxY = 0;
  set.children.forEach((ch, i) => {
    ch.x = i * colW; ch.y = 0;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  });
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
const created = [];

// ---- Scene/Backdrop（组件：Nebula 星云 + Stardust 星尘 + Horizon 地平线） ----
clearOld('Scene/Backdrop');
const bd = figma.createComponent();
bd.name = 'Scene/Backdrop';
bd.resize(1440, 900);
// 基底：深空径向渐变（与剧场稿 A 帧一致：bg-top → 中调 → bg-bottom）
bd.fills = [(/** @type {GradientPaint} */ ({
  type: 'GRADIENT_RADIAL',
  gradientTransform: [[1, 0, 0], [0, 1, 0]], // 沙箱要求径向渐变带显式 transform
  gradientStops: [
    { position: 0, ...varColor('Color/primitive/bg-top') },
    { position: 0.55, color: { r: 0.024, g: 0.012, b: 0.067, a: 1 } },
    { position: 1, ...varColor('Color/primitive/bg-bottom') },
  ],
}))];
const nebula = (name, x, y, size, varName) => {
  const e = figma.createEllipse();
  e.name = name; e.resize(size, size); e.x = x; e.y = y;
  e.fills = [varFill(varName)];
  e.opacity = 0.12;
  e.effects = (/** @type {BlurEffectNormal[]} */ ([{ type: 'LAYER_BLUR', radius: 80, visible: true }]));
  bd.appendChild(e);
};
nebula('nebula-violet', 40, -55, 500, 'Color/primitive/electric-purple'); // 对齐原稿 (40,-55)
nebula('nebula-cyan', 825, 455, 450, 'Color/primitive/neon-cyan');
nebula('nebula-acid', 460, -50, 400, 'Color/primitive/acid-purple');
// 星尘 60 颗（实测 85，装饰层缩减视觉无差异；如遇操作数限制再降）
for (let i = 0; i < 60; i++) {
  const s = figma.createEllipse();
  s.name = 'star-' + String(i).padStart(2, '0');
  const sz = 1 + Math.random() * 2;
  s.resize(sz, sz);
  s.x = Math.random() * 1440; s.y = Math.random() * 900;
  s.fills = [WHITE];
  s.opacity = 0.08 + Math.random() * 0.42;
  bd.appendChild(s);
}
const horizon = figma.createRectangle();
horizon.name = 'horizon';
horizon.resize(1440, 1);
horizon.x = 0; horizon.y = 820;
horizon.fills = [SOL(1, 1, 1, 0.15)];
bd.appendChild(horizon);
page.appendChild(bd);
bd.x = 40; bd.y = 40;
bd.description = 'Theater backdrop: 3 nebula glows (bound to primitive vars) + 60 stardust particles + horizon line. Motion: stardust drift 30s loop driven by audio-reactive (see MOTION SPEC).';
created.push(bd.id);

// ---- Ring/Sound：state=idle|playing（3 同心描边圆） ----
clearOld('Ring/Sound');
const rs = [];
for (const st of ['idle', 'playing']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(720, 720);
  c.fills = [];
  const rings = [
    // 与原稿一致：idle 即青色描边（240@18% w2 / 300@12% w1.5 / 360@8% w1），playing 更亮
    { name: 'ring-720', x: 0, y: 0, size: 720, stroke: st === 'playing' ? SOL(0, 0.898, 1, 0.45) : SOL(0, 0.898, 1, 0.18), w: 2 },
    { name: 'ring-600', x: 60, y: 60, size: 600, stroke: st === 'playing' ? SOL(1, 1, 1, 0.3) : SOL(0, 0.898, 1, 0.12), w: 1.5 },
    { name: 'ring-480', x: 120, y: 120, size: 480, stroke: st === 'playing' ? SOL(0, 0.898, 1, 0.65) : SOL(0, 0.898, 1, 0.08), w: 1 },
  ];
  for (const { name, x, y, size, stroke, w } of rings) {
    const r = figma.createEllipse();
    r.name = name; r.resize(size, size); r.x = x; r.y = y;
    r.fills = [];
    r.strokes = [stroke];
    r.strokeWeight = w;
    c.appendChild(r);
  }
  if (st === 'playing') {
    (/** @type {EllipseNode} */ (c.children[0])).effects = glow(0, 0.898, 1, 0.5, 30, 4);
  }
  rs.push(c);
  created.push(c.id);
}
const ringSet = figma.combineAsVariants(rs, page);
ringSet.name = 'Ring/Sound';
layoutRow(ringSet, 780, 780);
placeSet(ringSet, 1540, 1100); // 声环宽度 1540，放下方空白行
ringSet.description = 'Sound visualization rings 720×720. Variants: state=idle|playing (playing = cyan tint + outer glow). Motion: playing pulse ∞ 2.4s ease-in-out driven by playing state；Archive 实测关键帧：240 环 480→504→480 尺寸脉动 + 透明度 0.18→0.20→0.15（300/360 环恒定尺寸、透明度微变）。Tokens: accent, glass-stroke.';
created.push(ringSet.id);

// ---- Ring/Progress：state=idle|hover|dragging（环形进度 + 时间戳） ----
clearOld('Ring/Progress');
const rp = [];
for (const st of ['idle', 'hover', 'dragging']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(300, 340);
  c.fills = [];
  const track = figma.createEllipse();
  track.name = 'orbit-track';
  track.resize(300, 300);
  track.fills = [];
  track.strokes = [SOL(1, 1, 1, 0.15)];
  track.strokeWeight = 2;
  c.appendChild(track);
  // 流星飞线束（代码 _theater.scss th-streaks 同源，来自 Archive A 帧 progress-arc 矢量）：
  // 裁切容器 300×324 只露出线束片段，内部矢量 360.781×454.773 青色曲线
  // 动效：1.2s ease-in-out infinite alternate 往返扫动（translate/rotate/scale 补间），见 MOTION SPEC
  const streaksClip = figma.createFrame();
  streaksClip.name = 'streaks-clip';
  streaksClip.resize(300, 324);
  streaksClip.x = 0; streaksClip.y = 0;
  streaksClip.fills = [];
  streaksClip.clipsContent = true;
  c.appendChild(streaksClip);
  const streaks = figma.createNodeFromSvg('<svg width="360.781" height="454.773" viewBox="0 0 360.781 454.773"><path d="M1 1C199.613 2 367.224 89.2524 123.054 64.5371C422.991 168.896 447.655 356.24 141.014 200.961C414.402 447.604 275.085 575.264 39.564 293.923" fill="none" stroke="#00E5FF" stroke-width="2" stroke-linecap="round"/></svg>');
  streaks.name = 'streaks';
  streaks.x = 150; streaks.y = 1; // 代码 th-streaks: left 150 top 1
  streaks.opacity = 0.5;
  streaks.strokes = [ACCENT];
  streaksClip.appendChild(streaks);
  // 45% 进度弧：用 SVG 路径生成矢量弧（EllipseNode 无虚线支持；原剧场稿 progress-arc 即 VECTOR）
  const arc = figma.createNodeFromSvg('<svg width="300" height="300" viewBox="0 0 300 300"><path d="M 296 150 A 146 146 0 0 1 11.15 195.12" fill="none" stroke="#00E5FF" stroke-width="2"/></svg>');
  arc.name = 'progress-arc';
  arc.x = 0; arc.y = 0;
  arc.strokes = [ACCENT];
  arc.strokeWeight = st === 'dragging' ? 3 : 2;
  if (st !== 'idle') arc.effects = glow(0, 0.898, 1, 0.6, 10, 2);
  c.appendChild(arc);
  // ── Archive 三帧关键帧还原（A/B/C 三帧是同一动效的补间关键帧）──
  // A 帧 = streaks 飞线束（上方 streaks 层，容器内 150,1）
  // B 帧 = 收缩成弧 198°（298×298，扫出容器到 -297,1）
  // C 帧 = 弧增长到 234°，dot 沿轨道移到 (25,234)
  // 完整动效：飞线扫过 → 收缩成弧 → 弧增长 → 循环（1.2s ease-in-out）
  // 以下两层为 B/C 关键帧弧线（visible=false，AI 还原时按层名+弧长参数重建）
  const kfB = figma.createNodeFromSvg('<svg width="300" height="300" viewBox="0 0 300 300"><path d="M 296 150 A 146 146 0 1 1 11.15 104.88" fill="none" stroke="#00E5FF" stroke-width="2"/></svg>');
  kfB.name = 'arc-kf-b'; // Archive B 帧：198° 弧（圆心 150,150 r146，从 0° 顺时针 198°）
  kfB.x = -297; kfB.y = 1; // 扫出容器（与 A 帧 translate -447px 一致：150→-297）
  kfB.strokes = [ACCENT];
  kfB.visible = false;
  c.appendChild(kfB);
  const kfC = figma.createNodeFromSvg('<svg width="300" height="300" viewBox="0 0 300 300"><path d="M 296 150 A 146 146 0 1 1 64.18 31.9" fill="none" stroke="#00E5FF" stroke-width="2"/></svg>');
  kfC.name = 'arc-kf-c'; // Archive C 帧：234° 弧（圆心 150,150 r146，从 0° 顺时针 234°）
  kfC.x = -297; kfC.y = 1;
  kfC.strokes = [ACCENT];
  kfC.visible = false;
  c.appendChild(kfC);
  const dotSize = st === 'idle' ? 8 : st === 'hover' ? 10 : 12;
  const dot = figma.createEllipse();
  dot.name = 'orbit-dot';
  dot.resize(dotSize, dotSize);
  dot.x = 191 - (dotSize - 8) / 2; dot.y = 285 - (dotSize - 8) / 2;
  dot.fills = [st === 'dragging' ? ACCENT : WHITE];
  dot.strokes = [ACCENT];
  dot.strokeWeight = 1.5;
  if (st !== 'idle') dot.effects = glow(0, 0.898, 1, 0.7, 8, 2);
  c.appendChild(dot);
  const tCur = figma.createText();
  tCur.name = 't-cur';
  tCur.characters = '02:14';
  tCur.fontSize = 16;
  tCur.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
  tCur.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  tCur.fills = [CYAN];
  // 时间戳定位：轨道（300×300）下方居中，两段左右排开
  tCur.x = 78; tCur.y = 308;
  c.appendChild(tCur);
  const k1 = c.addComponentProperty('tCur', 'TEXT', '02:14');
  tCur.componentPropertyReferences = { characters: k1 };
  const tTotal = figma.createText();
  tTotal.name = 't-total';
  tTotal.characters = '04:52';
  tTotal.fontSize = 16;
  tTotal.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
  tTotal.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  tTotal.fills = [SOL(1, 1, 1, 0.3)];
  tTotal.x = 142; tTotal.y = 308;
  c.appendChild(tTotal);
  const k2 = c.addComponentProperty('tTotal', 'TEXT', '04:52');
  tTotal.componentPropertyReferences = { characters: k2 };
  rp.push(c);
  created.push(c.id);
}
const progSet = figma.combineAsVariants(rp, page);
progSet.name = 'Ring/Progress';
layoutRow(progSet, 380, 420);
placeSet(progSet, 3200, 1100);
progSet.description = 'Circular seek progress 300×300 (arc = 45% via strokeDashes; adjust per instance). Variants: state=idle|hover|dragging (dot 8→10→12). TEXT props tCur/tTotal. 内含 streaks-clip(300×324 裁切) + streaks 矢量（青色线束，代码 _theater.scss th-streaks 同源）+ 关键帧弧 arc-kf-b(198°)/arc-kf-c(234°)（visible=false）。Archive A/B/C 三帧动效：A=飞线束扫过(容器内 150,1) → B=收缩成弧 198°(扫出到 -297,1) → C=弧增长 234° + dot 移轨(25,234)，1.2s ease-in-out 循环。Motion: hover/drag arc glow + dot scale 120/100ms。Tokens: accent, white.';
created.push(progSet.id);

return { createdNodeIds: created, sets: ['Scene/Backdrop', 'Ring/Sound', 'Ring/Progress'] };
`;

// ============ SEG2: Hologram/Cover(3) + Lyrics/Line(4) + Core/Play(4) ============
const SEG2 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

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
const ACCENT = varFill('Color/semantic/accent');
const TEXT_MAIN = varFill('Color/semantic/text-main');
const TEXT_DIM = varFill('Color/semantic/text-dim');
const TEXT_MUTED = varFill('Color/semantic/text-muted');
const CYAN = ACCENT;
const DIM = TEXT_DIM;
const MUTED = TEXT_MUTED;
const glow = (r, g, b, a, radius, spread = 0, y = 0) => (/** @type {DropShadowEffect[]} */ ([{ type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r, g, b, a }, offset: { x: 0, y }, radius, spread, visible: true }]));
const COVER_GRADIENT = (/** @type {GradientPaint} */ ({
  type: 'GRADIENT_LINEAR',
  gradientTransform: [[0, 1, 0], [-1, 0, 1]],
  gradientStops: [
    { position: 0, ...varColor('Color/primitive/electric-purple') },
    { position: 0.5, ...varColor('Color/primitive/bg-bottom') },
    { position: 1, ...varColor('Color/primitive/neon-cyan') },
  ],
}));
function clearOld(name) {
  page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).filter(n => n.name === name).forEach(n => n.remove());
}
function layoutRow(set, colW, rowH) {
  let maxX = 0, maxY = 0;
  set.children.forEach((ch, i) => {
    ch.x = i * colW; ch.y = 0;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  });
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
// 组件集平铺错位（与 SEG1/SEG3/SEG4 一致）
function placeSet(set, x, y) {
  set.x = x; set.y = y;
}
function bindVar(node, prop, varName) {
  const v = figma.variables.getLocalVariables().find(x => x.name === varName);
  if (v) node.setBoundVariable(prop, v);
}
// 实例 resize 不会缩放内部绝对定位的 SVG 矢量（保持 24×24 锚左上）——
// 必须同步 resize 矢量并把锚点归零，图标才会真正居中
function fitIcon(inst, size) {
  inst.resize(size, size);
  try {
    const vec = inst.findAllWithCriteria({ types: ['VECTOR'] })[0];
    if (vec) { vec.resize(size, size); vec.x = 0; vec.y = 0; }
  } catch (e) { /* 实例内 override 失败时降级为仅实例 resize */ }
}
function layoutRow(set, colW, rowH) {
  let maxX = 0, maxY = 0;
  set.children.forEach((ch, i) => {
    ch.x = i * colW; ch.y = 0;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  });
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
const created = [];

// ---- Hologram/Cover：state=idle|playing|loading（轨道 + 全息封面 + caption） ----
clearOld('Hologram/Cover');
const TAU = Math.PI * 2;
const hc = [];
for (const st of ['idle', 'playing', 'loading', 'no-cover']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(480, 500);
  c.fills = [];
  const orbit = figma.createEllipse();
  orbit.name = 'orbit-ring';
  orbit.resize(390, 390);
  orbit.x = 45; orbit.y = 25;
  orbit.fills = [];
  orbit.strokes = [st === 'playing' ? SOL(0, 0.898, 1, 0.5) : SOL(1, 1, 1, 0.2)];
  orbit.strokeWeight = 1.5;
  c.appendChild(orbit);
  const cx = 240, cy = 220, R = 192;
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * TAU;
    const dx = Math.cos(a), dy = Math.sin(a);
    const tick = figma.createLine();
    tick.name = 'orbit-tick-' + String(i + 1).padStart(2, '0');
    tick.resize(14, 1);
    tick.x = cx + dx * R - 7;
    tick.y = cy + dy * R - 0.5;
    tick.rotation = (a * 180) / Math.PI + 90; // 切向（与原稿刻度方向一致，原稿为垂直/水平短线段）
    tick.strokes = [st === 'playing' ? SOL(0, 0.898, 1, 0.6) : SOL(1, 1, 1, 0.3)];
    tick.strokeWeight = 1.5;
    c.appendChild(tick);
  }
  const cover = figma.createEllipse();
  cover.name = 'holographic-cover';
  cover.resize(280, 280);
  cover.x = 100; cover.y = 80; // 对齐原稿 (290,280)（帧置于 190,200 时）
  cover.fills = [COVER_GRADIENT];
  cover.strokes = [SOL(0, 0.898, 1, 0.4)];
  cover.strokeWeight = 1;
  cover.effects = st === 'idle' ? glow(0.357, 0.169, 1, 0.35, 40, 0, 8)
    : st === 'playing' ? glow(0.357, 0.169, 1, 0.55, 44, 6, 8)
    : glow(0.357, 0.169, 1, 0.2, 40, 0, 8);
  if (st === 'loading') cover.opacity = 0.55;
  if (st === 'no-cover') cover.opacity = 0.35;
  // 封面图片挂载点语义：真实封面图替换 cover 层 fills；渐变 + ♪ 为占位/缺失 fallback
  // （沙箱不允许 EllipseNode 设 description，语义写在组件集 description）
  c.appendChild(cover);
  if (st === 'no-cover') {
    // 无封面降级标签（AI 推荐缺封面时展示）
    const nc = figma.createFrame();
    nc.name = 'no-cover-tag';
    nc.layoutMode = 'HORIZONTAL';
    nc.itemSpacing = 6;
    nc.counterAxisAlignItems = 'CENTER';
    nc.primaryAxisSizingMode = 'AUTO';
    nc.counterAxisSizingMode = 'AUTO';
    nc.x = 176; nc.y = 252;
    nc.fills = [SOL(1, 1, 1, 0.08)];
    nc.cornerRadius = 8;
    bindVar(nc, 'cornerRadius', 'Radius/8');
    nc.paddingLeft = 8; nc.paddingRight = 8; nc.paddingTop = 3; nc.paddingBottom = 3;
    const ncLabel = figma.createText();
    ncLabel.name = 'label';
    ncLabel.characters = 'NO COVER';
    ncLabel.fontSize = 8;
    ncLabel.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
    ncLabel.fontName = { family: 'JetBrains Mono', style: 'Regular' };
    ncLabel.fills = [SOL(1, 1, 1, 0.6)];
    nc.appendChild(ncLabel);
    c.appendChild(nc);
  }
  const sym = figma.createText();
  sym.name = 'cover-glyph';
  sym.characters = '♪';
  sym.fontSize = 90;
  sym.fontName = { family: 'Inter', style: 'Regular' };
  sym.fills = [SOL(1, 1, 1, st === 'loading' ? 0.3 : 0.8)];
  // 封面中心 (240,220) 动态居中
  sym.x = 240 - sym.width / 2;
  sym.y = 220 - sym.height / 2;
  c.appendChild(sym);
  const cap = figma.createFrame();
  cap.name = 'cover-caption';
  cap.layoutMode = 'VERTICAL';
  cap.itemSpacing = 4;
  cap.primaryAxisSizingMode = 'AUTO';
  cap.counterAxisSizingMode = 'AUTO';
  cap.x = 141; cap.y = 390; // 对齐原稿 (331,590)
  cap.fills = [];
  const t1 = figma.createText();
  t1.name = 'song-title';
  t1.characters = '走钢丝的人';
  t1.fontSize = 40;
  t1.letterSpacing = (/** @type {LetterSpacing} */ ({ value: -1, unit: 'PIXELS' }));
  t1.fontName = { family: 'Inter', style: 'Semi Bold' };
  t1.fills = [TEXT_MAIN];
  const t2 = figma.createText();
  t2.name = 'meta';
  t2.characters = '李泉 // 2001 · 寓言';
  t2.fontSize = 16;
  t2.fontName = { family: 'Inter', style: 'Regular' };
  t2.fills = [SOL(1, 1, 1, 0.45)];
  const t3 = figma.createText();
  t3.name = 'quality-tag';
  t3.characters = 'HI-RES 24/96 · DOLBY ATMOS';
  t3.fontSize = 10;
  t3.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
  t3.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  t3.fills = [SOL(0, 0.898, 1, 0.6)];
  cap.appendChild(t1);
  cap.appendChild(t2);
  cap.appendChild(t3);
  c.appendChild(cap);
  // 引用必须在节点进入组件树后设置（沙箱规则）
  const k1 = c.addComponentProperty('songTitle', 'TEXT', '走钢丝的人');
  t1.componentPropertyReferences = { characters: k1 };
  const k2 = c.addComponentProperty('artist', 'TEXT', '李泉 // 2001 · 寓言');
  t2.componentPropertyReferences = { characters: k2 };
  const k3 = c.addComponentProperty('quality', 'TEXT', 'HI-RES 24/96 · DOLBY ATMOS');
  t3.componentPropertyReferences = { characters: k3 };
  const heart = figma.createFrame();
  heart.name = 'heart-stat';
  heart.layoutMode = 'HORIZONTAL';
  heart.itemSpacing = 4;
  heart.counterAxisAlignItems = 'CENTER';
  heart.primaryAxisSizingMode = 'AUTO';
  heart.counterAxisSizingMode = 'AUTO';
  heart.x = 370; heart.y = 130; // 对齐原稿 (560,330)：轨道圈内、封面圆外
  heart.fills = [];
  const hi = figma.createText();
  hi.name = 'heart-icon';
  hi.characters = '♥';
  hi.fontSize = 14;
  hi.fontName = { family: 'Inter', style: 'Regular' };
  hi.fills = [varFill('Color/semantic/status-liked')];
  const hcText = figma.createText();
  hcText.name = 'heart-count';
  hcText.characters = '1,284';
  hcText.fontSize = 14;
  hcText.fontName = { family: 'Inter', style: 'Regular' };
  hcText.fills = [SOL(1, 1, 1, 0.6)];
  heart.appendChild(hi);
  heart.appendChild(hcText);
  c.appendChild(heart);
  const k4 = c.addComponentProperty('heartCount', 'TEXT', '1,284');
  hcText.componentPropertyReferences = { characters: k4 };
  const live = figma.createFrame();
  live.name = 'live-tag';
  live.layoutMode = 'HORIZONTAL';
  live.itemSpacing = 6;
  live.counterAxisAlignItems = 'CENTER';
  live.primaryAxisSizingMode = 'AUTO';
  live.counterAxisSizingMode = 'AUTO';
  live.x = 323; live.y = 92; // 对齐原稿 (513,292)
  live.fills = [SOL(1, 1, 1, 0.08)];
  live.cornerRadius = 8;
  bindVar(live, 'cornerRadius', 'Radius/8');
  live.paddingLeft = 8; live.paddingRight = 8; live.paddingTop = 3; live.paddingBottom = 3;
  const dot = figma.createEllipse();
  dot.name = 'dot';
  dot.resize(4, 4);
  dot.fills = [varFill('Color/semantic/status-liked')];
  const lbl = figma.createText();
  lbl.name = 'label';
  lbl.characters = 'LIVE';
  lbl.fontSize = 8;
  lbl.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
  lbl.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  lbl.fills = [CYAN];
  live.appendChild(dot);
  live.appendChild(lbl);
  c.appendChild(live);
  hc.push(c);
  created.push(c.id);
}
const holoSet = figma.combineAsVariants(hc, page);
holoSet.name = 'Hologram/Cover';
layoutRow(holoSet, 540, 560);
placeSet(holoSet, 1540, 40);
holoSet.description = 'Holographic cover area 480×500: orbit ring + 12 ticks + 280×280 holographic cover + caption. Variants: state=idle|playing|loading|no-cover (no-cover = AI 推荐缺封面降级态，显示 NO COVER 标签). 封面图片挂载点 = cover 层（holographic-cover）：AI 还原时替换为封面 URL 图片，渐变+♪ 为占位/缺失 fallback。TEXT props: songTitle/artist/quality/heartCount. Motion: playing orbit rotation 4s loop; loading dims cover. Tokens: accent, ai, status-liked.';
created.push(holoSet.id);

// ---- Lyrics/Line：state=prev|current|next ----
clearOld('Lyrics/Line');
const ll = [];
for (const st of ['prev', 'current', 'next', 'empty']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.layoutMode = 'HORIZONTAL';
  c.itemSpacing = 16;
  bindVar(c, 'itemSpacing', 'Spacing/16');
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.fills = [];
  let lyricText = null;
  if (st === 'current') {
    const bar = figma.createRectangle();
    bar.name = 'active-bar';
    bar.resize(3, 53);
    bar.fills = [CYAN];
    bar.cornerRadius = 1.5;
    c.appendChild(bar);
    lyricText = figma.createText();
    lyricText.name = 'lyric';
    lyricText.characters = '我就像个走钢丝的人';
    lyricText.fontSize = 40;
    lyricText.letterSpacing = (/** @type {LetterSpacing} */ ({ value: -1, unit: 'PIXELS' }));
    lyricText.fontName = { family: 'Inter', style: 'Semi Bold' };
    lyricText.fills = [TEXT_MAIN];
    c.appendChild(lyricText);
  } else if (st === 'empty') {
    // 降级态：无歌词（AI 还原时对应 lyrics 为空的分支）
    lyricText = figma.createText();
    lyricText.name = 'lyric';
    lyricText.characters = '暂无歌词 // NO LYRICS';
    lyricText.fontSize = 20;
    lyricText.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
    lyricText.fontName = { family: 'JetBrains Mono', style: 'Regular' };
    lyricText.fills = [SOL(1, 1, 1, 0.25)];
    c.appendChild(lyricText);
  } else {
    lyricText = figma.createText();
    lyricText.name = 'lyric';
    lyricText.characters = '歌词行';
    lyricText.fontSize = 20;
    lyricText.fontName = { family: 'Inter', style: 'Regular' };
    lyricText.fills = [SOL(1, 1, 1, 0.18)];
    c.appendChild(lyricText);
  }
  const key = c.addComponentProperty('text', 'TEXT', lyricText.characters);
  lyricText.componentPropertyReferences = { characters: key };
  ll.push(c);
  created.push(c.id);
}
const lyricSet = figma.combineAsVariants(ll, page);
lyricSet.name = 'Lyrics/Line';
layoutRow(lyricSet, 460, 110);
placeSet(lyricSet, 1540, 700); // Lyrics 4 变体行排较宽，放 Hologram 下方独立行
lyricSet.description = 'Lyrics line (theater style). Variants: state=prev (20px white18%) | current (40px semibold + cyan active-bar) | next (20px white18%). TEXT prop text. Motion: line advance fade+slide-up 240ms driven by audio clock.';
created.push(lyricSet.id);

// ---- Core/Play：state=idle|hover|pressed|playing（能量核心播放键） ----
clearOld('Core/Play');
const cp = [];
for (const st of ['idle', 'hover', 'pressed', 'playing']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(72, 72);
  c.fills = [];
  const ring = figma.createEllipse();
  ring.name = 'inner-ring';
  ring.resize(52, 52);
  ring.x = 10; ring.y = 10;
  ring.fills = [];
  if (st === 'hover' || st === 'playing') {
    ring.strokes = [CYAN];
    ring.strokeWeight = 2;
    ring.effects = glow(0, 0.898, 1, 0.6, 14, 2);
  } else if (st === 'pressed') {
    ring.strokes = [SOL(1, 1, 1, 0.5)];
    ring.strokeWeight = 1.5;
  } else {
    ring.strokes = [SOL(1, 1, 1, 0.8)];
    ring.strokeWeight = 1.5;
  }
  c.appendChild(ring);
  // SVG 图标（Icon/Play 或 Icon/Pause）+ INSTANCE_SWAP 槽位（替代 Unicode 字符）
  const iconName = st === 'playing' ? 'Icon/Pause' : 'Icon/Play';
  const iconComp = page.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === iconName);
  const icon = iconComp.createInstance();
  icon.name = 'icon';
  icon.x = 36 - 15; icon.y = 36 - 15; // ring 中心 (36,36)
  c.appendChild(icon);
  if (st === 'playing') {
    // playing 变体：不绑定 INSTANCE_SWAP 属性——combineAsVariants 合并同名属性时
    // 默认值统一为第一个变体（idle→Icon/Play），playing 会被拉回 Play。
    // 保持实例级 override（mainComponent 天然 = Icon/Pause），视觉正确。
  } else {
    // 沙箱实证：属性必须每变体自建（addComponentProperty 返回 name#属主ID 格式键，
    // 绑定只认属主组件自己的定义），跨变体复用同一个 key 会失败。
    const key = c.addComponentProperty('icon', 'INSTANCE_SWAP', iconComp.id);
    icon.componentPropertyReferences = { mainComponent: key };
  }
  // fitIcon 必须在属性绑定之后：绑定会重置实例内 override，先调会被清掉
  fitIcon(icon, 30);
  cp.push(c);
  created.push(c.id);
}
const coreSet = figma.combineAsVariants(cp, page);
coreSet.name = 'Core/Play';
layoutRow(coreSet, 110, 110);
placeSet(coreSet, 1540, 1980);
coreSet.description = 'Energy-core play button 72×72 (ring + glyph). Variants: state=idle|hover|pressed|playing (playing shows ⏸ + cyan glow ring). TEXT prop glyph. Motion: hover 120ms, tap 100ms; playing glow pulse driven by playing state.';
created.push(coreSet.id);

return { createdNodeIds: created, sets: ['Hologram/Cover', 'Lyrics/Line', 'Core/Play'] };
`;

// ============ SEG3: Button/Icon(8) + Badge/Platform(8) + Tag/Stat(12) ============
const SEG3 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

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
const ACCENT = varFill('Color/semantic/accent');
const TEXT_MAIN = varFill('Color/semantic/text-main');
const TEXT_DIM = varFill('Color/semantic/text-dim');
const TEXT_MUTED = varFill('Color/semantic/text-muted');
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const CYAN = ACCENT;
const DIM = TEXT_DIM;
const MUTED = TEXT_MUTED;
const glow = (r, g, b, a, radius, spread = 0) => (/** @type {DropShadowEffect[]} */ ([{ type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r, g, b, a }, offset: { x: 0, y: 0 }, radius, spread, visible: true }]));
function clearOld(name) {
  page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).filter(n => n.name === name).forEach(n => n.remove());
}
function layoutGrid(set, colKey, colVals, rowKey, rowVals, colW, rowH) {
  let maxX = 0, maxY = 0;
  for (const ch of set.children) {
    const props = Object.fromEntries(ch.name.split(', ').map(p => p.split('=')));
    ch.x = (colVals.indexOf(props[colKey]) || 0) * colW;
    ch.y = (rowVals.indexOf(props[rowKey]) || 0) * rowH;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  }
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
// 组件集平铺错位：Backdrop 占左上 (40,40)；组件集从 x=1540 起 4 列网格（避免全部堆在原点）
function placeSet(set, x, y) {
  set.x = x; set.y = y;
}
function bindVar(node, prop, varName) {
  const v = figma.variables.getLocalVariables().find(x => x.name === varName);
  if (v) node.setBoundVariable(prop, v);
}
// 实例 resize 不会缩放内部绝对定位的 SVG 矢量（保持 24×24 锚左上）——
// 必须同步 resize 矢量并把锚点归零，图标才会真正居中
function fitIcon(inst, size) {
  inst.resize(size, size);
  try {
    const vec = inst.findAllWithCriteria({ types: ['VECTOR'] })[0];
    if (vec) { vec.resize(size, size); vec.x = 0; vec.y = 0; }
  } catch (e) { /* 实例内 override 失败时降级为仅实例 resize */ }
}
function layoutRow(set, colW, rowH) {
  let maxX = 0, maxY = 0;
  set.children.forEach((ch, i) => {
    ch.x = i * colW; ch.y = 0;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  });
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
const created = [];

// ---- Button/Icon：size=sm|md × state=default|hover|active|disabled ----
clearOld('Button/Icon');
const SIZES = [
  { sz: 'sm', d: 32, fs: 14 },
  { sz: 'md', d: 40, fs: 16 },
];
const STATES = ['default', 'hover', 'active', 'disabled'];
const comps = [];
for (const { sz, d, fs } of SIZES) {
  for (const st of STATES) {
    const c = figma.createComponent();
    c.name = 'size=' + sz + ', state=' + st;
    c.resize(d, d);
    c.layoutMode = 'HORIZONTAL';
    c.primaryAxisSizingMode = 'FIXED';   // 显式固定，防止容器坍缩到内容宽
    c.counterAxisSizingMode = 'FIXED';
    c.primaryAxisAlignItems = 'CENTER';
    c.counterAxisAlignItems = 'CENTER';
    c.cornerRadius = 8;
    if (st === 'default') { c.fills = [GLASS_FILL]; c.strokes = [GLASS_STROKE]; c.strokeWeight = 1; }
    else if (st === 'hover') { c.fills = [SOL(1, 1, 1, 0.1)]; c.strokes = [SOL(1, 1, 1, 0.25)]; c.strokeWeight = 1; }
    else if (st === 'active') { c.fills = [SOL(0, 0.898, 1, 0.18)]; c.strokes = [SOL(0, 0.898, 1, 0.6)]; c.strokeWeight = 1; c.effects = glow(0, 0.898, 1, 0.4, 10, 1); }
    else { c.fills = [GLASS_FILL]; c.strokes = [GLASS_STROKE]; c.strokeWeight = 1; c.opacity = 0.35; }
    bindVar(c, 'cornerRadius', 'Radius/8');
    const iconComp = page.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === 'Icon/Play');
    const icon = iconComp.createInstance();
    icon.name = 'icon';
    c.appendChild(icon);
    const key = c.addComponentProperty('icon', 'INSTANCE_SWAP', iconComp.id);
    icon.componentPropertyReferences = { mainComponent: key };
    // fitIcon 必须在属性绑定之后（绑定会重置实例内 override）
    fitIcon(icon, fs);
    comps.push(c);
    created.push(c.id);
  }
}
const iconSet = figma.combineAsVariants(comps, page);
iconSet.name = 'Button/Icon';
layoutGrid(iconSet, 'size', ['sm', 'md'], 'state', STATES, 100, 90);
placeSet(iconSet, 4800, 40);
iconSet.description = 'Theater icon buttons (core-labels style, radius 8). Variants: size=sm(32)|md(40) × state=default|hover|active|disabled. TEXT prop glyph. Motion: hover 120ms ease-out. Tokens: glass-fill, glass-stroke, accent.';
created.push(iconSet.id);

// ---- Badge/Platform：platform × state ----
clearOld('Badge/Platform');
const PF_COLOR = {
  qq: varFill('Color/semantic/platform-qq'),
  netease: varFill('Color/semantic/platform-netease'),
  deezer: varFill('Color/semantic/platform-deezer'),
  spotify: varFill('Color/semantic/platform-spotify'),
};
const PLATFORMS = [
  { pf: 'qq', letter: 'Q', r: 1, g: 0.851, b: 0.239 },
  { pf: 'netease', letter: 'N', r: 1, g: 0.231, b: 0.361 },
  { pf: 'deezer', letter: 'D', r: 0.239, g: 0.608, b: 1 },
  { pf: 'spotify', letter: 'S', r: 0.239, g: 1, b: 0.635 },
];
const bcomps = [];
for (const { pf, letter, r, g, b } of PLATFORMS) {
  for (const st of ['idle', 'active']) {
    const c = figma.createComponent();
    c.name = 'platform=' + pf + ', state=' + st;
    c.resize(28, 28);
    c.layoutMode = 'HORIZONTAL';
    c.primaryAxisSizingMode = 'FIXED';   // 显式固定，防止坍缩
    c.counterAxisSizingMode = 'FIXED';
    c.primaryAxisAlignItems = 'CENTER';
    c.counterAxisAlignItems = 'CENTER';
    c.cornerRadius = 14;
    bindVar(c, 'cornerRadius', 'Radius/14');
    c.fills = [SOL(1, 1, 1, st === 'active' ? 0.25 : 0.08)];
    c.strokes = [PF_COLOR[pf]];
    c.strokeWeight = 1;
    if (st === 'active') c.effects = glow(r, g, b, 0.5, 12, 2);
    const t = figma.createText();
    t.name = 'letter';
    t.characters = letter;
    t.fontSize = 11;
    t.fontName = { family: 'Inter', style: 'Semi Bold' };
    t.fills = [PF_COLOR[pf]];
    c.appendChild(t);
    // 不给 letter 建 TEXT 属性：combineAsVariants 合并同名属性默认值取第一个
    // 变体（全部变 Q），字母是平台固定视觉（Q/N/D/S），直接写死字符
    bcomps.push(c);
    created.push(c.id);
  }
}
const badgeSet = figma.combineAsVariants(bcomps, page);
badgeSet.name = 'Badge/Platform';
layoutGrid(badgeSet, 'platform', PLATFORMS.map(p => p.pf), 'state', ['idle', 'active'], 80, 70);
placeSet(badgeSet, 3200, 1980);
badgeSet.description = 'Platform badge 28×28. Variants: platform=qq|netease|deezer|spotify × state=idle|active. letter 为平台固定首字母（无 TEXT prop，避免变体合并默认值串位）。Tokens: platform-* semantic colors.';
created.push(badgeSet.id);

// ---- Tag/Stat：tone=cyan|purple|dim|muted|red|green × live=false|true ----
clearOld('Tag/Stat');
const TONES = [
  { tone: 'cyan', color: CYAN },
  { tone: 'purple', color: varFill('Color/semantic/ai') },
  { tone: 'dim', color: DIM },
  { tone: 'muted', color: MUTED },
  { tone: 'red', color: varFill('Color/semantic/status-liked') },
  { tone: 'green', color: varFill('Color/semantic/status-sync') },
];
const tcomps = [];
for (const { tone, color } of TONES) {
  for (const live of ['false', 'true']) {
    const c = figma.createComponent();
    c.name = 'tone=' + tone + ', live=' + live;
    c.layoutMode = 'HORIZONTAL';
    c.itemSpacing = 5;
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'AUTO';
    c.fills = [];
    const dot = figma.createText();
    dot.name = 'dot';
    dot.characters = '● ';
    dot.fontSize = 9;
    dot.fontName = { family: 'JetBrains Mono', style: 'Regular' };
    dot.fills = [varFill('Color/semantic/status-liked')];
    dot.visible = live === 'true';
    const label = figma.createText();
    label.name = 'label';
    label.characters = 'TAG';
    label.fontSize = 10;
    label.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
    label.fontName = { family: 'JetBrains Mono', style: 'Regular' };
    label.fills = [color];
    c.appendChild(dot);
    c.appendChild(label);
    const key = c.addComponentProperty('label', 'TEXT', 'TAG');
    label.componentPropertyReferences = { characters: key };
    tcomps.push(c);
    created.push(c.id);
  }
}
const tagSet = figma.combineAsVariants(tcomps, page);
tagSet.name = 'Tag/Stat';
layoutGrid(tagSet, 'tone', TONES.map(t => t.tone), 'live', ['false', 'true'], 150, 50);
placeSet(tagSet, 4200, 1980);
tagSet.description = 'Telemetry mono label 10px (top-hud/neural style). Variants: tone=cyan|purple|dim|muted|red|green × live=false|true (live shows red ●). TEXT prop label. Tokens: accent, ai, text-*, status-*.';
created.push(tagSet.id);

return { createdNodeIds: created, sets: ['Button/Icon', 'Badge/Platform', 'Tag/Stat'] };
`;

// ============ SEG4: Card/Neural(2) + Controls/Transport(2) ============
const SEG4 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

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
const ACCENT = varFill('Color/semantic/accent');
const TEXT_MAIN = varFill('Color/semantic/text-main');
const TEXT_DIM = varFill('Color/semantic/text-dim');
const TEXT_MUTED = varFill('Color/semantic/text-muted');
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const CYAN = ACCENT;
const DIM = TEXT_DIM;
const MUTED = TEXT_MUTED;
const glow = (r, g, b, a, radius, spread = 0, y = 0) => (/** @type {DropShadowEffect[]} */ ([{ type: 'DROP_SHADOW', blendMode: 'NORMAL', color: { r, g, b, a }, offset: { x: 0, y }, radius, spread, visible: true }]));
const ART_GRADIENT = (/** @type {GradientPaint} */ ({
  type: 'GRADIENT_LINEAR',
  gradientTransform: [[0, 1, 0], [-1, 0, 1]],
  gradientStops: [
    { position: 0, ...varColor('Color/primitive/electric-purple') },
    { position: 1, ...varColor('Color/primitive/neon-cyan') },
  ],
}));
function clearOld(name) {
  page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).filter(n => n.name === name).forEach(n => n.remove());
}
function layoutGrid(set, colKey, colVals, rowKey, rowVals, colW, rowH) {
  let maxX = 0, maxY = 0;
  for (const ch of set.children) {
    const props = Object.fromEntries(ch.name.split(', ').map(p => p.split('=')));
    ch.x = (colVals.indexOf(props[colKey]) || 0) * colW;
    ch.y = (rowVals.indexOf(props[rowKey]) || 0) * rowH;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  }
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
// 组件集平铺错位：Backdrop 占左上 (40,40)；组件集从 x=1540 起 4 列网格（避免全部堆在原点）
function placeSet(set, x, y) {
  set.x = x; set.y = y;
}
function bindVar(node, prop, varName) {
  const v = figma.variables.getLocalVariables().find(x => x.name === varName);
  if (v) node.setBoundVariable(prop, v);
}
// 实例 resize 不会缩放内部绝对定位的 SVG 矢量（保持 24×24 锚左上）——
// 必须同步 resize 矢量并把锚点归零，图标才会真正居中
function fitIcon(inst, size) {
  inst.resize(size, size);
  try {
    const vec = inst.findAllWithCriteria({ types: ['VECTOR'] })[0];
    if (vec) { vec.resize(size, size); vec.x = 0; vec.y = 0; }
  } catch (e) { /* 实例内 override 失败时降级为仅实例 resize */ }
}
function layoutRow(set, colW, rowH) {
  let maxX = 0, maxY = 0;
  set.children.forEach((ch, i) => {
    ch.x = i * colW; ch.y = 0;
    maxX = Math.max(maxX, ch.x + ch.width);
    maxY = Math.max(maxY, ch.y + ch.height);
  });
  set.resizeWithoutConstraints(maxX + 40, maxY + 40);
}
function findSet(name) {
  return page.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name);
}
function findVariant(set, props) {
  return set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
}
const created = [];

// ---- Card/Neural：state=default|hover（120×120 推荐卡） ----
clearOld('Card/Neural');
const ncomps = [];
for (const st of ['default', 'hover']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(120, 120);
  c.cornerRadius = 10;
  bindVar(c, 'cornerRadius', 'Radius/10');
  c.fills = [st === 'hover' ? SOL(1, 1, 1, 0.1) : GLASS_FILL];
  c.strokes = [st === 'hover' ? SOL(1, 1, 1, 0.25) : GLASS_STROKE];
  c.strokeWeight = 1;
  if (st === 'hover') c.effects = glow(0, 0, 0, 0.3, 12, 0, 4);
  const art = figma.createRectangle();
  art.name = 'art-block';
  art.resize(120, 70);
  art.fills = [ART_GRADIENT];
  art.cornerRadius = 8;
  bindVar(art, 'cornerRadius', 'Radius/8');
  // 推荐卡封面图片挂载点语义写在组件集 description（沙箱不支持节点级 description）
  c.appendChild(art);
  const meta = figma.createFrame();
  meta.name = 'meta';
  meta.layoutMode = 'VERTICAL';
  meta.itemSpacing = 2;
  meta.primaryAxisSizingMode = 'AUTO';
  meta.counterAxisSizingMode = 'AUTO';
  meta.x = 10; meta.y = 78;
  meta.fills = [];
  const song = figma.createText();
  song.name = 'song';
  song.characters = '午夜巴黎';
  song.fontSize = 11;
  song.fontName = { family: 'Inter', style: 'Regular' };
  song.fills = [SOL(1, 1, 1, 0.8)];
  const artist = figma.createText();
  artist.name = 'artist';
  artist.characters = '王菲';
  artist.fontSize = 9;
  artist.fontName = { family: 'Inter', style: 'Regular' };
  artist.fills = [SOL(1, 1, 1, 0.35)];
  const match = figma.createText();
  match.name = 'match';
  match.characters = '94%';
  match.fontSize = 9;
  match.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
  match.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  match.fills = [CYAN];
  meta.appendChild(song);
  meta.appendChild(artist);
  meta.appendChild(match);
  c.appendChild(meta);
  const ks = c.addComponentProperty('song', 'TEXT', '午夜巴黎');
  song.componentPropertyReferences = { characters: ks };
  const ka = c.addComponentProperty('artist', 'TEXT', '王菲');
  artist.componentPropertyReferences = { characters: ka };
  const kp = c.addComponentProperty('match', 'TEXT', '94%');
  match.componentPropertyReferences = { characters: kp };
  ncomps.push(c);
  created.push(c.id);
}
const neuralSet = figma.combineAsVariants(ncomps, page);
neuralSet.name = 'Card/Neural';
layoutRow(neuralSet, 180, 180); // 单属性集行排布（避免对角占位）

// ---- State/RecoUnconfigured（AI 未配置引导态组件） ----
clearOld('State/RecoUnconfigured');
const ru = figma.createComponent();
ru.name = 'State/RecoUnconfigured';
ru.resize(392, 132);
ru.layoutMode = 'VERTICAL';
ru.itemSpacing = 10;
ru.counterAxisAlignItems = 'MIN';
ru.primaryAxisSizingMode = 'FIXED';
ru.counterAxisSizingMode = 'FIXED';
ru.fills = [SOL(1, 1, 1, 0.04)];
ru.strokes = [GLASS_STROKE];
ru.strokeWeight = 1;
ru.cornerRadius = 12;
bindVar(ru, 'cornerRadius', 'Radius/12');
ru.paddingLeft = 16; ru.paddingRight = 16; ru.paddingTop = 14; ru.paddingBottom = 14;
const t1 = figma.createText();
t1.name = 'title';
t1.characters = 'AI 推荐未配置';
t1.fontSize = 14;
t1.fontName = { family: 'Inter', style: 'Semi Bold' };
t1.fills = [SOL(1, 1, 1, 0.85)];
const t2 = figma.createText();
t2.name = 'desc';
t2.characters = '在设置中填入 DeepSeek API Key，开启智能推荐';
t2.fontSize = 11;
t2.fontName = { family: 'Inter', style: 'Regular' };
t2.fills = [SOL(1, 1, 1, 0.45)];
const btnRow = figma.createFrame();
btnRow.name = 'actions';
btnRow.layoutMode = 'HORIZONTAL';
btnRow.itemSpacing = 8;
btnRow.counterAxisAlignItems = 'CENTER';
btnRow.primaryAxisSizingMode = 'AUTO';
btnRow.counterAxisSizingMode = 'AUTO';
btnRow.fills = [];
const btn = figma.createFrame();
btn.name = 'btn-configure';
btn.layoutMode = 'HORIZONTAL';
btn.primaryAxisSizingMode = 'AUTO';
btn.counterAxisSizingMode = 'AUTO';
btn.cornerRadius = 8;
bindVar(btn, 'cornerRadius', 'Radius/8');
btn.fills = [GLASS_FILL];
btn.strokes = [GLASS_STROKE];
btn.strokeWeight = 1;
btn.paddingLeft = 10; btn.paddingRight = 10; btn.paddingTop = 5; btn.paddingBottom = 5;
const btnText = figma.createText();
btnText.name = 'label';
btnText.characters = '配置 KEY';
btnText.fontSize = 10;
btnText.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 1, unit: 'PIXELS' }));
btnText.fontName = { family: 'JetBrains Mono', style: 'Regular' };
btnText.fills = [CYAN];
btn.appendChild(btnText);
btnRow.appendChild(btn);
ru.appendChild(t1);
ru.appendChild(t2);
ru.appendChild(btnRow);
page.appendChild(ru);
ru.x = 5400; ru.y = 420;
ru.description = 'AI 推荐未配置引导态（recoConfigured=false）：标题 + 说明 + 配置 KEY 按钮。降级态组件，AI 还原时对应未配置 Key 的分支。';
created.push(ru.id);
placeSet(neuralSet, 4800, 420);
neuralSet.description = 'AI suggestion card 120×120 (art gradient + song/artist/match). Variants: state=default|hover (lift + brighter). TEXT props: song/artist/match. Motion: hover 160ms ease-out. Tokens: accent, ai gradient (primitive bound).';
created.push(neuralSet.id);

// ---- Button/Like：跨平台红心按钮 state=unliked|liked|fanout（fan-out 核心功能） ----
clearOld('Button/Like');
const heartIconComp = page.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === 'Icon/Heart');
const LIKE_STATES = ['unliked', 'liked', 'fanout'];
const lcomps = [];
for (const st of LIKE_STATES) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.resize(40, 40);
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'FIXED';
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.cornerRadius = 8;
  bindVar(c, 'cornerRadius', 'Radius/8');
  const liked = st !== 'unliked';
  c.fills = [liked ? SOL(1, 0.231, 0.361, 0.18) : GLASS_FILL];
  c.strokes = [liked ? SOL(1, 0.231, 0.361, 0.5) : GLASS_STROKE];
  c.strokeWeight = 1;
  if (liked) c.effects = glow(1, 0.231, 0.361, 0.4, 10, 1);
  const icon = heartIconComp.createInstance();
  icon.name = 'icon';
  if (liked) {
    // liked 态：实例内覆盖 heart 描边为红（Icon/Heart 默认白）
    const vec = icon.findAllWithCriteria({ types: ['VECTOR'] })[0];
    if (vec) vec.strokes = [SOL(1, 0.231, 0.361)];
  }
  c.appendChild(icon);
  fitIcon(icon, 18);
  // fan-out 徽章（右上角，fanOutCount=已同步平台数 0-4；非 fanout 变体隐藏但属性一致）
  const badge = figma.createFrame();
  badge.name = 'fanout-badge';
  badge.layoutMode = 'HORIZONTAL';
  badge.counterAxisAlignItems = 'CENTER';
  badge.primaryAxisSizingMode = 'AUTO';
  badge.counterAxisSizingMode = 'AUTO';
  badge.x = 27; badge.y = -5;
  badge.fills = [SOL(0, 0.898, 1, 0.9)];
  badge.cornerRadius = 7;
  bindVar(badge, 'cornerRadius', 'Radius/8');
  badge.paddingLeft = 3; badge.paddingRight = 3; badge.paddingTop = 1; badge.paddingBottom = 1;
  badge.visible = st === 'fanout';
  const num = figma.createText();
  num.name = 'count';
  num.characters = st === 'fanout' ? '3' : '0';
  num.fontSize = 8;
  num.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  num.fills = [SOL(0.02, 0.02, 0.1)];
  badge.appendChild(num);
  c.appendChild(badge);
  const kCnt = c.addComponentProperty('fanOutCount', 'TEXT', st === 'fanout' ? '3' : '0');
  num.componentPropertyReferences = { characters: kCnt };
  lcomps.push(c);
  created.push(c.id);
}
const likeSet = figma.combineAsVariants(lcomps, page);
likeSet.name = 'Button/Like';
layoutRow(likeSet, 90, 90);
placeSet(likeSet, 5900, 1980);
likeSet.description = '跨平台红心按钮 40×40（fan-out 核心功能）。Variants: state=unliked（白心未收藏）| liked（红心+红晕已收藏）| fanout（红心+右上青色徽章显示已同步平台数）。TEXT prop fanOutCount（0-4）。Motion: tap 100ms; liked 红晕 pulse。Tokens: status-liked, glass-fill, accent。';
created.push(likeSet.id);

// ---- Controls/Transport：state=playing|paused（prev + Core/Play + next） ----
clearOld('Controls/Transport');
const iconSet = findSet('Button/Icon');
const coreSet = findSet('Core/Play');
const mdDefault = findVariant(iconSet, { size: 'md', state: 'default' }); // md=40px 与原稿 core-labels 一致
const tcomps = [];
for (const st of ['playing', 'paused']) {
  const c = figma.createComponent();
  c.name = 'state=' + st;
  c.layoutMode = 'HORIZONTAL';
  c.itemSpacing = 24;
  bindVar(c, 'itemSpacing', 'Spacing/24');
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.fills = [];
  const iconCompOf = (name) => page.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name);
  const mkIcon = (iconName) => {
    const inst = mdDefault.createInstance();
    inst.name = 'btn';
    const props = inst.componentProperties;
    for (const [k, d] of Object.entries(props)) {
      if (d.type === 'INSTANCE_SWAP') inst.setProperties({ [k]: iconCompOf(iconName).id });
    }
    c.appendChild(inst);
  };
  mkIcon('Icon/Prev');
  // 跨平台红心按钮（unliked 默认；liked/fanout 见 Button/Like 组件集）
  const likeInst = findVariant(findSet('Button/Like'), { state: 'unliked' }).createInstance();
  likeInst.name = 'like';
  c.appendChild(likeInst);
  const coreVariant = findVariant(coreSet, { state: st === 'playing' ? 'playing' : 'idle' });
  const coreInst = coreVariant.createInstance();
  coreInst.name = 'core';
  c.appendChild(coreInst);
  mkIcon('Icon/Next');
  tcomps.push(c);
  created.push(c.id);
}
const transSet = figma.combineAsVariants(tcomps, page);
transSet.name = 'Controls/Transport';
layoutRow(transSet, 260, 130); // 单属性集行排布
placeSet(transSet, 5400, 1980);
transSet.description = 'Transport cluster (theater): prev + Button/Like(红心) + Core/Play + next. Variants: state=playing|paused (swaps Core/Play variant). 红心为跨平台 fan-out 交互入口（liked/fanout 态见 Button/Like）。Theater draft has no shuffle/repeat — noted in MOTION SPEC as future addition. Tokens: accent, glass-fill, status-liked.';
created.push(transSet.id);

return { createdNodeIds: created, sets: ['Card/Neural', 'Controls/Transport'] };
`;

module.exports = { SEG1, SEG2, SEG3, SEG4 };
