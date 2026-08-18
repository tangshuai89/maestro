// ─────────────────────────────────────────────────────────────
// AETHER v3 Professional — Figma 落地代码（分段）
// 每个 SEGMENT 是一次独立的 use_figma code 参数（<8k 字符）
// 文件：FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
// ─────────────────────────────────────────────────────────────

// ============ SEGMENT 1: 设计变量 + 背景 ============
const SEG1 = `
// 1. 创建变量集合
let col = figma.variables.variableCollections.find(c => c.name === 'AETHER');
if (!col) col = figma.variables.createVariableCollection('AETHER');
const modeId = col.modes[0].modeId;
function addVar(name, r, g, b, a = 1) {
  let v = figma.variables.variables.find(x => x.name === name && x.variableCollectionId === col.id);
  if (!v) v = figma.variables.createVariable(name, col, 'COLOR');
  v.setValueForMode(modeId, { type: 'COLOR', r, g, b, a });
}
addVar('bg', 2, 2, 10);
addVar('neon-cyan', 0, 0.898, 1);
addVar('glass-bg', 1, 1, 1, 0.06);
addVar('glass-stroke', 1, 1, 1, 0.12);
addVar('text-main', 0.961, 0.941, 0.910);
addVar('text-dim', 0.961, 0.941, 0.910, 0.4);
addVar('text-muted', 0.961, 0.941, 0.910, 0.1);

// 2. 定位 frame
const page = figma.currentPage;
let canvas = page.children.find(n => n.name === 'AETHER — Canvas') || null;
if (!canvas) {
  canvas = figma.createFrame();
  canvas.name = 'AETHER — Canvas';
  canvas.resize(1440, 900);
  page.appendChild(canvas);
}
// 清空旧内容
for (const ch of [...canvas.children]) ch.remove();

// 3. 背景渐变
canvas.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: [
  { position: 0, color: { r: 0.02, g: 0.02, b: 0.10, a: 1 } },
  { position: 1, color: { r: 0.008, g: 0.008, b: 0.04, a: 1 } }
]}];
canvas.clipsContent = true;
canvas.layoutMode = 'NONE';
canvas.x = 0; canvas.y = 0;
figma.currentPage.selection = [canvas];
figma.viewport.scrollAndZoomIntoView([canvas]);

// 4. 星尘粒子（36 颗小圆点）
function star(x, y, s, alpha) {
  const c = figma.createEllipse();
  c.resize(s, s);
  c.x = x; c.y = y;
  c.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: alpha } }];
  canvas.appendChild(c);
  return c;
}
const rnd = (a, b) => a + Math.random() * (b - a);
for (let i = 0; i < 36; i++) star(rnd(0, 1440), rnd(0, 900), rnd(1, 2.5), rnd(0.08, 0.5));

// 5. 光晕（电紫左上 + 青色右下）
function glow(x, y, size, r, g, b) {
  const e = figma.createEllipse();
  e.resize(size, size);
  e.x = x; e.y = y;
  e.fills = [{ type: 'SOLID', color: { r, g, b, a: 0.12 } }];
  e.effects = [{ type: 'LAYER_BLUR', radius: 80, visible: true }];
  canvas.appendChild(e);
  return e;
}
glow(-150, -150, 500, 0.357, 0.169, 1); // 电紫
glow(1150, 650, 520, 0, 0.898, 1);       // 霓虹青

// 6. 地平线网格
const grid = figma.createFrame();
grid.name = 'horizon-grid';
grid.resize(1440, 260);
grid.x = 0; grid.y = 900;
grid.fills = [];
grid.strokes = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.03 } }];
grid.strokeWeight = 1;
canvas.appendChild(grid);
figma.currentPage.selection = [canvas];
`;

