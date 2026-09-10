#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER v4 — D6 增量审计（description 模板合规）
// 验证：每个 Figma 节点（COMPONENT_SET / COMPONENT / Screen FRAME）的 description
//       含 AI_CONTRACT 段 + 必填 4 段（react / props / a11y / states）
// 用法:
//   FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit-d6.mjs
//   离线自测: node scripts/figma-aether-v4-audit-d6.mjs --fixture /tmp/d6
// 退出码: 0 = 全部 PASS, 1 = 有 FAIL
// 关联: specs/d6-description-template/{spec,template}.md
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

const REQUIRED_FIELDS = ['react', 'props', 'a11y', 'states'];
const REGEX_AI_CONTRACT = /---[\s\S]*?AI_CONTRACT:[\s\S]*?(?:---|$)/;

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); }

// ── 1. 拉文件树（depth 足够深，description 必带） ──
const file = await api(`/files/${FILE_KEY}?depth=8`);
const pages = (file.document?.children || []).filter((n) => n.type === 'CANVAS' || n.type === 'PAGE');

// ── 2. 收集需要校验的节点 ──
function walk(nodes, out = []) {
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.type === 'COMPONENT_SET' || n.type === 'COMPONENT') {
      out.push(n);
    } else if (n.type === 'FRAME' && (
      n.name?.startsWith('Screen/') ||
      n.name === 'README — AI CONTRACT' ||
      n.name === 'Archive README' ||
      n.name === 'MOTION SPEC'
    )) {
      out.push(n);
    }
    if (n.children) walk(n.children, out);
  }
  return out;
}
const targets = walk(pages);

// ── 3. 校验 description ──
let pass = 0, fail = 0, skip = 0;
for (const n of targets) {
  const desc = n.description || '';
  const id = n.id;
  if (!desc || desc.length < 30) {
    check(`D6 description: ${n.name} (${id})`, false, 'description 为空或 < 30 字符');
    fail++;
    continue;
  }
  const m = desc.match(REGEX_AI_CONTRACT);
  if (!m) {
    check(`D6 description: ${n.name} (${id})`, false, '缺 ---AI_CONTRACT:--- 段');
    fail++;
    continue;
  }
  const block = m[0];
  const missing = REQUIRED_FIELDS.filter((f) => !new RegExp(`\\b${f}\\s*:`).test(block));
  if (missing.length > 0) {
    check(`D6 description: ${n.name} (${id})`, false, `AI_CONTRACT 缺字段: ${missing.join(', ')}`);
    fail++;
  } else {
    check(`D6 description: ${n.name} (${id})`, true, `${desc.length} 字符，含 AI_CONTRACT + 4 字段`);
    pass++;
  }
}

// ── 4. 汇总 ──
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
if (AS_JSON) {
  console.log(JSON.stringify({ file: FILE_KEY, pass, fail, total: targets.length, results }, null, 2));
} else {
  console.log(`\nAETHER v4-D6 描述审计 — ${FILE_KEY}\n校验节点: ${targets.length}\n` + lines.join('\n') + `\n\n${pass}/${targets.length} 通过` + (fail ? `，${fail} 项 FAIL` : ' ✅ 全部达标'));
}
process.exit(fail ? 1 : 0);
