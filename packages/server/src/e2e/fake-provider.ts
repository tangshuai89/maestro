/**
 * E2E 用的**假 provider** —— 让「登录 → 搜索 → 播放 → 收藏」这条跨包链路
 * 在**没有任何真实凭据**的情况下跑通。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * H7 要的是一条真实的跨包链路（server 路由 → renderer API → UI）。
 * 但真实链路依赖 QQ / 网易云 / Spotify 的登录态：
 *   - 真实凭据**不能进 CI**（是用户账号，不是测试资产）
 *   - 真实平台的搜索结果**每天在变** → 断言写不牢
 *   - 真实平台的流是**网络资源** → CI 上不稳定、还烧流量
 * 所以链路的后端必须换成**假 provider**：路由、控制器、存储、跨平台合并、
 * 收藏 fan-out、音频代理 —— 全是真的，只有「平台本身」是假的。
 *
 * ── 怎么注入（关键：不改一行业产品代码）──────────────────────────
 * NestJS 里 provider 实例是**单例**，`app.get(XxxProvider)` 拿到的就是注入
 * 进去的那个对象 → 直接**替换实例上的方法**即可。
 * 比 `overrideProvider` 轻，也不用装 @nestjs/testing。
 *
 * ⚠️ 被替换的方法必须保持**原方法的签名与语义**（入参、返回形状、异常）——
 *   链路测试的价值就在于「server 的真实逻辑」跑在假数据上，改签名会让测试
 *   测到一条**不存在的**链路。
 */
import type { MusicProvider } from '../common/provider';

/** E2E 音频的路径（由 e2e-server 挂在 Nest 的 express 上）。 */
export const E2E_AUDIO_PATH = '/__e2e__/silent.wav';

/**
 * 生成一段**指定长度**的静音 WAV（8kHz / 8bit / 单声道）。
 *
 * ⚠️ 长度不是随便定的，两个判据都挂在它身上：
 *   1. **不能太短** —— 音频一结束，`<audio>` 触发 `ended` → 产品逻辑会
 *      **自动切下一首** → 测「收藏」时当前歌已经换人了（实测踩到）。
 *   2. **不能比元数据短太多** —— `isResidualAudio` 判「30s 试听残片」的
 *      条件是 `metaDuration > audioDuration + 45` → 音频比元数据短 45 秒以上
 *      就会触发**试听降级链**（降标准音质 / 跨平台换源）→ 测试测的链路就歪了。
 *   → 所以：**音频长度 = 假歌的元数据长度**（60s），两个判据同时满足。
 */
export function makeSilentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const dataLen = sampleRate * seconds;
  const buf = Buffer.alloc(44 + dataLen);
  // RIFF 头
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 单声道
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byteRate = sampleRate * 1 * 1
  buf.writeUInt16LE(1, 32); // blockAlign
  buf.writeUInt16LE(8, 34); // bitsPerSample
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  // data 全 0 = 静音
  return buf;
}

/** 假搜索结果里的一首歌（UnifiedSearchItem 形状）。 */
export interface FakeSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  platform: MusicProvider;
  trackId: string;
}

/** 假 provider 需要记住的状态（收藏集合、搜索命中）。 */
export interface FakeProviderState {
  /** 被收藏的 trackId 集合（按平台分桶）。 */
  liked: Map<MusicProvider, Set<string>>;
  /** 搜索时返回的歌。 */
  songs: FakeSong[];
  /** 收到的调用计数（测试用来断言「真的打到了 provider」）。 */
  calls: {
    search: number;
    like: number;
    unlike: number;
    getStreamPath: number;
    fetchLiked: number;
    fetchRadioBatch: number;
  };
}

export function createFakeState(songs: FakeSong[] = defaultSongs()): FakeProviderState {
  return {
    liked: new Map<MusicProvider, Set<string>>(),
    songs,
    calls: {
      search: 0,
      like: 0,
      unlike: 0,
      getStreamPath: 0,
      fetchLiked: 0,
      fetchRadioBatch: 0,
    },
  };
}

export function defaultSongs(): FakeSong[] {
  // duration 与 E2E 音频长度一致（60s）—— 见 makeSilentWav 的注释：
  // 短了会「播完自动切歌」，短太多会被判成「30s 试听」触发降级链。
  const duration = 60;
  return [
    {
      id: 'qq:e2e-1',
      title: 'E2E 测试曲一',
      artist: '测试歌手',
      album: '测试专辑',
      duration,
      platform: 'qq',
      trackId: 'e2e-1',
    },
    {
      id: 'qq:e2e-2',
      title: 'E2E 测试曲二',
      artist: '测试歌手',
      album: '测试专辑',
      duration,
      platform: 'qq',
      trackId: 'e2e-2',
    },
  ];
}

/** 假 provider 的方法集合（按平台分派，形状对齐真 provider）。 */
export function createFakeProviderMethods(state: FakeProviderState) {
  const likedOf = (platform: MusicProvider): Set<string> => {
    let s = state.liked.get(platform);
    if (!s) {
      s = new Set<string>();
      state.liked.set(platform, s);
    }
    return s;
  };

  return {
    /** 单平台搜索：命中歌名/歌手就算（够 E2E 用，不做模糊匹配）。 */
    async search(_session: unknown, query: string): Promise<FakeSong[]> {
      state.calls.search += 1;
      const q = (query ?? '').trim();
      if (!q) return [];
      return state.songs.filter(
        (s) => s.title.includes(q) || s.artist.includes(q) || q.includes(s.title),
      );
    },

    /** 跨平台搜索：把所有假歌都当成有源。 */
    async searchAll(): Promise<FakeSong[]> {
      state.calls.search += 1;
      return state.songs;
    },

    /** 取流路径 —— 指向 E2E server 自己提供的静音音频（真 HTTP 真字节）。 */
    async getStreamPath(
      _session: unknown,
      trackId: string,
      _mediaMid?: string,
      _quality?: string,
    ): Promise<string> {
      state.calls.getStreamPath += 1;
      // ⚠️ 端口默认 **3210**（不是 3200）：3200 是 Electron sidecar 的端口 →
      // 指着它 = 拉的是**用户真 server** 的流（实测：返回 502，E2E 直接红）。
      return `http://127.0.0.1:${process.env.E2E_PORT ?? 3210}${E2E_AUDIO_PATH}#${trackId}`;
    },

    async like(_session: unknown, trackId: string): Promise<boolean> {
      state.calls.like += 1;
      likedOf('qq').add(trackId);
      return true;
    },

    async unlike(_session: unknown, trackId: string): Promise<boolean> {
      state.calls.unlike += 1;
      likedOf('qq').delete(trackId);
      return true;
    },

    async fetchLikedMidSet(_session: unknown): Promise<Set<string>> {
      state.calls.fetchLiked += 1;
      return new Set(likedOf('qq'));
    },

    async fetchLiked(_session: unknown): Promise<string[]> {
      state.calls.fetchLiked += 1;
      return [...likedOf('qq')];
    },

    async fetchRadioBatch(_session: unknown): Promise<unknown[]> {
      state.calls.fetchRadioBatch += 1;
      return [];
    },
  };
}