// ============ SEGMENT 2: 顶部协议条 + 平台徽章 ============
const SEG2 = `
const canvas = figma.currentPage.children.find(n => n.name === 'AETHER — Canvas');
function frame(name, x, y, w, h) {
  const f = figma.createFrame();
  f.name = name; f.resize(w, h); f.x = x; f.y = y;
  f.fills = []; f.strokes = [];
  canvas.appendChild(f);
  return f;
}
function text(name, str, size, color, mono = false) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  t.fills = [color];
  t.fontName = mono ? { family: 'JetBrains Mono', style: 'Regular' } : { family: 'Inter', style: 'Regular' };
  canvas.appendChild(t);
  return t;
}
const offWhite = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 1 } };
const dim = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 0.4 } };
const muted = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 0.1 } };
const cyan = { type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 1 } };

// 顶部条
const top = frame('top-bar', 0, 0, 1440, 40);
top.layoutMode = 'HORIZONTAL';
top.itemSpacing = 48; top.paddingLeft = 64; top.paddingRight = 64; top.paddingTop = 12;
top.counterAxisSizingMode = 'FIXED';

const left = frame('left-group', 0, 0, 600, 40);
left.layoutMode = 'HORIZONTAL'; left.itemSpacing = 32;

// 标题组
const titleGroup = frame('title-group', 0, 0, 300, 40);
titleGroup.layoutMode = 'VERTICAL'; titleGroup.itemSpacing = 2;
const p1 = text('protocol', 'SYSTEM PROTOCOL', 9, dim, true);
p1.fontSize = 9; p1.letterSpacing = { value: 2, unit: 'PIXELS' };
const p2 = text('title', 'AETHER ENGINE v3.0', 18, offWhite);
p2.fontName = { family: 'Inter', style: 'Semi Bold' };

// 平台徽章
const badges = frame('platform-badges', 0, 0, 200, 40);
badges.layoutMode = 'HORIZONTAL'; badges.itemSpacing = 12;
function badge(name, letter, color) {
  const b = figma.createFrame();
  b.name = name; b.resize(28, 28);
  b.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.06 } }];
  b.strokes = [{ type: 'SOLID', color }];
  b.strokeWeight = 1; b.cornerRadius = 14;
  b.layoutMode = 'HORIZONTAL'; b.primaryAxisAlignItems = 'CENTER'; b.counterAxisAlignItems = 'CENTER';
  const t = figma.createText();
  t.characters = letter; t.fontSize = 11;
  t.fontName = { family: 'Inter', style: 'Semi Bold' };
  t.fills = [color];
  b.appendChild(t);
  canvas.appendChild(b);
  return b;
}
const qq = badge('QQ', 'Q', { type: 'SOLID', color: { r: 1, g: 0.851, b: 0.239, a: 1 } });
const ne = badge('NetEase', 'N', { type: 'SOLID', color: { r: 1, g: 0.231, b: 0.361, a: 1 } });
const dz = badge('Deezer', 'D', { type: 'SOLID', color: { r: 0.239, g: 0.608, b: 1, a: 1 } });
const sp = badge('Spotify', 'S', { type: 'SOLID', color: { r: 0.239, g: 1, b: 0.635, a: 1 } });
// NetEase 激活
ne.fills = [{ type: 'SOLID', color: { r: 1, g: 0.231, b: 0.361, a: 0.25 } }];
ne.effects = [{ type: 'DROP_SHADOW', color: { r: 1, g: 0.231, b: 0.361, a: 0.5 }, offset: { x: 0, y: 0 }, radius: 12, spread: 2, visible: true }];

// 右状态
const status = frame('status', 0, 0, 300, 40);
status.layoutMode = 'VERTICAL'; status.counterAxisAlignItems = 'END'; status.itemSpacing = 2;
const s1 = text('buff', 'BUFF 99.4% // LAT 47ms', 10, cyan, true);
const s2 = text('neural', 'NEURAL.SYNC ACTIVE', 9, muted, true);
s2.letterSpacing = { value: 2, unit: 'PIXELS' };
`;

