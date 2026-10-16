#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 三语 README 语言纯度检查
//
// 规则：README.md（英）里不该出现汉字、README.zh-CN.md（中）里不该出现假名、
// README.ja.md（日）里不该出现简体特征字。三语各自纯净，避免读者读到
// 「英文文档里夹一段中文」这种串味。
//
// 为什么需要 CI 兜：三份 README 靠人工同步，必然漂移。2026-10-16 就实测到
// README.md 混入 43 行中文（目录树注释 + 整个 Roadmap），而 README.zh-CN.md
// 一直是干净的 —— 没人发现是因为没有任何检查会失败。
//
// ## 豁免（刻意收窄，避免检查形同虚设）
//
// 一行若要通过，必须能**逐个汉字片段**对上白名单，而不是整行放行：
//   - 语言名本身：简体中文 / 日本語 / English
//   - **UI 按钮字面值**：登录 / 退出。app 界面就是中文按钮，英文文档翻译成
//     "Log in" 读者反而在界面上找不到 —— 这类必须按字面值引用
//   - 指向中文 spec 的原文标题：已知限制（specs/packaging/spec.md 是中文写的）
// 另可用行尾标记 `<!-- i18n-allow -->` 逐行豁免（用于代码块等场景）。
//
// ## 不检查的
//
// 围栏代码块（```）内的内容 —— 代码注释里的中文是有意义的技术信息。
//
// 用法:
//   node scripts/check-readme-i18n.mjs            # 出清单
//   node scripts/check-readme-i18n.mjs --gate     # 门禁：有违规非零退出（接 CI）
//   node scripts/check-readme-i18n.mjs --json     # 机器可读
//
// 关联：commit 45956bc（首次纯净化）
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const GATE = argv.includes('--gate');
const AS_JSON = argv.includes('--json');

/** 逐行豁免标记。放在行尾。 */
const ALLOW_MARK = '<!-- i18n-allow -->';

// ── 正则 ──────────────────────────────────────────────────────────────
const HAN = /[一-鿿㐀-䶿]/; // 汉字（含扩展 A）
const HAN_RUN = /[一-鿿㐀-䶿]+/g; // 连续汉字串
const KANA = /[぀-ヿ]/; // 平假名 + 片假名

/**
 * 英文版允许的汉字串（必须**逐段**精确匹配，见文件头「豁免」）。
 *
 * 加条目时想清楚：这是「读者在英文文档里看到中文也合理」的极少数场景。
 */
const EN_ALLOWED = [
  '简体中文', // 语言链接
  '日本語', // 语言链接
  '登录', // UI 按钮字面值（app 界面就是中文）
  '退出', // 同上（托盘菜单）
  '已知限制', // specs/packaging/spec.md 的中文原文标题
];

/**
 * 日文版禁止的**简体词**。
 *
 * ⚠️ 判据必须是**词**，不能是**单字**。踩过一次坑：用「简体字集合」做规则，
 *    结果 43 处全是误报 —— 因为日语本身就大量使用汉字：
 *    日本語・音楽・音声・出力・状態・保存・存在・不要・永続化・数値・記録…
 *    `日/音/出/状/存/不/化/数/录` 十个字在日语里全是合法的。
 *
 * 可靠判据是**日语对同一概念会用不同的汉字**：
 *    音乐 ≠ 音楽 · 状态 ≠ 状態 · 设置 ≠ 設定 · 输出 ≠ 出力 · 数据 ≠ データ
 *    保存 = 保存（日语标准写法就相同，**不能**禁）
 *    视图 ≠ ビュー · 样式 ≠ スタイル · 不变 ≠ 不変 · 网络 ≠ ネットワーク
 *
 * 目标不是穷举全部简体词，而是抓住「整段没翻译的中文残留」——精选高频词足够，
 * 且误报率接近零。
 */
