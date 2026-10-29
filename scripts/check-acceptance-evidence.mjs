#!/usr/bin/env node
/**
 * 验收清单**证据可达性**门禁：清单里写的证据文件必须还真的存在。
 *
 * ## 为什么需要这道门禁
 *
 * 「specs/&lt;name&gt;/tasks.md」 是这个仓库的「验收清单」—— 1174 条勾选项，每条后面通常
 * 跟着一个「证据」（哪个测试文件 / 哪个脚本 / 哪条命令）。它是判断「这件事到底
 * 做没做完」的唯一依据。
 *
 * 但它**靠人勾** → 会腐烂：
 *   - 合并后没人回来勾（实测 21 项没勾，其中 15 项在**已合并**的 feature 里）
 *   - 勾了也没人核 → 证据指向的文件早就改名 / 搬家 / 删了，清单还指着它
 *
 * 这道门禁只管第二种：**证据指向的东西还在不在**。
 *
 * ## 实测（2026-10-29 写这道门禁时的现场数据）
 *
 * 全仓 152 条仓库路径证据里，**15 条指向不存在的文件**：
 *   - 8 条「漏了 「packages/」 前缀」（「electron/src/main.ts」 → 实际在
 *     「packages/electron/src/main.ts」）—— 抄的时候少写一段
 *   - 7 条「文件真搬家了」（「scripts/pack.cjs」 → 「packages/electron/scripts/pack.cjs」；
 *     「packages/renderer/src/lib/shortcuts.test.ts」 → 「.tsx」）
 *
 * ⇒ **清单确实在腐烂，而且已经烂了**。人眼看不出来，是因为这些条目读起来
 * 完全通顺（「「electron/src/main.ts」 加了全局热键」—— 谁会先去 stat 这个文件？）。
 *
 * ## 判据
 *
 * 1. 扫 「specs/&lt;name&gt;/tasks.md」 的每个清单项（「- [x] **X** …」），取该项**及其后两行**
 *    内（到下一个清单项为止）所有 backtick 包裹的字符串作为**证据候选**。
 * 2. 候选必须「像仓库路径」才纳入校验（否则会误伤 API 端点 / 外部路径 / 散文）：
 *    - 以已知仓库前缀开头：「packages/」 「scripts/」 「tests/」 「specs/」 「docs/」
 *      「.github/」 「common/」 「electron/」 「renderer/」 「server/」
 *    - 或带已知扩展名（「.ts」 「.tsx」 「.mjs」 「.js」 「.cjs」 「.json」 「.sh」 「.scss」
 *      「.yml」 「.yaml」 「.md」 「.html」）且不含空格
 *    - 明确排除：「http(s)://」、以 「/」 开头（绝对路径 / API 端点）、以 「~/」 开头
 *      （外部路径）、含空格、含 「(」 「{」 「}」（模板/函数签名）、含 「,」
 * 3. 逐个判定：
 *    - 文件存在 → 通过
 *    - 不存在 → **失败**；先做「后缀唯一匹配」给出可操作的诊断：
 *      - 仓库里恰好有 1 个文件以它结尾 → 「你大概漏了前缀，正确路径是 X」
 *      - 有多个 → 「有 N 个同名候选，自己指」
 *      - 一个都没有 → 「文件不存在（改名 / 删了 / 从没存在过）」
 * 4. 豁免机制 「scripts/acceptance-evidence-ignore.json」：每条必须写 「reason」，
 *    否则视为**未登记** → 仍然失败（防止「为了过门禁去改清单措辞」）。
 *
 * ## 局限（诚实说明）
 *
 * - 只校验「证据文件还在」，**不校验证据内容是否仍然证明那条结论**。文件被改了
 *   但结论仍成立 / 失效，这条门禁看不出来。
 * - 只覆盖**带仓库路径**的证据（实测占清单项的 11%）。写成散文 / 命令 /
 *   API 端点的证据不在范围内 —— 那部分要靠人。
 * - 这是**全仓体检**，不是 PR 增量检查：它跟「这次 PR 改了什么」无关，
 *   作用是「仓库里任何一条死证据都不许留着」。
 *
 * ## 用法
 *
 *   node scripts/check-acceptance-evidence.mjs              # 全量体检
 *   node scripts/check-acceptance-evidence.mjs --json       # 机器可读
 *   node scripts/check-acceptance-evidence.mjs --self-test  # 自测（离线）
 *
 * 退出码：0 = 通过；1 = 有死证据；2 = 用法 / 环境错
 */
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const IGNORE_FILE = resolve(__dirname, 'acceptance-evidence-ignore.json');