// ============ SEGMENT 3: 左栏封面 + 推荐 ============
const SEG3 = `
const canvas = figma.currentPage.children.find(n => n.name === 'AETHER — Canvas');
function frame(name, x, y, w, h) {
  const f = figma.createFrame();
  f.name = name; f.resize(w, h); f.x = x; f.y = y;
  f.fills = []; f.strokes = [];
  canvas.appendChild(f);
  return f;
}
function text(name, str, size, color, mono = false, bold = false) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  t.fills = [color];
  t.fontName = { family: mono ? 'JetBrains Mono' : 'Inter', style: bold ? 'Semi Bold' : 'Regular' };
  canvas.appendChild(t);
  return t;
}
const offWhite = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 1 } };
const dim = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 0.4 } };
const muted = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 0.1 } };
const cyan = { type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 1 } };

const leftCol = frame('left-column', 64, 90, 480, 700);
leftCol.layoutMode = 'VERTICAL'; leftCol.itemSpacing = 40;

// 封面 420x420
const cover = frame('cover', 0, 0, 420, 420);
cover.cornerRadius = 12;
cover.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: [
  { position: 0, color: { r: 0.357, g: 0.169, b: 1, a: 1 } },
  { position: 0.5, color: { r: 0.02, g: 0.02, b: 0.10, a: 1 } },
  { position: 1, color: { r: 0, g: 0.898, b: 1, a: 1 } }
]}];
cover.strokes = [{ type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 0.4 } }];
cover.strokeWeight = 1;
cover.effects = [
  { type: 'DROP_SHADOW', color: { r: 0.357, g: 0.169, b: 1, a: 0.35 }, offset: { x: 0, y: 8 }, radius: 40, spread: 0, visible: true },
  { type: 'LAYER_BLUR', radius: 0, visible: false }
];
// 封面中心 ♪
const sym = text('symbol', '♪', 140, { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.15 } });
sym.x = cover.x + 170; sym.y = cover.y + 140;
// 封面角标
const tagRow = frame('cover-tags', cover.x + 16, cover.y + 380, 388, 28);
tagRow.layoutMode = 'HORIZONTAL'; tagRow.itemSpacing = 8;
const t1 = text('hi-res', 'HI-RES 96KHZ', 9, dim, true);
t1.fills = [muted];
const t2 = text('atmos', 'DOLBY ATMOS', 9, cyan, true);

// 歌名信息
const info = frame('info', 0, 0, 420, 100);
info.layoutMode = 'VERTICAL'; info.itemSpacing = 8;
const title = text('song-title', '走钢丝的人', 44, offWhite, false, true);
title.letterSpacing = { value: -1, unit: 'PIXELS' };
const meta = frame('meta', 0, 0, 420, 30);
meta.layoutMode = 'HORIZONTAL'; meta.itemSpacing = 12; meta.counterAxisAlignItems = 'CENTER';
const artist = text('artist', '李泉', 18, dim);
const dot = figma.createEllipse(); dot.resize(6, 6);
dot.fills = [{ type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 0.4 } }];
const album = text('album', '2001 · 寓言', 18, muted);

// Neural Feed 推荐
const feed = frame('neural-feed', 0, 0, 420, 220);
feed.layoutMode = 'VERTICAL'; feed.itemSpacing = 16;
const feedTitle = text('feed-title', 'NEURAL FEED', 10, dim, true);
feedTitle.letterSpacing = { value: 2, unit: 'PIXELS' };
function recoCard(name, song, artistName, pct, x) {
  const c = frame(name, 0, 0, 420, 56);
  c.layoutMode = 'HORIZONTAL'; c.itemSpacing = 16; c.paddingLeft = 16; c.paddingRight = 16;
  c.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.06 } }];
  c.strokes = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.12 } }];
  c.strokeWeight = 1; c.cornerRadius = 12;
  c.counterAxisAlignItems = 'CENTER';
  const thumb = figma.createFrame();
  thumb.name = 'thumb'; thumb.resize(40, 40); thumb.cornerRadius = 8;
  thumb.fills = [{ type: 'SOLID', color: { r: 0.357, g: 0.169, b: 1, a: 0.3 } }];
  c.appendChild(thumb);
  const info2 = figma.createFrame();
  info2.layoutMode = 'VERTICAL'; info2.itemSpacing = 2;
  info2.counterAxisSizingMode = 'AUTO'; info2.primaryAxisSizingMode = 'AUTO';
  const n1 = text('song', song, 14, offWhite);
  const n2 = text('artist', artistName, 11, dim);
  c.appendChild(info2);
  const p = text('pct', pct, 10, cyan, true);
  c.appendChild(p);
  return c;
}
recoCard('reco-1', '午夜巴黎', '王菲', '94%', 0);
recoCard('reco-2', '孤独患者', '陈奕迅', '88%', 72);
`;

