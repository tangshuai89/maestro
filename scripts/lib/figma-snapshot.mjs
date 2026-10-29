// ─────────────────────────────────────────────────────────────
// Figma → 前端 差异比对 — 纯函数核心
//
// 为什么要这个文件：所有"设计稿说 A、代码是 B"的判定逻辑都在这里，
// 不碰文件系统、不 spawn 子进程 —— 这样能离线构造坏数据做反向验证
// （"门禁能不能主动抓出坏改动"是 D 系列反复吃过的教训，见 specs/eval-driven-nl/）。
//
// 主线方向：**Figma → 前端**（设计稿驱动代码）。
// 反向（Figma 该跟代码改）只作为「附注」输出，不占待办清单位置 ——
// 那是 2026-10-24 归档决策的边界：纯设计稿对齐类不产生 app 功能。
// ─────────────────────────────────────────────────────────────

/**
 * 解析 AI_CONTRACT 段（浅解析：只取顶层 key → 原始值字符串）。
 *
 * 为什么浅解析就够：Figma 沙箱里没有 YAML parser，采集段只能取契约原文；
 * 而差异判定真正需要的只有两件事 —— ① `react` 路径 ② 4 个必填 key **是否存在**。
 * props / a11y / states 的值原样保留（供未来用），**但嵌套内容归属父 key**。
 *
 * 契约原文形如（D1 的真实格式）：
 *   AI_CONTRACT:
 *     react: packages/renderer/src/components/search/SearchPanel.tsx
 *     props:
 *       onPlay: (items, index) => void
 *       onClose: () => void
 *     a11y:
 *       role: dialog
 *       keyboard: [Escape, ArrowDown]
 *     states: [empty, loading, results]
 *
 * ⚠️ 嵌套必须归属父 key：如果不区分缩进，`props:` 下面的 `onPlay:` 会被当成
 *    与 props 平级的顶层 key → `props` 的值变空、契约语义被拍平。
 *    所以这里按**缩进层级**判定：第一个 key 行的缩进 = 顶层基准，
 *    比基准深的行一律拼进上一个顶层 key。
 */
export function parseContract(text) {
  if (!text || typeof text !== 'string') return null;
  const out = {};
  let inContract = false;
  let lastKey = null;
  let baseIndent = null;
  for (const line of text.split('\n')) {
    if (/^\s*AI_CONTRACT:\s*$/.test(line)) {
      inContract = true;
      continue;
    }
    if (!inContract) continue;
    const kv = /^(\s*)([a-zA-Z][a-zA-Z0-9_]*):(.*)$/.exec(line);
    if (kv) {
      const indent = kv[1].length;
      const key = kv[2];
      const value = kv[3].trim();
      if (baseIndent === null) baseIndent = indent;
      if (indent <= baseIndent) {
        // 顶层 key
        lastKey = key;
        out[key] = value;
      } else if (lastKey) {
        // 嵌套 → 归属上一个顶层 key（值拼接，不丢内容）
        out[lastKey] = out[lastKey] ? `${out[lastKey]} ${line.trim()}` : line.trim();
      }
      continue;
    }
    // 续行（多行值，如列表的下一项）→ 拼到上一个 key
    if (lastKey && /^\s{4,}\S/.test(line)) {
      out[lastKey] = (out[lastKey] ? out[lastKey] + ' ' : '') + line.trim();
    }
  }
  return Object.keys(out).length ? out : null;
}

/** 契约里的 react 路径 → 干净的文件路径（去引号 / 去尾逗号） */
export function reactPathOf(contract) {
  const raw = contract?.react;
  if (!raw) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/,$/, '')
    .trim();
  return cleaned || null;
}

/** 单条差异的形状。所有腿共用，方便统一渲染与机器消费。 */
export function makeDiff({ lane, kind, severity, title, detail, action, target }) {
  return {
    lane, // 'tokens' | 'components' | 'descriptions' | 'motion'
    kind, // 机器可读的小类，如 'figmaOnly' / 'unmapped' / 'nodeIdChanged'
    severity, // 'must' | 'should' | 'note'
    title, // 一行标题
    detail, // 上下文（现值/期望值）
    action, // 给人/agent 看的动作说明
    target: target ?? null, // 该改哪个文件（相对仓库根）；null = 不涉及具体文件
  };
}

// ── 1. tokens 腿 ────────────────────────────────────────────────
// 输入：仓库侧 token map（name → 值）、Figma 侧 token map。
// 主线：Figma 有、仓库缺 → 代码该跟；值不一致 → 代码该跟。
//
// 注意：map 的 key 来自 parseGeneratedTokens，**已含 `--` 前缀**（`--accent`）。
// 所以这里不能再拼 `--`，否则渲染成 `----accent`。统一走 cssName() 兜住。
const cssName = (name) => (String(name).startsWith('--') ? String(name) : `--${name}`);

