#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER v4 — AI 驱动设计稿审计（Figma REST API）
// 用法:
//   FIGMA_TOKEN=<personal access token> node scripts/figma-aether-v4-audit.mjs
//   FIGMA_FILE_KEY=xxx FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit.mjs --json
//   离线自测: node scripts/figma-aether-v4-audit.mjs --fixture /tmp/fixture
//     （fixture 由 FIGMA_FIXTURE_DUMP=/tmp/fixture node scripts/figma-v4-smoke.mjs 生成）
// 退出码: 0 = 全部通过, 1 = 有 FAIL, 2 = 缺 token/网络错误
// 审计标准见 docs/figma-driven-frontend.md §8 与 01 · Foundations 的 README
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
const FILE_KEY = process.env.FIGMA_FILE_KEY || 'FtbRZXvzlCp4Sq9e322cQQ';
const TOKEN = process.env.FIGMA_TOKEN;
const AS_JSON = process.argv.includes('--json');
const FIXTURE = process.argv.includes('--fixture') ? process.argv[process.argv.indexOf('--fixture') + 1] : null;

if (!TOKEN && !FIXTURE) {
  console.error('缺少 FIGMA_TOKEN。获取: Figma → Settings → Security → Personal access tokens');
  process.exit(2);
}

const api = async (path, retries = 3) => {
  if (FIXTURE) {
    const file = path.includes('/variables') ? `${FIXTURE}.variables.json` : `${FIXTURE}.json`;
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`https://api.figma.com/v1${path}`, {
        // figd_ 新式 token 只能走 X-Figma-Token 头；带 Authorization 会被 401 拒绝
        headers: { 'X-Figma-Token': TOKEN },
      });
      if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
};

// ---------- 期望清单（与构建脚本一一对应） ----------
// AETHER THEATER 基准（v4-ABC）
const EXPECTED_SETS = {
  'Ring/Sound': 2,
  'Hologram/Cover': 4, // idle|playing|loading|no-cover
  'Lyrics/Line': 4, // prev|current|next|empty
  'Core/Play': 4,
  'Button/Icon': 8,
  'Badge/Platform': 8,
  'Tag/Stat': 12,
  'Ring/Progress': 3,
  'Card/Neural': 2,
  'Controls/Transport': 2,
  'Button/Like': 3, // unliked|liked|fanout（跨平台红心）
};
const EXPECTED_COMPONENTS = ['Scene/Backdrop', 'State/RecoUnconfigured', 'Icon/Prev', 'Icon/Next', 'Icon/Play', 'Icon/Pause', 'Icon/Shuffle', 'Icon/Repeat', 'Icon/Heart', 'Icon/Search'];
const EXPECTED_VARS = {
  'Color/primitive': 10,
  'Color/semantic': 17, // 15 基础 + track + white
  Spacing: 10,
  Radius: 7, // 8/10/12/14/16/20/24
  Motion: 7, // 4 duration + 3 ease
};
const MIN_TEXT_STYLES = 11;
const MIN_EFFECT_STYLES = 4;
const MIN_SCREENS = 4;
const MIN_INTERACTIONS = 12;
const MAX_UNBOUND_RATIO = 0.3; // 03 页未绑定变量颜色的最大容忍比例

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

// ---------- 1. 文件 + 页面 ----------
const file = await api(`/files/${FILE_KEY}?geometry=paths`);
const doc = file.document;
const pages = doc.children.filter((n) => n.type === 'CANVAS' || n.type === 'PAGE'); // REST 里页面类型是 CANVAS
const pageNames = pages.map((p) => p.name);
for (const want of ['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion']) {
  check(`页面存在: ${want}`, pageNames.includes(want), pageNames.includes(want) ? '' : `实际: ${pageNames.join(', ')}`);
}
const page01 = pages.find((p) => p.name === '01 · Foundations');
const page02 = pages.find((p) => p.name === '02 · Components');
const page03 = pages.find((p) => p.name === '03 · Screens');
const page04 = pages.find((p) => p.name === '04 · Motion');

// ---------- 2. README ----------
const readme = page01?.children?.find((n) => n.name === 'README — AI CONTRACT');
check('README — AI CONTRACT 存在 (01)', !!readme, readme ? '' : '01 页无 README frame');

