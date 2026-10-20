/**
 * 专辑 fan-out e2e（spec: specs/album-fanout）。
 *
 * 真启 NestJS（不 listen 端口，走 in-process HTTP），验证端点契约：
 *   1) 路由顺序：/music/album/save/merged 命中 fanOutLike 路径（响应有
 *      fannedOutTo 字段），不被 /album/save/:albumId 截胡
 *   2) 入参校验：缺 mergedAlbumId / sources 空 / saved 非 bool → 400
 *   3) 结构性跳过：QQ 没有收藏专辑能力 → fannedOutTo 空、不写 state
 *   4) 网易云写入：fannedOutTo 含 netease
 *   5) 取消收藏：按记录反写
 *   6) GET /music/albums/search 的结果带 savedPlatforms（角标真值来源）
 *
 * 不依赖真实网络：provider 的 searchAlbums / saveAlbum 都被替换成假实现。
 * 用临时 STORAGE_DIR 避免污染真实 state.json。
 *
 * 运行: npx ts-node src/music/album-save.e2e.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// ⚠️ 必须在 import AppModule 之前设 env——ConfigService 在构造时读 storageDir。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-album-e2e-'));
process.env.STORAGE_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-var-requires */
const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const { AppModule } = require('../app.module');
const { normalizeKey } = require('@maestro/common');
const { SessionService } = require('../common/session');
const { NeteaseMusicProvider } = require('./netease.provider');
const { QqMusicProvider } = require('./qq.provider');
const { DeezerMusicProvider } = require('./deezer.provider');
const {
  InProcessClient,
  getRequestHandlerFromNestApp,
} = require('../test-helpers/in-process-http');

const ALBUM_TITLE = '范特西';
const ALBUM_ARTIST = '周杰伦';
/**
 * 与服务端 album.util 的合并 id 口径一致：merged-${normalizeKey(title, artist)}。
 * 这里直接调同一个归一器算 —— 手写字符串会跟实现漂移（实测是「范特西周杰伦」，
 * 没有分隔符）。
 */