export function diffTokens(repoTokens, figmaTokens) {
  const out = [];
  for (const [name, value] of figmaTokens) {
    const css = cssName(name);
    if (!repoTokens.has(name)) {
      out.push(
        makeDiff({
          lane: 'tokens',
          kind: 'figmaOnly',
          severity: 'must',
          title: `设计稿新增令牌 ${css}`,
          detail: { figma: value, repo: null },
          action: `设计稿有 ${css}（${value}），仓库生成层没有 → 跑 \`node scripts/figma-export-tokens.mjs scripts/figma-tokens-dump.json\` 重新导出`,
          target: 'packages/renderer/src/styles/base/_tokens.generated.scss',
        }),
      );
    } else if (repoTokens.get(name) !== value) {
      out.push(
        makeDiff({
          lane: 'tokens',
          kind: 'valueMismatch',
          severity: 'must',
          title: `令牌值与设计稿不一致 ${css}`,
          detail: { figma: value, repo: repoTokens.get(name) },
          action: `设计稿=${value}，仓库=${repoTokens.get(name)} → 跑 \`node scripts/figma-export-tokens.mjs scripts/figma-tokens-dump.json\` 重新导出（若仓库值是对的，说明设计稿快照过期，先刷新 dump）`,
          target: 'packages/renderer/src/styles/base/_tokens.generated.scss',
        }),
      );
    }
  }
  // 反向：仓库有、Figma 没有 —— 附注，不占主线
  for (const [name, value] of repoTokens) {
    if (!figmaTokens.has(name)) {
      out.push(
        makeDiff({
          lane: 'tokens',
          kind: 'repoOnly',
          severity: 'note',
          title: `仓库有、设计稿没有的令牌 ${cssName(name)}`,
          detail: { figma: null, repo: value },
          action: '附注：若这是有意的（legacy / -ui 令牌）忽略；若不是，设计稿漏了这个变量',
          target: null,
        }),
      );
    }
  }
  return out;
}

// ── 2. components 腿 ────────────────────────────────────────────
// 输入：Figma 侧组件集清单、code-connect 映射数组。
// 主线：
//   a) AI_CONTRACT 声明的 react 路径在仓库里不存在 → 代码该补组件
//   b) Figma 组件集没有任何映射 → 驱动通道缺失（AI 读不到它）
//   c) 映射指向的 nodeId 与 Figma 现状不符 → 通道指错位置
// snapshotScreens 只参与反向（orphaned）查找：Screen/*/Modal 这类映射指向的是
// 03 · Screens 上的 FRAME，不在组件集清单里，但它们确实存在。
export function diffComponents(snapshotComponents, mappings, repoFileExists, snapshotScreens = []) {
  const out = [];
  const byName = new Map();
  for (const m of mappings) {
    if (!byName.has(m.figmaComponent)) byName.set(m.figmaComponent, m);
  }
  const figmaNames = new Set([...snapshotComponents, ...snapshotScreens].map((c) => c.name));

  for (const comp of snapshotComponents) {
    const map = byName.get(comp.name);

    // a) AI_CONTRACT 指向的 React 文件不存在 → 前端该补组件（这是"向下驱动"的主线）
    const reactPath = comp.aiContract?.react;
    if (reactPath && !repoFileExists(reactPath)) {
      out.push(
        makeDiff({
          lane: 'components',
          kind: 'reactPathMissing',
          severity: 'must',
          title: `设计稿要求的组件在代码里不存在：${comp.name}`,
          detail: { reactPath, nodeId: comp.nodeId, variants: comp.variants },
          action: `设计稿 ${comp.name} 的 AI_CONTRACT 声明 react 路径 \`${reactPath}\`，但该文件不存在 → 按设计稿的变体清单（${(comp.variants ?? []).join(' / ') || '未声明'}）新建该组件`,
          target: reactPath,
        }),
      );
    }

    // b) Figma 组件集没有映射 → 驱动通道缺失
    if (!map) {
      out.push(
        makeDiff({
          lane: 'components',
          kind: 'unmapped',
          severity: 'should',
          title: `设计稿组件集没有 Code Connect 映射：${comp.name}`,
          detail: { nodeId: comp.nodeId, variants: comp.variants },
          action: `Figma 里有 \`${comp.name}\`（${comp.nodeId}），但 figma-code-connect.json 里没有它 → AI 通过 Code Connect 读不到这个组件的代码位置`,
          target: 'figma-code-connect.json',
        }),
      );
      continue;
    }

    // c) nodeId 对不上 → 通道指错位置（常见于 Figma 侧重建过组件）
    if (map.figmaNodeId && comp.nodeId && map.figmaNodeId !== comp.nodeId) {
      out.push(
        makeDiff({
          lane: 'components',
          kind: 'nodeIdChanged',
          severity: 'should',
          title: `映射的 nodeId 与设计稿现状不符：${comp.name}`,
          detail: { mapping: map.figmaNodeId, figma: comp.nodeId },
          action: `figma-code-connect.json 里写的是 \`${map.figmaNodeId}\`，设计稿现状是 \`${comp.nodeId}\` → 更新映射（组件被重建过）`,
          target: 'figma-code-connect.json',
        }),
      );
    }
  }

  // 反向：映射了但设计稿里没这个组件集 → 附注（多为设计稿删了/改名了）
  for (const m of mappings) {
    if (!figmaNames.has(m.figmaComponent)) {
      out.push(
        makeDiff({
          lane: 'components',
          kind: 'orphaned',
          severity: 'note',
          title: `映射指向的设计稿组件不存在：${m.figmaComponent}`,
          detail: { nodeId: m.figmaNodeId, reactPath: m.reactPath },
          action: '附注：设计稿里没有这个组件集（可能删了或改名）→ 确认后更新或删掉映射',
          target: 'figma-code-connect.json',
        }),
      );
    }
  }
  return out;
}

