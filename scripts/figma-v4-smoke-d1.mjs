// Figma Plugin API mock + D1 段执行器（运行时冒烟）
// 按真实执行顺序跑 D1 6 段（SEG1-6），断言结构
// 用法: node scripts/figma-v4-smoke-d1.mjs（退出码 0 = 全部通过）
//       FIGMA_FIXTURE_DUMP=/tmp/d1 node scripts/figma-v4-smoke-d1.mjs  # 导出 fixture 供 audit-d1 端到端测试
// 复用 v4-smoke.mjs 的 mock 状态
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = new URL('..', import.meta.url).pathname;

// ---------- Mock 状态（与 v4-smoke 一致 + 补 Button/Text） ----------
let uid = 0;
const nid = (p) => `${p}:${++uid}`;
const store = { variables: [], collections: [], textStyles: [], effectStyles: [] };
const VALID_SCOPES = new Set(['ALL_SCOPES', 'TEXT_CONTENT', 'CORNER_RADIUS', 'WIDTH_HEIGHT', 'GAP', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'STROKE_FLOAT', 'EFFECT_FLOAT', 'EFFECT_COLOR', 'OPACITY', 'FONT_FAMILY', 'FONT_STYLE', 'FONT_WEIGHT', 'FONT_SIZE', 'LINE_HEIGHT', 'LETTER_SPACING', 'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT']);

