/**
 * 推荐离线评测 CLI（留一法）。
 *
 * 用法（**先关掉正在跑的 app**，避免两个进程同时用同一份 state.json）：
 *
 *   npm run reco:eval                       # 默认：留出 20 首、Top-10、pool 模式（不花钱）
 *   npm run reco:eval -- --mode=llm --runs=3
 *   npm run reco:eval -- --holdout=30 --count=10 --seed=7 --json
 *   npm run reco:eval -- --save .storage/reco-eval-baseline.json
 *   npm run reco:eval -- --compare .storage/reco-eval-baseline.json
 *
 * 参数：
 *   --holdout=N   留出多少首当考卷（默认 20）
 *   --count=N     推荐条数 / Top-K（默认 10）
 *   --runs=N      重复几轮取平均（默认 1；多轮会换留出集）
 *   --seed=N      随机种子（默认 1，同种子可复现同一份考卷）
 *   --mode=pool   pool = 不调 LLM（测检索层）；llm = 完整流水线（消耗 token）
 *   --session=ID  指定会话（默认取最近使用的那个）
 *   --storage=DIR 指定存储目录（默认进程 CWD 下的 .storage）
 *   --json        输出机器可读 JSON（配合 --save/--compare 做回归追踪）
 *   --save=FILE   把本次报告存成基线文件
 *   --compare=FILE 与基线对比输出变化
 *
 * 这是**离线诊断工具**，不参与运行时；读的是本机 .storage（含登录凭据），
 * 只读不写业务数据。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StorageService } from '../common/storage';
import { Session } from '../common/session';
import { RecoService } from './reco.service';
import { compareEvalReports, formatEvalReport } from './eval';

/** CLI 就是要把报告写到 stdout；用 write 而不是 console.log（server eslint 禁 console）。 */
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

interface CliArgs {
  holdout: number;
  count: number;
  runs: number;
  seed: number;
  mode: 'pool' | 'llm';
  session?: string;
  storage?: string;
  json: boolean;
  save?: string;
  compare?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    holdout: 20,
    count: 10,
    runs: 1,
    seed: 1,
    mode: 'pool',
    json: false,
  };
  const num = (v: string | undefined, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    switch (key) {
      case 'holdout':
        args.holdout = num(value, args.holdout);
        break;
      case 'count':
        args.count = num(value, args.count);
        break;
      case 'runs':
        args.runs = num(value, args.runs);
        break;
      case 'seed':
        args.seed = num(value, args.seed);
        break;
      case 'mode':
        args.mode = value === 'llm' ? 'llm' : 'pool';
        break;
      case 'session':
        args.session = value;
        break;
      case 'storage':
        args.storage = value;
        break;
      case 'save':
        args.save = value;
        break;
      case 'compare':
        args.compare = value;
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const storageDir = args.storage
    ? path.resolve(args.storage)
    : path.resolve('.storage');
  // 必须在 NestFactory.create **之前**设定：ConfigService 的 storageDir 是类字段，
  // 在实例化那一刻读 env（不是 import 时），所以这里设还来得及。
  process.env.STORAGE_DIR = storageDir;

  if (!fs.existsSync(path.join(storageDir, 'state.json'))) {
    out(
      `❌ 找不到 ${path.join(storageDir, 'state.json')}。\n` +
        `   在仓库根跑：npm run reco:eval（默认读 packages/server/.storage）\n` +
        `   或用 --storage=<dir> 指向实际存储目录。`,
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  try {
    const storage = app.get(StorageService);
    const reco = app.get(RecoService);

    // 直接从持久化 blob 里取会话（含各平台登录凭据）——不经过 SessionService，
    // 避免整个进程对 state.json 产生任何写入。
    const blob = storage.get<{ byId: Record<string, Session> }>('sessions');
    const sessions = Object.values(blob?.byId ?? {});
    if (!sessions.length) {
      out('❌ state.json 里没有任何会话——先在 app 里登录并导入库。');
      process.exit(1);
    }
    const session = args.session
      ? sessions.find((s) => s.id === args.session)
      : sessions.sort(
          (a, b) => (b.lastAccessedAt ?? b.createdAt) - (a.lastAccessedAt ?? a.createdAt),
        )[0];
    if (!session) {
      out(`❌ 找不到会话 ${args.session}`);
      process.exit(1);
    }

    out(
      `── 存储 ${storageDir}\n── 会话 ${session.id.slice(0, 12)}…\n` +
        `── 模式 ${args.mode}｜留出 ${args.holdout}｜Top-${args.count}｜${args.runs} 轮｜seed ${args.seed}\n`,
    );

    const report = await reco.evaluate(session, {
      holdoutSize: args.holdout,
      count: args.count,
      runs: args.runs,
      seed: args.seed,
      mode: args.mode,
    });

    if (args.json) {
      out(JSON.stringify(report, null, 2));
    } else {
      out(formatEvalReport(report));
    }

    if (args.compare) {
      const baseline = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
      out('');
      out(compareEvalReports(baseline, report));
    }
    if (args.save) {
      fs.writeFileSync(args.save, JSON.stringify(report, null, 2));
      out(`\n已保存基线：${args.save}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // 错误也走 stdout：这个 CLI 的唯一消费者就是人/脚本的 stdout。
  out(`❌ reco eval 失败: ${err?.message ?? err}`);
  process.exit(1);
});
