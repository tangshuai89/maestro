// ─────────────────────────────────────────────────────────────
// AETHER THEATER v4-ABC — 剧场稿屏幕（第 3 步）
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：03 · Screens
// 布局基准：99 · Archive 页 AETHER THEATER — 宇宙剧场 · A（1440×900）
// 每个 SEGMENT 是一次独立的 use_figma code 参数
// 运行顺序：SEG1 → SEG2 → SEG3（先跑 foundations + components）
// 屏幕 = 组件实例组装 + 剧场式自由定位（非 v3 分栏）
// ─────────────────────────────────────────────────────────────

// ============ SEG1: 工具 + Screen/NowPlaying/Playing ============
const SEG1 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  return set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
}
function setTextProps(inst, map) {
  // 组件属性 key 是生成式（如 text#12:3），按名字前缀匹配（同名先匹配长的，避免 song 抢 songTitle）
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) inst.setProperties({ [k]: map[name] });
    }
  }
}
function clearOld(names) {
  page.children.filter(n => names.includes(n.name)).forEach(n => n.remove());
}
function textNode(name, str, size, color, mono = false, bold = false, ls) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  t.fontName = { family: mono ? 'JetBrains Mono' : 'Inter', style: bold ? 'Semi Bold' : 'Regular' };
  t.fills = [color];
  if (ls !== undefined) t.letterSpacing = (/** @type {LetterSpacing} */ ({ value: ls, unit: 'PIXELS' }));
  return t;
}
function buildTopHud(screen) {
  const hud = figma.createFrame();
  hud.name = 'top-hud';
  hud.layoutMode = 'HORIZONTAL';
  hud.primaryAxisAlignItems = 'SPACE_BETWEEN';
  hud.counterAxisAlignItems = 'CENTER';
  hud.primaryAxisSizingMode = 'FIXED';
  hud.counterAxisSizingMode = 'FIXED';
  hud.resize(1440, 40);
  hud.x = 0; hud.y = 24;
  hud.paddingLeft = 64; hud.paddingRight = 64;
  hud.fills = [];
  const brand = figma.createFrame();
  brand.name = 'brand';
  brand.layoutMode = 'VERTICAL';
  brand.itemSpacing = 2;
  brand.primaryAxisSizingMode = 'AUTO';
  brand.counterAxisSizingMode = 'AUTO';
  brand.fills = [];
  const wm = textNode('wordmark', 'AETHER ENGINE v3.0', 14, TEXT_MAIN, false, true);
  wm.opacity = 0.85;
  const kk = textNode('kicker', 'SYSTEM PROTOCOL', 9, TEXT_MAIN, true, false, 2);
  kk.opacity = 0.25;
  brand.appendChild(wm);
  brand.appendChild(kk);
  hud.appendChild(brand);
  const tele = figma.createFrame();
  tele.name = 'telemetry';
  tele.layoutMode = 'HORIZONTAL';
  tele.itemSpacing = 16;
  tele.counterAxisAlignItems = 'CENTER';
  tele.primaryAxisSizingMode = 'AUTO';
  tele.counterAxisSizingMode = 'AUTO';
  tele.fills = [];
  tele.appendChild(textNode('stats', 'BUFF 99.4% // LAT 47ms', 10, ACCENT, true));
  const heart = figma.createFrame();
  heart.name = 'heart-stat';
  heart.layoutMode = 'HORIZONTAL';
  heart.itemSpacing = 4;
  heart.counterAxisAlignItems = 'CENTER';
  heart.primaryAxisSizingMode = 'AUTO';
  heart.counterAxisSizingMode = 'AUTO';
  heart.fills = [];
  heart.appendChild(textNode('heart-icon', '♥', 12, varFill('Color/semantic/status-liked')));
  const hc = textNode('heart-count', '1,284', 12, TEXT_MAIN);
  hc.opacity = 0.6;
  heart.appendChild(hc);
  tele.appendChild(heart);
  const dot = figma.createEllipse();
  dot.name = 'online-dot';
  dot.resize(4, 4);
  dot.fills = [varFill('Color/semantic/status-sync')];
  tele.appendChild(dot);
  const rightGroup = figma.createFrame();
  rightGroup.name = 'right-group';
  rightGroup.layoutMode = 'HORIZONTAL';
  rightGroup.itemSpacing = 16;
  rightGroup.counterAxisAlignItems = 'CENTER';
  rightGroup.primaryAxisSizingMode = 'AUTO';
  rightGroup.counterAxisSizingMode = 'AUTO';
  rightGroup.fills = [];
  rightGroup.appendChild(tele);
  const badgeSet = findSet('Badge/Platform');
  const badges = figma.createFrame();
  badges.name = 'platform-badges';
  badges.layoutMode = 'HORIZONTAL';
  badges.itemSpacing = 12;
  badges.counterAxisAlignItems = 'CENTER';
  badges.primaryAxisSizingMode = 'AUTO';
  badges.counterAxisSizingMode = 'AUTO';
  badges.fills = [];
  const mkBadge = (pf, st) => findVariant(badgeSet, { platform: pf, state: st }).createInstance();
  badges.appendChild(mkBadge('qq', 'idle'));
  badges.appendChild(mkBadge('netease', 'active'));
  badges.appendChild(mkBadge('deezer', 'idle'));
  badges.appendChild(mkBadge('spotify', 'idle'));
  rightGroup.appendChild(badges);
  hud.appendChild(rightGroup);
  screen.appendChild(hud);
}
const created = [];

