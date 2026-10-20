#!/usr/bin/env node
/**
 * NL 意图驱动检索 · 端到端探针（specs/nl-intent-retrieval/）。
 *
 * 跑**真实链路**：真实 DeepSeek 解析意图 → 真实候选池检索（QQ/网易云/Deezer/
 * Spotify）→ 真实填源 → 打印最终队列的「歌名 — 艺人」。
 *
 * 用途：验证「风格指令真的作用在检索层」——队列里应当出现该流派的代表艺人，
 * 而不是用户库里的口味主干。
 *
 * 用法：
 *   node scripts/nl-intent-e2e-probe.mjs                      # 默认场景
 *   node scripts/nl-intent-e2e-probe.mjs "来点儿爵士乐"        # 单句
 *   node scripts/nl-intent-e2e-probe.mjs --session <sessionId> # 指定会话
 *
 * ⚠️ 会真实消耗 DeepSeek token（每句 1 次调用）+ 真实平台搜索请求。
 * 前置：npm run build:server（脚本读 packages/server/dist）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const DIST = path.join(__dirname, 'packages/server/dist');
const STORAGE_DIR = path.join(__dirname, 'packages/server/.storage');

// server 正常跑在 packages/server 目录下（storageDir = cwd/.storage）。
// 探针从仓库根跑，必须显式指过去，否则读到的是空的 ./.storage。
process.env.STORAGE_DIR = STORAGE_DIR;

if (!existsSync(DIST)) {
  console.error('缺少 packages/server/dist —— 先跑 `npm run build:server`');
  process.exit(1);
}

const DEFAULT_QUERIES = ['来点儿爵士乐', '放点适合夜跑的电子乐', '九十年代摇滚，排除周杰伦'];

async function main() {
  const args = process.argv.slice(2);
  const sessionIdx = args.indexOf('--session');
  const wantedSession = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
  const baseline = args.includes('--baseline');
  const queries = args.filter(
    (a, i) => !a.startsWith('--') && !(sessionIdx >= 0 && i === sessionIdx + 1),
  );
  const list = queries.length ? queries : DEFAULT_QUERIES;

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(path.join(DIST, 'app.module.js'));
  const { RecoService } = require(path.join(DIST, 'reco/reco.service.js'));
  const { SessionService } = require(path.join(DIST, 'common/session.js'));
  const { buildParseIntentPrompt, parseIntentResponse } = require(
    path.join(DIST, 'reco/nl-intent.js'),
  );
  const { buildIntentSeeds } = require(path.join(DIST, 'reco/genre-seeds.js'));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const reco = app.get(RecoService);
  const sessions = app.get(SessionService);

  // 选一个"有库 + 有平台登录"的会话：库的 sessionId 必须在 sessions blob 里存在
  const blob = sessions['blob']?.byId ?? {};
  const state = JSON.parse(readFileSync(path.join(STORAGE_DIR, 'state.json'), 'utf8'));
  const candidates = Object.keys(state)
    .filter((k) => k.startsWith('library:'))
    .map((k) => k.slice('library:'.length))
    .filter((id) => (state[`library:${id}`]?.items?.length ?? 0) > 20 && blob[id]);
  const sessionId = wantedSession ?? candidates[candidates.length - 1];
  if (!sessionId) {
    console.error('没有可用会话（需要 library>20 首且有 session 的）');
    await app.close();
    return;
  }
  const session = blob[sessionId];
  const libSize = state[`library:${sessionId}`]?.items?.length ?? 0;
  console.log(
    `🔑 session=${sessionId.slice(0, 8)}… 库=${libSize} 首｜平台=${
      Object.keys(session.providers ?? {})
        .filter((p) => session.providers[p] && Object.keys(session.providers[p]).length)
        .join(',') || '无'
    }`,
  );

  const apiKey = reco.getApiKey?.() ?? reco['getApiKey']?.();
  if (!apiKey) {
    console.error('没有 DeepSeek key');
    await app.close();
    return;
  }

  for (const text of list) {
    console.log(`\n▶ ${text}`);
    const t0 = Date.now();
    const messages = buildParseIntentPrompt(text, []);
    const raw = await reco.callDeepSeekForParse(apiKey, messages, { maxTokens: 800 });
    const { intent } = parseIntentResponse(raw);
    const seeds = buildIntentSeeds(intent);
    console.log(`  genres=${JSON.stringify(intent.genres)} seeds=${JSON.stringify(seeds.artists)}`);

    const res = await reco.run(session, { intent });
    const tm = res.timings ?? {};
    console.log(
      `  模式=${res.mode} 候选池=${res.candidateCount} 产出=${res.items.length} 首｜` +
        `池 ${tm.poolMs ?? '-'}ms / LLM ${tm.llmMs ?? '-'}ms / 填源 ${tm.fillMs ?? '-'}ms / 合计 ${Date.now() - t0}ms`,
    );
    res.items.forEach((it, i) => {
      const src = it.sources?.map((s) => s.platform).join('/') ?? '—';
      console.log(`   ${String(i + 1).padStart(2)}. ${it.title} — ${it.artist}  [${src}]`);
    });
  }

  // 对照组：不带 intent 的普通推荐（= 改造前的 NL 行为：意图只进 prompt）
  if (!baseline) {
    console.log('\n▶ [对照] 普通推荐（不带 intent）');
    const res = await reco.run(session, {});
    console.log(`  模式=${res.mode} 候选池=${res.candidateCount} 产出=${res.items.length} 首`);
    res.items.forEach((it, i) => {
      console.log(`   ${String(i + 1).padStart(2)}. ${it.title} — ${it.artist}`);
    });
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
