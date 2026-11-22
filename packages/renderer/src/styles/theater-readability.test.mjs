// ─────────────────────────────────────────────────────────────
// 可读性门禁（三件事，都是用户报出来的「看不清」）
//
// ① 剧场里「可交互文字」的默认色 ≥ WCAG AA
//    2026-11-18：歌词工具行（复制歌词 / 复制本行 / 导出歌词图 / 换个源找歌词）
//    用 `color-mix(in srgb, var(--text-main) 34%, transparent)`（三级文字档），
//    34% 暖白压在剧场深底上实测 **2.8:1**，11px 等宽字远低于 4.5:1。
//
// ② 剧场 titlebar 必须钉死深色调色板
//    2026-11-20：顶栏按钮（音源 / 搜索 / 推荐 / ❤ / 队列 / 无损 / mode 图标）
//    和它们的 dropdown 吃的是**主题翻转令牌**（--text-secondary / --bg-overlay /
//    --border / --bg-elevated）。系统是浅色时（theme='system' + macOS 白天 =
//    默认状态），字变 rgba(28,25,23,.6)、底变 4% 黑、边变 8% 黑，压在近黑画布
//    rgb(2,2,10) 上只有 **~1.2:1** —— 肉眼等于消失。剧场画布永远是深空黑，
//    所以 titlebar 子树必须固定用 dark 调色板。
//
// ③ shadcn 门户（Dialog/Input/textarea）的文档级前景色
//    2026-11-22：NL 歌单 modal 的标题 / 意图值 / textarea 里打的字在浅色系统下
//    是**黑底黑字**。根因：Radix portal 挂在 <body> 上，而 body 没设 color ⇒
//    继承浏览器默认（color-scheme: light → 纯黑），DialogContent 的底却是固定的
//    深色 --sh-card。修复 = 给 body 一个固定前景色（--sh-foreground）。
//
// ① 的门禁口径：
//   - 只扫 `_theater.scss`（剧场视图底色是固定的深色画布，能算出确定性对比度；
//     其它视图叠在 modal / 玻璃底上，背景不固定，不在这里判）
//   - 命中「可交互类名族」（-btn/-button/-action/-link/-control/-ctrl/-tab/
//     -chip/-toggle/-seed）
//   - 跳过状态态（:hover / :focus / :active / :disabled / ::placeholder）——
//     hover 只会更亮，disabled 按 WCAG 可豁免
//   - 底色取 `--primitive-bg-top`（剧场画布顶色）。封面染色会把局部底提亮，
//     但 AA 余量够（72% 在真实截图底色 rgb(17,41,57) 上实测 7.5:1）
//
// ⚠️ 令牌按 `main.scss` 的 `@use` 顺序解析（后加载者胜）—— 这才是真实级联。
//    别按「手写覆盖优先」想当然：`--text-dim` 在 `_tokens.scss` 里被手写改成
//    0.55，但 `_tokens.generated.scss` 在它之后加载，又把值盖回 0.4（见
//    `npm run tokens:check` 的「遮蔽（未登记）」告警）。手写那份目前是死代码。
//
// 反向验证：文件末尾用**同一个** checker 断言旧的 34% 会判红 —— 一个永远绿的
// 门禁等于没有门禁（CLAUDE.md「评测自己的准则」）。
// ─────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEATER_SCSS = resolve(__dirname, 'components/_theater.scss');
const MAIN_SCSS = resolve(__dirname, 'main.scss');

const AA_SMALL_TEXT = 4.5;

// ── tokens：按 main.scss 的 @use 顺序累加（后加载覆盖先加载） ──────
// `_themes.scss` 的令牌写在 @mixin 里（深/浅两套），不是 :root 级联的一部分，
// 因此不参与解析；剧场控件真用到时会因「token 未定义」而抛错，提醒扩展这里。
const tokenLayers = [...readFileSync(MAIN_SCSS, 'utf8').matchAll(/@use\s+'base\/([\w.-]+)'/g)]
  .map((m) => m[1])
  .filter((name) => !['themes', 'reset', 'base', 'tw-vars'].includes(name));

const tokens = {};
for (const layer of tokenLayers) {
  // partial 与普通文件混放（_tokens.scss / tokens-bridge.scss），两种都要认。
  const candidates = [
    resolve(__dirname, `base/_${layer}.scss`),
    resolve(__dirname, `base/${layer}.scss`),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) throw new Error(`找不到 ${layer} 的 scss（@use 'base/${layer}'）`);
  const src = readFileSync(file, 'utf8');
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*--([\w-]+):\s*([^;]+);/);
    if (m) tokens[m[1]] = m[2].trim(); // 后加载者胜 = 真实级联
  }
}

function hexToRgba(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  ];
}

function parseColorLiteral(str) {
  const s = str.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return hexToRgba(s);
  const rgb = s.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const p = rgb[1].split(',').map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return null;
}

