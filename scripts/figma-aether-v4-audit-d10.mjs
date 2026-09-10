#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER v4 — D10 增量审计（MOTION SPEC JSON 合规）
// 验证：04 · Motion 页 MOTION SPEC frame description 含
//       ---MOTION_SPEC:--- 段，可被 JSON.parse 解析
//       + 每条 spec 必填字段完整 + id 全局唯一
// 用法:
//   FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit-d10.mjs
//   离线自测: node scripts/figma-aether-v4-audit-d10.mjs --fixture /tmp/d10
// 退出码: 0 = PASS, 1 = FAIL
// 关联: specs/d10-motion-spec/spec.md
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
const FILE_KEY = process.env.FIGMA_FILE_KEY || 'FtbRZXvzlCp4Sq9e322cQQ';
const TOKEN = process.env.FIGMA_TOKEN;
const AS_JSON = process.argv.includes('--json');
const FIXTURE = process.argv.includes('--fixture') ? process.argv[process.argv.indexOf('--fixture') + 1] : null;

if (!TOKEN && !FIXTURE) {
  console.error('缺少 FIGMA_TOKEN（也可 --fixture <dir> 离线测）');
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

const REQUIRED_BASE = ['id', 'category', 'component', 'trigger'];
const TRANSITION_FIELDS = ['from_state', 'to_state', 'duration_ms', 'easing'];
const VALID_CATEGORIES = new Set(['interaction', 'transition', 'ambient', 'screen-flow']);
const VALID_TRIGGERS = new Set(['ON_HOVER', 'ON_CLICK', 'ON_PRESS', 'MOUSE_DOWN', 'AFTER_TIMEOUT', 'track-time', 'audio-reactive']);

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); }

// ── 1. 拉 04 · Motion 页 ──
const file = await api(`/files/${FILE_KEY}?depth=4`);
const pages = (file.document?.children || []).filter((n) => n.type === 'CANVAS' || n.type === 'PAGE');
const motionPage = pages.find((p) => p.name === '04 · Motion');
if (!motionPage) {
  console.error('找不到 04 · Motion 页');
  process.exit(1);
}
const specFrame = motionPage.children?.find((n) => n.name === 'MOTION SPEC');
if (!specFrame) {
  console.error('04 · Motion 页无 MOTION SPEC frame');
  process.exit(1);
}

// ── 2. 提取 MOTION_SPEC 段 ──
const desc = specFrame.description || '';
// 描述形如 `--- { "MOTION_SPEC": "1.0", "spec": [...] } ---`
// JSON 内有 {}，不能用 {.*?}；直接用 ---...--- 截整段作为 JSON
const match = desc.match(/---([\s\S]+?)---/);
if (!match) {
  check('MOTION SPEC frame description 含 ---...--- 段', false, 'description 缺段');
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`\nAETHER v4-D10 动效审计\n` + lines.join('\n') + `\n\n0/1 通过，1 FAIL`);
  process.exit(1);
}
const innerJson = match[1].trim();

// ── 3. 解析 JSON ──
let parsed;
try {
  parsed = JSON.parse(innerJson);
} catch (e) {
  check('MOTION_SPEC 段内 JSON.parse', false, e.message);
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`\nAETHER v4-D10 动效审计\n` + lines.join('\n') + `\n\n0/1 通过，1 FAIL`);
  process.exit(1);
}
check('MOTION_SPEC 段内 JSON.parse', true, `${innerJson.length} 字符`);

if (!parsed.spec || !Array.isArray(parsed.spec)) {
  check('顶层有 spec 数组', false, `实际: ${JSON.stringify(Object.keys(parsed))}`);
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`\nAETHER v4-D10 动效审计\n` + lines.join('\n') + `\n\n0/2 通过`);
  process.exit(1);
}
check('顶层有 spec 数组', true, `共 ${parsed.spec.length} 条`);

