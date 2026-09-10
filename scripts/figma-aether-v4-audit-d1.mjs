#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER v4 — D1 增量审计（6 个 Modal/Full 屏幕）
// 验证：6 个 Screen frame 存在 + AI_CONTRACT description 字段 +
//       03 页自有填充变量绑定率 ≥70%（mod 与原 v4-audit 阈值不同：modal 屏更简单）
// 用法:
//   FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit-d1.mjs
//   离线自测: node scripts/figma-aether-v4-audit-d1.mjs --fixture /tmp/fixture
//     （fixture 由 FIGMA_FIXTURE_DUMP=/tmp/fixture node scripts/figma-v4-smoke-d1.mjs 生成）
// 退出码: 0 = 全部通过, 1 = 有 FAIL, 2 = 缺 token/网络错误
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
    return JSON.parse(readFileSync(`${FIXTURE}.json`, 'utf8'));
  }
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`https://api.figma.com/v1${path}`, {
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

// ---------- D1 期望清单 ----------
const D1_SCREENS = [
  'Screen/Search/Modal',
  'Screen/Liked/Modal',
  'Screen/Settings/Full',
  'Screen/RecoKey/Modal',
  'Screen/AuthError/Full',
  'Screen/EmptyState/Full',
];
const D1_TOTAL_MIN = 10; // 6 新 + 4 已有（Playing/Paused/Buffering/SourceSelect）
const D1_OWN_BOUND_MIN = 0.7; // 03 页自有填充变量绑定率（modal 屏简单，阈值比 v4 高）
const D1_COMP_BOUND_MIN = 0.3; // 03 页实例内填充变量绑定率（与 v4 一致）
const REQUIRED_DESCRIPTION_TAGS = ['AI_CONTRACT:', 'react:', 'a11y:'];

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); }

// ---------- 1. 拉文件 ----------
const file = await api(`/files/${FILE_KEY}?depth=4`);
const pages = (file.document?.children || []).filter((n) => n.type === 'CANVAS' || n.type === 'PAGE');
const page03 = pages.find((p) => p.name === '03 · Screens');
if (!page03) {
  console.error('找不到 03 · Screens 页');
  process.exit(1);
}

// ---------- 2. 6 个新 frame 存在性 ----------
const allFrames = page03.children || [];
const screenNames = allFrames.filter((n) => n.type === 'FRAME' && n.name.startsWith('Screen/')).map((n) => n.name);
for (const want of D1_SCREENS) {
  check(`D1 frame: ${want}`, screenNames.includes(want), screenNames.includes(want) ? '' : `当前: ${screenNames.join(', ')}`);
}
check(`03 页 Screen/ frame ≥ ${D1_TOTAL_MIN}`, screenNames.length >= D1_TOTAL_MIN, `实际 ${screenNames.length}: ${screenNames.join(', ')}`);

// ---------- 3. AI_CONTRACT 校验 ----------
// FRAME 在 Plugin API 里没有 description（只有 COMPONENT / COMPONENT_SET 有 PublishableMixin），
// 所以契约存为 frame 下一个隐藏 TEXT 子节点 AI_CONTRACT，REST 走 characters。
// 仍兼容 description 字段，方便后续把屏幕升级成 COMPONENT。
const contractOf = (f) =>
  f.description || (f.children || []).find((c) => c.type === 'TEXT' && c.name === 'AI_CONTRACT')?.characters || '';
for (const want of D1_SCREENS) {
  const f = allFrames.find((n) => n.name === want);
  if (!f) continue; // 上面已 FAIL
  const desc = contractOf(f);
  const missing = REQUIRED_DESCRIPTION_TAGS.filter((tag) => !desc.includes(tag));
  if (missing.length === 0) {
    check(`D1 AI_CONTRACT: ${want}`, true, `(${desc.length} 字符)`);
  } else {
    check(`D1 AI_CONTRACT: ${want}`, false, desc ? `缺标签: ${missing.join(', ')}` : '找不到 AI_CONTRACT 节点');
  }
}