// ---- Screen/NowPlaying/Playing ----
clearOld(['Screen/NowPlaying/Playing']);
const screen = figma.createFrame();
screen.name = 'Screen/NowPlaying/Playing';
screen.resize(1440, 900);
screen.x = 0; screen.y = 0;
screen.clipsContent = true;
screen.fills = []; // 背景由 Scene/Backdrop 提供，帧必须透明（白底会盖住星云）
page.appendChild(screen);
created.push(screen.id);

// 背景（Scene/Backdrop 实例）
const bdInst = findComp('Scene/Backdrop').createInstance();
bdInst.name = 'backdrop';
screen.appendChild(bdInst);
// 声环（Ring/Sound playing）
const ringInst = findVariant(findSet('Ring/Sound'), { state: 'playing' }).createInstance();
ringInst.name = 'sound-rings';
ringInst.x = 70; ringInst.y = 60; // 中心 (430,420) 与全息轨道同心（原稿位置）
screen.appendChild(ringInst);
// 顶部 HUD
buildTopHud(screen);
// 环形进度（左上）
const progInst = findVariant(findSet('Ring/Progress'), { state: 'idle' }).createInstance();
progInst.name = 'star-orbit';
progInst.x = 280; progInst.y = 270;
setTextProps(progInst, { tCur: '02:14', tTotal: '04:52' });
screen.appendChild(progInst);
// 全息封面（左中）
const coverInst = findVariant(findSet('Hologram/Cover'), { state: 'playing' }).createInstance();
coverInst.name = 'hologram';
coverInst.x = 190; coverInst.y = 200; // 与 star-orbit(280,270) 同心（原稿 orbit-ring 中心 430,420）
setTextProps(coverInst, { songTitle: '走钢丝的人', artist: '李泉 // 2001 · 寓言', quality: 'HI-RES 24/96 · DOLBY ATMOS', heartCount: '1,284' });
screen.appendChild(coverInst);
// 歌词流（右区）
const lyricBox = figma.createFrame();
lyricBox.name = 'lyric-stream';
lyricBox.layoutMode = 'VERTICAL';
lyricBox.itemSpacing = 12;
lyricBox.primaryAxisSizingMode = 'AUTO';
lyricBox.counterAxisSizingMode = 'FIXED'; // 宽度定 560（原稿），高度随内容
lyricBox.resize(560, 100);
lyricBox.x = 820; lyricBox.y = 320;
lyricBox.fills = [];
const tagSet = findSet('Tag/Stat');
const mkTag = (tone, live, label) => {
  const inst = findVariant(tagSet, { tone, live }).createInstance();
  setTextProps(inst, { label });
  return inst;
};
lyricBox.appendChild(mkTag('muted', 'false', 'TRANSCRIBING // CORE 02'));
const lyricSet = findSet('Lyrics/Line');
const mkLyric = (state, label) => {
  const inst = findVariant(lyricSet, { state }).createInstance();
  setTextProps(inst, { text: label });
  return inst;
};
lyricBox.appendChild(mkLyric('prev', '有人在欢呼'));
lyricBox.appendChild(mkLyric('current', '我就像个走钢丝的人'));
lyricBox.appendChild(mkLyric('next', '在云端漫步'));
lyricBox.appendChild(mkLyric('next', '不曾想过退路'));
lyricBox.appendChild(mkLyric('next', '平衡这孤独'));
lyricBox.appendChild(mkTag('cyan', 'false', 'T: 02:14 / S: 0.82'));
screen.appendChild(lyricBox);
// 播放控制（左下）：x=266 使播放键中心(266+164=430)与全息封面中心(190+240)同心
const transInst = findVariant(findSet('Controls/Transport'), { state: 'playing' }).createInstance();
transInst.name = 'controls';
transInst.x = 266; transInst.y = 700;
screen.appendChild(transInst);
// 神经推荐（右下）
const neuralBox = figma.createFrame();
neuralBox.name = 'neural-suggestions';
neuralBox.layoutMode = 'VERTICAL';
neuralBox.itemSpacing = 16;
neuralBox.primaryAxisSizingMode = 'AUTO';
neuralBox.counterAxisSizingMode = 'AUTO';
neuralBox.x = 1000; neuralBox.y = 700;
neuralBox.fills = [];
neuralBox.appendChild(mkTag('purple', 'false', 'DEEP.SEEK // NEURAL FEED'));
const cards = figma.createFrame();
cards.name = 'suggestion-cards';
cards.layoutMode = 'HORIZONTAL';
cards.itemSpacing = 16;
cards.primaryAxisSizingMode = 'AUTO';
cards.counterAxisSizingMode = 'AUTO';
cards.fills = [];
const neuralSet = findSet('Card/Neural');
const mkNeural = (song, artist, match) => {
  const inst = findVariant(neuralSet, { state: 'default' }).createInstance();
  setTextProps(inst, { song, artist, match });
  return inst;
};
cards.appendChild(mkNeural('午夜巴黎', '王菲', '94%'));
cards.appendChild(mkNeural('孤独患者', '陈奕迅', '88%'));
cards.appendChild(mkNeural('夜的第七章', '周杰伦', '91%'));
neuralBox.appendChild(cards);
screen.appendChild(neuralBox);

