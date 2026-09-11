// Figma Plugin API mock + D5_NEW 段执行器（运行时冒烟）
// 跑 D5_NEW SEG1 + SEG2，断言 02 · Components 增 10 个 component set / 28 变体
// 用法: node scripts/figma-v4-smoke-d5-new.mjs（退出码 0 = 全部通过）
//       FIGMA_FIXTURE_DUMP=/tmp/d5new node scripts/figma-v4-smoke-d5-new.mjs  # 导出 fixture
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = new URL('..', import.meta.url).pathname;

// ---------- Mock 状态 ----------
let uid = 0;
const nid = (p) => `${p}:${++uid}`;
const store = { variables: [], collections: [] };

class MockNode {
  constructor(type, name) {
    this.id = nid(type); this.type = type; this.name = name; this.parent = null;
    this.children = []; this.x = 0; this.y = 0; this.width = 100; this.height = 100;
    this._fills = []; this._strokes = []; this._strokeWeight = 1;
    this._cornerRadius = 0; this._effects = []; this._opacity = 1;
    this.layoutMode = 'NONE'; this.itemSpacing = 0;
    this._lsh = undefined; this._lsv = undefined;
    this.paddingLeft = 0; this.paddingRight = 0; this.paddingTop = 0; this.paddingBottom = 0;
    this._pa = 'FIXED'; this._ca = 'FIXED';
    this._paai = 'MIN'; this._caai = 'MIN';
    this.visible = true; this.clipsContent = false;
    this.componentPropertyReferences = {};
    this.componentProperties = {};
    // description 只在 COMPONENT / COMPONENT_SET 上
    if (type === 'COMPONENT' || type === 'COMPONENT_SET') {
      let desc = '';
      Object.defineProperty(this, 'description', { get() { return desc; }, set(v) { desc = v; }, configurable: true });
    } else {
      Object.defineProperty(this, 'description', { get() { return undefined; }, set() { throw new Error(`no such property 'description' on ${type} node`); }, configurable: true });
    }
  }
  get fills() { return this._fills; }
  set fills(v) { this._fills = v; }
  get strokes() { return this._strokes; }
  set strokes(v) { this._strokes = v; }
  get strokeWeight() { return this._strokeWeight; }
  set strokeWeight(v) { this._strokeWeight = v; }
  get cornerRadius() { return this._cornerRadius; }
  set cornerRadius(v) { this._cornerRadius = v; }
  get effects() { return this._effects; }
  set effects(v) { this._effects = v; }
  get opacity() { return this._opacity; }
  set opacity(v) { this._opacity = v; }
  get primaryAxisSizingMode() { return this._pa; }
  set primaryAxisSizingMode(v) { this._pa = v; }
  get counterAxisSizingMode() { return this._ca; }
  set counterAxisSizingMode(v) { this._ca = v; }
  get primaryAxisAlignItems() { return this._paai; }
  set primaryAxisAlignItems(v) { this._paai = v; }
  get counterAxisAlignItems() { return this._caai; }
  set counterAxisAlignItems(v) { this._caai = v; }
  set layoutSizingHorizontal(v) {
    if ((v === 'FILL' || v === 'HUG') && (!this.parent || this.parent.layoutMode === 'NONE')) {
      throw new Error(`layoutSizingHorizontal='${v}' needs auto-layout parent (${this.name})`);
    }
    this._lsh = v;
  }
  get layoutSizingHorizontal() { return this._lsh; }
  set layoutSizingVertical(v) {
    if ((v === 'FILL' || v === 'HUG') && (!this.parent || this.parent.layoutMode === 'NONE')) {
      throw new Error(`layoutSizingVertical='${v}' needs auto-layout parent (${this.name})`);
    }
    this._lsv = v;
  }
  get layoutSizingVertical() { return this._lsv; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  resize(w, h) { this.width = w; this.height = h; }
  resizeWithoutConstraints(w, h) { this.width = w; this.height = h; }
  findAllWithCriteria({ types }) {
    const out = [];
    const walk = (n) => { for (const c of n.children || []) { if (types.includes(c.type)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  addComponentProperty(name, type, defaultValue) {
    const key = `${name}#${this.id}`;
    this.componentProperties[key] = { type, defaultValue };
    return key;
  }
  setProperties(obj) { Object.assign(this._props, obj); }
  get _props() {
    if (!this.__props) this.__props = {};
    return this.__props;
  }
  setBoundVariable(prop, variable) { this[`_bound_${prop}`] = variable; }
}

// TEXT 节点需要字符/字体 setter
class MockText extends MockNode {
  constructor(name) {
    super('TEXT', name);
    this.characters = '';
    this.fontSize = 12;
    this.fontName = { family: 'Inter', style: 'Regular' };
    this.letterSpacing = null;
  }
}

const figma = {
  root: { children: [], insertChild(index, node) { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = this; this.children.splice(index, 0, node); return node; } },
  currentPage: null,
  variables: {
    getLocalVariables: () => store.variables,
    getLocalVariableCollections: () => store.collections,
    createVariableCollection(name) { const col = { id: nid('col'), name, modes: [{ modeId: nid('mode'), name: 'Default' }] }; store.collections.push(col); return col; },
    createVariable(name, col, type) { const v = { id: nid('var'), name, variableCollectionId: col.id, resolvedType: type, valuesByMode: {}, scopes: [] }; v.setValueForMode = (m, val) => { v.valuesByMode[m] = val; }; store.variables.push(v); return v; },
  },
  createPage() { const p = new MockNode('PAGE', 'Page'); p.parent = figma.root; figma.root.children.push(p); return p; },
  createFrame() { return new MockNode('FRAME', 'Frame'); },
  createComponent() { return new MockNode('COMPONENT', 'Component'); },
  createText() { return new MockText('Text'); },
  createRectangle() { return new MockNode('RECTANGLE', 'Rectangle'); },
  createEllipse() { return new MockNode('ELLIPSE', 'Ellipse'); },
  combineAsVariants(components, page) {
    const set = new MockNode('COMPONENT_SET', 'Set');
    for (const c of components) { c.parent = set; set.children.push(c); }
    set.parent = page; page.children.push(set);
    return set;
  },
  async setCurrentPageAsync(p) { figma.currentPage = p; },
  async loadFontAsync() {},
};

// ---------- Bootstrap：5 页 + AETHER 完整变量（让所有 varFill 拿到 boundVariables） ----------
for (const n of ['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion', '99 · Archive']) {
  if (!figma.root.children.find(p => p.name === n)) {
    const p = figma.createPage();
    p.name = n;
    figma.root.insertChild(0, p);
  }
}
const aether = figma.variables.createVariableCollection('AETHER');
const varNames = [
  'Color/semantic/text-main', 'Color/semantic/text-dim', 'Color/semantic/text-muted',
  'Color/semantic/accent', 'Color/semantic/accent-soft',
  'Color/semantic/glass-fill', 'Color/semantic/glass-stroke',
  'Color/semantic/white',
  'Color/semantic/status-error', 'Color/semantic/status-liked', 'Color/semantic/status-sync',
  'Color/semantic/platform-qq', 'Color/semantic/platform-netease',
  'Color/semantic/platform-deezer', 'Color/semantic/platform-spotify',
];
for (const name of varNames) {
  const v = figma.variables.createVariable(name, aether, 'COLOR');
  v.setValueForMode(aether.modes[0].modeId, { r: 0.5, g: 0.5, b: 0.5, a: 1 });
}

// ---------- 执行器 ----------
function runSegment(seg) {
  figma.currentPage = figma.root.children[0] || null;
  const fn = new Function('figma', `return (async () => {\n${seg}\n})();`);
  return fn(figma);
}

const results = [];
for (const segName of ['SEG1', 'SEG2']) {
  try {
    const mod = require(`${repo}/scripts/figma-aether-v4-components-d5.js`);
    const ret = await runSegment(mod[segName]);
    results.push({ seg: segName, ok: true, ret });
  } catch (e) {
    results.push({ seg: segName, ok: false, error: e.message, stack: e.stack });
  }
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.seg}${r.error ? ' — ' + r.error : ''}` + (r.stack ? '\n' + r.stack.split('\n').slice(0, 4).join('\n') : ''));

// ---------- 断言 ----------
const assert = (name, ok, detail) => results.push({ file: 'ASSERT', seg: name, ok: !!ok, ret: detail });
const compPage = figma.root.children.find(p => p.name === '02 · Components');

const EXPECTED = [
  { name: 'Modal/Shell', variants: ['state=default'] },
  { name: 'Modal/ErrorPanel', variants: ['state=collapsed', 'state=expanded'] },
  { name: 'Modal/RecoLoading', variants: ['state=loading', 'state=error'] },
  { name: 'SourceChip', variants: ['platform=qq', 'platform=netease', 'platform=deezer', 'platform=spotify'] },
  { name: 'Layout/QualityMenu', variants: ['quality=standard', 'quality=high', 'quality=lossless'] },
  { name: 'Layout/SourceMenu', variants: ['provider=qq', 'provider=netease', 'provider=deezer', 'provider=spotify'] },
  { name: 'Layout/DeezerPresetSelect', variants: ['state=default', 'state=hover', 'state=open'] },
  { name: 'Screen/SourceSelect', variants: ['state=empty', 'state=ready'] },
  { name: 'Titlebar', variants: ['state=logged-out', 'state=logged-in', 'state=logging-in'] },
  { name: 'Modal/NeteaseCookie', variants: ['state=empty', 'state=qr-shown', 'state=cookie-paste', 'state=submitting'] },
];

const allSets = compPage.children.filter(n => n.type === 'COMPONENT_SET');
assert('02 · Components 含 10 个新 COMPONENT_SET', allSets.length === 10, `实际 ${allSets.length}: ${allSets.map(s => s.name).join(', ')}`);

let totalVariants = 0;
for (const exp of EXPECTED) {
  const set = allSets.find(s => s.name === exp.name);
  assert(`${exp.name} set 存在`, !!set, set ? '' : '无');
  if (!set) continue;
  const variants = set.children.map(c => c.name);
  for (const v of exp.variants) {
    assert(`  ${exp.name} 含变体 ${v}`, variants.includes(v), variants.join(' | '));
  }
  totalVariants += set.children.length;
  // description 含 AI_CONTRACT
  assert(`  ${exp.name} description 含 AI_CONTRACT`, /AI_CONTRACT/.test(set.description), set.description.slice(0, 60));
  assert(`  ${exp.name} description 含 ---...--- 段`, /---[\s\S]+?---/.test(set.description), '');
}

assert('28 变体总数', totalVariants === 28, `实际 ${totalVariants}`);

// 验证 D5_NEW set 全部 description 完整
const withContract = allSets.filter(s => /AI_CONTRACT/.test(s.description));
assert('10 个 set 全部有 AI_CONTRACT description', withContract.length === 10, `${withContract.length}/10`);

// 验证每个变体（图层结构粗略）至少 1 个 child
const emptyVariants = allSets.flatMap(s => s.children.filter(c => c.children.length === 0));
assert('0 个空变体', emptyVariants.length === 0, `${emptyVariants.length} 个: ${emptyVariants.map(c => c.name).join(', ')}`);

// 验证 SourceChip 暴露 isBest BOOLEAN prop
const chipSet = allSets.find(s => s.name === 'SourceChip');
if (chipSet) {
  const qq = chipSet.children.find(c => c.name === 'platform=qq');
  const hasBest = qq && Object.values(qq.componentProperties).some(p => p.type === 'BOOLEAN');
  assert('SourceChip 暴露 BOOLEAN prop（isBest）', !!hasBest, hasBest ? '' : '无 BOOLEAN');
}

// 验证 Layout/QualityMenu 暴露 disabled BOOLEAN prop
const qmSet = allSets.find(s => s.name === 'Layout/QualityMenu');
if (qmSet) {
  const std = qmSet.children.find(c => c.name === 'quality=standard');
  const hasDis = std && Object.values(std.componentProperties).some(p => p.type === 'BOOLEAN');
  assert('Layout/QualityMenu 暴露 BOOLEAN prop（disabled）', !!hasDis, hasDis ? '' : '无 BOOLEAN');
}

// 验证 ErrorPanel 暴露 TEXT prop（message）
const epSet = allSets.find(s => s.name === 'Modal/ErrorPanel');
if (epSet) {
  const col = epSet.children.find(c => c.name === 'state=collapsed');
  const hasMsg = col && Object.values(col.componentProperties).some(p => p.type === 'TEXT');
  assert('Modal/ErrorPanel 暴露 TEXT prop（message）', !!hasMsg, hasMsg ? '' : '无 TEXT');
}

// 验证变体命名格式 key=value
const badNames = allSets.flatMap(s => s.children.filter(c => !/^[^=]+=[^=]+$/.test(c.name)));
assert('所有变体名符合 key=value 格式', badNames.length === 0, badNames.map(c => c.name).join(', '));

// 验证每个 set 位置在 y >= 4000（底部第二行）
const wrongY = allSets.filter(s => s.y < 4000);
assert('10 个 set 全部位于底部第二行（y >= 4000）', wrongY.length === 0, wrongY.map(s => `${s.name}@y=${s.y}`).join('; '));

// ---------- fixture 导出 ----------
const dumpPrefix = process.env.FIGMA_FIXTURE_DUMP;
if (dumpPrefix) {
  const serNode = (n) => {
    const out = { type: n.type, name: n.name, id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
    if (n.description) out.description = n.description;
    if (typeof n.characters === 'string') out.characters = n.characters;
    if (n.children && n.children.length) out.children = n.children.map(serNode);
    return out;
  };
  const fixture = {
    document: { children: figma.root.children.map(p => ({ type: 'CANVAS', name: p.name, id: p.id, children: p.children.map(serNode) })) },
  };
  writeFileSync(`${dumpPrefix}.json`, JSON.stringify(fixture, null, 2));
  console.log(`\n[fixture] exported to ${dumpPrefix}.json`);
}

const fails = results.filter(r => !r.ok);
for (const r of results) if (r.file === 'ASSERT' && !r.ok) console.log(`FAIL  ${r.seg} — ${r.ret}`);
console.log(`\n${results.length - fails.length}/${results.length} 通过` + (fails.length ? `，${fails.length} 项 FAIL` : ' ✅ 全部达标'));
process.exit(fails.length ? 1 : 0);
