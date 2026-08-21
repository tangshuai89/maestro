// Figma Plugin API 轻量 mock + v4 段执行器（运行时冒烟测试）
// 按真实执行顺序跑全部 13 段，断言结构清单，抓逻辑错误（跨段依赖、空引用、变体计数）
// 用法: node scripts/figma-v4-smoke.mjs（退出码 0 = 全部通过）
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = new URL('..', import.meta.url).pathname;

// ---------- Mock 状态 ----------
let uid = 0;
const nid = (p) => `${p}:${++uid}`;
const store = { variables: [], collections: [], textStyles: [], effectStyles: [] };
// 与 use_figma 沙箱一致的枚举（沙箱比 @figma/plugin-typings 新/严，以此为准）
const VALID_SCOPES = new Set(['ALL_SCOPES', 'TEXT_CONTENT', 'CORNER_RADIUS', 'WIDTH_HEIGHT', 'GAP', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'STROKE_FLOAT', 'EFFECT_FLOAT', 'EFFECT_COLOR', 'OPACITY', 'FONT_FAMILY', 'FONT_STYLE', 'FONT_WEIGHT', 'FONT_SIZE', 'LINE_HEIGHT', 'LETTER_SPACING', 'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT']);
const VALID_TRIGGERS = new Set(['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG', 'MOUSE_UP', 'MOUSE_DOWN', 'AFTER_TIMEOUT', 'ON_SCROLL', 'ON_SWIPE_LEFT', 'ON_SWIPE_RIGHT', 'ON_SWIPE_UP', 'ON_SWIPE_DOWN', 'ON_KEY_DOWN', 'ON_NODE_CHANGE']);
const VALID_EASINGS = new Set(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT', 'EASE_IN_BACK', 'EASE_OUT_BACK', 'EASE_IN_AND_OUT_BACK', 'CUSTOM_CUBIC_BEZIER', 'GENTLE', 'QUICK', 'BOUNCY', 'SLOW', 'CUSTOM_SPRING', 'HOLD']);

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
    this._refs = {}; // 构造函数直接初始化，不走 accessor（节点尚未入树）
    this.componentProperties = {};
    this.interactions = [];
    this.description = '';
    this.mainComponent = null;
  }
  // 官方规则强制校验：HUG/FILL 只能在已挂到 auto-layout 父节点后设置（先设会抛错）
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
        throw new Error(`effects 校验失败: ${e.type} 必须带 blendMode（沙箱规则）`);
      }
      if ((e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') && e.blendMode) {
        throw new Error(`effects 校验失败: ${e.type} 不接受 blendMode（沙箱规则）`);
      }
    }
    this._effects = list;
  }
  get effects() { return this._effects; }
  set componentPropertyReferences(refs) {
    // 沙箱规则：节点祖先链中必须存在 COMPONENT/COMPONENT_SET（否则 'Can only set component property references on symbol sublayer'）
    let node = this, inComp = false;
    while (node.parent && node.type !== 'PAGE') {
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') { inComp = true; break; }
      node = node.parent;
    }
    if (!inComp) throw new Error(`componentPropertyReferences 只能设置在组件树内的节点上 (${this.name})`);
    this._refs = refs;
  }
  get componentPropertyReferences() { return this._refs || {}; }
  set interactions(list) {
    for (const it of list || []) {
      if (it.trigger && !VALID_TRIGGERS.has(it.trigger.type)) throw new Error(`interactions trigger 非法: ${it.trigger.type}`);
      for (const a of it.actions || []) {
        if (a.transition && a.transition.easing && !VALID_EASINGS.has(a.transition.easing.type)) throw new Error(`easing 非法: ${a.transition.easing.type}`);
        if (a.transition && !['DISSOLVE', 'SMART_ANIMATE', 'SCROLL_ANIMATE'].includes(a.transition.type)) throw new Error(`transition 非法: ${a.transition.type}`);
      }
    }
    this._interactions = list;
  }
  get interactions() { return this._interactions; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  insertChild(index, node) { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = this; this.children.splice(index, 0, node); return node; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  resize(w, h) { this.width = w; this.height = h; }
  setBoundVariable(prop, v) { this._boundVars = this._boundVars || {}; this._boundVars[prop] = { type: 'VARIABLE_ALIAS', id: v && v.id }; }
  resizeWithoutConstraints(w, h) { this.width = w; this.height = h; }
  findAllWithCriteria({ types }) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children || []) {
        if (types.includes(c.type)) out.push(c);
        walk(c);
      }
    };
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
    // 真实实例携带源组件子结构副本（槽位等），供 findAllWithCriteria 使用
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
  createSlot() {
    const slot = new MockNode('SLOT', 'Content');
    this.appendChild(slot);
    const key = this.addComponentProperty('Content', 'SLOT', '');
    slot.componentPropertyReferences = { slotContentId: key };
    return slot;
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
          for (const x of sc || []) if (!VALID_SCOPES.has(x)) throw new Error(`scopes 非法枚举值: ${x}（沙箱 VariableScope 无此项）`);
          this._scopes = sc;
        },
        get() { return this._scopes; },
      });
      v.setValueForMode = (modeId, value) => {
        // 真实 API 规则：只有 VARIABLE_ALIAS 带 type 字段，其余必须裸值（否则 setValueForMode 校验失败）
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
    if (figma.currentPage) figma.currentPage.appendChild(c); // 沙箱行为：自动落到 currentPage
    return c;
  },
  async setCurrentPageAsync(p) { figma.currentPage = p; },
  createText() { const t = new MockNode('TEXT', 'Text'); t.characters = ''; t.fontSize = 12; t.fontName = { family: 'Inter', style: 'Regular' }; t.letterSpacing = null; t.textStyleId = null; return t; },
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
    // 合并变体属性到 set
    for (const c of components) Object.assign(set.componentPropertyDefinitions, c.componentPropertyDefinitions);
    set.children.forEach((c, i) => { c.x = i * 100; c.y = 0; });
    set.defaultVariant = set.children[0];
    return set;
  },
};