/** 解一层 var(--x)（token 本身也可能是 rgba / var 引用）。 */
function resolveToken(name, depth = 0) {
  if (depth > 6) throw new Error(`token 引用环：--${name}`);
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`token 未定义：--${name}（需要扩展解析器？）`);
  const literal = parseColorLiteral(raw);
  if (literal) return literal;
  const ref = raw.match(/^var\(--([\w-]+)\)$/);
  if (ref) return resolveToken(ref[1], depth + 1);
  throw new Error(`token --${name} 的值无法解析：${raw}`);
}

/**
 * 把一条 `color:` 声明解析成 [r,g,b,a]（a = 有效不透明度）。
 * 解析不了就抛错——门禁宁可红，也不能静默跳过（跳过 = 假绿）。
 */
function resolveColorDecl(decl) {
  const value = decl.trim().replace(/;$/, '');

  const mix = value.match(
    /^color-mix\(in srgb,\s*var\(--([\w-]+)\)\s+(\d+(?:\.\d+)?)%,\s*transparent\)$/,
  );
  if (mix) {
    const base = resolveToken(mix[1]);
    const alpha = (parseFloat(mix[2]) / 100) * base[3];
    return [base[0], base[1], base[2], alpha];
  }

  const ref = value.match(/^var\(--([\w-]+)\)$/);
  if (ref) return resolveToken(ref[1]);

  const literal = parseColorLiteral(value);
  if (literal) return literal;

  throw new Error(`无法解析颜色声明：${value}（解析器需要扩展，别让它静默跳过）`);
}

// ── WCAG 对比度 ───────────────────────────────────────────────
function linear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function composite([r, g, b, a], bg) {
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
}
function contrast(fg, bg) {
  const f = luminance(composite(fg, bg));
  const b = luminance(bg);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}

const THEATER_BG = resolveToken('primitive-bg-top');

// ── 已知欠账（不属于本次要修的那一行） ─────────────────────────
// 这两个控件走 `var(--text-dim)`，而 --text-dim 被生成层盖成 0.4（见文件头），
// 实测 ~3.3:1。升到 0.55 会改全站视觉基线，属于 NEXT-ITERATION「--text-dim 选
// 0.55 还是 0.4」的待拍板项 —— 不在这里顺手改。
// 自清洁：一旦它们真的达标（比如 --text-dim 拍板升到 0.55），下面的断言会红，
// 提示把这条豁免删掉，避免清单变成永久的遮羞布。
const KNOWN_DIM = new Map([
  ['.th-more-btn', '--text-dim 当前实际值 0.4（手写 0.55 被生成层遮蔽）'],
  ['.th-ctrl', '--text-dim 当前实际值 0.4（手写 0.55 被生成层遮蔽）'],
]);

// ── SCSS 扫块 ─────────────────────────────────────────────────
// 可交互类名族；两侧边界保证是**完整词**，不会把 `.th-lyric`（静态歌词）
// 误判成交互元素。
const INTERACTIVE =
  /(?:^|[\s._-])(?:btn|button|action|link|control|ctrl|tab|chip|toggle|seed)(?:$|[\s._:-])/i;
// 状态态 + 伪元素：hover 只会更亮；disabled 在 WCAG 里可豁免对比度。
const STATE_ONLY = /:(hover|focus|focus-visible|active|disabled)\b|\[disabled\]|::/;

function collectInteractiveColors() {
  const lines = readFileSync(THEATER_SCSS, 'utf8').split('\n');
  const stack = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;
    if (line.endsWith('{')) {
      stack.push(line.slice(0, -1).trim());
      continue;
    }
    if (line === '}') {
      stack.pop();
      continue;
    }
    const m = line.match(/^color:\s*(.+?);$/);
    if (!m) continue;
    const selector = stack.filter(Boolean).join(' ');
    if (!selector || !INTERACTIVE.test(selector) || STATE_ONLY.test(selector)) continue;
    out.push({ line: i + 1, selector, decl: m[1], rgba: resolveColorDecl(m[1]) });
  }
  return out;
}

// ── 断言 ──────────────────────────────────────────────────────
let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    failures++;
    process.exitCode = 1;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const entries = collectInteractiveColors();

test('扫到了剧场里已知的交互控件（防空扫描）', () => {
  assert(entries.length > 0, '一条交互色都没扫到');
  const selectors = entries.map((e) => e.selector);
  for (const known of ['.th-lyric-action', '.th-more-btn']) {
    assert(
      selectors.includes(known),
      `已知交互控件 ${known} 没被扫到（选择器解析器坏了？扫到：${selectors.join(' | ')}）`,
    );
  }
});