// ── 3. descriptions 腿 ──────────────────────────────────────────
// 复用 audit-d6 的判据：AI_CONTRACT 段 + 4 必填字段（react/props/a11y/states）。
export const REQUIRED_AI_CONTRACT_FIELDS = ['react', 'props', 'a11y', 'states'];

// 语义载体的"有没有"与"预览"：
// 采集段给的是 hasDescription / descriptionPreview（布尔 + 短预览，控返回体）；
// 旧格式（直接给 description 全文）也兼容 —— 两边都能跑。
const hasSemantic = (comp) =>
  comp.hasDescription !== undefined
    ? Boolean(comp.hasDescription)
    : Boolean(String(comp.description ?? '').trim());

const semanticPreview = (comp) =>
  comp.descriptionPreview !== undefined
    ? String(comp.descriptionPreview ?? '')
    : String(comp.description ?? '').slice(0, 120);

export function diffDescriptions(snapshotComponents) {
  const out = [];
  for (const comp of snapshotComponents) {
    if (!hasSemantic(comp)) {
      out.push(
        makeDiff({
          lane: 'descriptions',
          kind: 'missingDescription',
          severity: 'note',
          title: `没有语义描述：${comp.name}`,
          detail: { nodeId: comp.nodeId },
          action:
            '附注：AI 读不到这个组件的语义 → 需要在 Figma 端补 description + AI_CONTRACT（设计稿侧写操作，低 ROI）',
          target: null,
        }),
      );
      continue;
    }
    if (!comp.aiContract) {
      out.push(
        makeDiff({
          lane: 'descriptions',
          kind: 'noAiContract',
          severity: 'note',
          title: `语义描述缺 AI_CONTRACT 段：${comp.name}`,
          detail: { nodeId: comp.nodeId, descriptionPreview: semanticPreview(comp) },
          action:
            '附注：AI 拿不到结构化 schema → 在 Figma 端补 AI_CONTRACT 段（设计稿侧写操作，低 ROI）',
          target: null,
        }),
      );
      continue;
    }
    const missing = REQUIRED_AI_CONTRACT_FIELDS.filter((f) => comp.aiContract[f] === undefined);
    if (missing.length) {
      out.push(
        makeDiff({
          lane: 'descriptions',
          kind: 'missingFields',
          severity: 'note',
          title: `AI_CONTRACT 缺字段：${comp.name}`,
          detail: { missing, nodeId: comp.nodeId },
          action: `附注：缺 ${missing.join(' / ')} → 在 Figma 端补齐（设计稿侧写操作，低 ROI）`,
          target: null,
        }),
      );
    }
  }
  return out;
}