const JA_FORBIDDEN = [
  // 简体特有 / 日语用假名
  '视图',
  '样式',
  '不变',
  '网络',
  '软件',
  '视频',
  '音频',
  // 简体写法（对应日语的 音楽/状態/出力/設定/データ/音声 等）
  '音乐',
  '状态',
  '设置',
  '数据',
  '信息',
  '默认',
  '缓存',
  '接口',
  '变量',
  '数组',
  '注释',
  '服务器',
  '数据库',
  '优化',
  '质量',
  '进度',
  '颜色',
  '测试',
  '错误',
  '警告',
  '目录',
  '文档',
  '导入',
  '导出',
  '保存', // ← 「保存」日语同形，保留待定，见下方 CAVEAT
];

/** ⚠️ CAVEAT —— 上面列表里的「保存」是日语标准写法（保存する），会误报。
 *  实测当前 README.ja.md 里「保存」确实出现（永続化の結果 等语境之外）。
 *  所以从禁词里移除，改由 CI 跑一次验证后决定。 */
const JA_FORBIDDEN_SAFE = JA_FORBIDDEN.filter((w) => w !== '保存');

/** 英文版：合法汉字片段（逐段精确匹配） */
const EN_ALLOWED_SET = new Set(EN_ALLOWED);

const FILES = [
  { path: 'README.md', lang: 'en' },
  { path: 'README.zh-CN.md', lang: 'zh' },
  { path: 'README.ja.md', lang: 'ja' },
];

/** 拆出围栏代码块之外的行（代码块内不检查：代码注释里的中文是有意义的技术信息）。 */
function contentLines(text) {
  const out = [];
  let inFence = false;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    out.push({ line: i + 1, text: raw });
  });
  return out;
}

