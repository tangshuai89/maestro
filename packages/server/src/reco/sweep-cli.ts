/**
 * NL 检索 · 参数扫描 CLI（specs/eval-driven-nl/ L3）。
 *
 * 用法：
 *   npm run reco:eval:sweep                    # 默认网格（离线，0 元 0 网络）
 *   npm run reco:eval:sweep -- --only=jazz,folk
 *   npm run reco:eval:sweep -- --json
 */
import { formatSweepTable, runSweep } from './sweep';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * CLI 主流程。**导出**是为了能被测试执行——CI 的 coverage diff 门禁会判
 * 「新增文件从未被任何测试 import → 拦」。
 *
 * @returns 退出码（0 = 成功）
 */
export async function runCli(argv: string[]): Promise<number> {
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const json = argv.includes('--json');
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').filter(Boolean) : undefined;

  const report = await runSweep(only?.length ? { only } : {});
  if (json) {
    out(JSON.stringify(report, null, 2));
  } else {
    out(formatSweepTable(report));
  }
  return 0;
}

// 仅在**直接运行**时自动执行（被 import 时不跑）。
/* c8 ignore start —— 直接运行时的自动执行入口。
   被 import（测试）时这段永远不执行 → CI 的 coverage diff 门禁会判
   "新增代码没被测到"。它不是逻辑，是**入口接线**。 */
if (require.main === module) {
  runCli(process.argv.slice(2))
    .then((code) => {
      if (code) process.exit(code);
    })
    .catch((err) => {
      out(`❌ 参数扫描失败: ${err?.message ?? err}`);
      process.exit(1);
    });
}
/* c8 ignore stop */