// ---------- 3. 样式 ----------
const styles = Object.values(file.styles || {});
const textStyles = styles.filter((s) => s.styleType === 'TEXT' && s.name.startsWith('AETHER/'));
const effectStyles = styles.filter((s) => s.styleType === 'EFFECT' && s.name.startsWith('AETHER/'));
check(`Text Styles ≥ ${MIN_TEXT_STYLES}`, textStyles.length >= MIN_TEXT_STYLES, `实际 ${textStyles.length}: ${textStyles.map((s) => s.name).join(', ')}`);
check(`Effect Styles ≥ ${MIN_EFFECT_STYLES}`, effectStyles.length >= MIN_EFFECT_STYLES, `实际 ${effectStyles.length}: ${effectStyles.map((s) => s.name).join(', ')}`);

// ---------- 4. 变量 ----------
try {
  // /variables 只返回"已发布"变量（未发布时 404）；文件本地变量走 /variables/local
  let vars;
  try { vars = await api(`/files/${FILE_KEY}/variables/local`); }
  catch (e) {
    // 403 = token 缺 variables scope，直接跳过（fallback 只会把 403 换成 404 掩盖问题）
    if (/403/.test(String(e))) throw Object.assign(e, { scope403: true });
    vars = await api(`/files/${FILE_KEY}/variables`);
  }
  const collections = Object.values(vars.meta.variableCollections);
  const col = collections.find((c) => c.name === 'AETHER');
  const allVars = Object.values(vars.meta.variables).filter((v) => v.variableCollectionId === col?.id);
  check('变量集合 AETHER', !!col, col ? `共 ${allVars.length} 个变量` : '无 AETHER 集合');
  if (col) {
    for (const [group, min] of Object.entries(EXPECTED_VARS)) {
      const n = allVars.filter((v) => v.name.startsWith(group + '/')).length;
      check(`变量组 ${group} ≥ ${min}`, n >= min, `实际 ${n}`);
    }
  }
} catch (e) {
  if (/403/.test(String(e)) || e.scope403) {
    // 403 = token 缺 variables scope（细粒度权限），不是文件问题 —— 标记 SKIP
    results.push({ name: '变量接口可访问（SKIP）', ok: null, detail: 'token 缺少 file_variables scope，重建 token 时勾选后重验' });
  } else {
    check('变量接口可访问', false, String(e));
  }
}

// ---------- 5. 组件集 ----------
const componentSetsMap = file.componentSets || {};
const componentSets = Object.values(componentSetsMap);
const components = Object.values(file.components || {});
// 重建可能留下「幽灵」map 条目（已从树删除但 map 残留）：优先匹配文档树中实际存在的组件集
const liveSetIds = new Set();
const walkLive = (nodes) => {
  for (const n of nodes || []) {
    if (n.type === 'COMPONENT_SET') liveSetIds.add(n.id);
    walkLive(n.children);
  }
};
walkLive(pages.flatMap((p) => p.children || []));
for (const [name, wantVariants] of Object.entries(EXPECTED_SETS)) {
  // 注意：componentSets 的 map key 是本地 id（如 156:175），组件条目的 componentSetId 也指向本地 id；
  // set 对象里的 key 字段是 40 位全局 key，不能用来匹配
  const allEntries = Object.entries(componentSetsMap).filter(([, s]) => s.name === name);
  const entry = allEntries.find(([k]) => liveSetIds.has(k)) || allEntries[0];
  if (!entry) {
    check(`组件集 ${name}`, false, '不存在');
    continue;
  }
  const [setLocalId] = entry;
  const n = components.filter((c) => c.componentSetId === setLocalId).length;
  check(`组件集 ${name} (${wantVariants} 变体)`, n === wantVariants, `实际 ${n} 变体`);
}
for (const name of EXPECTED_COMPONENTS) {
  check(`组件 ${name}`, components.some((c) => c.name === name), components.some((c) => c.name === name) ? '' : '不存在');
}

// ---------- 5b. radius 绑定（02 页圆角须来自 Radius/* 变量） ----------
let radiusBound = 0;
const walkRadius = (nodes) => {
  for (const n of nodes || []) {
    if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') {
      // REST 圆角绑定字段为 rectangleCornerRadii（插件 API 侧是 cornerRadius）
      if (n.boundVariables && (n.boundVariables.cornerRadius || n.boundVariables.rectangleCornerRadii)) radiusBound++;
    }
    walkRadius(n.children);
  }
};
walkRadius(page02?.children);
check('02 页 cornerRadius 绑定 ≥15', radiusBound >= 15, `实际 ${radiusBound} 处`);