const MERGED_ID = `merged-${normalizeKey(ALBUM_TITLE, ALBUM_ARTIST)}`;

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('test-secret'));
  await app.init();
  const client = new InProcessClient(getRequestHandlerFromNestApp(app));

  // ── 固定 session：网易云已登录 ──────────────────────────────
  const sessions: any = app.get(SessionService);
  const testSession: any = {
    id: 'e2e-album-session',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    providers: { netease: { musicU: 'fake-music-u' } },
  };
  sessions.resolve = () => testSession;

  // ── 假 provider：searchAlbums 造一张跨平台专辑，saveAlbum 记账 ──
  const saveCalls: Array<{ albumId: string; saved: boolean }> = [];
  const netease: any = app.get(NeteaseMusicProvider);
  netease.searchAlbums = async () => [
    {
      platform: 'netease',
      albumId: 'ne-album-1',
      title: ALBUM_TITLE,
      artist: ALBUM_ARTIST,
      coverUrl: '',
      trackCount: 10,
      year: 2001,
      rank: 0,
    },
  ];
  netease.saveAlbum = async (_ps: any, albumId: string, saved: boolean) => {
    saveCalls.push({ albumId, saved });
    return true;
  };
  const qq: any = app.get(QqMusicProvider);
  qq.searchAlbums = async () => [
    {
      platform: 'qq',
      albumId: 'qq-album-1',
      title: ALBUM_TITLE,
      artist: ALBUM_ARTIST,
      coverUrl: '',
      trackCount: 10,
      year: 2001,
      rank: 0,
    },
  ];
  const deezer: any = app.get(DeezerMusicProvider);
  deezer.searchAlbums = async () => [];

  const call = async (method: string, pathname: string, body?: unknown) => {
    const r = await client.call(method, pathname, body);
    let json: unknown = null;
    try {
      json = r.json();
    } catch {
      /* no body */
    }
    return { status: r.status, json: json as any };
  };

  try {
    // ── 1. 入参校验 ────────────────────────────────────────────
    {
      const r = await call('POST', '/music/album/save/merged', { sources: [], saved: true });
      assert.strictEqual(r.status, 400, '缺 mergedAlbumId → 400');
    }
    {
      const r = await call('POST', '/music/album/save/merged', {
        mergedAlbumId: MERGED_ID,
        sources: [],
        saved: true,
      });
      assert.strictEqual(r.status, 400, 'sources 空 → 400');
    }
    {
      const r = await call('POST', '/music/album/save/merged', {
        mergedAlbumId: MERGED_ID,
        sources: [{ platform: 'netease', albumId: 'ne-album-1' }],
      });
      assert.strictEqual(r.status, 400, 'saved 非 bool → 400');
    }
    {
      // 未知平台 → 400（不能被 normalizeProvider 静默兜底成 'qq'）
      const r = await call('POST', '/music/album/save/merged', {
        mergedAlbumId: MERGED_ID,
        sources: [{ platform: 'bogus', albumId: 'x' }],
        saved: true,
      });
      assert.strictEqual(r.status, 400, '未知 platform → 400（不兜底成 qq）');
    }
    console.log('✅ 1. 入参校验：缺 mergedAlbumId / sources 空 / saved 非 bool → 400');

    // ── 2. 路由顺序 + 结构性跳过（QQ 无收藏专辑能力）────────────
    {
      const r = await call('POST', '/music/album/save/merged', {
        mergedAlbumId: MERGED_ID,
        sources: [{ platform: 'qq', albumId: 'qq-album-1' }],
        saved: true,
      });
      assert.strictEqual(r.status, 201, 'fan-out 端点应 201（Nest 默认 POST 状态）');
      assert.ok(
        Array.isArray(r.json?.fannedOutTo),
        '响应必须含 fannedOutTo —— 否则说明被 /album/save/:albumId 截胡了',
      );
      assert.deepStrictEqual(r.json.fannedOutTo, [], 'QQ 没有收藏专辑能力 → 结构性跳过');
      console.log('✅ 2. 路由顺序正确（未被 :albumId 截胡）+ QQ 结构性跳过');
    }

    // ── 3. 网易云写入 ─────────────────────────────────────────
    {
      const r = await call('POST', '/music/album/save/merged', {
        mergedAlbumId: MERGED_ID,
        sources: [{ platform: 'netease', albumId: 'ne-album-1' }],
        saved: true,
      });
      assert.deepStrictEqual(r.json.fannedOutTo, ['netease'], '网易云应写入成功');
      assert.strictEqual(saveCalls.length, 1, '应只调一次 saveAlbum');
      assert.deepStrictEqual(
        saveCalls[0],
        { albumId: 'ne-album-1', saved: true },
        'saveAlbum 调用参数',
      );
      console.log('✅ 3. 网易云写入成功');
    }

    // ── 4. 搜索结果带 savedPlatforms（角标真值）────────────────
    {
      const r = await call('GET', '/music/albums/search?q=' + encodeURIComponent(ALBUM_TITLE));
      assert.strictEqual(r.status, 200, '专辑搜索应 200');
      const items = r.json?.items ?? [];
      assert.ok(items.length > 0, '搜索应有结果（假 provider 造了 1 张）');
      const item = items.find((i: any) => i.title === ALBUM_TITLE);
      assert.ok(item, '应找到那张专辑');
      assert.deepStrictEqual(
        item.savedPlatforms,
        ['netease'],
        'savedPlatforms 应只含真实写入成功的平台',
      );
      console.log('✅ 4. GET /music/albums/search 返回 savedPlatforms');
    }

    // ── 5. 取消收藏：按记录反写 ───────────────────────────────
    {
      saveCalls.length = 0;
      const r = await call('POST', '/music/album/save/merged', {
        mergedAlbumId: MERGED_ID,
        sources: [],
        saved: false,
      });
      assert.deepStrictEqual(r.json.fannedOutTo, ['netease'], '取消应命中已记录平台');
      assert.deepStrictEqual(
        saveCalls,
        [{ albumId: 'ne-album-1', saved: false }],
        '取消应按记录里的 albumId 反写',
      );
      // 取消后角标应消失
      const s = await call('GET', '/music/albums/search?q=' + encodeURIComponent(ALBUM_TITLE));
      const item = (s.json?.items ?? []).find((i: any) => i.title === ALBUM_TITLE);
      assert.ok(
        !item?.savedPlatforms || item.savedPlatforms.length === 0,
        '取消后不应再有 savedPlatforms',
      );
      console.log('✅ 5. 取消收藏按记录反写 + 角标清除');
    }

    // ── 6. 单平台端点 ─────────────────────────────────────────
    {
      const r = await call('POST', '/music/album/save/ne-album-1?provider=netease&saved=true');
      assert.strictEqual(r.status, 201, '单平台端点应可用');
      assert.strictEqual(r.json?.success, true, '单平台收藏应成功');
      const r2 = await call('POST', '/music/album/save/ne-album-1?provider=netease');
      assert.strictEqual(r2.status, 400, '缺 saved → 400');
      // 平台不支持 → fail loud（不静默 success=false）
      const r3 = await call('POST', '/music/album/save/qq-album-1?provider=qq&saved=true');
      assert.strictEqual(r3.status, 400, 'QQ 不支持收藏专辑 → 400');
      // 未知 provider → 400（不兜底成 qq）
      const r3b = await call('POST', '/music/album/save/x?provider=bogus&saved=true');
      assert.strictEqual(r3b.status, 400, '未知 provider → 400');
      // 未登录 → 404（与 track 侧 "Not logged in to X" 同一口径）
      sessions.resolve = () => ({ ...testSession, providers: {} });
      const r4 = await call('POST', '/music/album/save/ne-album-1?provider=netease&saved=true');
      assert.strictEqual(r4.status, 404, '未登录 → 404');
      sessions.resolve = () => testSession;
      console.log('✅ 6. 单平台端点 /album/save/:albumId 可用 + 校验 + fail loud');
    }
  } finally {
    await app.close();
  }

  console.log('\n✅ album-save.e2e.test.ts 全部通过');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