class MockNode {
  constructor(type, name) {
    this.id = nid(type);
    this.type = type;
    this.name = name;
    this.parent = null;
    this.children = [];
    this.x = 0; this.y = 0; this.width = 100; this.height = 100;
    this.fills = []; this.strokes = []; this.strokeWeight = 1;
    this.cornerRadius = 0; this._effects = []; this.opacity = 1;
    this.layoutMode = 'NONE'; this.itemSpacing = 0;
    this.paddingLeft = 0; this.paddingRight = 0; this.paddingTop = 0; this.paddingBottom = 0;
    this.primaryAxisSizingMode = 'FIXED'; this.counterAxisSizingMode = 'FIXED';
    this.primaryAxisAlignItems = 'MIN'; this.counterAxisAlignItems = 'MIN';
    this.visible = true; this.clipsContent = false;
    this.componentPropertyDefinitions = {};
    this._refs = {};
    this.componentProperties = {};
    this.interactions = [];
    this.mainComponent = null;
    // 真实 Plugin API 里 description 只在 PublishableMixin（COMPONENT / COMPONENT_SET）上，
    // 写 FRAME 会抛 "no such property 'description' on FRAME node"——mock 必须同构，否则漏抓
    if (type === 'COMPONENT' || type === 'COMPONENT_SET') {
      let desc = '';
      Object.defineProperty(this, 'description', {
        get() { return desc; },
        set(v) { desc = v; },
        configurable: true,
      });
    } else {
      Object.defineProperty(this, 'description', {
        get() { return undefined; },
        set() { throw new Error(`in set_description: no such property 'description' on ${type} node`); },
        configurable: true,
      });
    }
  }
  set layoutSizingHorizontal(v) {
    if ((v === 'FILL' || v === 'HUG') && (!this.parent || this.parent.layoutMode === 'NONE')) {
      throw new Error(`layoutSizingHorizontal='${v}' 需要先挂到 auto-layout 父节点 (${this.name})`);
    }
    this._lsh = v;
  }
  get layoutSizingHorizontal() { return this._lsh; }
  set layoutSizingVertical(v) {
    if ((v === 'FILL' || v === 'HUG') && (!this.parent || this.parent.layoutMode === 'NONE')) {
      throw new Error(`layoutSizingVertical='${v}' 需要先挂到 auto-layout 父节点 (${this.name})`);
    }
    this._lsv = v;
  }
  get layoutSizingVertical() { return this._lsv; }
  set effects(list) {
    for (const e of list || []) {
      if ((e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && !e.blendMode) {
        throw new Error(`effects 校验失败: ${e.type} 必须带 blendMode`);
      }
      if ((e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') && e.blendMode) {
        throw new Error(`effects 校验失败: ${e.type} 不接受 blendMode`);
      }
    }
    this._effects = list;
  }
  get effects() { return this._effects; }
  set componentPropertyReferences(refs) {
    let node = this, inComp = false;
    while (node.parent && node.type !== 'PAGE') {
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') { inComp = true; break; }
      node = node.parent;
    }
    if (!inComp) throw new Error(`componentPropertyReferences 只能设置在组件树内的节点上 (${this.name})`);
    this._refs = refs;
  }
  get componentPropertyReferences() { return this._refs || {}; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  insertChild(index, node) { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = this; this.children.splice(index, 0, node); return node; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  resize(w, h) { this.width = w; this.height = h; }
  setBoundVariable(prop, v) { this._boundVars = this._boundVars || {}; this._boundVars[prop] = { type: 'VARIABLE_ALIAS', id: v && v.id }; }
  resizeWithoutConstraints(w, h) { this.width = w; this.height = h; }
  findAllWithCriteria({ types }) {
    const out = [];
    const walk = (n) => { for (const c of n.children || []) { if (types.includes(c.type)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  findAll(pred) { const out = []; const walk = (n) => { for (const c of n.children || []) { if (pred(c)) out.push(c); walk(c); } }; walk(this); return out; }
  createInstance() {
    const inst = new MockNode('INSTANCE', this.name);
    inst.mainComponent = this;
    inst.componentProperties = {};
    for (const [k, d] of Object.entries(this.componentPropertyDefinitions || {})) {
      inst.componentProperties[k] = { type: d.type, value: d.defaultValue };
    }
    const cloneChildren = (src, dst) => {
      for (const ch of src.children || []) {
        const copy = new MockNode(ch.type, ch.name);
        Object.assign(copy, ch, { id: nid(ch.type), parent: dst, children: [] });
        copy.children = [];
        dst.appendChild(copy);
        cloneChildren(ch, copy);
      }
    };
    cloneChildren(this, inst);
    return inst;
  }
  setProperties(map) {
    for (const [k, v] of Object.entries(map)) {
      if (this.componentProperties[k]) this.componentProperties[k].value = v;
      else this.componentProperties[k] = { type: 'TEXT', value: v };
    }
  }
  addComponentProperty(name, type, defaultValue) {
    const key = `${name}#m${++uid}`;
    this.componentPropertyDefinitions[key] = { type, defaultValue };
    return key;
  }
}

const figma = {
  root: {
    children: [],
    insertChild(index, node) { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = this; this.children.splice(index, 0, node); return node; },
  },
  currentPage: null,
  skipInvisibleInstanceChildren: false,
  variables: {
    getLocalVariables: () => store.variables,
    getLocalVariableCollections: () => store.collections,
    createVariableCollection(name) {
      const col = { id: nid('col'), name, modes: [{ modeId: nid('mode'), name: 'Default' }] };
      store.collections.push(col);
      return col;
    },
    createVariable(name, col, type) {
      const v = { id: nid('var'), name, variableCollectionId: col.id, resolvedType: type, valuesByMode: {}, scopes: [] };
      Object.defineProperty(v, 'scopes', {
        set(sc) {
          for (const x of sc || []) if (!VALID_SCOPES.has(x)) throw new Error(`scopes 非法枚举值: ${x}`);
          this._scopes = sc;
        },
        get() { return this._scopes; },
      });
      v.setValueForMode = (modeId, value) => {
        if (value && typeof value === 'object' && value.type && value.type !== 'VARIABLE_ALIAS') {
          throw new Error(`setValueForMode 不接受 type 包装值: ${value.type}`);
        }
        v.valuesByMode[modeId] = value;
      };
      store.variables.push(v);
      return v;
    },
  },
  getLocalTextStyles: () => store.textStyles,
  getLocalEffectStyles: () => store.effectStyles,
  createTextStyle() { const s = { id: nid('textstyle'), name: '' }; store.textStyles.push(s); return s; },
  createEffectStyle() { const s = { id: nid('effectstyle'), name: '' }; store.effectStyles.push(s); return s; },
  createPage() { const p = new MockNode('PAGE', 'Page'); p.parent = figma.root; figma.root.children.push(p); return p; },
  createFrame() { return new MockNode('FRAME', 'Frame'); },
  createComponent() {
    const c = new MockNode('COMPONENT', 'Component');
    if (figma.currentPage) figma.currentPage.appendChild(c);
    return c;
  },
  async setCurrentPageAsync(p) { figma.currentPage = p; },
  createText() { const t = new MockNode('TEXT', 'Text'); t.characters = ''; t.fontSize = 12; t.fontName = { family: 'Inter', style: 'Regular' }; t.letterSpacing = null; t.textStyleId = null; t.getStyledTextSegments = () => [{ fontName: t.fontName, characters: t.characters }]; return t; },
  createRectangle() { return new MockNode('RECTANGLE', 'Rectangle'); },
  createEllipse() { return new MockNode('ELLIPSE', 'Ellipse'); },
  createLine() { const l = new MockNode('LINE', 'Line'); l.x1 = 0; l.y1 = 0; l.x2 = 10; l.y2 = 10; return l; },
  createNodeFromSvg() { const v = new MockNode('VECTOR', 'vector'); v.fills = []; v.strokes = []; return v; },
  async loadFontAsync() {},
  combineAsVariants(components, parent) {
    for (const c of components) {
      if (c.parent && c.parent !== parent) throw new Error('combineAsVariants: Grouped nodes must be in the same page as the parent');
    }
    const set = new MockNode('COMPONENT_SET', 'ComponentSet');
    parent.appendChild(set);
    for (const c of components) { c.parent = null; set.appendChild(c); }
    for (const c of components) Object.assign(set.componentPropertyDefinitions, c.componentPropertyDefinitions);
    set.children.forEach((c, i) => { c.x = i * 100; c.y = 0; });
    set.defaultVariant = set.children[0];
    return set;
  },
};

// ---------- Bootstrap：v4-smoke 已建 11 组件集 + Scene/Backdrop + 8 SVG icons ----------
// 这段在真实 use_figma 里由 v4 components/icons SEG 跑出；mock 里我们手工建
function bootstrapV4() {
  // 必备页
  for (const n of ['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion', '99 · Archive']) {
    if (!figma.root.children.find(p => p.name === n)) {
      const p = figma.createPage();
      p.name = n;
      figma.root.insertChild(0, p);
    }
  }
  const compPage = figma.root.children.find(p => p.name === '02 · Components');
  figma.currentPage = compPage;

  // 必备变量
  const aether = figma.variables.createVariableCollection('AETHER');
  const colorPrim = figma.variables.createVariable('Color/primitive/bg-top', aether, 'COLOR');
  colorPrim.setValueForMode(aether.modes[0].modeId, { r: 0.04, g: 0.02, b: 0.09, a: 1 });
  const colorSem = figma.variables.createVariable('Color/semantic/accent', aether, 'COLOR');
  colorSem.setValueForMode(aether.modes[0].modeId, { r: 0, g: 0.9, b: 1, a: 1 });
  for (const name of ['Color/semantic/text-main', 'Color/semantic/text-dim', 'Color/semantic/text-muted', 'Color/semantic/glass-fill', 'Color/semantic/glass-stroke', 'Color/semantic/status-liked', 'Color/semantic/status-error', 'Color/semantic/status-warn', 'Color/semantic/status-info', 'Color/semantic/status-sync']) {
    const v = figma.variables.createVariable(name, aether, 'COLOR');
    v.setValueForMode(aether.modes[0].modeId, { r: 0.5, g: 0.5, b: 0.5, a: 1 });
  }

  // 必备组件（v4 11 组件集 + Scene/Backdrop + 8 icon）
  const allComps = [
    { name: 'Scene/Backdrop', type: 'component' },
    // ⚠️ 这里的 variant 清单必须和 FtbRZXvzlCp4Sq9e322cQQ 02 · Components 真实一致，
    // 否则 mock 会放过真实文件里不存在的 variant（例：曾经多写了 Button/Text tone=ghost，
    // mock 全绿但 use_figma 报 "cannot read property 'createInstance' of undefined"）
    // textProp = 有 TEXT 组件属性（setProperties 能写）；bakedLabel = 文案烘死在 variant 的文本层里（只能改实例文本）
    { name: 'Tag/Stat', type: 'set', textProp: 'label', variants: ['cyan', 'purple', 'dim', 'muted', 'red', 'green'].flatMap((tone) => [{ tone, live: 'false' }, { tone, live: 'true' }]) },
    { name: 'Lyrics/Line', type: 'set', textProp: 'text', variants: [{ state: 'prev' }, { state: 'current' }, { state: 'next' }] },
    { name: 'Button/Text', type: 'set', bakedLabel: true, variants: ['default', 'accent', 'danger'].flatMap((tone) => [{ tone, state: 'default' }, { tone, state: 'hover' }, { tone, state: 'disabled' }]) },
    { name: 'Input/Text', type: 'set', variants: [{ state: 'default' }, { state: 'focus' }, { state: 'disabled' }] },
    { name: 'Icon/Heart', type: 'component' },
    { name: 'Icon/Search', type: 'component' },
  ];
  for (const c of allComps) {
    if (c.type === 'component') {
      const comp = figma.createComponent();
      comp.name = c.name;
    } else {
      const variants = c.variants.map((props) => {
        const v = figma.createComponent();
        v.name = Object.entries(props).map(([k, vv]) => `${k}=${vv}`).join(', ');
        if (c.textProp) v.addComponentProperty(c.textProp, 'TEXT', 'DEFAULT');
        if (c.bakedLabel) {
          const t = figma.createText();
          t.name = 'label';
          t.characters = 'BAKED';
          v.appendChild(t);
        }
        return v;
      });
      const set = figma.combineAsVariants(variants, compPage);
      set.name = c.name;
    }
  }

  // 03 · Screens 已建 4 屏（v4-ABC 剧场稿）——占位 frame 让 audit ≥10 检查通过
  const screensPage = figma.root.children.find((p) => p.name === '03 · Screens');
  figma.currentPage = screensPage;
  const screenXs = [0, 0, 0, 0]; // 占位 4 屏 x=0（SEG1-6 写的 frame x ≥ 1480，不冲突）
  for (const [i, name] of ['Screen/NowPlaying/Playing', 'Screen/NowPlaying/Paused', 'Screen/NowPlaying/Buffering', 'Screen/SourceSelect/'].entries()) {
    const f = figma.createFrame();
    f.name = name;
    f.resize(1440, 900);
    f.x = screenXs[i]; f.y = 0;
    screensPage.appendChild(f); // mock 的 createFrame 不自动 append
  }
}
bootstrapV4();

// ---------- 执行器 ----------
function runSegment(seg) {
  figma.currentPage = figma.root.children[0] || null;
  const fn = new Function('figma', `return (async () => {\n${seg}\n})();`);
  return fn(figma);
}

// ---------- D1 段清单（真实执行顺序） ----------
const RUN = [
  ['figma-aether-v4-screens-d1.js', 'SEG1'],
  ['figma-aether-v4-screens-d1.js', 'SEG2'],
  ['figma-aether-v4-screens-d1.js', 'SEG3'],
  ['figma-aether-v4-screens-d1.js', 'SEG4'],
  ['figma-aether-v4-screens-d1.js', 'SEG5'],
  ['figma-aether-v4-screens-d1.js', 'SEG6'],
];

const results = [];
for (const [file, seg] of RUN) {
  const mod = require(`${repo}/scripts/${file}`);
  const code = mod[seg];
  try {
    const ret = await runSegment(code);
    results.push({ file, seg, ok: true, ret });
  } catch (e) {
    results.push({ file, seg, ok: false, error: e.message, stack: e.stack });
  }
}

// ---------- 断言 ----------
const assert = (name, ok, detail) => results.push({ file: 'ASSERT', seg: name, ok: !!ok, ret: detail });

for (const r of results.slice(0, 6)) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file} ${r.seg}${r.error ? ' — ' + r.error : ''}` + (r.stack ? '\n' + r.stack.split('\n').slice(0, 4).join('\n') : ''));

const p03 = figma.root.children.find((p) => p.name === '03 · Screens');
const screens = p03.children.filter((n) => n.name.startsWith('Screen/')).map((n) => n.name);
assert('6 个 D1 屏全部建出', screens.length >= 10, `共 ${screens.length} 个 Screen/ frame（4 v4 占位 + 6 D1）`);
const EXPECTED = ['Screen/Search/Modal', 'Screen/Liked/Modal', 'Screen/Settings/Full', 'Screen/RecoKey/Modal', 'Screen/AuthError/Full', 'Screen/EmptyState/Full'];
for (const want of EXPECTED) {
  assert(`D1 frame 存在: ${want}`, screens.includes(want), screens.join(', '));
}
// 6 屏 AI_CONTRACT 都齐（FRAME 无 description 属性，契约存在隐藏 TEXT 子节点 AI_CONTRACT 上）
const contractOf = (f) => (f?.children || []).find((c) => c.type === 'TEXT' && c.name === 'AI_CONTRACT')?.characters || '';
for (const want of EXPECTED) {
  const f = p03.children.find((n) => n.name === want);
  const desc = contractOf(f);
  assert(`D1 AI_CONTRACT 完整: ${want}`, desc.includes('AI_CONTRACT:') && desc.includes('react:') && desc.includes('a11y:'), desc.slice(0, 40) || '无 AI_CONTRACT 节点');
}
// x 坐标递增（避免覆盖）
const xs = EXPECTED.map((n) => p03.children.find((f) => f.name === n).x);
const sorted = [...xs].sort((a, b) => a - b);
assert('D1 6 屏 x 坐标单调', JSON.stringify(xs) === JSON.stringify(sorted), xs.join(', '));
// 03 页含实例
const instCount = p03.findAllWithCriteria({ types: ['INSTANCE'] }).length;
assert('D1 03 页含组件实例', instCount > 0, `${instCount} 个`);
// 实例化率：每个 screen frame 内至少有 1 个实例（modal panel 内）
let screenWithInst = 0;
for (const want of EXPECTED) {
  const f = p03.children.find((n) => n.name === want);
  if (f && f.findAllWithCriteria({ types: ['INSTANCE'] }).length > 0) screenWithInst++;
}
assert('D1 每屏含组件实例', screenWithInst === 6, `${screenWithInst}/6`);
// Button/Text 的 label 没有 TEXT 组件属性，只能改实例文本——断言自定义文案真写进去了，别留组件默认值
const BTN_LABELS = ['导出加密快照', '选择文件', '导入并合并', '保存', '取消', '重试', '重新登录', '去登录', '了解更多'];
const allChars = new Set(p03.findAllWithCriteria({ types: ['TEXT'] }).map((t) => t.characters));
const missingLabels = BTN_LABELS.filter((l) => !allChars.has(l));
assert('D1 Button/Text 自定义文案已覆盖', missingLabels.length === 0, missingLabels.length ? `仍是组件默认值: ${missingLabels.join(', ')}` : `${BTN_LABELS.length}/9 命中`);
// 自有填充绑定（mock 里 setFills 没真绑，但 SEG 代码用 varFill() 应该走 boundVariables 链）
let ownFill = 0, ownBound = 0;
const bindWalk = (nodes, inInst) => {
  for (const n of nodes || []) {
    const inst = inInst || n.type === 'INSTANCE';
    for (const f of n.fills || []) {
      if (f.type === 'SOLID' || f.type === 'GRADIENT_LINEAR') {
        const bound = f.type === 'GRADIENT_LINEAR'
          ? (f.gradientStops || []).some((s) => s.boundVariables && s.boundVariables.color)
          : !!(f.boundVariables && f.boundVariables.color);
        if (!inst) { ownFill++; if (bound) ownBound++; }
      }
    }
    bindWalk(n.children, inst);
  }
};
bindWalk(p03.children, false);
assert('D1 03 页自有填充绑定 ≥70%', ownFill === 0 || ownBound / ownFill >= 0.7, `绑定 ${ownBound}/${ownFill}`);

// ---------- fixture 导出（FIGMA_FIXTURE_DUMP=<前缀> 时启用，供 audit-d1.mjs --fixture 端到端测试） ----------
const dumpPrefix = process.env.FIGMA_FIXTURE_DUMP;
if (dumpPrefix) {
  const serNode = (n) => {
    const out = { type: n.type, name: n.name, id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
    if (n.description) out.description = n.description;
    if (typeof n.characters === 'string') out.characters = n.characters; // AI_CONTRACT 节点靠这个被 audit 读到
    if (n.children && n.children.length) out.children = n.children.map(serNode);
    if (n.fills && n.fills.length) out.fills = n.fills.map((f) => {
      const c = { type: f.type };
      if (f.color) c.color = f.color;
      if (f.boundVariables) c.boundVariables = f.boundVariables;
      return c;
    });
    return out;
  };
  const components = {};
  const componentSets = {};
  for (const pg of figma.root.children) {
    for (const set of pg.findAllWithCriteria({ types: ['COMPONENT_SET'] })) {
      componentSets[set.id] = { key: 'globalkey-' + set.id, name: set.name };
    }
    for (const comp of pg.findAllWithCriteria({ types: ['COMPONENT'] })) {
      components[comp.id] = { key: 'globalkey-' + comp.id, name: comp.name, componentSetId: comp.parent && comp.parent.type === 'COMPONENT_SET' ? comp.parent.id : undefined };
    }
  }
  const fixture = {
    document: {
      children: figma.root.children.map((p) => ({
        type: 'CANVAS', name: p.name, id: p.id,
        children: p.children.map(serNode),
      })),
    },
    components, componentSets,
    meta: { variables: Object.fromEntries(store.variables.map((v) => [v.id, v])) },
  };
  writeFileSync(`${dumpPrefix}.json`, JSON.stringify(fixture, null, 2));
  console.log(`\n[fixture] exported to ${dumpPrefix}.json`);
}

// ---------- 汇总 ----------
const fails = results.filter((r) => !r.ok);
for (const r of results) if (r.file === 'ASSERT' && !r.ok) console.log(`FAIL  ${r.seg} — ${r.ret}`);
console.log(`\n${results.length - fails.length}/${results.length} 通过` + (fails.length ? `，${fails.length} 项 FAIL` : ' ✅ 全部达标'));
process.exit(fails.length ? 1 : 0);