/** 目录名 → 整个子树跳过（构建产物 / 依赖 / 报告） */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'release',
  'coverage',
  '.git',
  'test-results',
  'visual-report',
  'playwright-report',
  '.next',
  'out',
  '.cache',
]);

/** 算「像仓库路径」的已知前缀 */
const REPO_PREFIXES = [
  'packages/',
  'scripts/',
  'tests/',
  'specs/',
  'docs/',
  '.github/',
  'common/',
  'electron/',
  'renderer/',
  'server/',
];

/** 算「像仓库路径」的已知扩展名 */
const KNOWN_EXTS = [
  '.ts',
  '.tsx',
  '.mjs',
  '.js',
  '.cjs',
  '.json',
  '.sh',
  '.scss',
  '.yml',
  '.yaml',
  '.md',
  '.html',
  '.css',
];

// ─────────────────────────────────────────────────────────────
// 证据候选的识别
// ─────────────────────────────────────────────────────────────

/**
 * 这个 backtick 里的东西**是不是**一个仓库路径证据。
 *
 * 误报比漏报贵得多 —— 门禁一旦误伤，人就会开始绕过它。所以这里宁可放过。
 */
export function looksLikeRepoPath(s) {
  if (!s || /\s/.test(s)) return false;
  if (s.startsWith('http://') || s.startsWith('https://')) return false;
  if (s.startsWith('/')) return false; // 绝对路径 / API 端点（/api/album/{id}）
  if (s.startsWith('~/')) return false; // 外部路径（~/knowledge/…）
  if (/[(){}]/.test(s)) return false; // 函数签名 / 模板
  if (s.includes(',')) return false; // 多个路径
  if (s.includes(' ')) return false;
  // ⚠️ 必须是**带目录的路径**：裸文件名（`api.ts` / `netease.provider.ts`）是
  // 散文里的简称（「`netease.provider.ts` 新增 saveAlbum()」），读者知道指的是
  // 哪个包里的哪个文件 —— 拿它去 stat 必然「不存在」→ 误报潮。
  // 判据 = 含 `/` **且** 以已知仓库前缀开头。
  if (!s.includes('/')) return false;
  return REPO_PREFIXES.some((p) => s.startsWith(p));
}

/** 把一行文本里的 backtick 片段取出来 */
export function extractBackticked(line) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[1]);
  return out;
}

// ─────────────────────────────────────────────────────────────
// 仓库文件索引
// ─────────────────────────────────────────────────────────────

/**
 * 递归列出仓库里所有**文件与目录**（跳过依赖 / 构建产物），返回 posix 风格相对路径。
 *
 * 目录也要收：清单里常拿目录当证据（「`packages/renderer/src` 实测现状」），
 * 只收文件会把这些全判成死证据。
 */
export function listRepoFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        files.push(relative(root, full).split(sep).join('/'));
        walk(full);
      } else if (e.isFile()) {
        files.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return files;
}

// ─────────────────────────────────────────────────────────────
// 清单解析
// ─────────────────────────────────────────────────────────────

const BULLET_RE = /^\s*-\s\[( |x|X)\]\s/;

/**
 * 解析一个 tasks.md → 清单项数组
 *
 * 每项 = { line, checked, title, evidence[] }
 * 证据范围：该项本身 + 其后最多 2 行（到下一个清单项为止）。
 */
