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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const json = argv.includes('--json');
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').filter(Boolean) : undefined;

  const report = await runSweep(only?.length ? { only } : {});
  if (json) {
    out(JSON.stringify(report, null, 2));
  } else {
    out(formatSweepTable(report));
  }
}

main().catch((err) => {
  out(`❌ 参数扫描失败: ${err?.message ?? err}`);
  process.exit(1);
});