return { createdNodeIds: created, screen: 'Screen/NowPlaying/Playing' };
`;

// ============ SEG2: Paused + Buffering（复用 SEG1 结构） ============
const SEG2 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
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
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  return set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
}
function setTextProps(inst, map) {
  // 组件属性 key 是生成式（如 text#12:3），按名字前缀匹配（同名先匹配长的，避免 song 抢 songTitle）
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) inst.setProperties({ [k]: map[name] });
    }
  }
}
function clearOld(names) {
  page.children.filter(n => names.includes(n.name)).forEach(n => n.remove());
}
function textNode(name, str, size, color, mono = false, bold = false, ls) {
  const t = figma.createText();
  t.name = name; t.characters = str; t.fontSize = size;
  t.fontName = { family: mono ? 'JetBrains Mono' : 'Inter', style: bold ? 'Semi Bold' : 'Regular' };
  t.fills = [color];
  if (ls !== undefined) t.letterSpacing = (/** @type {LetterSpacing} */ ({ value: ls, unit: 'PIXELS' }));
  return t;
}
function buildTopHud(screen) {
  const hud = figma.createFrame();
  hud.name = 'top-hud';
  hud.layoutMode = 'HORIZONTAL';
  hud.primaryAxisAlignItems = 'SPACE_BETWEEN';
  hud.counterAxisAlignItems = 'CENTER';
  hud.primaryAxisSizingMode = 'FIXED';
  hud.counterAxisSizingMode = 'FIXED';
  hud.resize(1440, 40);
  hud.x = 0; hud.y = 24;
  hud.paddingLeft = 64; hud.paddingRight = 64;
  hud.fills = [];
  const brand = figma.createFrame();
  brand.name = 'brand';
  brand.layoutMode = 'VERTICAL';
  brand.itemSpacing = 2;
  brand.primaryAxisSizingMode = 'AUTO';
  brand.counterAxisSizingMode = 'AUTO';
  brand.fills = [];
  const wm = textNode('wordmark', 'AETHER ENGINE v3.0', 14, TEXT_MAIN, false, true);
  wm.opacity = 0.85;
  const kk = textNode('kicker', 'SYSTEM PROTOCOL', 9, TEXT_MAIN, true, false, 2);
  kk.opacity = 0.25;
  brand.appendChild(wm);
  brand.appendChild(kk);
  hud.appendChild(brand);
  const tele = figma.createFrame();
  tele.name = 'telemetry';
  tele.layoutMode = 'HORIZONTAL';
  tele.itemSpacing = 16;
  tele.counterAxisAlignItems = 'CENTER';
  tele.primaryAxisSizingMode = 'AUTO';
  tele.counterAxisSizingMode = 'AUTO';
  tele.fills = [];
  tele.appendChild(textNode('stats', 'BUFF 99.4% // LAT 47ms', 10, ACCENT, true));
  const heart = figma.createFrame();
  heart.name = 'heart-stat';
  heart.layoutMode = 'HORIZONTAL';
  heart.itemSpacing = 4;
  heart.counterAxisAlignItems = 'CENTER';
  heart.primaryAxisSizingMode = 'AUTO';
  heart.counterAxisSizingMode = 'AUTO';
  heart.fills = [];
  heart.appendChild(textNode('heart-icon', '♥', 12, varFill('Color/semantic/status-liked')));
  const hc = textNode('heart-count', '1,284', 12, TEXT_MAIN);
  hc.opacity = 0.6;
  heart.appendChild(hc);
  tele.appendChild(heart);
  const dot = figma.createEllipse();
  dot.name = 'online-dot';
  dot.resize(4, 4);
  dot.fills = [varFill('Color/semantic/status-sync')];
  tele.appendChild(dot);
  const rightGroup = figma.createFrame();
  rightGroup.name = 'right-group';
  rightGroup.layoutMode = 'HORIZONTAL';
  rightGroup.itemSpacing = 16;
  rightGroup.counterAxisAlignItems = 'CENTER';
  rightGroup.primaryAxisSizingMode = 'AUTO';
  rightGroup.counterAxisSizingMode = 'AUTO';
  rightGroup.fills = [];
  rightGroup.appendChild(tele);
  const badgeSet = findSet('Badge/Platform');
  const badges = figma.createFrame();
  badges.name = 'platform-badges';
  badges.layoutMode = 'HORIZONTAL';
  badges.itemSpacing = 12;
  badges.counterAxisAlignItems = 'CENTER';
  badges.primaryAxisSizingMode = 'AUTO';
  badges.counterAxisSizingMode = 'AUTO';
  badges.fills = [];
  const mkBadge = (pf, st) => findVariant(badgeSet, { platform: pf, state: st }).createInstance();
  badges.appendChild(mkBadge('qq', 'idle'));
  badges.appendChild(mkBadge('netease', 'active'));
  badges.appendChild(mkBadge('deezer', 'idle'));
  badges.appendChild(mkBadge('spotify', 'idle'));
  rightGroup.appendChild(badges);
  hud.appendChild(rightGroup);
  screen.appendChild(hud);
}
function buildScreen(name, x, coverState, ringState, transportState, extra) {
  clearOld([name]);
  const screen = figma.createFrame();
  screen.name = name;
  screen.resize(1440, 900);
  screen.x = x; screen.y = 0;
  screen.clipsContent = true;
  screen.fills = []; // 背景由 Scene/Backdrop 提供，帧必须透明（白底会盖住星云）
  page.appendChild(screen);
  const bdInst = findComp('Scene/Backdrop').createInstance();
  bdInst.name = 'backdrop';
  screen.appendChild(bdInst);
  const ringInst = findVariant(findSet('Ring/Sound'), { state: ringState }).createInstance();
  ringInst.name = 'sound-rings';
  ringInst.x = 70; ringInst.y = 60; // 中心 (430,420) 与全息轨道同心（原稿位置）
  screen.appendChild(ringInst);
  buildTopHud(screen);
  const progInst = findVariant(findSet('Ring/Progress'), { state: 'idle' }).createInstance();
  progInst.name = 'star-orbit';
  progInst.x = 280; progInst.y = 270;
  setTextProps(progInst, { tCur: '02:14', tTotal: '04:52' });
  screen.appendChild(progInst);
  const coverInst = findVariant(findSet('Hologram/Cover'), { state: coverState }).createInstance();
  coverInst.name = 'hologram';
  coverInst.x = 190; coverInst.y = 200; // 与 star-orbit(280,270) 同心（原稿 orbit-ring 中心 430,420）
  setTextProps(coverInst, { songTitle: '走钢丝的人', artist: '李泉 // 2001 · 寓言', quality: 'HI-RES 24/96 · DOLBY ATMOS', heartCount: '1,284' });
  screen.appendChild(coverInst);
  const lyricBox = figma.createFrame();
  lyricBox.name = 'lyric-stream';
  lyricBox.layoutMode = 'VERTICAL';
  lyricBox.itemSpacing = 12;
  lyricBox.primaryAxisSizingMode = 'AUTO';
  lyricBox.counterAxisSizingMode = 'FIXED'; // 宽度定 560（原稿），高度随内容
  lyricBox.resize(560, 100);
  lyricBox.x = 820; lyricBox.y = 320;
  lyricBox.fills = [];
  const tagSet = findSet('Tag/Stat');
  const mkTag = (tone, live, label) => {
    const inst = findVariant(tagSet, { tone, live }).createInstance();
    setTextProps(inst, { label });
    return inst;
  };
  lyricBox.appendChild(mkTag('muted', 'false', 'TRANSCRIBING // CORE 02'));
  const lyricSet = findSet('Lyrics/Line');
  const mkLyric = (state, label) => {
    const inst = findVariant(lyricSet, { state }).createInstance();
    setTextProps(inst, { text: label });
    return inst;
  };
  lyricBox.appendChild(mkLyric('prev', '有人在欢呼'));
  lyricBox.appendChild(mkLyric('current', '我就像个走钢丝的人'));
  lyricBox.appendChild(mkLyric('next', '在云端漫步'));
  lyricBox.appendChild(mkLyric('next', '不曾想过退路'));
  lyricBox.appendChild(mkLyric('next', '平衡这孤独'));
  lyricBox.appendChild(mkTag('cyan', 'false', 'T: 02:14 / S: 0.82'));
  screen.appendChild(lyricBox);
  const transInst = findVariant(findSet('Controls/Transport'), { state: transportState }).createInstance();
  transInst.name = 'controls';
  transInst.x = 266; transInst.y = 700; // 播放键中心与封面中心(430)同心（含红心后右移 30）
  screen.appendChild(transInst);
  const neuralBox = figma.createFrame();
  neuralBox.name = 'neural-suggestions';
  neuralBox.layoutMode = 'VERTICAL';
  neuralBox.itemSpacing = 16;
  neuralBox.primaryAxisSizingMode = 'AUTO';
  neuralBox.counterAxisSizingMode = 'AUTO';
  neuralBox.x = 1000; neuralBox.y = 700;
  neuralBox.fills = [];
  neuralBox.appendChild(mkTag('purple', 'false', 'DEEP.SEEK // NEURAL FEED'));
  const cards = figma.createFrame();
  cards.name = 'suggestion-cards';
  cards.layoutMode = 'HORIZONTAL';
  cards.itemSpacing = 16;
  cards.primaryAxisSizingMode = 'AUTO';
  cards.counterAxisSizingMode = 'AUTO';
  cards.fills = [];
  const neuralSet = findSet('Card/Neural');
  const mkNeural = (song, artist, match) => {
    const inst = findVariant(neuralSet, { state: 'default' }).createInstance();
    setTextProps(inst, { song, artist, match });
    return inst;
  };
  cards.appendChild(mkNeural('午夜巴黎', '王菲', '94%'));
  cards.appendChild(mkNeural('孤独患者', '陈奕迅', '88%'));
  cards.appendChild(mkNeural('夜的第七章', '周杰伦', '91%'));
  neuralBox.appendChild(cards);
  screen.appendChild(neuralBox);
  if (extra) extra(screen, mkTag);
  return screen.id;
}
const created = [];
created.push(buildScreen('Screen/NowPlaying/Paused', 1560, 'idle', 'idle', 'paused'));
created.push(buildScreen('Screen/NowPlaying/Buffering', 3120, 'loading', 'idle', 'paused', (screen, mkTag) => {
  const t = mkTag('cyan', 'true', 'BUFFERING // STREAM');
  t.x = 820; t.y = 620;
  screen.appendChild(t);
}));
return { createdNodeIds: created, screens: ['Screen/NowPlaying/Paused', 'Screen/NowPlaying/Buffering'] };
`;