export function parseChecklist(text) {
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = BULLET_RE.exec(lines[i]);
    if (!m) continue;
    const title = lines[i].replace(BULLET_RE, '').trim();
    const evidence = [];
    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
      if (j > i && BULLET_RE.test(lines[j])) break;
      for (const code of extractBackticked(lines[j])) {
        if (looksLikeRepoPath(code)) evidence.push(code);
      }
    }
    const checked = m[1].toLowerCase() === 'x';
    const tagMatch = checked ? null : /^@(blocked|manual|deferred|todo)\b/.exec(title);
    items.push({
      line: i + 1,
      checked,
      title,
      evidence,
      tag: tagMatch ? tagMatch[1] : null,
    });
  }
  return items;
}

// ─────────────────────────────────────────────────────────────
// 判定
// ─────────────────────────────────────────────────────────────

/**
 * 一条证据的死法诊断。
 *
 * 返回 null = 活着；否则返回 { reason, suggestion? }。
 */
export function diagnoseEvidence(ev, repoFiles) {
  const list = Array.isArray(repoFiles) ? repoFiles : [...repoFiles];
  // 「`electron/src/main.ts:286`」这种带行号的写法 → 剥掉行号再判定
  // 目录证据常带尾斜杠（「`specs/playlist-edit/`」）→ 归一化掉
  const bare = ev.replace(/:\d+$/, '').replace(/\/+$/, '');
  if (list.includes(bare)) return null;
  if (list.includes(ev)) return null;
  // dist 是构建产物 → 不在版本控制里 → 当证据不可复现（这是真问题，不是误报）
  if (/(^|\/)dist\//.test(bare) || /(^|\/)release\//.test(bare)) {
    return { reason: '指向构建产物（dist / release）—— 证据不可复现，请改指源码路径' };
  }
  // 后缀匹配：仓库里有没有文件正好以它结尾（漏前缀 / 少写一段）
  const suffix = '/' + bare;
  const candidates = list.filter((f) => f === bare || f.endsWith(suffix));
  if (candidates.length === 1) {
    return { reason: '路径不对（大概率漏了前缀）', suggestion: candidates[0] };
  }
  if (candidates.length > 1) {
    return {
      reason: `路径不对，且有 ${candidates.length} 个同名候选`,
      suggestion: candidates.slice(0, 5).join(' / '),
    };
  }
  return { reason: '文件不存在（改名 / 删除 / 从没存在过）' };
}

/**
 * 主判定。返回 { dead: [...], ignored: [...] }
 *
 * dead[] 每条 = { spec, line, title, evidence, reason, suggestion? }
 */
