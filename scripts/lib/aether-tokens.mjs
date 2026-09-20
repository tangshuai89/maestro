// ─────────────────────────────────────────────────────────────
// AETHER token 映射 — 单一实现（导出 / 比对 / 拉取共用）
//
// 为什么必须单一实现：2026-09-20 之前 `figma-export-tokens.mjs` 用 `kebab()`、
// `check-token-drift.mjs` 用自带的 `toCssName()`，两套映射对同一变量给出不同名字
// （`--accent` vs `--semantic-accent`），导致比对脚本 51 处全假 FAIL。
// 同 `packages/common/src/normalizer.ts` 的教训：跨端共用的逻辑只能有一份。
//
// 映射契约见 docs/figma-driven-frontend.md §2.4。
// ─────────────────────────────────────────────────────────────

/** 导出顺序 —— 与 README 契约的展示顺序一致，改这里会改生成物字节 */
export const GROUPS = ['Color/primitive', 'Color/semantic', 'Spacing', 'Radius', 'Motion'];

const HEADER = [
  '// ============================================================',
  '// AETHER tokens — 由 Figma 变量自动导出（figma-export-tokens.mjs）',
  '// 请勿手改此文件；设计变更后重新导出',
  '// ============================================================',
];

/** camelCase / 点号 → kebab-case（与 v4 导出脚本保持逐字节一致） */
export const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[./]/g, '-').toLowerCase();

/**
 * Figma 变量名 → CSS 自定义属性名。
 * @returns {{ group: string, cssVar: string } | null} null = 不属于 AETHER token 体系
 */
export function cssVarFor(figmaName) {
  const group = GROUPS.find((g) => figmaName.startsWith(g + '/'));
  if (!group) return null;
  const key = figmaName.slice(group.length + 1);
  let cssVar;
  if (group === 'Color/semantic') cssVar = `--${kebab(key)}`;
  else if (group === 'Color/primitive') cssVar = `--primitive-${kebab(key)}`;
  else if (group === 'Spacing') cssVar = `--space-${key}`;
  else if (group === 'Radius') cssVar = `--radius-${key}`;
  else if (key.startsWith('duration-')) cssVar = `--motion-${kebab(key)}`;
  else cssVar = `--${kebab(key)}`; // Motion/ease-out → --ease-out
  return { group, cssVar };
}

const hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');

/**
 * 变量值（已解析别名）→ CSS 值字符串。
 * - COLOR → hex / rgba
 * - FLOAT + spacing|radius → 补 px
 * - Motion/ease-* 是 STRING，必须裸输出：带引号会让 `var(--ease-*)` 在
 *   transition/animation 里整条失效
 */
export function cssValueFor(entry, cssVar) {
  const v = entry.value;
  if (entry.resolvedType === 'COLOR') {
    const r = hex(v.r), g = hex(v.g), b = hex(v.b);
    const a = v.a ?? 1;
    if (a >= 1) return `#${r}${g}${b}`;
    return `rgba(${Math.round(v.r * 255)}, ${Math.round(v.g * 255)}, ${Math.round(v.b * 255)}, ${Number(a.toFixed(3))})`;
  }
  if (entry.resolvedType === 'FLOAT') {
    const withUnit = cssVar && (cssVar.startsWith('--space-') || cssVar.startsWith('--radius-'));
    return withUnit ? `${v}px` : `${v}`;
  }
  if (entry.name.includes('/ease-') || entry.name.startsWith('ease-')) return `${v}`;
  return `"${v}"`;
}

/**
 * dump 变量数组 → `:root { ... }` SCSS 文本。
 * 返回的字符串与 2026-08-21 的导出脚本产物逐字节一致。
 */
export function renderScss(variables) {
  const lines = [...HEADER, ':root {'];
  const buckets = Object.fromEntries(GROUPS.map((g) => [g, []]));
  const unmapped = [];
  for (const v of variables) {
    const hit = cssVarFor(v.name);
    if (!hit) {
      unmapped.push(v.name);
      continue;
    }
    buckets[hit.group].push(`  ${hit.cssVar}: ${cssValueFor(v, hit.cssVar)};`);
  }
  for (const g of GROUPS) {
    lines.push(`  // ---- ${g} ----`);
    lines.push(...buckets[g]);
  }
  lines.push('}', '');
  return { css: lines.join('\n'), unmapped };
}

/** dump 变量数组 → [{ figmaName, cssVar, value }] */
export function collectTokens(variables) {
  const out = [];
  for (const v of variables) {
    const hit = cssVarFor(v.name);
    if (!hit) continue;
    out.push({ figmaName: v.name, cssVar: hit.cssVar, value: cssValueFor(v, hit.cssVar) });
  }
  return out;
}

/**
 * 从生成物里解析 `--name: value;`（生成物每行一条，值不含换行）。
 * @returns {Map<string, string>} name（含 --）→ 值
 */
export function parseGeneratedTokens(scssText) {
  const map = new Map();
  for (const m of scssText.matchAll(/^\s*(--[\w-]+):\s*(.+?);\s*$/gm)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/**
 * 提取文件里所有 `:root`/任何块内的自定义属性**名字**。
 * 只取名字不取值：手写层有跨行的值（如 --font-ui 的字体栈），取值会漏。
 */
export function parseDeclaredNames(scssText) {
  const names = new Set();
  for (const m of scssText.matchAll(/^\s*(--[\w-]+)\s*:/gm)) names.add(m[1]);
  return names;
}

/** djb2 —— 用来核对「实时 Figma 渲染」与「仓库生成物」是否逐字节一致 */
export function djb2(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