// ============ SEGMENT 4: 右栏歌词卡 + 底部控制 ============
const SEG4 = `
const canvas = figma.currentPage.children.find(n => n.name === 'AETHER — Canvas');
function frame(name, x, y, w, h) {
  const f = figma.createFrame();
  f.name = name; f.resize(w, h); f.x = x; f.y = y;
  f.fills = []; f.strokes = [];
  canvas.appendChild(f);
  return f;
}
function text(name, str, size, color, mono = false, bold = false) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  t.fills = [color];
  t.fontName = { family: mono ? 'JetBrains Mono' : 'Inter', style: bold ? 'Semi Bold' : 'Regular' };
  canvas.appendChild(t);
  return t;
}
const offWhite = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 1 } };
const dim = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 0.4 } };
const muted = { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: 0.1 } };
const cyan = { type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 1 } };

// 歌词卡 400x580
const lyrics = frame('lyrics-card', 560, 90, 400, 580);
lyrics.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.06 } }];
lyrics.strokes = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.12 } }];
lyrics.strokeWeight = 1; lyrics.cornerRadius = 20;
lyrics.layoutMode = 'VERTICAL'; lyrics.paddingLeft = 40; lyrics.paddingRight = 40;
lyrics.paddingTop = 36; lyrics.paddingBottom = 36; lyrics.itemSpacing = 24;

// 卡头
const head = frame('card-head', 0, 0, 320, 30);
head.layoutMode = 'HORIZONTAL'; head.counterAxisAlignItems = 'CENTER';
head.itemSpacing = 0; head.primaryAxisAlignItems = 'SPACE_BETWEEN';
const h1 = text('trans', 'TRANSCRIBING // CORE 02', 10, muted, true);
const h2 = text('live', '● LIVE', 9, cyan, true);

// 分割线
const divider = figma.createRectangle();
divider.resize(320, 1); divider.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.1 } }];
lyrics.appendChild(divider);

// 歌词行
function line(str, size, color, bold = false) {
  const t = text('lyric', str, size, color, false, bold);
  t.letterSpacing = { value: -0.5, unit: 'PIXELS' };
  lyrics.appendChild(t);
  return t;
}
line('有人在欢呼', 18, muted);
// 当前行（带青色左边条）
const cur = frame('current-line', 0, 0, 320, 50);
cur.layoutMode = 'HORIZONTAL'; cur.itemSpacing = 16; cur.counterAxisAlignItems = 'CENTER';
const bar = figma.createRectangle();
bar.resize(3, 44); bar.fills = [{ type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 1 } }];
cur.appendChild(bar);
const curText = text('cur-lyric', '我就像个走钢丝的人', 30, offWhite, false, true);
cur.appendChild(curText);
lyrics.appendChild(cur);
const ts = text('timestamp', 'T: 02:14 / S: 0.82', 9, cyan, true);
lyrics.appendChild(ts);
line('在云端漫步', 18, muted);
line('不曾想过退路', 18, muted);
line('平衡这孤独', 18, muted);

// 底部控制
const footer = frame('footer', 64, 760, 1312, 90);
footer.layoutMode = 'HORIZONTAL'; footer.itemSpacing = 48; footer.counterAxisAlignItems = 'CENTER';
// 控制按钮组
const ctrl = frame('controls', 0, 0, 400, 64);
ctrl.layoutMode = 'HORIZONTAL'; ctrl.itemSpacing = 20; ctrl.counterAxisAlignItems = 'CENTER';
function iconBtn(name, symbol, alpha) {
  const b = figma.createFrame();
  b.name = name; b.resize(40, 40); b.cornerRadius = 20;
  b.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.06 } }];
  b.strokes = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.12 } }];
  b.strokeWeight = 1;
  b.layoutMode = 'HORIZONTAL'; b.primaryAxisAlignItems = 'CENTER'; b.counterAxisAlignItems = 'CENTER';
  const t = text('icon', symbol, 16, { type: 'SOLID', color: { r: 0.961, g: 0.941, b: 0.910, a: alpha } });
  b.appendChild(t);
  ctrl.appendChild(b);
  return b;
}
iconBtn('prev', '⏮', 0.4);
iconBtn('shuffle', '⇄', 0.4);
// 播放键
const play = frame('play', 0, 0, 64, 64);
play.cornerRadius = 32;
play.fills = [{ type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 1 } }];
play.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0.898, b: 1, a: 0.5 }, offset: { x: 0, y: 0 }, radius: 20, spread: 4, visible: true }];
play.layoutMode = 'HORIZONTAL'; play.primaryAxisAlignItems = 'CENTER'; play.counterAxisAlignItems = 'CENTER';
const playIcon = text('play-icon', '▶', 26, { type: 'SOLID', color: { r: 0.02, g: 0.02, b: 0.10, a: 1 } });
play.appendChild(playIcon);
ctrl.appendChild(play);
iconBtn('next', '⏭', 0.4);
iconBtn('repeat', '⟳', 0.4);

// 进度
const prog = frame('progress', 0, 0, 500, 40);
prog.layoutMode = 'VERTICAL'; prog.itemSpacing = 8;
const times = frame('times', 0, 0, 500, 20);
times.layoutMode = 'HORIZONTAL'; times.primaryAxisAlignItems = 'SPACE_BETWEEN';
const t1 = text('t-cur', '02:14', 11, cyan, true);
const t2 = text('t-total', '04:52', 11, muted, true);
prog.appendChild(times);
// 轨道
const track = figma.createRectangle();
track.resize(500, 2); track.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.2 } }];
track.cornerRadius = 1;
prog.appendChild(track);
// 填充（青色，~45%）
const fill = figma.createRectangle();
fill.resize(225, 2); fill.x = 0; fill.y = 30;
fill.fills = [{ type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 1 } }];
fill.cornerRadius = 1;
prog.appendChild(fill);
// 滑块
const knob = figma.createEllipse();
knob.resize(10, 10); knob.x = 220; knob.y = 26;
knob.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }];
knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0.898, b: 1, a: 1 } }];
knob.strokeWeight = 1.5;
prog.appendChild(knob);

// 右下角版权
const ver = text('version', 'NEURAL.SYNC // AES.ENGINE v3.0', 9, muted, true);
ver.x = 64; ver.y = 870;
`;

module.exports = { SEG1, SEG2, SEG3, SEG4 };
