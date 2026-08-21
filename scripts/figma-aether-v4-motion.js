// ─────────────────────────────────────────────────────────────
// AETHER THEATER v4-ABC — 动效（第 4 步）
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：02（组件交互）+ 04（SPEC 表）
// 每个 SEGMENT 是一次独立的 use_figma code 参数
// 已知平台限制：插件 API 无法写 interactions（COMPONENT/FRAME/INSTANCE 均无该属性），
// 连线段为尽力而为：尝试写入，失败则计数上报，不中断构建。
// 动效规格见 docs/aether-theater-v4-spec.md §MOTION SPEC
// ─────────────────────────────────────────────────────────────

// ============ SEG1: 组件变体原型连线（尽力而为） ============
const SEG1 = `
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findVariant(set, props) {
  return set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
}
const SM = (duration, easing = 'EASE_OUT') => (/** @type {Transition} */ ({ type: 'SMART_ANIMATE', duration, easing: { type: easing } }));
const created = [];
const failed = [];
function wire(from, to, trigger, duration, easing) {
  if (!from || !to) { failed.push('missing-variant'); return; }
  try {
    const t = trigger === 'MOUSE_UP' || trigger === 'MOUSE_DOWN' ? { type: trigger, delay: 0 } : { type: trigger };
    from.interactions = [...(from.interactions || []), {
      trigger: t,
      actions: [{ type: 'NODE', destinationId: to.id, transition: SM(duration, easing) }],
    }];
    created.push(from.id);
  } catch (e) {
    failed.push(from.name + ':' + trigger + ':' + String(e).slice(0, 60));
  }
}

// Core/Play：idle→hover / idle→pressed
const coreSet = findSet('Core/Play');
wire(findVariant(coreSet, { state: 'idle' }), findVariant(coreSet, { state: 'hover' }), 'ON_HOVER', 120, 'EASE_OUT');
wire(findVariant(coreSet, { state: 'idle' }), findVariant(coreSet, { state: 'pressed' }), 'ON_CLICK', 100, 'EASE_IN');
// Button/Icon：default→hover
const iconSet = findSet('Button/Icon');
for (const sz of ['sm', 'md']) {
  wire(findVariant(iconSet, { size: sz, state: 'default' }), findVariant(iconSet, { size: sz, state: 'hover' }), 'ON_HOVER', 120, 'EASE_OUT');
}
// Card/Neural：default→hover
const neuralSet = findSet('Card/Neural');
wire(findVariant(neuralSet, { state: 'default' }), findVariant(neuralSet, { state: 'hover' }), 'ON_HOVER', 160, 'EASE_OUT');
// Ring/Progress：idle→hover / idle→dragging
const progSet = findSet('Ring/Progress');
wire(findVariant(progSet, { state: 'idle' }), findVariant(progSet, { state: 'hover' }), 'ON_HOVER', 120, 'EASE_OUT');
wire(findVariant(progSet, { state: 'idle' }), findVariant(progSet, { state: 'dragging' }), 'MOUSE_DOWN', 100, 'EASE_OUT');
// Lyrics/Line：prev→current→next（演示）
const lyricSet = findSet('Lyrics/Line');
wire(findVariant(lyricSet, { state: 'prev' }), findVariant(lyricSet, { state: 'current' }), 'ON_CLICK', 240, 'EASE_OUT');
wire(findVariant(lyricSet, { state: 'current' }), findVariant(lyricSet, { state: 'next' }), 'ON_CLICK', 240, 'EASE_OUT');
// Ring/Sound：idle→playing 无触发（状态驱动）

return { wiredNodeIds: created, failed, count: created.length, platformNote: 'interactions 受平台限制，见命令手册手动清单' };
`;

// ============ SEG2: 屏幕流转（尽力而为）+ MOTION SPEC 表 ============
const SEG2 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

