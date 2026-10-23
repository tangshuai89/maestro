/**
 * E2E server —— 起**真 NestJS**（真路由 / 真控制器 / 真存储 / 真跨平台合并 /
 * 真音频代理），只把**平台本身**换成假 provider。
 *
 * 用途：H7 的「跨包全链路」——让 Playwright 里的真实 renderer 产物能对着一个
 * 真实后端跑「搜索 → 播放 → 收藏 → 角标 → 刷新后仍在」。
 *
 * ── 设计约束 ──────────────────────────────────────────────────────
 * 1. **零产品代码改动**：provider 是 Nest 单例 → 直接替换实例上的方法；
 *    `MusicService.searchUnified` 同理。product 代码一行不动。
 * 2. **不依赖真实凭据**：QQ / 网易云 / Spotify 的登录态是用户账号，不是测试
 *    资产，不能进 CI；真实搜索结果每天都变，断言写不牢。
 * 3. **音频代理是真的**：`/music/stream/:provider/:trackId` 走真代理逻辑
 *    （Range 转发 / 206 / 白名单 / 502 诊断），上游是 data: URL 的静音 WAV。
 *    ⚠️ dev 模式的白名单 fail-open 是必需的（data: URL 的 host 为空）——
 *    `NODE_ENV` 保持 development，prod 的严格 403 会挡住。
 * 4. **CORS**：renderer 产物跑在 127.0.0.1:4173，server 的 allowlist 默认只
 *    放行 3000 + 5273-5322 → 用 `RENDERER_ORIGINS` **追加**（env 是追加不是
 *    替换，见 config.ts 的注释）。
 *
 * 运行: npx ts-node src/e2e/e2e-server.ts [--port 3210]
 *
 * ⚠️ **默认端口是 3210，不是 3200**：3200 是 **Electron sidecar 的端口** ——
 * 用户开着 app 时它就一直在监听。之前本 E2E 用 3200 的后果（实测踩到）：
 *   1. 端口被占 → E2E server 起不来；
 *   2. Playwright 的 `reuseExistingServer`（本地默认 true）→ **静默复用**了
 *      用户那个**真** server → E2E 测的根本不是假 provider（真 server ���
 *      QQ 搜索返回 60 条真实结果，而不是假 provider 的 2 条）；
 *   3. 更糟：E2E 的「收藏」步骤会把红心写进**用户真实的账号**。
 * → 专用端口 + 绝不复用，两条都要。
 * 就绪后会打印 `E2E_SERVER_READY <port>`（Playwright 的 webServer 靠它判活）。
 */
import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export {};
const assert = require('node:assert');

// ⚠️ 必须在 import AppModule 之前设 env —— ConfigService 在构造时读
// storageDir / rendererOrigins。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-e2e-server-'));
process.env.STORAGE_DIR = tmpDir;
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
// renderer 产物的 origin（vite preview）——env 是**追加**不是替换。
process.env.RENDERER_ORIGINS = [
  process.env.RENDERER_ORIGINS ?? '',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]
  .filter(Boolean)
  .join(',');

/* eslint-disable @typescript-eslint/no-var-requires */
const { AppModule } = require('../app.module');
const { MusicService } = require('../music/music.service');
const { SessionService } = require('../common/session');
const { QqMusicProvider } = require('../music/qq.provider');
const { NeteaseMusicProvider } = require('../music/netease.provider');
const { DeezerMusicProvider } = require('../music/deezer.provider');
const { SpotifyMusicProvider } = require('../music/spotify.provider');
const {
  createFakeProviderMethods,
  createFakeState,
  defaultSongs,
  makeSilentWav,
  toTrackForPlatform,
  E2E_AUDIO_PATH,
} = require('./fake-provider');

/** 假搜索结果 → server 端的 UnifiedSearchItem（形状对齐 music/types.ts）。 */
function toUnifiedItem(song: any) {
  const source = {
    platform: song.platform,
    trackId: song.trackId,
    hasCopyright: true,
    // 交给 server 的音频代理去拉 → 前端拿到的是**后端代理相对路径**
    url: `/music/stream/${song.platform}/${song.trackId}`,
  };
  // 同一首歌的**第二个平台源**（跨平台降级链用）
  const sources: any[] = [source];
  if (song.alt) {
    sources.push({
      platform: song.alt.platform,
      trackId: song.alt.trackId,
      hasCopyright: true,
      url: `/music/stream/${song.alt.platform}/${song.alt.trackId}`,
    });
  }
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    coverUrl: '',
    duration: song.duration,
    sources,
    bestSource: song.platform,
    versionType: 'studio',
    versions: [
      {
        id: `ver-${song.trackId}`,
        duration: song.duration,
        sources,
        bestSource: song.platform,
      },
    ],
  };
}