// ---------- 执行器 ----------
// 初始默认页（真实文件至少有一页；SEG0 会把它改名归档）
figma.root.children.push(new MockNode('PAGE', 'Page 1'));
function runSegment(seg, pageName) {
  // 模拟真实 use_figma 沙箱：每次调用 currentPage 重置为第一页（段内必须自定位页面）
  figma.currentPage = figma.root.children[0] || null;
  const fn = new Function('figma', `return (async () => {\n${seg}\n})();`);
  return fn(figma);
}

// ---------- 段清单（真实执行顺序） ----------
const RUN = [
  ['figma-aether-v4-foundations.js', 'SEG0', null],            // 建页
  ['figma-aether-v4-foundations.js', 'SEG1', '01 · Foundations'],
  ['figma-aether-v4-foundations.js', 'SEG2', '01 · Foundations'],
  ['figma-aether-v4-foundations.js', 'SEG3', '01 · Foundations'],
  ['figma-aether-v4-icons.js', 'SEG1', '02 · Components'],
  ['figma-aether-v4-components.js', 'SEG1', '02 · Components'],
  ['figma-aether-v4-components.js', 'SEG2', '02 · Components'],
  ['figma-aether-v4-components.js', 'SEG3', '02 · Components'],
  ['figma-aether-v4-components.js', 'SEG4', '02 · Components'],
  ['figma-aether-v4-screens.js', 'SEG1', '03 · Screens'],
  ['figma-aether-v4-screens.js', 'SEG2', '03 · Screens'],
  ['figma-aether-v4-screens.js', 'SEG3', '03 · Screens'],
  ['figma-aether-v4-screens.js', 'SEG4', '03 · Screens'],
  ['figma-aether-v4-motion.js', 'SEG1', '02 · Components'],
  ['figma-aether-v4-motion.js', 'SEG2', '03 · Screens'],
  ['figma-aether-v4-snapshot.js', 'SEG1', '03 · Screens'],
];

const results = [];
for (const [file, seg, page] of RUN) {
  const mod = require(`${repo}/scripts/${file}`);
  const code = mod[seg];
  try {
    const ret = await runSegment(code, page || (figma.root.children[0] && figma.root.children[0].name));
    results.push({ file, seg, ok: true, ret });
  } catch (e) {
    results.push({ file, seg, ok: false, error: e.message, stack: e.stack });
  }
}