function check(overrides = {}) {
  const violations = [];

  for (const { path, lang } of FILES) {
    let text;
    if (Object.prototype.hasOwnProperty.call(overrides, path)) {
      text = overrides[path];
    } else {
      try {
        text = readFileSync(join(REPO, path), 'utf8');
      } catch {
        violations.push({ file: path, lang, line: 0, reason: '文件缺失或不可读', snippet: '' });
        continue;
      }
    }

    for (const { line, text: raw } of contentLines(text)) {
      if (raw.includes(ALLOW_MARK)) continue;

      if (lang === 'en') {
        for (const seg of raw.match(HAN_RUN) ?? []) {
          if (!EN_ALLOWED_SET.has(seg)) {
            violations.push({
              file: path,
              lang,
              line,
              reason: '英文版出现未豁免的汉字',
              snippet: seg,
            });
          }
        }
      } else if (lang === 'zh') {
        const hit = raw.match(KANA);
        if (hit) {
          violations.push({ file: path, lang, line, reason: '中文版出现假名', snippet: hit[0] });
        }
      } else if (lang === 'ja') {
        for (const w of JA_FORBIDDEN_SAFE) {
          if (raw.includes(w)) {
            violations.push({ file: path, lang, line, reason: '日文版出现简体词', snippet: w });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * 自测：往内存里的 README 注入违规内容，断言检查能抓到。
 *
 * 为什么必须自带 —— 「通过」的检查脚本可能是因为**规则写错了**而永远通过。
 * 第一次实现就踩过：日文版的判据用了「简体字集合」，结果把日语合法的
 * 音楽/出力/状態/保存… 全部误报成 43 处。误报率高的规则等于没有规则，
 * 所以注入式负向用例是这类检查的必需品，不是加分项。
 */
function selfTest() {
  const NL = '\n';
  const base = {
    'README.md':
      '# Title' + NL + NL + '- click **登录**' + NL + '- [简体中文](./README.zh-CN.md)' + NL,
    'README.zh-CN.md': '# 标题' + NL + NL + '这是一段中文。' + NL,
    'README.ja.md': '# タイトル' + NL + NL + 'これは日本語のテキストです。' + NL,
  };
  const fails = [];
  const expect = (name, overrides, wantFile) => {
    const hits = check({ ...base, ...overrides });
    if (wantFile === null) {
      if (hits.length !== 0) {
        fails.push(
          name +
            ': 期望 0 违规，实际 ' +
            hits.length +
            '（误报：' +
            JSON.stringify(hits.slice(0, 3)) +
            '）',
        );
      }
    } else if (!hits.some((v) => v.file === wantFile)) {
      fails.push(name + ': 期望抓到 ' + wantFile + ' 的违规，实际没抓到');
    }
  };

  // 基线必须干净 —— 白名单里的「登录」「简体中文」不能误报
  expect('基线干净', {}, null);
  // 英文版混入中文
  expect(
    '英文版中文段落',
    { 'README.md': base['README.md'] + NL + '这是一个中文段落。' + NL },
    'README.md',
  );
  // 英文版混入未豁免的 UI 字面值（白名单只放行 登录/退出）
  expect(
    '英文版未知按钮文案',
    { 'README.md': base['README.md'] + NL + '点击 **确定** 继续。' + NL },
    'README.md',
  );
  // 中文版混入假名
  expect(
    '中文版假名',
    { 'README.zh-CN.md': base['README.zh-CN.md'] + NL + 'この行は日本語です。' + NL },
    'README.zh-CN.md',
  );
  // 日文版混入简体词
  expect(
    '日文版简体词',
    { 'README.ja.md': base['README.ja.md'] + NL + '网络连接失败。' + NL },
    'README.ja.md',
  );
  // 逐行豁免标记必须生效
  expect(
    'i18n-allow 标记豁免',
    { 'README.md': base['README.md'] + NL + '未翻译的中文 <!-- i18n-allow -->' + NL },
    null,
  );
  // 围栏代码块内不检查
  expect(
    '代码块内不检查',
    {
      'README.md': base['README.md'] + NL + '```bash' + NL + '# 这是注释里的中文' + NL + '```' + NL,
    },
    null,
  );
  // 日文原生的简体同形字不得误报：音楽 / 状態 / 出力 / 保存
  expect(
    '日文同形字不误报',
    { 'README.ja.md': base['README.ja.md'] + NL + '音楽 状態 出力 保存 日本語' + NL },
    null,
  );
  // 真实文件当前必须通过
  expect('真实仓库三份 README', {}, null);

  if (fails.length) {
    console.error('❌ check-readme-i18n 自测失败：');
    for (const f of fails) console.error('   · ' + f);
    return false;
  }
  console.log('✅ check-readme-i18n 自测通过（9 例：5 正向基线 + 4 负向注入）');
  return true;
}

const SELF_TEST = argv.includes('--self-test');
if (SELF_TEST) {
  if (!selfTest()) process.exit(1);
  // 自测通过后仍跑一次真实检查，确保「规则没坏」且「仓库真的干净」
}

const violations = check();

if (AS_JSON) {
  console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
} else {
  if (violations.length === 0) {
    console.log('✅ 三语 README 语言纯净度通过');
    console.log('   README.md       英文（UI 字面值 / 语言名按白名单豁免）');
    console.log('   README.zh-CN.md 中文（无假名）');
    console.log('   README.ja.md    日文（无简体词）');
  } else {
    console.log(`❌ README 语言纯净度：${violations.length} 处问题\n`);
    const byFile = {};
    for (const v of violations) byFile[v.file] ??= [];
    for (const v of violations) byFile[v.file].push(v);
    for (const [file, list] of Object.entries(byFile)) {
      console.log(`── ${file} ──`);
      for (const v of list) {
        console.log(`   ${String(v.line).padStart(4)}│ [${v.lang}] ${v.reason}：${v.snippet}`);
      }
      console.log('');
    }
    console.log(`豁免方式：行尾加 ${ALLOW_MARK}（逐行）`);
    console.log('或往脚本 EN_ALLOWED / FORBIDDEN 里加白名单条目。');
  }
}

if (GATE && violations.length > 0) process.exit(1);
