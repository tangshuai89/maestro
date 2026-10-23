#!/usr/bin/env node
/**
 * NL 检索 · fixture 录制（specs/eval-driven-nl/ L1）。
 *
 * 把「一次真实检索里发生的所有事」录成 JSON 入库，让离线评测（L1）能**不出网、
 * 不花钱、确定性地**重放同一条检索：
 *
 *   - 每个场景的 **intent**（DeepSeek 解析结果）
 *   - **种子艺人**（流派 → 代表艺人）
 *   - **相邻艺人**（Deezer 相关艺人）
 *   - 每个艺人的**平台搜索结果**（检索层的真实输入）
 *   - 策展层的**实际选中曲目**（LLM picks → 标题+艺人，不是下标）
 *   - 库**主干艺人**（冷门流派兜底路径要用）
 *
 * 流派标签（黄金集）也在这里录：一次 LLM 调用标一整个场景的曲目 → 冻结进仓库，
 * 之后离线评测**不再需要 LLM 判定**。
 *
 * 用法：
 *   node scripts/record-nl-fixtures.mjs                 # 录全部默认场景
 *   node scripts/record-nl-fixtures.mjs jazz folk       # 只录指定场景
 *
 * ⚠️ 需要本机有：DeepSeek key + 平台登录态（QQ/网易云/Spotify/Deezer）。
 * ⚠️ 会真实消耗 token 与平台搜索请求。产物会覆盖仓库里的 fixture。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const DIST = path.join(__dirname, 'packages/server/dist');
const FIXTURE_DIR = path.join(__dirname, 'packages/server/src/reco/__fixtures__');

// server 正常跑在 packages/server 目录下（storageDir = cwd/.storage）
process.env.STORAGE_DIR = path.join(__dirname, 'packages/server/.storage');

const out = (line) => process.stdout.write(`${line}\n`);

/**
 * 裁剪成离线评测需要的最小形状。
 *
 * `inLibrary` 必录：**库内去重会改变候选池**——用户库里已有的曲目不进池。
 * 不录这个标记，离线评测就复现不出"库里的好歌被滤光 → 种子块凑不满 → 模型
 * 从漂移的相邻艺人凑数"这条失败路径（2026-10-23 真实链路评测才暴露出来）。
 */
