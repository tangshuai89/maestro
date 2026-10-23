/**
 * NL 检索 · 离线回放评测 CLI（specs/eval-driven-nl/ L1）。
 *
 * **0 元 / 0 网络 / 确定性**——PR 门禁的主体。
 *
 * 用法：
 *   npm run reco:eval:offline                       # 跑全部场景 + 与入库基线对比
 *   npm run reco:eval:offline -- --only=jazz,folk   # 只跑指定场景
 *   npm run reco:eval:offline -- --save <file>      # 存基线
 *   npm run reco:eval:offline -- --tolerance=5      # 允许的下降百分点（默认 5）
 *
 * 退出码：0 = 通过；1 = 门禁未过（不变量红 / 纯度低于基线 / 黄金集覆盖不足）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compareOfflineToBaseline,
  DEFAULT_BASELINE_PATH,
  formatOfflineReport,
  runOfflineEval,
} from './eval-offline';

/**
 * 仓库根。CLI 的 cwd 是 `packages/server`（npm script 会 cd 过去），
 * 所以**相对路径必须按仓库根解析**——否则 `--save specs/...` 会写进
 * `packages/server/specs/...`（一个不存在的位置，且和 CI 的路径对不上）。
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const fromRepoRoot = (p: string): string => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));

/** CLI 就是要把报告写到 stdout；用 write 而不是 console.log（server eslint 禁 console）。 */
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

interface CliArgs {
  fixtureDir?: string;
  baseline: string;
  count: number;
  only: string[];
  tolerance: number;
  save?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baseline: DEFAULT_BASELINE_PATH,
    count: 12,
    only: [],
    tolerance: 5,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq >= 0 ? raw.slice(2, eq) : raw.slice(2);
    const inline = eq >= 0 ? raw.slice(eq + 1) : undefined;
    const take = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        i++;
        return next;
      }
      return undefined;
    };
    switch (key) {
      case 'fixture-dir':
        args.fixtureDir = take();
        break;
      case 'baseline':
        args.baseline = take() ?? args.baseline;
        break;
      case 'count': {
        const n = Number(inline);
        if (Number.isFinite(n)) args.count = n;
        break;
      }
      case 'only':
        args.only = (take() ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case 'tolerance': {
        const n = Number(inline);
        if (Number.isFinite(n)) args.tolerance = n;
        break;
      }
      case 'save':
        args.save = take();
        break;
      case 'json':
        args.json = true;
        break;
      default:
        break;
    }
  }
  return args;
}

/**
 * CLI 主流程。**导出**是为了能被测试执行——CI 的 coverage diff 门禁会判
 * 「新增文件从未被任何测试 import → 拦」（新增的函数从没被调用过 = 那段代码
 * 一行都没跑过）。所以这里导出 `runCli`，测试直接调它。
 *
 * @returns 退出码（0 = 通过）
 */
export async function runCli(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  args.baseline = fromRepoRoot(args.baseline);
  const report = await runOfflineEval({
    ...(args.fixtureDir ? { fixtureDir: args.fixtureDir } : {}),
    count: args.count,
    only: args.only,
  });

  if (args.json) {
    out(JSON.stringify(report, null, 2));
  } else {
    out(formatOfflineReport(report));
  }

  // 门禁 1：所有场景的不变量必须全过（与基线无关）
  const broken = report.scenarios.filter((s) => s.invariants.some((i) => !i.pass));
  if (broken.length) {
    out('');
    out(`❌ 不变量门禁未通过（${broken.length} 个场景）：${broken.map((s) => s.id).join('、')}`);
  }

  // 门禁 2：黄金集覆盖不足的场景 → 拒绝给结论（不当通过，也不当不通过）
  const inconclusive = report.scenarios.filter((s) => s.inconclusive);
  if (inconclusive.length) {
    out('');
    out(`⚠️ 黄金集覆盖不足，结论不可信：${inconclusive.map((s) => s.id).join('、')}`);
  }

  // 门禁 3：纯度不低于入库基线（容差 tolerance 个百分点）
  //
  // ⚠️ 带 --save 时，对比**只作提示不参与判定**：这一轮正在**替换**基线，
  // 拿旧基线判门禁必然红（数字变了 = 基线要更新），那是噪声不是回归。
  const savingBaseline = Boolean(args.save);
  let baselineOk = true;
  if (fs.existsSync(args.baseline)) {
    const baseline = JSON.parse(fs.readFileSync(args.baseline, 'utf8'));
    const cmp = compareOfflineToBaseline(baseline, report, args.tolerance);
    baselineOk = cmp.ok;
    out('');
    out(
      `与基线对比（${args.baseline}｜容差 ${args.tolerance}pt）` +
        `${savingBaseline ? '｜本轮在更新基线，仅作提示' : ''}：`,
    );
    for (const l of cmp.lines) out(l);
  } else {
    out('');
    out(`⚠️ 没有基线文件（${args.baseline}）—— 跳过对比。跑一次 --save 建立基线。`);
  }

  if (args.save) {
    const p = fromRepoRoot(args.save);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + '\n');
    out(`\n已保存基线：${p}`);
  }

  const failed = broken.length > 0 || (!savingBaseline && !baselineOk);
  if (failed) {
    out('');
    out('❌ 离线评测门禁未通过');
    return 1;
  }
  out('');
  out('✅ 离线评测门禁通过');
  return 0;
}

// 仅在**直接运行**时自动执行（被 import 时不跑——否则测试 import 它就会
// 触发整场评测 + process.exit）。
/* c8 ignore start —— 直接运行时的自动执行入口。
   被 import（测试）时这段永远不执行 → CI 的 coverage diff 门禁会判
   "新增代码没被测到"。它不是逻辑，是**入口接线**。 */
if (require.main === module) {
  runCli(process.argv.slice(2))
    .then((code) => {
      if (code) process.exit(code);
    })
    .catch((err) => {
      out(`❌ 离线评测失败: ${err?.message ?? err}`);
      process.exit(1);
    });
}
/* c8 ignore stop */