// ============ SEG3: Screen/SourceSelect ============
const SEG3 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

const SOL = (r, g, b, a = 1) => (/** @type {SolidPaint} */ ({ type: 'SOLID', color: { r, g, b, a } }));
const varFill = (name) => {
  const vv = figma.variables.getLocalVariables().find(x => x.name === name);
  let raw = null, cur = vv, depth = 0;
  while (cur && depth < 8) {
    const col = figma.variables.getLocalVariableCollections().find(c => c.id === cur.variableCollectionId);
    raw = cur.valuesByMode[col ? col.modes[0].modeId : null];
    if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'VARIABLE_ALIAS') { cur = figma.variables.getLocalVariables().find(x => x.id === raw.id); depth++; }
    else break;
  }
  const c = raw && typeof raw === 'object' && 'r' in raw && 'g' in raw && 'b' in raw ? (/** @type {RGB | RGBA} */ (raw)) : { r: 1, g: 0, b: 1, a: 1 };
  return (/** @type {SolidPaint} */ ({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b, a: 'a' in c ? c.a : 1 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: vv.id } } }));
};
const DIM = varFill('Color/semantic/text-dim');
const OFF = varFill('Color/semantic/text-main');
const GLASS_FILL = varFill('Color/semantic/glass-fill');
const GLASS_STROKE = varFill('Color/semantic/glass-stroke');
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  return set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
}
const created = [];