function trimItem(it, inLibrary = false) {
  return {
    title: it.title,
    artist: it.artist,
    album: it.album ?? '',
    duration: it.duration ?? 0,
    bestSource: it.bestSource,
    versionType: it.versionType ?? 'studio',
    inLibrary,
  };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(path.join(DIST, 'app.module.js'));
  const { RecoService } = require(path.join(DIST, 'reco/reco.service.js'));
  const { StorageService } = require(path.join(DIST, 'common/storage.js'));
  const { MusicService } = require(path.join(DIST, 'music/music.service.js'));
  const { DEFAULT_GENRE_SCENARIOS } = require(path.join(DIST, 'reco/eval-genre.js'));
  const { buildParseIntentPrompt, parseIntentResponse } = require(
    path.join(DIST, 'reco/nl-intent.js'),
  );
  const { buildIntentSeeds } = require(path.join(DIST, 'reco/genre-seeds.js'));
  const { CANDIDATE_SEARCH_PAGE } = require(path.join(DIST, 'reco/reco.service.js'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const reco = app.get(RecoService);
  const music = app.get(MusicService);
  const storage = app.get(StorageService);
  const apiKey = reco['getApiKey']?.();
  if (!apiKey) {
    out('❌ 没有 DeepSeek key');
    await app.close();
    process.exit(1);
  }

  // 挑一个有库的会话
  const state = storage.get('sessions');
  const blob = state?.byId ?? {};
  const all = Object.values(blob);
  const withLib = all.filter(
    (s) => s?.id && (storage.get(`library:${s.id}`)?.items?.length ?? 0) > 50,
  );
  const session = withLib.find((s) => s.providers?.deezer) ?? withLib[0];
  if (!session) {
    out('❌ 没有可用会话（需要库 > 50 首）');
    await app.close();
    process.exit(1);
  }
  const lib = music.getLibrary(session);
  out(`🔑 session=${session.id.slice(0, 10)}… 库=${lib.items.length} 首`);

  // 库内曲目（归一键）——用来给每条录制结果打 inLibrary 标记
  const { normalizeKey } = require('@maestro/common');
  const libKeys = new Set(lib.items.map((it) => normalizeKey(it.title, it.artist)));

  // 库主干艺人（冷门流派兜底路径要重放）
  const profile = reco['getTasteProfile'](session, lib.items, lib.importedAt, [], undefined);
  const anchors = profile.anchors;

  const scenarios = {};
  const golden = {};
  const list = only.length
    ? DEFAULT_GENRE_SCENARIOS.filter((s) => only.includes(s.id))
    : DEFAULT_GENRE_SCENARIOS;

  for (const sc of list) {
    out(`\n▶ [${sc.id}] ${sc.text}`);
    // 1. 解析意图（真实 DeepSeek）
    const messages = buildParseIntentPrompt(sc.text, []);
    const raw = await reco.callDeepSeekForParse(apiKey, messages, { maxTokens: 800 });
    const { intent } = parseIntentResponse(raw);
    const seeds = buildIntentSeeds(intent).artists;
    out(`   流派=${intent.genres.join(',')} 种子=${seeds.join(',') || '（无）'}`);

    // 2. 搜种子 + 拉相邻艺人 + 搜相邻艺人
    const search = {};
    const related = {};
    const record = async (artist) => {
      if (search[artist]) return;
      try {
        const r = await music.searchUnified(session, artist, 1, CANDIDATE_SEARCH_PAGE);
        search[artist] = r.items.map((it) =>
          trimItem(it, libKeys.has(normalizeKey(it.title, it.artist))),
        );
      } catch {
        search[artist] = [];
      }
    };
    for (const a of seeds) {
      await record(a);
      try {
        const rel = await music.findRelatedArtists(session, a, 2);
        related[a] = rel ?? [];
        for (const n of rel ?? []) await record(n);
      } catch {
        related[a] = [];
      }
    }
    out(`   录了 ${Object.keys(search).length} 个艺人的搜索结果`);

    // 3. 跑真实流水线 → 策展层实际选中的曲目
    let picks = [];
    let queue = [];
    try {
      const res = await reco.run(session, { intent, noPoolCache: true });
      queue = res.items.map(trimItem);
      // 选中曲目 = 队列本身（策展层的产物）
      picks = queue.map((q) => ({ title: q.title, artist: q.artist }));
    } catch (e) {
      out(`   ⚠️ run 失败：${e?.message ?? e}`);
    }

    // 4. 黄金集：给场景里的曲目标流派
    //    ⚠️ **必须分批**（40 首/批）：一次标 200+ 首会撞 max_tokens 上限 →
    //    响应被截断 → 后半段全部没标签（实测 citypop 场景 240 首 → 标签 0 条）。
    const tagPool = [...Object.values(search).flat(), ...queue];
    const unique = [];
    const seen = new Set();
    for (const it of tagPool) {
      const k = `${it.title}|${it.artist}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(it);
    }
    const { parseGenreTags } = require(path.join(DIST, 'reco/eval-genre.js'));
    const TAG_BATCH = 40;
    let taggedCount = 0;
    for (let i = 0; i < unique.length; i += TAG_BATCH) {
      const batch = unique.slice(i, i + TAG_BATCH);
      const list = batch.map((it, k) => `${k + 1}. ${it.title} - ${it.artist}`).join('\n');
      try {
        const rawTags = await reco.callDeepSeek(
          apiKey,
          [
            {
              role: 'system',
              content:
                '你是音乐流派标注员。给下面每首歌标注它的**主要流派**（1-2 个，小写英文，如 jazz / rock / pop / electronic / folk / blues / rnb / hiphop / classical / new wave / city pop）。\n' +
                '只输出 JSON：{"tags": [["jazz"], ["pop"], ...]}——数组长度必须与歌单条数相同、顺序一一对应。\n' +
                '拿不准就给空数组，不要猜。',
            },
            { role: 'user', content: list },
          ],
          { maxTokens: 1200 },
        );
        const tags = parseGenreTags(rawTags, batch.length) ?? [];
        batch.forEach((it, k) => {
          const t = tags[k] ?? [];
          if (t.length) {
            golden[`${it.title}|${it.artist}`] = t;
            taggedCount++;
          }
        });
      } catch (e) {
        out(`   ⚠️ 流派标注失败（第 ${i / TAG_BATCH + 1} 批）：${e?.message ?? e}`);
      }
    }
    if (unique.length) {
      out(`   标了 ${taggedCount}/${unique.length} 首的流派（黄金集，分批 ${TAG_BATCH}）`);
    }

    scenarios[sc.id] = {
      id: sc.id,
      text: sc.text,
      expect: sc.expect,
      adjacent: sc.adjacent ?? [],
      intent,
      seeds,
      related,
      search,
      picks,
      queue,
    };
  }

  // 库主干艺人 + 它们的搜索结果（兜底路径）
  for (const a of anchors) {
    if (scenarios.__anchors__) break;
  }
  const anchorSearch = {};
  for (const a of anchors) {
    try {
      const r = await music.searchUnified(session, a, 1, CANDIDATE_SEARCH_PAGE);
      anchorSearch[a] = r.items.map((it) =>
        trimItem(it, libKeys.has(normalizeKey(it.title, it.artist))),
      );
    } catch {
      anchorSearch[a] = [];
    }
  }
  out(`\n▶ 库主干艺人 ${anchors.length} 位（兜底路径用）`);

  mkdirSync(FIXTURE_DIR, { recursive: true });
  const fixture = {
    recordedAt: new Date().toISOString(),
    sessionId: session.id,
    librarySize: lib.items.length,
    anchors,
    anchorSearch,
    scenarios,
  };
  // **压成一行**（不带缩进）：这两个文件是机器读的，缩进会让体积翻倍
  // （700KB → 1.4MB），仓库里放这种机器数据不值当。
  writeFileSync(path.join(FIXTURE_DIR, 'nl-search.json'), JSON.stringify(fixture) + '\n');
  writeFileSync(path.join(FIXTURE_DIR, 'genre-golden.json'), JSON.stringify(golden) + '\n');
  out(
    `\n✅ 已写入 ${path.relative(__dirname, path.join(FIXTURE_DIR, 'nl-search.json'))}` +
      `（${Object.keys(scenarios).length} 个场景，${Object.keys(golden).length} 条黄金标签）`,
  );
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