// ── 4. 校验每条 spec ──
const seenIds = new Set();
let pass = 0, fail = 0;
for (const item of parsed.spec) {
  const missing = REQUIRED_BASE.filter((f) => item[f] === undefined || item[f] === null);
  if (missing.length > 0) {
    check(`spec[${item.id || '?'}].必填字段`, false, `缺: ${missing.join(', ')}`);
    fail++;
    continue;
  }
  if (!VALID_CATEGORIES.has(item.category)) {
    check(`spec[${item.id}].category`, false, `非法: ${item.category}（须 ${[...VALID_CATEGORIES].join('/')}）`);
    fail++;
    continue;
  }
  if (!VALID_TRIGGERS.has(item.trigger)) {
    check(`spec[${item.id}].trigger`, false, `非法: ${item.trigger}`);
    fail++;
    continue;
  }
  if (seenIds.has(item.id)) {
    check(`spec[${item.id}] 唯一`, false, 'id 重复');
    fail++;
    continue;
  }
  seenIds.add(item.id);
  // transition 类必填字段
  if (item.category === 'interaction' || item.category === 'transition' || item.category === 'screen-flow') {
    const transMissing = TRANSITION_FIELDS.filter((f) => item[f] === undefined || item[f] === null);
    if (transMissing.length > 0) {
      check(`spec[${item.id}].transition 字段`, false, `${item.category} 缺: ${transMissing.join(', ')}`);
      fail++;
      continue;
    }
  }
  // ambient 必填 driver
  if (item.category === 'ambient' && !item.driver) {
    check(`spec[${item.id}].driver`, false, 'ambient 缺 driver 字段');
    fail++;
    continue;
  }
  pass++;
}
check(`所有 spec 必填字段合规`, fail === 0, `${pass}/${parsed.spec.length} PASS，${fail} FAIL`);

// ── 5. 双向漂移校验：Figma 端 spec vs 仓库 specs/motion-spec.json（仅真 Figma 模式）──
if (!FIXTURE) try {
  const repoSpec = JSON.parse(readFileSync('specs/motion-spec.json', 'utf8'));
  const figmaIds = new Set(parsed.spec.map((s) => s.id));
  const repoIds = new Set(repoSpec.spec.map((s) => s.id));
  const onlyInFigma = [...figmaIds].filter((id) => !repoIds.has(id));
  const onlyInRepo = [...repoIds].filter((id) => !figmaIds.has(id));
  if (onlyInFigma.length === 0 && onlyInRepo.length === 0) {
    check('Figma ↔ 仓库 spec id 集合一致', true, `共 ${parsed.spec.length} 条`);
  } else {
    const details = [];
    if (onlyInFigma.length) details.push(`Figma 多: ${onlyInFigma.join(', ')}`);
    if (onlyInRepo.length) details.push(`仓库多: ${onlyInRepo.join(', ')}`);
    check('Figma ↔ 仓库 spec id 集合一致', false, details.join('；'));
  }
  // 字段值一致性（仅对比有共同 id 的项）
  for (const f of parsed.spec) {
    const r = repoSpec.spec.find((x) => x.id === f.id);
    if (!r) continue; // 已在集合检查报过
    const drift = [];
    for (const k of ['category', 'component', 'trigger', 'duration_ms', 'easing', 'driver', 'description']) {
      if (JSON.stringify(f[k]) !== JSON.stringify(r[k])) drift.push(`${k}: 仓库=${JSON.stringify(r[k])} Figma=${JSON.stringify(f[k])}`);
    }
    if (drift.length) {
      check(`spec[${f.id}] 字段一致`, false, drift.join('；'));
      fail++;
    }
  }
} catch (e) {
  if (!FIXTURE) {
    // 真 Figma 模式但仓库 spec 不存在（异常）
    check('Figma ↔ 仓库 spec 对比', false, `读 specs/motion-spec.json 失败: ${e.message}`);
  }
  // fixture 模式：跳过（Figma 端已用仓库 spec 生成，不算漂移）
} else { check('Figma ↔ 仓库 spec 对比（仅真 Figma 模式）', true, 'fixture 模式跳过'); }

// ── 5. 汇总 ──
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
if (AS_JSON) {
  console.log(JSON.stringify({ file: FILE_KEY, spec_count: parsed.spec.length, pass, fail, results }, null, 2));
} else {
  console.log(`\nAETHER v4-D10 动效审计 — ${FILE_KEY}\n` + lines.join('\n') + `\n\n${pass}/${parsed.spec.length} spec 合规${fail ? `，${fail} 项 FAIL` : ' ✅ 全部达标'}`);
}
process.exit(fail ? 1 : 0);
