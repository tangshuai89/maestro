#!/usr/bin/env node
/**
 * NL 检索 · 黄金集（流派标签）标注。
 *
 * 给 `__fixtures__/nl-search.json` 里录到的曲目打流派标签，写进
 * `__fixtures__/genre-golden.json`——离线评测用它替代 LLM 判定（确定性、0 成本）。
 *
 * **为什么要分批**：一次调用标 200+ 首会撞 `max_tokens` 上限 → 响应被截断 →
 * 后半段全部没标签（实测 citypop 场景 240 首 → 标签 0 条）。所以按 40 首一批，
 * 每批独立调用。
 *
 * 用法：
 *   node scripts/tag-nl-fixtures.mjs              # 只补缺的（已标的不重标）
 *   node scripts/tag-nl-fixtures.mjs --force      # 全部重标
 *   node scripts/tag-nl-fixtures.mjs --only=citypop-jp
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const DIST = path.join(__dirname, 'packages/server/dist');
const FIXTURE_DIR = path.join(__dirname, 'packages/server/src/reco/__fixtures__');

process.env.STORAGE_DIR = path.join(__dirname, 'packages/server/.storage');

const out = (line) => process.stdout.write(`${line}\n`);
/** 每批多少首 —— 40 首 ≈ 500 token，离 2000 的上限有足够余量。 */
const BATCH = 40;

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').filter(Boolean) : null;

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(path.join(DIST, 'app.module.js'));
  const { RecoService } = require(path.join(DIST, 'reco/reco.service.js'));
  const { parseGenreTags } = require(path.join(DIST, 'reco/eval-genre.js'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const reco = app.get(RecoService);
  const apiKey = reco['getApiKey']?.();
  if (!apiKey) {
    out('❌ 没有 DeepSeek key');
    await app.close();
    process.exit(1);
  }

  const fixturePath = path.join(FIXTURE_DIR, 'nl-search.json');
  const goldenPath = path.join(FIXTURE_DIR, 'genre-golden.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const golden = force ? {} : JSON.parse(readFileSync(goldenPath, 'utf8'));

  const sysPrompt =
    '你是音乐流派标注员。给下面每首歌标注它的**主要流派**（1-2 个，小写英文，如 jazz / rock / pop / electronic / folk / blues / rnb / hiphop / classical / new wave / city pop）。\n' +
    '只输出 JSON：{"tags": [["jazz"], ["pop"], ...]}——数组长度必须与歌单条数相同、顺序一一对应。\n' +
    '拿不准就给空数组，不要猜。';

  let tagged = 0;
  let calls = 0;
  for (const [id, sc] of Object.entries(fixture.scenarios)) {
    if (only && !only.includes(id)) continue;
    // 场景内所有录到的曲目（种子 + 相邻艺人）
    const items = Object.values(sc.search ?? {}).flat();
    const seen = new Set();
    const unique = items.filter((it) => {
      const k = `${it.title}|${it.artist}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const todo = force ? unique : unique.filter((it) => !golden[`${it.title}|${it.artist}`]);
    if (!todo.length) {
      out(`▶ [${id}] 已有标签，跳过（${unique.length} 首）`);
      continue;
    }
    out(`▶ [${id}] 要标 ${todo.length} 首（已有 ${unique.length - todo.length} 首）`);
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const list = batch.map((it, k) => `${k + 1}. ${it.title} - ${it.artist}`).join('\n');
      try {
        const raw = await reco.callDeepSeek(
          apiKey,
          [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: list },
          ],
          { maxTokens: 1200 },
        );
        const tags = parseGenreTags(raw, batch.length) ?? [];
        batch.forEach((it, k) => {
          const t = tags[k] ?? [];
          if (t.length) {
            golden[`${it.title}|${it.artist}`] = t;
            tagged++;
          }
        });
        calls++;
      } catch (e) {
        out(`   ⚠️ 第 ${i / BATCH + 1} 批失败：${e?.message ?? e}`);
      }
    }
  }

  writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + '\n');
  out(
    `\n✅ 黄金集更新：新增 ${tagged} 条标签（${calls} 次调用），共 ${Object.keys(golden).length} 条`,
  );
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
