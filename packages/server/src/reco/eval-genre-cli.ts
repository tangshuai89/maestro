/**
 * NL 歌单 · 风格纯度评测 CLI。
 *
 * 用法（**先关掉正在跑的 app**，避免两个进程同时用同一份 state.json）：
 *
 *   npm run reco:eval:genre                        # 默认 5 个场景，带 LLM 流派判定
 *   npm run reco:eval:genre -- --no-judge          # 不调 LLM 判定（只算检索层 + 污染）
 *   npm run reco:eval:genre -- --count=10 --session=ID
 *   npm run reco:eval:genre -- --save .storage/genre-purity-baseline.json
 *   npm run reco:eval:genre -- --compare .storage/genre-purity-baseline.json
 *
 * 参数：
 *   --count=N     每个场景要几首（默认 12）
 *   --session=ID  指定会话（默认取最近使用的那个）
 *   --storage=DIR 指定存储目录（默认 packages/server/.storage）
 *   --no-judge    不做 LLM 流派判定（省一次调用/场景；通过判定改用检索层纯度）
 *   --json        输出机器可读 JSON
 *   --save=FILE   存基线
 *   --compare=FILE 与基线对比
 *
 * ⚠️ 会真实消耗 DeepSeek token（每场景：1 次意图解析 + 1 次选曲 + 1 次流派判定）
 *    并真实打平台搜索。只读不写业务数据（"最近推荐过"历史会被还原）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StorageService } from '../common/storage';
import { Session } from '../common/session';
import { RecoService } from './reco.service';
import { compareGenrePurityReports, formatGenrePurityReport } from './eval-genre';

/** CLI 就是要把报告写到 stdout；用 write 而不是 console.log（server eslint 禁 console）。 */
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

interface CliArgs {
  count: number;
  session?: string;
  storage?: string;
  judge: boolean;
  json: boolean;
  save?: string;
  compare?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { count: 12, judge: true, json: false };
  // 两种写法都支持：--save=FILE 与 --save FILE（空格分隔时值在下一个 argv）。
  // 只认 "=" 的话，`--save x.json` 的值会被丢掉 → 基线静默不写。
  const takeValue = (i: number, inline: string | undefined): { value?: string; next: number } => {
    if (inline !== undefined) return { value: inline, next: i };
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) return { value: next, next: i + 1 };
    return { next: i };
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq >= 0 ? raw.slice(2, eq) : raw.slice(2);
    const inline = eq >= 0 ? raw.slice(eq + 1) : undefined;
    switch (key) {
      case 'count': {
        const n = Number(inline);
        if (Number.isFinite(n)) args.count = n;
        break;
      }
      case 'session': {
        const v = takeValue(i, inline);
        args.session = v.value;
        i = v.next;
        break;
      }
      case 'storage': {
        const v = takeValue(i, inline);
        args.storage = v.value;
        i = v.next;
        break;
      }
      case 'no-judge':
        args.judge = false;
        break;
      case 'json':
        args.json = true;
        break;
      case 'save': {
        const v = takeValue(i, inline);
        args.save = v.value;
        i = v.next;
        break;
      }
      case 'compare': {
        const v = takeValue(i, inline);
        args.compare = v.value;
        i = v.next;
        break;
      }
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
    : path.resolve(__dirname, '../../.storage');
  // 必须在 NestFactory.create **之前**设定：ConfigService 的 storageDir 是类字段，
  // 在实例化那一刻读 env（不是 import 时），所以这里设还来得及。
  process.env.STORAGE_DIR = storageDir;

  if (!fs.existsSync(path.join(storageDir, 'state.json'))) {
    out(
      `❌ 找不到 ${path.join(storageDir, 'state.json')}。\n` +
        `   在仓库根跑：npm run reco:eval:genre（默认读 packages/server/.storage）\n` +
        `   或用 --storage=<dir> 指向实际存储目录。`,
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  try {
    const storage = app.get(StorageService);
    const reco = app.get(RecoService);

    // 直接从持久化 blob 里取会话（含各平台登录凭据）——不经过 SessionService。
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
        `── 每例 ${args.count} 首｜流派判定 ${args.judge ? '开' : '关'}\n`,
    );

    const report = await reco.evaluateGenrePurity(session, {
      count: args.count,
      judge: args.judge,
    });

    if (args.json) {
      out(JSON.stringify(report, null, 2));
    } else {
      out(formatGenrePurityReport(report));
    }

    if (args.compare) {
      const baseline = JSON.parse(fs.readFileSync(path.resolve(args.compare), 'utf8'));
      out('');
      out(compareGenrePurityReports(baseline, report));
    }
    if (args.save) {
      // 相对路径按**当前工作目录**解析（CLI 跑在 packages/server 下），并自动
      // 建父目录——否则 `--save packages/server/.storage/x.json` 会因为中间
      // 目录不存在而写失败。
      const savePath = path.resolve(args.save);
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, JSON.stringify(report, null, 2));
      out(`\n已保存基线：${savePath}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // 错误也走 stdout：这个 CLI 的唯一消费者就是人/脚本的 stdout。
  out(`❌ genre purity eval 失败: ${err?.message ?? err}`);
  process.exit(1);
});