test(`交互文字默认色对比度 ≥ ${AA_SMALL_TEXT}:1（WCAG AA 小字号）`, () => {
  const bad = [];
  const stale = [];
  for (const e of entries) {
    const ratio = contrast(e.rgba, THEATER_BG);
    const exempt = KNOWN_DIM.get(e.selector);
    if (ratio < AA_SMALL_TEXT) {
      if (exempt) continue;
      bad.push(
        `_theater.scss:${e.line} ${e.selector}\n` +
          `      color: ${e.decl}  → ${ratio.toFixed(2)}:1（要 ≥ ${AA_SMALL_TEXT}）`,
      );
    } else if (exempt) {
      stale.push(`${e.selector} 已经 ${ratio.toFixed(2)}:1 —— 请从 KNOWN_DIM 删掉这条豁免`);
    }
  }
  assert(bad.length === 0, `以下交互文字在剧场底色上看不清：\n    ${bad.join('\n    ')}`);
  assert(stale.length === 0, `豁免清单过期：\n    ${stale.join('\n    ')}`);
});

test('已知欠账的前提仍成立（--text-dim 仍被生成层遮蔽成 0.4）', () => {
  // 这条断言不是给「坏值」背书，而是让 --text-dim 一旦拍板升到 0.55 时，
  // 门禁会主动红一次：删豁免 + 重跑视觉基线，而不是悄悄放过。
  const raw = tokens['text-dim'] ?? '';
  assert(
    raw.includes('0.4'),
    `--text-dim 实际级联值变成 ${raw} —— 如果已经升到 0.55（WCAG AA），` +
      '请从 KNOWN_DIM 删掉 .th-more-btn / .th-ctrl 两条豁免并更新视觉基线',
  );
});

test('反向验证：旧的 34% 值会被这条门禁判红', () => {
  // 用**同一个** checker 跑用户报的那个值：必须 < 4.5，否则门禁形同虚设。
  const old = resolveColorDecl('color-mix(in srgb, var(--text-main) 34%, transparent)');
  const ratio = contrast(old, THEATER_BG);
  assert(
    ratio < AA_SMALL_TEXT,
    `34% 居然判成 ${ratio.toFixed(2)}:1 —— 门禁的阈值/底色口径不对，抓不到这次回归`,
  );
});

// ── ② 剧场 titlebar 的主题钉死 ─────────────────────────────────
const THEMES_SCSS = resolve(__dirname, 'base/_themes.scss');
const TITLEBAR_SCSS = resolve(__dirname, 'components/_titlebar.scss');
const DROPDOWN_SCSS = resolve(__dirname, 'components/_dropdown-menu.scss');
// 剧场画布底色（.th-root 的深空黑），不是主题令牌 —— 主题翻转时它不变。
const THEATER_CANVAS = [2, 2, 10];