// ---------- 4. 03 页实例化 + 变量绑定率 ----------
// 门禁只卡 D1 自己建的 6 屏——03 页上还躺着 v4-ABC 的 12 屏，其中 Search/Library/Settings/
// Error/RecoLoading 5 屏是在这条阈值存在之前画的、填充全硬编码。按整页统计会把 D1 拖到 FAIL，
// 而那笔债不属于 D1（收敛归 D2）。整页数字仍然打出来，只是不作为 FAIL 依据。
const tally = (frames) => {
  const t = { inst: 0, ownFill: 0, ownBound: 0, compFill: 0, compBound: 0, unbound: [] };
  const walk = (nodes, inInst) => {
    for (const n of nodes || []) {
      const inst = inInst || n.type === 'INSTANCE';
      if (n.type === 'INSTANCE') t.inst++;
      if (Array.isArray(n.fills)) {
        for (const f of n.fills) {
          if (f.type === 'SOLID' || f.type === 'GRADIENT_LINEAR') {
            const bound = f.type === 'GRADIENT_LINEAR'
              ? (f.gradientStops || []).some((s) => s.boundVariables && s.boundVariables.color)
              : !!(f.boundVariables && f.boundVariables.color);
            if (inst) { t.compFill++; if (bound) t.compBound++; }
            else { t.ownFill++; if (bound) t.ownBound++; else t.unbound.push(`${n.name} [${n.type}]`); }
          }
        }
      }
      walk(n.children, inst);
    }
  };
  walk(frames, false);
  return t;
};
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}% (${a}/${b})` : 'n/a (0/0)');
const d1Frames = allFrames.filter((n) => D1_SCREENS.includes(n.name));
const d1 = tally(d1Frames);
const all = tally(allFrames);

check('D1 6 屏含组件实例', d1.inst > 0, `实际 ${d1.inst} 个实例`);
const d1Unbound = d1.unbound.length ? '；未绑定: ' + d1.unbound.slice(0, 6).join(', ') + (d1.unbound.length > 6 ? '…' : '') : '';
check(
  `D1 6 屏自有填充绑定 ≥ ${D1_OWN_BOUND_MIN * 100}%`,
  (d1.ownFill ? d1.ownBound / d1.ownFill : 1) >= D1_OWN_BOUND_MIN,
  `绑定 ${pct(d1.ownBound, d1.ownFill)}${d1Unbound}`,
);
check(
  `D1 6 屏实例内填充绑定 ≥ ${D1_COMP_BOUND_MIN * 100}%`,
  d1.compFill === 0 || d1.compBound / d1.compFill >= D1_COMP_BOUND_MIN,
  `绑定 ${pct(d1.compBound, d1.compFill)}`,
);
// 整页口径（含 v4-ABC 遗留屏）——只报数，不作为 FAIL 依据，供 D2 收敛时对账
const legacy = { ownFill: all.ownFill - d1.ownFill, ownBound: all.ownBound - d1.ownBound };
check(
  '03 整页自有填充绑定（信息，不门禁）',
  true,
  `整页 ${pct(all.ownBound, all.ownFill)}；其中 v4-ABC 遗留屏 ${pct(legacy.ownBound, legacy.ownFill)}——遗留债归 D2`,
);

// ---------- 5. 屏幕不互相覆盖 ----------
// 原来只比 x 是否相同——03 页有 12 个 v4-ABC 屏占满 y=0 行时抓不到叠放，改成真实包围盒相交检测
const box = (f) => {
  const b = f.absoluteBoundingBox || { x: f.x, y: f.y, width: f.width || 0, height: f.height || 0 };
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const newScreens = D1_SCREENS.map((n) => allFrames.find((f) => f.name === n)).filter(Boolean);
const allScreens = allFrames.filter((n) => n.type === 'FRAME' && n.name.startsWith('Screen/'));
const collisions = [];
for (const a of newScreens) {
  for (const b of allScreens) {
    if (a === b || a.name === b.name) continue;
    if (overlaps(box(a), box(b))) collisions.push(`${a.name} × ${b.name}`);
  }
}
check(
  'D1 6 屏与 03 页其他屏无重叠',
  collisions.length === 0,
  collisions.length ? collisions.slice(0, 6).join('; ') : newScreens.map((s) => `${s.name}@${box(s).x},${box(s).y}`).join(', '),
);

// ---------- 汇总 ----------
const skips = results.filter((r) => r.ok === null);
const fails = results.filter((r) => r.ok === false);
const lines = results.map((r) => `${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
if (AS_JSON) {
  console.log(JSON.stringify({ file: FILE_KEY, pass: fails.length === 0, total: results.length, fails: fails.length, skips: skips.length, results }, null, 2));
} else {
  console.log(`\nAETHER v4-D1 增量审计报告 — ${FILE_KEY}\n` + lines.join('\n') + `\n\n${results.length - fails.length - skips.length}/${results.length} 通过` + (fails.length ? `，${fails.length} 项 FAIL` : ' ✅ 全部达标') + (skips.length ? `，${skips.length} 项 SKIP` : ''));
}
process.exit(fails.length ? 1 : 0);