async function main(): Promise<void> {
  const port = Number(process.env.E2E_PORT ?? 3210);
  const state = createFakeState(defaultSongs());
  // 第二首歌的 **QQ 源故意取不到流**（网易云那个源是好的）→ 用来验证
  // 「跨平台降级链」：server 代理返 502 → renderer 自动换到网易云源。
  for (const song of state.songs) {
    if (song.brokenPrimary) state.brokenTrackIds.add(song.trackId);
  }
  const fake = createFakeProviderMethods(state);

  const app = await NestFactory.create(AppModule, { logger: false });
  const cfg = app.get(require('../common/config').ConfigService);
  app.use(cookieParser(cfg.sessionSecret));
  // 与 main.ts 同一份 CORS 配置（allowlist 来自 ConfigService，含 env 追加项）。
  app.enableCors({
    origin: cfg.rendererOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Maestro-Token'],
    exposedHeaders: ['X-Maestro-Token'],
  });

  // ── E2E 专用音频端点（真 HTTP 真字节）────────────────────────
  // 假 provider 的「上游流」指向这里 → server 的音频代理会**真的**去拉它
  // 并把字节转发给浏览器 → 播放链路（代理 / Range / 206 / 白名单）全是真的。
  //
  // ⚠️ 这个端点只挂在 E2E 进程里，**不在产品的 controller 上**。
  const wav = makeSilentWav(60);
  app.use(E2E_AUDIO_PATH, (_req: any, res: any) => {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wav.length));
    res.setHeader('Accept-Ranges', 'bytes');
    res.end(wav);
  });

  // ── 把「平台本身」换成假的（路由 / 控制器 / 存储全是真的）──────────
  // provider 是 Nest 单例 → 拿到的就是注入进去的那个对象 → 直接换方法。
  //
  // ⚠️ 先把 session 变成「已登录」：server 的多处判据是
  // `session.providers[provider]` 存在与否（requireProviderSession 找不到就
  // 404 "Not logged in to qq"）。真实链路靠登录窗口写 cookie，这里没有窗口
  // → 直接在 resolve 之后补一个假的 ProviderSession。
  const sessionService = app.get(SessionService);
  const origResolve = sessionService.resolve.bind(sessionService);
  sessionService.resolve = (req: any, res: any) => {
    const session = origResolve(req, res);
    if (!session.providers.qq) {
      sessionService.setProvider(session, 'qq', {
        qqCookie: 'qm_keyst=fake-e2e; p_skey=fake-e2e; uin=0',
        qqUin: '0',
        qqCookies: { qm_keyst: 'fake-e2e', p_skey: 'fake-e2e', uin: '0' },
        qqVip: true,
      });
    }
    if (!session.providers.netease) {
      sessionService.setProvider(session, 'netease', {
        musicU: '0',
        csrfToken: 'fake-e2e',
      });
    }
    return session;
  };

  const qq = app.get(QqMusicProvider);
  qq.getStreamPath = fake.getStreamPath;
  qq.like = fake.like;
  qq.unlike = fake.unlike;
  qq.fetchLikedMidSet = fake.fetchLikedMidSet;
  qq.fetchRadioBatch = fake.fetchRadioBatch;
  qq.search = fake.search;
  qq.fetchLiked = fake.fetchLiked;
  qq.probeSession = async () => ({
    // ⚠️ 形状必须对齐 SessionProbeResult（{alive, reason, fetched}）——
    // 少了 `alive` 会被读成 undefined（falsy）→ server 判「登录已过期」→
    // renderer 弹**登录错误面板**（.aep-root，fixed inset 0 + z-index 200）
    // → 整个界面被盖住，点不动。
    // `reason: 'purl_present'` 还有个附带好处：auth controller 只在
    // purl_present / vkey_present 时刷新 lastValidatedAt → 后续不会一直判 stale。
    alive: true,
    reason: 'purl_present',
    fetched: true,
  });

  const netease = app.get(NeteaseMusicProvider);
  netease.getStreamPath = fake.getStreamPath;
  netease.like = fake.like;
  netease.unlike = fake.unlike;
  netease.fetchLiked = fake.fetchLiked;
  netease.search = fake.search;
  netease.fetchRadioBatch = fake.fetchRadioBatch;

  const deezer = app.get(DeezerMusicProvider);
  deezer.getStreamPath = fake.getStreamPath;
  deezer.search = fake.search;
  deezer.fetchRadioBatch = fake.fetchRadioBatch;

  const spotify = app.get(SpotifyMusicProvider);
  spotify.getStreamPath = fake.getStreamPath;
  spotify.like = async () => ({ success: true });
  spotify.unlike = async () => ({ success: true });
  spotify.search = fake.search;
  spotify.fetchRadioBatch = fake.fetchRadioBatch;

  // 跨平台统一搜索（前端不带 provider 参数时走这条）
  const music = app.get(MusicService);
  music.searchUnified = async (_session: unknown, keyword: string, page = 1, pageSize = 20) => {
    const kw = (keyword ?? '').trim();
    const all = kw
      ? state.songs.filter((s: any) => s.title.includes(kw) || s.artist.includes(kw))
      : state.songs;
    const items = all.map(toUnifiedItem);
    return {
      q: keyword,
      total: items.length,
      page,
      pageSize,
      items: items.slice((page - 1) * pageSize, page * pageSize),
    };
  };
  music.searchTracks = async (_session: unknown, provider: string, keyword: string) => {
    const kw = (keyword ?? '').trim();
    const hits = kw
      ? state.songs.filter((s: any) => s.title.includes(kw) || s.artist.includes(kw))
      : state.songs;
    // ⚠️ 返回 **Track 形状**（前端把它当 Track 用：id=平台曲目 id、provider=平台名）
    return hits
      .map((s: any) => toTrackForPlatform(s, (provider || 'qq') as never))
      .filter((t: any): t is NonNullable<typeof t> => t !== null);
  };

  // ⚠️ 不指定 host：renderer 产物在浏览器里用的是 `http://localhost:3210`
  // （生产模式的 sidecar origin），而 localhost 在部分机器上解析成 ::1 ——
  // 只绑 127.0.0.1 会出现「浏览器连不上但 curl 连得上」的幽灵故障。
  await app.listen(port);
  new Logger('E2EServer').log(`fake providers ready on http://127.0.0.1:${port}`);
  // Playwright 的 webServer 靠 stdout 判活。
  console.log(`E2E_SERVER_READY ${port}`);

  const shutdown = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('E2E server 启动失败:', e);
  process.exit(1);
});