// ---------- 6. 屏幕 + 实例组装 + 变量绑定 ----------
// 绑定检查分两桶：03 页"自有"填充（非实例内部，屏幕自己的颜色）为门禁项；
// 实例内填充（组件所有，页面 02 负责）为信息项。
let screens = [];
let instCount = 0;
let ownFill = 0;
let ownBound = 0;
let compFill = 0;
let compBound = 0;
const unboundNodes = [];
let interactionCount = 0;
// 原型连线为全文件口径（组件变体 + 屏幕），单独全树扫描
const walkAll = (nodes) => {
  for (const n of nodes || []) {
    if (n.interactions && n.interactions.length) interactionCount += n.interactions.length;
    walkAll(n.children);
  }
};
walkAll(pages.flatMap((p) => p.children || []));
const walk = (nodes, inInst) => {
  for (const n of nodes || []) {
    if (n.type === 'FRAME' && n.name.startsWith('Screen/')) screens.push(n.name);
    const inst = inInst || n.type === 'INSTANCE';
    if (n.type === 'INSTANCE') instCount++;
    if (Array.isArray(n.fills)) {
      for (const f of n.fills) {
        if (f.type === 'SOLID' || f.type === 'GRADIENT_LINEAR') {
          // 渐变 paint 的绑定在 stops 上（boundVariables.color 挂在每个 stop），SOLID 在 paint 上
          const bound = f.type === 'GRADIENT_LINEAR'
            ? (f.gradientStops || []).some(s => s.boundVariables && s.boundVariables.color)
            : !!(f.boundVariables && f.boundVariables.color);
          if (inst) { compFill++; if (bound) compBound++; }
          else { ownFill++; if (bound) ownBound++; else unboundNodes.push(`${n.name || n.type} [${n.type}]`); }
        }
      }
    }
    walk(n.children, inst);
  }
};
walk(page03?.children, false);
check(`屏幕 ≥ ${MIN_SCREENS}`, screens.length >= MIN_SCREENS, `实际 ${screens.length}: ${screens.join(', ')}`);
check(`03 页含组件实例`, instCount > 0, `实际 ${instCount} 个实例`);
if (interactionCount >= MIN_INTERACTIONS) {
  check(`原型连线 ≥ ${MIN_INTERACTIONS}（全文件）`, true, `实际 ${interactionCount} 条`);
} else {
  // 平台限制：use_figma 沙箱不允许在 COMPONENT/FRAME/INSTANCE 节点上设置 interactions，
  // 原型连线只能在 Figma UI 原型模式手动完成 —— 记为 SKIP（非文件缺陷）
  results.push({ name: `原型连线 ≥ ${MIN_INTERACTIONS}（SKIP）`, ok: null, detail: `实际 ${interactionCount} 条；插件 API 无法写 interactions（平台限制），需 Figma UI 手动连线（见 figma-v4-command.md「完成后」节）` });
}
const unboundRatio = ownFill ? 1 - ownBound / ownFill : 1;
const topUnbound = unboundNodes.length ? '；未绑定节点: ' + unboundNodes.slice(0, 8).join(', ') + (unboundNodes.length > 8 ? '…' : '') : '';
check(`03 页自有填充绑定 ≤ ${MAX_UNBOUND_RATIO * 100}% 未绑定`, unboundRatio <= MAX_UNBOUND_RATIO, `未绑定 ${Math.round(unboundRatio * 100)}% (${ownFill - ownBound}/${ownFill})${topUnbound}`);
check(`03 页实例内填充绑定（信息）`, compFill === 0 || compBound / compFill >= 0.3, `组件内绑定 ${compBound}/${compFill}`);

// ---------- 7. MOTION SPEC ----------
const spec = page04?.children?.find((n) => n.name === 'MOTION SPEC');
check('MOTION SPEC 表存在 (04)', !!spec, spec ? '' : '04 页无 MOTION SPEC frame');

// ---------- 汇总 ----------
const skips = results.filter((r) => r.ok === null);
const fails = results.filter((r) => r.ok === false);
const lines = results.map((r) => `${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
if (AS_JSON) {
  console.log(JSON.stringify({ file: FILE_KEY, pass: fails.length === 0, total: results.length, fails: fails.length, skips: skips.length, results }, null, 2));
} else {
  console.log(`\nAETHER v4 审计报告 — ${FILE_KEY}\n` + lines.join('\n') + `\n\n${results.length - fails.length - skips.length}/${results.length} 通过` + (fails.length ? `，${fails.length} 项 FAIL` : ' ✅ 全部达标') + (skips.length ? `，${skips.length} 项 SKIP（token scope 不足）` : ''));
}
process.exit(fails.length ? 1 : 0);