export function runChecks({ root, ignore, specsDir = 'specs' }) {
  const repoFiles = new Set(listRepoFiles(root));
  const specsRoot = join(root, specsDir);
  const dead = [];
  const ignoredHits = [];
  const badIgnores = [];
  const untagged = [];
  let totalEvidence = 0;

  // 豁免表：key = `${specRelPath}::${evidence}` → 记录
  const ignoreMap = new Map();
  for (const item of ignore.ignore || []) {
    if (!item || typeof item.spec !== 'string' || typeof item.evidence !== 'string') {
      badIgnores.push(item);
      continue;
    }
    if (!item.reason || !String(item.reason).trim()) {
      badIgnores.push(item);
      continue;
    }
    ignoreMap.set(`${item.spec}::${item.evidence}`, item);
  }

  let specDirs = [];
  try {
    specDirs = readdirSync(specsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return { dead, ignored: ignoredHits, badIgnores, specDirs: [] };
  }

  for (const sd of specDirs) {
    const specRel = `${specsDir}/${sd}/tasks.md`;
    const full = join(specsRoot, sd, 'tasks.md');
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8');
    for (const item of parseChecklist(text)) {
      if (!item.checked && !item.tag) {
        untagged.push({ spec: specRel, line: item.line, title: item.title });
      }
      for (const ev of item.evidence) {
        totalEvidence++;
        const key = `${specRel}::${ev}`;
        const ig = ignoreMap.get(key);
        if (ig) {
          ignoredHits.push({ spec: specRel, line: item.line, evidence: ev, reason: ig.reason });
          continue;
        }
        const diag = diagnoseEvidence(ev, repoFiles);
        if (diag) {
          dead.push({
            spec: specRel,
            line: item.line,
            title: item.title,
            evidence: ev,
            reason: diag.reason,
            suggestion: diag.suggestion,
          });
        }
      }
    }
  }
  return { dead, ignored: ignoredHits, badIgnores, untagged, specDirs, totalEvidence };
}

// ─────────────────────────────────────────────────────────────
// 自测（离线，用临时 fixture 目录）
// ─────────────────────────────────────────────────────────────

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'acceptance-evidence-'));
  const mk = (p, content = '') => {
    mkdirSync(resolve(tmp, p, '..'), { recursive: true });
    writeFileSync(resolve(tmp, p), content, 'utf8');
  };

  mk('packages/demo/src/ok.ts', 'export const ok = 1;\n');
  mk('packages/demo/src/ok.test.ts', '// test\n');
  mk('packages/electron/src/main.ts', '// main\n');
  mk(
    'specs/demo/tasks.md',
    [
      '- [x] **A1** 活证据 → `packages/demo/src/ok.ts`',
      '- [x] **A2** 活证据（测试文件）→ `packages/demo/src/ok.test.ts`',
      '- [x] **A3** 死证据（文件不在）→ `packages/demo/src/gone.ts`',
      '- [x] **A4** 漏前缀 → `electron/src/main.ts`',
      '- [x] **A4b** 裸文件名（散文简称，不是路径）→ `ok.ts`',
      '- [x] **A5** 不是路径（API 端点）→ `POST /api/album/{id}`',
      '- [x] **A6** 不是路径（外部路径）→ `~/knowledge/maestro/x.md`',
      '- [x] **A7** 被豁免（带 reason）→ `packages/demo/src/waived.ts`',
      '- [x] **A8** 被豁免但缺 reason → `packages/demo/src/bad-waiver.ts`',
      '- [ ] @manual 带分类标记的未勾项（不该报）',
      '- [ ] 没有分类标记的未勾项（该报）',
      '',
    ].join('\n'),
  );

  const ignore = {
    ignore: [
      {
        spec: 'specs/demo/tasks.md',
        evidence: 'packages/demo/src/waived.ts',
        reason: '故意指向不存在的文件（自测用）',
      },
      { spec: 'specs/demo/tasks.md', evidence: 'packages/demo/src/bad-waiver.ts' },
    ],
  };

  const r = runChecks({ root: tmp, ignore });
  const deadEvs = r.dead.map((d) => d.evidence).sort();
  const bad = r.badIgnores.map((b) => b.evidence).sort();

  const expectations = [
    ['活证据不报', !r.dead.some((d) => d.evidence === 'packages/demo/src/ok.ts')],
    ['活证据（测试文件）不报', !r.dead.some((d) => d.evidence === 'packages/demo/src/ok.test.ts')],
    ['死证据被抓', r.dead.some((d) => d.evidence === 'packages/demo/src/gone.ts')],
    ['API 端点不误伤', !r.dead.some((d) => d.evidence.includes('/api/album/'))],
    ['外部路径不误伤', !r.dead.some((d) => d.evidence.startsWith('~/'))],
    ['漏前缀被抓', r.dead.some((d) => d.evidence === 'electron/src/main.ts')],
    [
      '漏前缀给出建议',
      r.dead.some(
        (d) =>
          d.evidence === 'electron/src/main.ts' && d.suggestion === 'packages/electron/src/main.ts',
      ),
    ],
    ['裸文件名不误伤', !r.dead.some((d) => d.evidence === 'ok.ts')],
    ['带 reason 的豁免被放行', r.ignored.some((i) => i.evidence === 'packages/demo/src/waived.ts')],
    ['缺 reason 的豁免算未登记', bad.includes('packages/demo/src/bad-waiver.ts')],
    ['带分类标记的未勾项不报', !r.untagged.some((u) => u.title.includes('带分类标记'))],
    ['没分类标记的未勾项被抓', r.untagged.some((u) => u.title.includes('没有分类标记'))],
  ];

  let failed = 0;
  for (const [name, ok] of expectations) {
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok) failed++;
  }
  rmSync(tmp, { recursive: true, force: true });

  if (failed) {
    console.error(`\n❌ 验收证据门禁自测失败（${failed} 条）`);
    process.exit(1);
  }
  console.log('\n✅ 验收证据门禁自测通过');
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