// ── 4. motion 腿 ────────────────────────────────────────────────
// 输入：Figma MOTION SPEC 的条目、仓库 specs/motion-spec.json 的条目、代码里实际的 @keyframes 名。
// 主线：设计稿声明的动效，代码里没有实现 / 没登记 → 代码该补。
export function diffMotion(figmaSpec, repoSpec, codeKeyframes) {
  const out = [];
  const repoById = new Map(repoSpec.map((s) => [s.id, s]));
  const figmaById = new Map(figmaSpec.map((s) => [s.id, s]));

  // 主线：设计稿有、仓库没有 → 代码该实现
  for (const s of figmaSpec) {
    if (!repoById.has(s.id)) {
      out.push(
        makeDiff({
          lane: 'motion',
          kind: 'figmaOnly',
          severity: 'must',
          title: `设计稿声明的动效未进仓库 spec：${s.id}`,
          detail: { component: s.component, trigger: s.trigger, duration_ms: s.duration_ms },
          action: `设计稿 MOTION SPEC 有 \`${s.id}\`（${s.component} / ${s.trigger} / ${s.duration_ms}ms），仓库 specs/motion-spec.json 没有 → 实现该动效并登记条目`,
          target: 'specs/motion-spec.json',
        }),
      );
    }
  }

  // 仓库 spec 登记了、Figma 没有 → 附注（设计稿侧漏了）
  for (const s of repoSpec) {
    if (!figmaById.has(s.id)) {
      out.push(
        makeDiff({
          lane: 'motion',
          kind: 'repoOnly',
          severity: 'note',
          title: `仓库登记的动效设计稿里没有：${s.id}`,
          detail: { component: s.component, driver: s.driver },
          action: '附注：设计稿 MOTION SPEC 缺这条 → 需要在 Figma 端补（设计稿侧写操作，低 ROI）',
          target: null,
        }),
      );
    }
  }

  // 代码里的 @keyframes 没被任何 spec 条目登记 → 仓库内部一致性问题（主线，属代码侧）
  const specBlob = JSON.stringify(repoSpec);
  const unregistered = [...codeKeyframes].filter((k) => !specBlob.includes(k));
  if (unregistered.length) {
    out.push(
      makeDiff({
        lane: 'motion',
        kind: 'unregisteredKeyframes',
        severity: 'should',
        title: `${unregistered.length} 个 @keyframes 没被 motion spec 登记`,
        detail: { unregistered },
        action: `代码里有这些动画但 specs/motion-spec.json 没登记 → AI 读设计稿时拿不到这些动效参数：${unregistered.join(' / ')}`,
        target: 'specs/motion-spec.json',
      }),
    );
  }
  return out;
}

// ── 汇总 ────────────────────────────────────────────────────────

/** 按 lane / severity 统计。 */
export function summarize(diffs) {
  const byLane = {};
  const bySeverity = { must: 0, should: 0, note: 0 };
  for (const d of diffs) {
    byLane[d.lane] = (byLane[d.lane] ?? 0) + 1;
    bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
  }
  return { total: diffs.length, byLane, bySeverity };
}

/**
 * 渲染成喂给 coding agent 的 markdown。
 *
 * 主线段落只放 must/should；note（设计稿侧写操作）单列一节，
 * 明确标注"不占待办清单位置" —— 与 2026-10-24 的归档决策保持一致。
 */
export function renderMarkdown(diffs, meta = {}) {
  const lines = [];
  lines.push('# Figma → 前端 差异清单');
  lines.push('');
  if (meta.capturedAt) lines.push(`快照：${meta.capturedAt} · Figma ${meta.fileKey ?? '?'}`);
  if (meta.repoHead) lines.push(`仓库 HEAD：${meta.repoHead}`);
  lines.push('');

  const main = diffs.filter((d) => d.severity !== 'note');
  const notes = diffs.filter((d) => d.severity === 'note');

  if (main.length === 0) {
    lines.push('## 需要改前端代码：0 项');
    lines.push('');
    lines.push('设计稿与前端代码在已登记的维度上一致。');
  } else {
    lines.push(`## 需要改前端代码（${main.length} 项）`);
    lines.push('');
    main.forEach((d, i) => {
      lines.push(`### ${i + 1}. [${d.lane}] ${d.title}`);
      lines.push('');
      for (const [k, v] of Object.entries(d.detail ?? {})) {
        lines.push(`- ${k}: ${Array.isArray(v) ? v.join(' / ') : v}`);
      }
      if (d.target) lines.push(`- 目标文件: \`${d.target}\``);
      lines.push(`- 动作: ${d.action}`);
      lines.push('');
    });
  }

  if (notes.length) {
    lines.push('---');
    lines.push('');
    lines.push(`## 附注：设计稿侧待办（${notes.length} 项，不占待办清单位置）`);
    lines.push('');
    lines.push('> 这些是「设计稿该跟代码改」或「设计稿侧补描述」——纯设计稿对齐，不产生 app 功能。');
    lines.push('');
    for (const d of notes) {
      lines.push(`- [${d.lane}] ${d.title} — ${d.action}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