// 1. 屏幕间原型流转（尽力而为；平台限制时失败计数）
const SM = (duration, easing = 'EASE_OUT') => (/** @type {Transition} */ ({ type: 'SMART_ANIMATE', duration, easing: { type: easing } }));
const playing = /** @type {FrameNode | undefined} */ (page.children.find(n => n.name === 'Screen/NowPlaying/Playing'));
const paused = /** @type {FrameNode | undefined} */ (page.children.find(n => n.name === 'Screen/NowPlaying/Paused'));
const buffering = /** @type {FrameNode | undefined} */ (page.children.find(n => n.name === 'Screen/NowPlaying/Buffering'));
const source = /** @type {FrameNode | undefined} */ (page.children.find(n => n.name === 'Screen/SourceSelect'));
const wired = [];
const failed = [];
function wireNode(from, to, trigger, duration) {
  if (!from) { failed.push('missing-from'); return; }
  try {
    from.interactions = [...(from.interactions || []), {
      trigger: { type: trigger },
      actions: [{ type: 'NODE', destinationId: to.id, transition: SM(duration) }],
    }];
    wired.push(from.id);
  } catch (e) {
    failed.push(from.name + ':' + trigger + ':' + String(e).slice(0, 60));
  }
}
if (playing && paused) {
  const transport = /** @type {FrameNode} */ (playing).findAll(n => n.name === 'controls' && n.type === 'INSTANCE')[0] || playing;
  wireNode(transport, paused, 'ON_CLICK', 200);
}
if (paused && buffering) {
  const transport = /** @type {FrameNode} */ (paused).findAll(n => n.name === 'controls' && n.type === 'INSTANCE')[0] || paused;
  wireNode(transport, buffering, 'ON_CLICK', 200);
}
if (source && playing) {
  const card = source.children.find(n => n.name === 'card-qq') || source;
  wireNode(card, playing, 'ON_CLICK', 240);
}

// 2. MOTION SPEC 表（04 · Motion 页，机器可解析文本）— 剧场版
const motionPage = figma.root.children.find(p => p.name === '04 · Motion');
if (motionPage) {
  const old = motionPage.children.find(n => n.name === 'MOTION SPEC');
  if (old) old.remove();
  const W = 1440, pad = 32, lh = 18;
  const frame = figma.createFrame();
  frame.name = 'MOTION SPEC';
  frame.x = 0; frame.y = 0;
  frame.fills = [(/** @type {SolidPaint} */ ({ type: 'SOLID', color: { r: 0.02, g: 0.02, b: 0.1, a: 1 } }))];
  motionPage.appendChild(frame);
  const ROWS = [
    ['COMPONENT', 'TRIGGER', 'ANIMATION', 'DURATION', 'EASING', 'DRIVEN-BY'],
    ['Ring/Sound', 'playing', '圆环脉冲扩散（循环）', '2400ms', 'ease-in-out', 'playing state'],
    ['Hologram/Cover', 'playing', 'orbit-tick 旋转 + 光晕呼吸', '4000ms', 'linear', 'playing state'],
    ['Lyrics/Line', 'track time', '行切换 fade + slide-up', '240ms', 'cubic-bezier(.16,1,.3,1)', 'audio clock'],
    ['Core/Play', 'hover', 'ring 亮起 + glow', '120ms', 'cubic-bezier(.16,1,.3,1)', '-'],
    ['Core/Play', 'tap', 'scale 0.96 → 1', '100ms', 'ease-in', '-'],
    ['Core/Play', 'playing', 'ring glow pulse（循环）', '2400ms', 'ease-in-out', 'playing state'],
    ['Ring/Progress', 'hover/drag', 'arc 亮起 + dot 放大', '120/100ms', 'ease-out', 'pointer'],
    ['Ring/Progress streaks', 'loop', '飞线束往返扫动（translate 0→-447 / rotate 90°→180° / scale 1→0.831,0.658）', '1200ms', 'ease-in-out alternate', 'loop（代码 th-streaks 已实现）'],
    ['Card/Neural', 'hover', 'lift + 描边亮起', '160ms', 'cubic-bezier(.16,1,.3,1)', '-'],
    ['Button/Icon', 'hover', 'fill 亮起', '120ms', 'cubic-bezier(.16,1,.3,1)', '-'],
    ['Scene/Backdrop', 'audio', '星尘漂移（循环）', '30s', 'linear', 'audio-reactive (bass-intensity)'],
    ['Badge/Platform', 'provider', 'active 外发光', '-', '-', 'provider state'],
    ['Screen', 'state 切换', '整体淡入淡出', '200ms', 'ease-out', 'app state'],
  ];
  const colX = [0, 120, 380, 660, 840, 1080];
  frame.resize(W, pad * 2 + ROWS.length * lh);
  ROWS.forEach((row, i) => {
    row.forEach((cell, ci) => {
      if (cell === '') return;
      const t = figma.createText();
      t.name = 'r' + String(i).padStart(2, '0') + 'c' + ci;
      t.characters = cell;
      t.fontSize = 10;
      t.fontName = { family: 'JetBrains Mono', style: 'Regular' };
      t.fills = [(/** @type {SolidPaint} */ ({ type: 'SOLID', color: i === 0 ? { r: 0, g: 0.898, b: 1, a: 1 } : { r: 0.961, g: 0.941, b: 0.910, a: 0.75 } }))];
      t.x = pad + colX[ci]; t.y = pad + i * lh;
      frame.appendChild(t);
    });
  });
  wired.push(frame.id);
}
return { wiredNodeIds: wired, failed, specTable: '04 · Motion / MOTION SPEC (theater)' };
`;

module.exports = { SEG1, SEG2 };