// 只在「直接执行」时跑 main（被 import 时只导出函数，方便测试与复用）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');

if (!isMain) {
  // 被 import：什么都不做
} else if (argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
} else {
  await main();
}

/** 主流程（单独抽出来，便于测试） */
async function main() {
  let ignore = { ignore: [] };
  try {
    ignore = JSON.parse(readFileSync(IGNORE_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`❌ 豁免表读不了：${IGNORE_FILE}\n   ${err.message}`);
      process.exit(2);
    }
  }

  const result = runChecks({ root: REPO_ROOT, ignore });

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.dead.length || result.badIgnores.length ? 1 : 0);
  }

  console.log(`验收证据可达性检查：扫了 ${result.specDirs.length} 个 spec 的清单项`);
  const alive = result.totalEvidence - result.dead.length;
  console.log(`  证据引用：${result.totalEvidence} 条（活 ${alive} / 死 ${result.dead.length}）`);

  if (result.ignored.length) {
    console.log(`\n── 已登记的豁免（${result.ignored.length} 条）──`);
    for (const i of result.ignored) {
      console.log(`  ⚠️  ${i.spec}:${i.line}  ${i.evidence}`);
      console.log(`      理由：${i.reason}`);
    }
  }

  if (result.badIgnores.length) {
    console.log(`\n── 未登记的豁免（缺 reason，当作没豁免）──`);
    for (const b of result.badIgnores) {
      console.log(`  ❌ ${b?.spec ?? '(缺 spec)'} :: ${b?.evidence ?? '(缺 evidence)'}`);
    }
    console.log('  ⇒ 每条豁免都必须写 reason，否则视为未登记。');
  }

  if (result.untagged.length) {
    console.log(`\n── 未勾但没写分类（${result.untagged.length} 条）—— 「没勾」必须带理由 ──`);
    for (const u of result.untagged) {
      const t = u.title.length > 70 ? u.title.slice(0, 70) + '…' : u.title;
      console.log(`  ❌ ${u.spec}:${u.line}  ${t}`);
    }
    console.log('  ⇒ 四个标记选一个（紧跟在 `- [ ]` 后面）：');
    console.log('    @blocked   外部阻塞（缺凭据 / 缺账号 / 缺网络 / 等决策）');
    console.log('    @manual    必须人测（真机 / 桌面 / 真实登录态）');
    console.log('    @deferred  明确延后（可选 / 不在本期范围）');
    console.log('    @todo      真·欠着的工程活');
  }

  if (result.dead.length) {
    console.log(`\n── 死证据（${result.dead.length} 条）—— 指向的文件已经不在了 ──`);
    for (const d of result.dead) {
      console.log(`  ❌ ${d.spec}:${d.line}  \`${d.evidence}\``);
      console.log(`      ${d.reason}`);
      if (d.suggestion) console.log(`      建议：\`${d.suggestion}\``);
      const t = d.title.length > 70 ? d.title.slice(0, 70) + '…' : d.title;
      console.log(`      出处：${t}`);
    }
    console.log('\n  ⇒ 修法二选一：① 把证据改成真实路径；② 确实该保留的，写进');
    console.log('    scripts/acceptance-evidence-ignore.json（每条必须带 reason）。');
    process.exit(1);
  }

  console.log('\n✅ 所有验收证据都还指向真实存在的文件');
  process.exit(0);
}