/** 取出 _themes.scss 里某个 @mixin 定义的令牌（body 里只有声明，没有嵌套块）。 */
function mixinTokens(src, name) {
  const m = src.match(new RegExp(`@mixin ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`@mixin ${name} 没找到（_themes.scss 结构变了？）`);
  const out = new Map();
  for (const line of m[1].split('\n')) {
    const d = line.match(/^\s*--([\w-]+):\s*([^;]+);/);
    if (d) out.set(d[1], d[2].trim());
  }
  return out;
}

const themesSrc = readFileSync(THEMES_SCSS, 'utf8');
const lightDefs = mixinTokens(themesSrc, 'light-tokens');
const darkDefs = mixinTokens(themesSrc, 'dark-tokens');
const titlebarSrc = readFileSync(TITLEBAR_SCSS, 'utf8');
const chromeFiles = [TITLEBAR_SCSS, DROPDOWN_SCSS];

/** titlebar + dropdown 里用到的所有 var(--x)。 */
function chromeVars() {
  const used = new Set();
  for (const file of chromeFiles) {
    for (const m of readFileSync(file, 'utf8').matchAll(/var\(--([\w-]+)\)/g)) used.add(m[1]);
  }
  return used;
}

/** 会跟随主题翻转的令牌 = 在 light 调色板里出现的令牌。 */
const flippable = new Set([...chromeVars()].filter((v) => lightDefs.has(v)));

test('剧场 titlebar 钉了 dark 调色板（.app.theater-mode .titlebar → dark-tokens）', () => {
  const pin = titlebarSrc.match(
    /\.app\.theater-mode\s+\.titlebar\s*\{[^}]*@include\s+[\w.]*dark-tokens/,
  );
  assert(
    pin,
    '没找到 `.app.theater-mode .titlebar { @include …dark-tokens; }` —— ' +
      '浅色主题下顶栏按钮会退回「深灰字压近黑画布」（~1.2:1）',
  );
});

test('titlebar / dropdown 用到的主题翻转令牌都被 dark 调色板覆盖', () => {
  const missing = [...flippable].filter((v) => !darkDefs.has(v));
  assert(
    missing.length === 0,
    `这些令牌会跟主题翻转，但 dark 调色板没定义 ⇒ 浅色主题下 titlebar 漏光：${missing
      .map((v) => `--${v}`)
      .join(', ')}`,
  );
});

test('反向验证：不钉住时（浅色主题）顶栏文字确实低于 AA', () => {
  // 用 light 调色板的 --text-secondary 直接算：这就是用户截图里的组合。
  const light = parseColorLiteral(lightDefs.get('text-secondary'));
  assert(light, 'light-tokens 里 --text-secondary 解析失败');
  const ratio = contrast(light, THEATER_CANVAS);
  assert(
    ratio < AA_SMALL_TEXT,
    `浅色主题的 --text-secondary 居然有 ${ratio.toFixed(2)}:1 —— 门禁的前提不成立，抓不到这次回归`,
  );
});

test('钉住后（dark 调色板）顶栏文字达到 AA', () => {
  const dark = parseColorLiteral(darkDefs.get('text-secondary'));
  assert(dark, 'dark-tokens 里 --text-secondary 解析失败');
  const ratio = contrast(dark, THEATER_CANVAS);
  assert(
    ratio >= AA_SMALL_TEXT,
    `dark 调色板的 --text-secondary 只有 ${ratio.toFixed(2)}:1（要 ≥ ${AA_SMALL_TEXT}）`,
  );
});

// ── ③ shadcn 门户：文档级前景色 ─────────────────────────────────
const BASE_SCSS = resolve(__dirname, 'base/_base.scss');
const BRIDGE_SCSS = resolve(__dirname, 'base/tokens-bridge.scss');

/** 解析 tokens-bridge 里的 HSL 三元组令牌（`38 53% 93%`）。 */
function bridgeHsl(name) {
  const src = readFileSync(BRIDGE_SCSS, 'utf8');
  const m = src.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`tokens-bridge 里找不到 --${name} 的 HSL 三元组`);
  return [+m[1], +m[2], +m[3]];
}

function hslToRgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255, 1];
}

test('shadcn 门户有文档级前景色（body { color: var(--text-main) }）', () => {
  const src = readFileSync(BASE_SCSS, 'utf8');
  assert(
    /body\s*\{[^}]*color:\s*var\(--text-main\)/.test(src),
    '`_base.scss` 里没有给 body 设 --sh-foreground ⇒ portal（Dialog 等）会继承浏览器' +
      '默认；color-scheme: light 时是纯黑，压在 --sh-card 深底上 = 黑底黑字',
  );
});

test('文档前景色 / 对话框底色 达到 AA（--sh-foreground vs --sh-card）', () => {
  const fg = hslToRgb(...bridgeHsl('sh-foreground'));
  const card = hslToRgb(...bridgeHsl('sh-card'));
  const ratio = contrast(
    fg,
    card.map((c, i) => (i === 3 ? 1 : c)),
  );
  assert(
    ratio >= AA_SMALL_TEXT,
    `--sh-foreground 在 --sh-card 上只有 ${ratio.toFixed(2)}:1（要 ≥ ${AA_SMALL_TEXT}）`,
  );
});

test('反向验证：浏览器默认黑字压在 --sh-card 上确实低于 AA（门禁抓得住这次回归）', () => {
  const card = hslToRgb(...bridgeHsl('sh-card'));
  const ratio = contrast(
    [0, 0, 0, 1],
    card.map((c, i) => (i === 3 ? 1 : c)),
  );
  assert(
    ratio < AA_SMALL_TEXT,
    `纯黑在 --sh-card 上居然有 ${ratio.toFixed(2)}:1 —— 门禁前提不成立，抓不到这次回归`,
  );
});

test('表单控件显式设了 text-foreground（UA 的 fieldtext 不跟 body 走）', () => {
  // <textarea>/<input> 是**表单控件**：UA 样式给的是 `color: fieldtext`，
  // 它跟随 color-scheme（light → 黑），**不继承 body** —— 只修 body 不够。
  const controls = [
    ['components/ui/textarea.tsx', 'Textarea'],
    ['components/ui/Input.tsx', 'Input'],
  ];
  for (const [rel, name] of controls) {
    const src = readFileSync(resolve(__dirname, '..', rel), 'utf8');
    assert(
      /text-foreground/.test(src),
      `${name} 的 className 里没有 text-foreground ⇒ 浅色系统下输入框里打的字是黑的` +
        '（UA fieldtext 不继承 body）',
    );
  }
});

test('反向验证：解析器遇到未知颜色会抛错而不是静默跳过', () => {
  let threw = false;
  try {
    resolveColorDecl('oklch(0.7 0.1 200)');
  } catch {
    threw = true;
  }
  assert(threw, '未知颜色被静默跳过 → 门禁会假绿');
});

if (failures === 0) console.log('all theater readability checks passed');
