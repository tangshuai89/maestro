#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Figma Code Connect 校验脚本
// 验证 figma-code-connect.json 的 21+ 映射：路径存在、Props 覆盖、schema 一致
// 用法:
//   node scripts/figma-code-connect-validate.mjs           # 基础校验（21+ 项必须通过）
//   node scripts/figma-code-connect-validate.mjs --strict   # 严格（无 D1-PLACEHOLDER；props 100% 覆盖）
// 退出码: 0 = 全部通过, 1 = 有 FAIL
// 关联: specs/d5-code-connect/spec.md §5 Schema 规范
// ─────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..');
const JSON_PATH = join(repo, 'figma-code-connect.json');
const STRICT = process.argv.includes('--strict');

const map = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const mappings = map.mappings || [];
const fileKey = map['$figmaFileKey'] || '<missing>';

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); }

// ── 1. 全局：每个 mapping 基本字段齐全 ──
let dup = 0;
const seenKeys = new Map();
for (let i = 0; i < mappings.length; i++) {
  const m = mappings[i];
  const idx = i + 1;
  if (!m.figmaComponent || typeof m.figmaComponent !== 'string') {
    check(`mapping[${idx}].figmaComponent`, false, '缺失或非字符串');
    continue;
  }
  if (!m.figmaNodeId || typeof m.figmaNodeId !== 'string') {
    check(`mapping[${idx}].figmaNodeId`, false, '缺失或非字符串');
    continue;
  }
  if (m.figmaNodeId.startsWith('D1-PLACEHOLDER-')) {
    if (STRICT) {
      check(`mapping[${idx}].figmaNodeId`, false, `仍是 D1 占位 (${m.figmaNodeId})；--strict 模式要求全部已替换`);
    } else {
      check(`mapping[${idx}].figmaNodeId`, true, `D1 占位（_d1Status=${m._d1Status || '未标'}）— Phase B 替换`);
    }
  } else if (m.figmaNodeId === 'TBD-FIGMA') {
    if (STRICT) {
      check(`mapping[${idx}].figmaNodeId`, false, `D5_NEW 占位（TBD-FIGMA）；--strict 模式要求 Figma 端加组件集后填真实 nodeId`);
    } else {
      check(`mapping[${idx}].figmaNodeId`, true, `D5 新增占位（_status=${m._status}）— 未来 Figma 端加组件集后填真实 nodeId`);
    }
  } else if (!/^[\d:]+$/.test(m.figmaNodeId) && !m.figmaNodeId.startsWith('I')) {
    // Figma node id 形如 "123:456" 或 "I123:456;789"；允许非纯数字以兼容
    if (STRICT) {
      check(`mapping[${idx}].figmaNodeId 格式`, false, `非标准 node_id 格式: ${m.figmaNodeId}`);
    } else {
      check(`mapping[${idx}].figmaNodeId 格式`, true, `非纯数字 (${m.figmaNodeId})，跳过严格校验`);
    }
  } else {
    check(`mapping[${idx}].figmaNodeId`, true, m.figmaNodeId);
  }
  // 重复检测
  const k = `${m.figmaComponent}::${m.figmaNodeId}`;
  if (seenKeys.has(k)) {
    dup++;
    check(`mapping[${idx}].duplicate`, false, `与 #${seenKeys.get(k) + 1} 重复: ${k}`);
  } else {
    seenKeys.set(k, idx);
  }
  // figmaComponent 命名
  if (/\s/.test(m.figmaComponent)) {
    check(`mapping[${idx}].figmaComponent 命名`, false, `含空格: "${m.figmaComponent}"`);
  } else {
    check(`mapping[${idx}].figmaComponent 命名`, true, m.figmaComponent);
  }
  // reactPath 存在
  if (!m.reactPath || typeof m.reactPath !== 'string') {
    check(`mapping[${idx}].reactPath`, false, '缺失或非字符串');
    continue;
  }
  const absPath = join(repo, m.reactPath);
  if (!existsSync(absPath)) {
    check(`mapping[${idx}].reactPath 存在`, false, `${m.reactPath} 不存在`);
  } else if (m._status === 'PENDING_REFACTOR') {
    // PENDING_REFACTOR 映射：reactPath 存在但内联子组件未来会提取；跳过 export/define 严格校验
    check(`mapping[${idx}].reactPath 存在`, true, `${m.reactPath}（PENDING_REFACTOR：内联子组件；将来提取独立 export 后可转 ACTIVE）`);
  } else {
    // 文件包含 reactComponent 作为定义（export default / 内联 const/function）
    const content = readFileSync(absPath, 'utf8');
    const exportDefaultMatch = content.match(/export\s+default\s+(function|const)\s+(\w+)/);
    if (exportDefaultMatch && exportDefaultMatch[2] === m.reactComponent) {
      // export default 与 reactComponent 完全匹配（最理想）
      check(`mapping[${idx}].reactPath + reactComponent`, true, `${m.reactComponent} ← ${m.reactPath}`);
    } else {
      // 检查 reactComponent 作为内联定义（const/function/class 声明）
      const inlineRe = new RegExp(`\\b(const|function|class)\\s+${m.reactComponent}\\b`);
      if (inlineRe.test(content)) {
        const note = m._inlineIn ? ` (内联: ${m._inlineIn.slice(0, 40)})` : ' (内联子组件)';
        check(`mapping[${idx}].reactPath + reactComponent`, true, `${m.reactComponent}${note} ← ${m.reactPath}`);
      } else {
        const note = m._inlineIn ? `；_inlineIn 标记但文件内未找到 ${m.reactComponent}` : '';
        check(`mapping[${idx}].reactPath + reactComponent`, false, `${m.reactPath} 找不到 reactComponent=${m.reactComponent}（export default=${exportDefaultMatch ? exportDefaultMatch[2] : '无'}）${note}`);
      }
    }
    // Props 提取（interface Props 字段）
    const propsMatch = content.match(/interface\s+Props\s*\{([^}]*)\}/m);
    if (m.props && Object.keys(m.props).length > 0) {
      if (propsMatch) {
        const propsBody = propsMatch[1];
        const requiredProps = [];
        const propNameRe = /^\s*([A-Za-z_]\w*)\s*[:?]/gm;
        let match;
        while ((match = propNameRe.exec(propsBody)) !== null) {
          if (!['type', 'interface'].includes(match[1])) {
            // 排除注释行（简化处理：跳过含 // 开头的行）
            const lineStart = propsBody.lastIndexOf('\n', match.index) + 1;
            const line = propsBody.substring(lineStart, propsBody.indexOf('\n', match.index));
            if (!line.trim().startsWith('//')) requiredProps.push(match[1]);
          }
        }
        const missing = requiredProps.filter((p) => !(p in m.props));
        if (missing.length > 0) {
          check(`mapping[${idx}].props 覆盖`, STRICT ? false : missing.length < requiredProps.length / 2, `缺: ${missing.join(', ')}（${requiredProps.length - missing.length}/${requiredProps.length} 覆盖）`);
        } else {
          check(`mapping[${idx}].props 覆盖`, true, `${requiredProps.length} 个 prop 全部覆盖`);
        }
      } else {
        check(`mapping[${idx}].props 覆盖`, true, '无 Props interface（合理，如纯状态组件）');
      }
    } else if (propsMatch) {
      const propsBody = propsMatch[1];
      const propCount = (propsBody.match(/^\s*[A-Za-z_]\w*\s*[:?]/gm) || []).length;
      if (propCount > 0) {
        check(`mapping[${idx}].props 覆盖`, false, `interface Props 有 ${propCount} 个 prop 但 mapping.props 为空`);
      } else {
        check(`mapping[${idx}].props 覆盖`, true, 'interface Props 为空');
      }
    } else {
      check(`mapping[${idx}].props 覆盖`, true, '无 Props 字段（合理）');
    }
  }
}

// ── 2. 全局：file key 匹配 ──
if (fileKey === 'FtbRZXvzlCp4Sq9e322cQQ') {
  check('figmaFileKey 与项目文档一致', true, fileKey);
} else {
  check('figmaFileKey 与项目文档一致', false, `当前: ${fileKey}（期望 FtbRZXvzlCp4Sq9e322cQQ）`);
}

// ── 3. 汇总 ──
const fails = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ pass: fails.length === 0, total: results.length, fails: fails.length, mappings: mappings.length, results }, null, 2));
} else {
  console.log(`\nFigma Code Connect 校验 — ${mappings.length} 映射\n` + lines.join('\n') + `\n\n${results.length - fails.length}/${results.length} 通过` + (fails.length ? `，${fails.length} 项 FAIL` : ' ✅ 全部达标') + (dup ? `（${dup} 个重复）` : ''));
}
process.exit(fails.length ? 1 : 0);