// ---------- 断言 ----------
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file} ${r.seg}${r.error ? ' — ' + r.error : ''}` + (r.stack ? '\n' + r.stack.split('\n').slice(0, 4).join('\n') : ''));

const assert = (name, ok, detail) => results.push({ file: 'ASSERT', seg: name, ok: !!ok, ret: detail });
const pages = figma.root.children.map(p => p.name);
assert('页面: 01-04 + 99 Archive', ['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion', '99 · Archive'].every(n => pages.includes(n)), pages.join(', '));
assert('页面顺序正确', JSON.stringify(pages) === JSON.stringify(['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion', '99 · Archive']), pages.join(' → '));
const p01 = figma.root.children.find(p => p.name === '01 · Foundations');
const p02 = figma.root.children.find(p => p.name === '02 · Components');
const p03 = figma.root.children.find(p => p.name === '03 · Screens');
const p04 = figma.root.children.find(p => p.name === '04 · Motion');
assert('README frame (01)', !!p01.children.find(n => n.name === 'README — AI CONTRACT'));
assert('MOTION SPEC frame (04)', !!p04.children.find(n => n.name === 'MOTION SPEC'));
const grp = (g) => store.variables.filter(v => v.name.startsWith(g + '/')).length;
assert('变量组', grp('Color/primitive') === 10 && grp('Color/semantic') === 17 && grp('Spacing') === 10 && grp('Radius') === 7 && grp('Motion') === 7,
  `primitive=${grp('Color/primitive')} semantic=${grp('Color/semantic')} spacing=${grp('Spacing')} radius=${grp('Radius')} motion=${grp('Motion')}`);
assert('Text Styles ≥11', store.textStyles.length >= 11, `${store.textStyles.length}`);
assert('Effect Styles ≥4', store.effectStyles.length >= 4, `${store.effectStyles.length}`);
const EXPECTED = { 'Ring/Sound': 2, 'Hologram/Cover': 4, 'Lyrics/Line': 4, 'Core/Play': 4, 'Button/Icon': 8, 'Badge/Platform': 8, 'Tag/Stat': 12, 'Ring/Progress': 3, 'Card/Neural': 2, 'Controls/Transport': 2, 'Button/Like': 3 };
for (const [name, want] of Object.entries(EXPECTED)) {
  const set = p02.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === name);
  assert(`组件集 ${name}`, !!set && set.children.length === want, set ? `${set.children.length}` : '不存在');
}
assert('组件 Scene/Backdrop', p02.findAllWithCriteria({ types: ['COMPONENT'] }).some(c => c.name === 'Scene/Backdrop'));
assert('组件 State/RecoUnconfigured', p02.findAllWithCriteria({ types: ['COMPONENT'] }).some(c => c.name === 'State/RecoUnconfigured'));
const iconNames = ['Icon/Prev', 'Icon/Next', 'Icon/Play', 'Icon/Pause', 'Icon/Shuffle', 'Icon/Repeat', 'Icon/Heart', 'Icon/Search'];
const iconComps = p02.findAllWithCriteria({ types: ['COMPONENT'] });
assert('SVG 图标组件 ×8', iconNames.every(n => iconComps.some(c => c.name === n)), iconNames.filter(n => !iconComps.some(c => c.name === n)).join(',') || '8/8');
// cornerRadius 绑定检查（Radius/* 变量已用于组件圆角）
const radiusBound = p02.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] }).filter(n => n._boundVars && n._boundVars.cornerRadius).length;
assert('cornerRadius 绑定 ≥15', radiusBound >= 15, `${radiusBound}`);
// 剧场版无 Card/Glass 槽位组件（原 v4 布局组件已废弃）
const screens = p03.children.filter(n => n.name.startsWith('Screen/')).map(n => n.name);
assert('屏幕 ≥4', screens.length >= 4, screens.join(', '));
const screenInst = p03.findAllWithCriteria({ types: ['INSTANCE'] }).length;
assert('03 页含实例', screenInst > 0, `${screenInst} 个`);
// 绑定检查：03 页自有填充（非实例内部）必须主要绑定变量；实例内填充（组件所有）信息级
let ownFill = 0, ownBound = 0, compFill = 0, compBound = 0;
const ownUnbound = [];
const bindWalk = (nodes, inInst) => {
  for (const n of nodes || []) {
    const inst = inInst || n.type === 'INSTANCE';
    for (const f of n.fills || []) {
      if (f.type === 'SOLID' || f.type === 'GRADIENT_LINEAR') {
        // 渐变 paint 的绑定在 stops 上（boundVariables.color 挂在每个 stop），SOLID 在 paint 上
        const bound = f.type === 'GRADIENT_LINEAR'
          ? (f.gradientStops || []).some(s => s.boundVariables && s.boundVariables.color)
          : !!(f.boundVariables && f.boundVariables.color);
        if (inst) { compFill++; if (bound) compBound++; }
        else { ownFill++; if (bound) ownBound++; else ownUnbound.push(n.name + '/' + n.type); }
      }
    }
    bindWalk(n.children, inst);
  }
};
bindWalk(p03.children, false);
assert('03 页自有填充绑定 ≥50%', ownFill === 0 || ownBound / ownFill >= 0.5, `绑定 ${ownBound}/${ownFill}`);
assert('03 页实例内填充绑定 ≥30%（信息）', compFill === 0 || compBound / compFill >= 0.3, `绑定 ${compBound}/${compFill}`);
console.log('UNBOUND-OWN:', JSON.stringify(ownUnbound, null, 0));
const allNodes = [];
const collect = (n) => { allNodes.push(n); (n.children || []).forEach(collect); };
figma.root.children.forEach(collect);
const interCount = allNodes.reduce((sum, n) => sum + (n.interactions ? n.interactions.length : 0), 0);
assert('原型连线 ≥12', interCount >= 12, `${interCount} 条`);
// 组件集平铺：坐标互不相同且边界框互不重叠
const allSets = p02.findAllWithCriteria({ types: ['COMPONENT_SET'] });
const positions = allSets.map(st => st.x + ',' + st.y);
assert('组件集平铺错位', new Set(positions).size === allSets.length, positions.join(' | '));
const overlaps = [];
for (let i = 0; i < allSets.length; i++) {
  for (let j = i + 1; j < allSets.length; j++) {
    const a = allSets[i], b = allSets[j];
    const hit = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    if (hit) overlaps.push(a.name + '↔' + b.name);
  }
}
assert('组件集互不重叠', overlaps.length === 0, overlaps.join(' | ') || '无重叠');
const transport = p02.findAllWithCriteria({ types: ['COMPONENT_SET'] }).find(s => s.name === 'Controls/Transport');
assert('Transport 含 Core/Play 实例', transport.children.some(v => v.children.some(c => c.type === 'INSTANCE' && c.mainComponent && c.mainComponent.parent && c.mainComponent.parent.name === 'Core/Play')));
const snap = results.find(r => r.file === 'figma-aether-v4-snapshot.js');
assert('快照段输出组件集数 = 11', !!snap && snap.ok && snap.ret && snap.ret.componentSets.length === 11, snap && snap.ret ? `${snap.ret.componentSets.length}` : '无输出');

// ---------- fixture 导出（FIGMA_FIXTURE_DUMP=<前缀> 时启用，供 audit.mjs --fixture 端到端测试） ----------
const dumpPrefix = process.env.FIGMA_FIXTURE_DUMP;
if (dumpPrefix) {
  const serNode = (n) => {
    const out = { type: n.type, name: n.name, id: n.id };
    if (n.children && n.children.length) out.children = n.children.map(serNode);
    if (n.fills && n.fills.length) out.fills = n.fills.map(f => {
      const c = { type: f.type };
      if (f.color) c.color = f.color;
      if (f.gradientStops) c.gradientStops = f.gradientStops.map(s => ({ position: s.position, color: s.color, boundVariables: s.boundVariables || null }));
      if (f.boundVariables) c.boundVariables = f.boundVariables;
      return c;
    });
    if (n.interactions && n.interactions.length) out.interactions = n.interactions;
    if (n.opacity !== undefined && n.opacity !== 1) out.opacity = n.opacity;
    if (n._boundVars) out.boundVariables = n._boundVars;
    return out;
  };
  const components = {};
  const componentSets = {};
  // 镜像真实 REST 结构：componentSets/组件 的 map key 是本地 id（如 156:175），
  // 条目内 key 字段是 40 位全局 key，组件的 componentSetId 指向本地 id
  for (const pg of figma.root.children) {
    for (const set of pg.findAllWithCriteria({ types: ['COMPONENT_SET'] })) {
      componentSets[set.id] = { key: 'globalkey-' + set.id, name: set.name };
      for (const v of set.children) components[v.id] = { key: 'globalkey-' + v.id, name: v.name, type: 'COMPONENT', componentSetId: set.id };
    }
    for (const c of pg.findAllWithCriteria({ types: ['COMPONENT'] })) {
      if (!components[c.id]) components[c.id] = { key: 'globalkey-' + c.id, name: c.name, type: 'COMPONENT' };
    }
  }
  const styles = {};
  for (const ts of store.textStyles) styles[ts.id] = { key: ts.id, name: ts.name, styleType: 'TEXT' };
  for (const es of store.effectStyles) styles[es.id] = { key: es.id, name: es.name, styleType: 'EFFECT' };
  const fileJson = {
    name: 'fixture', lastModified: '2026-01-01T00:00:00Z', version: '1', schemaVersion: 0,
    document: { type: 'DOCUMENT', children: figma.root.children.map(serNode) },
    components, componentSets, styles,
  };
  const varJson = {
    meta: {
      variables: Object.fromEntries(store.variables.map(v => [v.id, { id: v.id, name: v.name, variableCollectionId: v.variableCollectionId, resolvedType: v.resolvedType }])),
      variableCollections: Object.fromEntries(store.collections.map(c => [c.id, { id: c.id, name: c.name }])),
    },
  };
  writeFileSync(`${dumpPrefix}.json`, JSON.stringify(fileJson));
  writeFileSync(`${dumpPrefix}.variables.json`, JSON.stringify(varJson));
  console.log(`FIXTURE-DUMPED: ${dumpPrefix}.json (+.variables.json)`);
}

// ---------- 报告 ----------
let fail = 0;
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  if (!r.ok) fail++;
  console.log(`${tag}  ${r.file || '断言'} ${r.seg}${r.ret !== undefined && typeof r.ret !== 'object' ? ' — ' + r.ret : ''}${r.error ? ' — ' + r.error : ''}`);
}
console.log(`\n${results.length - fail}/${results.length} 通过`);
process.exit(fail ? 1 : 0);