page.children.filter(n => n.name === 'Screen/SourceSelect').forEach(n => n.remove());
const screen = figma.createFrame();
screen.name = 'Screen/SourceSelect';
screen.resize(1440, 900);
screen.x = 4680; screen.y = 0;
screen.clipsContent = true;
screen.fills = []; // 背景由 Scene/Backdrop 提供
page.appendChild(screen);
created.push(screen.id);

const bdInst = findComp('Scene/Backdrop').createInstance();
bdInst.name = 'backdrop';
screen.appendChild(bdInst);

const titleBox = figma.createFrame();
titleBox.name = 'title-box';
titleBox.layoutMode = 'VERTICAL';
titleBox.itemSpacing = 12;
titleBox.counterAxisAlignItems = 'CENTER';
titleBox.primaryAxisSizingMode = 'AUTO';
titleBox.counterAxisSizingMode = 'AUTO';
titleBox.x = 0; titleBox.y = 160;
titleBox.fills = [];
const t1 = figma.createText();
t1.name = 'heading';
t1.characters = '选择音乐来源';
t1.fontSize = 28;
t1.fontName = { family: 'Inter', style: 'Semi Bold' };
t1.fills = [OFF];
const t2 = figma.createText();
t2.name = 'sub';
t2.characters = '挑一个音源，开始你的电台';
t2.fontSize = 16;
t2.fontName = { family: 'Inter', style: 'Regular' };
t2.fills = [DIM];
titleBox.appendChild(t1);
titleBox.appendChild(t2);
screen.appendChild(titleBox);

const badgeSet = findSet('Badge/Platform');
const cards = figma.createFrame();
cards.name = 'platform-cards';
cards.layoutMode = 'HORIZONTAL';
cards.itemSpacing = 32;
cards.counterAxisAlignItems = 'CENTER';
cards.primaryAxisSizingMode = 'AUTO';
cards.counterAxisSizingMode = 'AUTO';
cards.x = 0; cards.y = 340;
cards.fills = [];
screen.appendChild(cards);
const PLATFORMS = [
  ['qq', 'QQ 音乐', '高品质音源'],
  ['netease', '网易云', '华语曲库'],
  ['deezer', 'Deezer', '国际曲库'],
  ['spotify', 'Spotify', '海外曲库'],
];
for (const [pf, name, desc] of PLATFORMS) {
  const card = figma.createFrame();
  card.name = 'card-' + pf;
  card.layoutMode = 'VERTICAL';
  card.itemSpacing = 16;
  card.counterAxisAlignItems = 'CENTER';
  card.primaryAxisSizingMode = 'FIXED';
  card.counterAxisSizingMode = 'FIXED';
  card.resize(200, 220);
  card.cornerRadius = 12;
  card.fills = [GLASS_FILL];
  card.strokes = [GLASS_STROKE];
  card.strokeWeight = 1;
  card.paddingTop = 36;
  const badgeInst = findVariant(badgeSet, { platform: pf, state: 'idle' }).createInstance();
  badgeInst.name = 'badge';
  card.appendChild(badgeInst);
  const n1 = figma.createText();
  n1.name = 'name';
  n1.characters = name;
  n1.fontSize = 16;
  n1.fontName = { family: 'Inter', style: 'Semi Bold' };
  n1.fills = [OFF];
  const n2 = figma.createText();
  n2.name = 'desc';
  n2.characters = desc;
  n2.fontSize = 12;
  n2.fontName = { family: 'Inter', style: 'Regular' };
  n2.fills = [DIM];
  card.appendChild(n1);
  card.appendChild(n2);
  cards.appendChild(card);
  created.push(card.id);
}
return { createdNodeIds: created, screen: 'Screen/SourceSelect' };
`;


// ============ SEG4: 降级态屏幕（NoLyrics / TrialFallback / RecoUnconfigured） ============
const SEG4 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '03 · Screens') || figma.currentPage;
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

const SOL = (r, g, b, a = 1) => (/** @type {SolidPaint} */ ({ type: 'SOLID', color: { r, g, b, a } }));
const compPage = figma.root.children.find(p => p.name === '02 · Components');
function findSet(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name); }
function findComp(name) { return compPage.findAllWithCriteria({ types: ['COMPONENT'] }).find(n => n.name === name); }
function findVariant(set, props) {
  return set.children.find(c => {
    const p = Object.fromEntries(c.name.split(', ').map(x => x.split('=')));
    return Object.entries(props).every(([k, v]) => p[k] === v);
  });
}
function setTextProps(inst, map) {
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const [k, d] of Object.entries(inst.componentProperties)) {
    if (d.type === 'TEXT') {
      const name = names.find(n => k.startsWith(n));
      if (name) inst.setProperties({ [k]: map[name] });
    }
  }
}
function clearOld(names) {
  page.children.filter(n => names.includes(n.name)).forEach(n => n.remove());
}
const created = [];

// 降级屏幕 = Playing 结构 + 局部替换（lyricsEmpty / trial / recoUnconfigured）
function buildDegraded(name, x, opts) {
  clearOld([name]);
  const screen = figma.createFrame();
  screen.name = name;
  screen.resize(1440, 900);
  screen.x = x; screen.y = 0;
  screen.clipsContent = true;
  screen.fills = [];
  page.appendChild(screen);
  const bdInst = findComp('Scene/Backdrop').createInstance();
  bdInst.name = 'backdrop';
  screen.appendChild(bdInst);
  const ringInst = findVariant(findSet('Ring/Sound'), { state: 'idle' }).createInstance();
  ringInst.name = 'sound-rings';
  ringInst.x = 70; ringInst.y = 60;
  screen.appendChild(ringInst);
  // 顶部 HUD
  const hud = figma.createFrame();
  hud.name = 'top-hud';
  hud.layoutMode = 'HORIZONTAL';
  hud.primaryAxisAlignItems = 'SPACE_BETWEEN';
  hud.counterAxisAlignItems = 'CENTER';
  hud.primaryAxisSizingMode = 'FIXED';
  hud.counterAxisSizingMode = 'FIXED';
  hud.resize(1440, 40);
  hud.x = 0; hud.y = 24;
  hud.paddingLeft = 64; hud.paddingRight = 64;
  hud.fills = [];
  const brand = figma.createFrame();
  brand.layoutMode = 'VERTICAL';
  brand.itemSpacing = 2;
  brand.primaryAxisSizingMode = 'AUTO';
  brand.counterAxisSizingMode = 'AUTO';
  brand.fills = [];
  const wm = figma.createText();
  wm.name = 'wordmark';
  wm.characters = 'AETHER ENGINE v3.0';
  wm.fontSize = 14;
  wm.fontName = { family: 'Inter', style: 'Semi Bold' };
  wm.fills = [SOL(1, 1, 1, 0.85)];
  wm.opacity = 0.85;
  const kk = figma.createText();
  kk.name = 'kicker';
  kk.characters = 'SYSTEM PROTOCOL';
  kk.fontSize = 9;
  kk.letterSpacing = (/** @type {LetterSpacing} */ ({ value: 2, unit: 'PIXELS' }));
  kk.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  kk.fills = [SOL(1, 1, 1, 0.25)];
  kk.opacity = 0.25;
  brand.appendChild(wm);
  brand.appendChild(kk);
  hud.appendChild(brand);
  screen.appendChild(hud);
  // 环形进度
  const progInst = findVariant(findSet('Ring/Progress'), { state: 'idle' }).createInstance();
  progInst.name = 'star-orbit';
  progInst.x = 280; progInst.y = 270;
  setTextProps(progInst, opts.trial ? { tCur: '00:00', tTotal: '00:30' } : { tCur: '02:14', tTotal: '04:52' });
  screen.appendChild(progInst);
  // 全息封面
  const coverInst = findVariant(findSet('Hologram/Cover'), { state: 'idle' }).createInstance();
  coverInst.name = 'hologram';
  coverInst.x = 190; coverInst.y = 200;
  setTextProps(coverInst, { songTitle: '走钢丝的人', artist: '李泉 // 2001 · 寓言', quality: 'HI-RES 24/96 · DOLBY ATMOS', heartCount: '1,284' });
  screen.appendChild(coverInst);
  // 歌词区（NoLyrics 时用 empty 变体）
  const lyricBox = figma.createFrame();
  lyricBox.name = 'lyric-stream';
  lyricBox.layoutMode = 'VERTICAL';
  lyricBox.itemSpacing = 12;
  lyricBox.primaryAxisSizingMode = 'AUTO';
  lyricBox.counterAxisSizingMode = 'FIXED';
  lyricBox.resize(560, 100);
  lyricBox.x = 820; lyricBox.y = 320;
  lyricBox.fills = [];
  const tagSet = findSet('Tag/Stat');
  const mkTag = (tone, live, label) => {
    const inst = findVariant(tagSet, { tone, live }).createInstance();
    setTextProps(inst, { label });
    return inst;
  };
  const lyricSet = findSet('Lyrics/Line');
  if (opts.lyricsEmpty) {
    lyricBox.appendChild(mkTag('muted', 'false', 'LYRICS UNAVAILABLE'));
    const emptyLine = findVariant(lyricSet, { state: 'empty' }).createInstance();
    setTextProps(emptyLine, { text: '暂无歌词 // NO LYRICS' });
    lyricBox.appendChild(emptyLine);
  } else {
    lyricBox.appendChild(mkTag('muted', 'false', 'TRANSCRIBING // CORE 02'));
    const mkLyric = (state, label) => {
      const inst = findVariant(lyricSet, { state }).createInstance();
      setTextProps(inst, { text: label });
      return inst;
    };
    lyricBox.appendChild(mkLyric('prev', '有人在欢呼'));
    lyricBox.appendChild(mkLyric('current', '我就像个走钢丝的人'));
    lyricBox.appendChild(mkLyric('next', '在云端漫步'));
    lyricBox.appendChild(mkLyric('next', '不曾想过退路'));
    lyricBox.appendChild(mkLyric('next', '平衡这孤独'));
    lyricBox.appendChild(mkTag('cyan', 'false', 'T: 02:14 / S: 0.82'));
  }
  screen.appendChild(lyricBox);
  // 播放控制
  const transInst = findVariant(findSet('Controls/Transport'), { state: 'paused' }).createInstance();
  transInst.name = 'controls';
  transInst.x = 266; transInst.y = 700; // 与全息封面同心（含红心后右移 30）
  screen.appendChild(transInst);
  // 神经推荐区（RecoUnconfigured 时换引导组件）
  if (opts.recoUnconfigured) {
    const ruInst = findComp('State/RecoUnconfigured').createInstance();
    ruInst.name = 'reco-unconfigured';
    ruInst.x = 1000; ruInst.y = 700;
    screen.appendChild(ruInst);
  } else {
    const neuralBox = figma.createFrame();
    neuralBox.name = 'neural-suggestions';
    neuralBox.layoutMode = 'VERTICAL';
    neuralBox.itemSpacing = 16;
    neuralBox.primaryAxisSizingMode = 'AUTO';
    neuralBox.counterAxisSizingMode = 'AUTO';
    neuralBox.x = 1000; neuralBox.y = 700;
    neuralBox.fills = [];
    neuralBox.appendChild(mkTag('purple', 'false', 'DEEP.SEEK // NEURAL FEED'));
    const cards = figma.createFrame();
    cards.layoutMode = 'HORIZONTAL';
    cards.itemSpacing = 16;
    cards.primaryAxisSizingMode = 'AUTO';
    cards.counterAxisSizingMode = 'AUTO';
    cards.fills = [];
    const neuralSet = findSet('Card/Neural');
    const mkNeural = (song, artist, match) => {
      const inst = findVariant(neuralSet, { state: 'default' }).createInstance();
      setTextProps(inst, { song, artist, match });
      return inst;
    };
    cards.appendChild(mkNeural('午夜巴黎', '王菲', '94%'));
    cards.appendChild(mkNeural('孤独患者', '陈奕迅', '88%'));
    cards.appendChild(mkNeural('夜的第七章', '周杰伦', '91%'));
    neuralBox.appendChild(cards);
    screen.appendChild(neuralBox);
  }
  // 试听降级标记
  if (opts.trial) {
    const trialTag = mkTag('cyan', 'true', '30S TRIAL');
    trialTag.x = 560; trialTag.y = 640;
    screen.appendChild(trialTag);
  }
  return screen.id;
}
created.push(buildDegraded('Screen/NowPlaying/NoLyrics', 6240, { lyricsEmpty: true }));
created.push(buildDegraded('Screen/NowPlaying/TrialFallback', 7800, { trial: true }));
created.push(buildDegraded('Screen/NowPlaying/RecoUnconfigured', 9360, { recoUnconfigured: true }));
return { createdNodeIds: created, screens: ['Screen/NowPlaying/NoLyrics', 'Screen/NowPlaying/TrialFallback', 'Screen/NowPlaying/RecoUnconfigured'] };
`;

module.exports = { SEG1, SEG2, SEG3, SEG4 };
