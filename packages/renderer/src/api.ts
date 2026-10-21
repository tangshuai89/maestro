// The NestJS server exposes its routes WITHOUT any prefix: `/music/*`,
// `/auth/*`, `/reco/*`. In dev (Vite on :5273) those paths are proxied
// to the server on :3200 (see vite.config.ts). The HTML5 <audio>
// element loads `track.audioUrl` directly — a server-relative path like
// `/music/stream/deezer/123` — so we resolve every URL against the same
// API origin, which works in both dev and production (where Electron
// loads the renderer from `file://` and a bare relative path would
// otherwise resolve against the wrong origin).
//
// ⚠️ There is deliberately NO `/api` prefix. The old code prefixed the
// client with `/api` and relied on Vite's dev proxy to strip it — but
// the server never had that prefix and prod has no such rewrite, so
// packaged builds 404'd on every call. Client and server now agree on
// the prefix-less shape (matching the audio path, which never used one).
//
// `import.meta.env.DEV` is true only when Vite is running. In production
// builds we read the sidecar URL from window.electronAPI.apiBase (pushed
// by the preload bridge once main spawns the NestJS sidecar). If neither
// is set (running a prod build without Electron), we fall back to
// http://localhost:3200 and let the user deal with it.
function resolveApiOrigin(): string {
  // In Electron, prefer the sidecar URL that main process pushed via preload.
  if (
    typeof window !== 'undefined' &&
    (window as { electronAPI?: { apiBase?: string } }).electronAPI?.apiBase
  ) {
    return (window as { electronAPI: { apiBase: string } }).electronAPI.apiBase;
  }
  if (import.meta.env.DEV) return '';
  return 'http://localhost:3200';
}

/**
 * Audit A3 (consistency-fixes T1): the sidecar URL is pushed via preload's
 * `sidecar-ready` IPC AFTER this module is first imported. When
 * `api.ts` was loaded eagerly at boot, the old `const API_ORIGIN =
 * resolveApiOrigin()` captured `''` (or 'localhost:3200') permanently, so
 * the renderer's audio src / cover-proxy URLs were broken until a full
 * reload — and the default port was the only thing keeping prod alive.
 *
 * `getApiOrigin()` evaluates on every call so media URLs that fire
 * later (radio next-track previews, lazy cover fetches) see the real
 * sidecar URL. Media URLs must go through it — never through `API_BASE`.
 */
export function getApiOrigin(): string {
  return resolveApiOrigin();
}

/** 模块加载时的 origin 快照。普通 REST 调用（`API_BASE`）走它；
 *  媒体 URL 走 `getApiOrigin()`（audio src / cover-proxy / 歌词分享图）。 */
export const API_ORIGIN = resolveApiOrigin();
const API_BASE = API_ORIGIN;

export type MusicProvider = 'qq' | 'netease' | 'deezer' | 'spotify';

export const PROVIDER_LABELS: Record<MusicProvider, string> = {
  qq: 'QQ 音乐',
  netease: '网易云音乐',
  deezer: 'Deezer',
  spotify: 'Spotify',
};

export interface Track {
  id: string;
  provider: MusicProvider;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  audioUrl: string; // /music/stream/{provider}/{id}，浏览器直接当 src 用
  duration: number;
  liked: boolean;
  mediaMid?: string; // QQ 取流用的 media_mid（高音质需要）
  /** 当前会话大概率放不了全曲（VIP 独占 / 付费 / 只给试听）。server Track 同名字段。 */
  vipLocked?: boolean;
  /** 这条源没有任何可播放音频（Spotify 无 preview_url）。见
   *  `UnifiedSourceInfo.noPreview`。 */
  noPreview?: boolean;
}

/** QQ 音质档位。standard=m4a，high=320mp3，lossless=flac（需会员）。 */
export type QqQuality = 'standard' | 'high' | 'lossless';
export const QQ_QUALITY_LABELS: Record<QqQuality, string> = {
  standard: '标准',
  high: '极高 320',
  lossless: '无损',
};

export interface AuthUser {
  nickname: string;
  avatarUrl: string;
  provider: MusicProvider;
}

export interface AuthStatus {
  provider: MusicProvider;
  loggedIn: boolean;
  user: AuthUser | null;
  /** Spotify-only: cached product tier, null for non-spotify providers or
   * when tier is unknown. */
  tier?: 'premium' | 'free' | 'open' | null;
  /**
   * 登录态**已过期**（server 跑过 validate 探针且判定失效）。
   *
   * 与 `loggedIn:false` 分开是因为两者含义不同：
   *  - `loggedIn:false` 且 `expired` 缺失 = 从没登录过 → 不该弹「重新登录」
   *  - `loggedIn:false` 且 `expired:true`  = 登录过但过期了 → 该弹「重新登录」
   *
   * 仅在服务端收到 `validate=1` 时出现。见 specs/auth-resilience Phase 10。
   */
  expired?: boolean;
  /** 过期时的机器可读错误码（当前只有 AUTH_EXPIRED）。 */
  error?: string;
  message?: string;
}

export interface NeteaseQrStart {
  key: string;
  qrImg: string;
  qrUrl: string;
}

export interface NeteaseQrCheck {
  /** 800 过期 / 801 等待扫码 / 802 已扫码待确认 / 803 登录成功 */
  code: number;
  message: string;
  user?: AuthUser;
}

/** A typed auth error thrown by the api layer. Backed by the server's
 *  `{ error: AuthErrorCode, message }` body shape; the raw fetch error is
 *  preserved as `cause` for logging. */
export class AuthError extends Error {
  readonly code: import('./auth/types').AuthErrorCode;
  readonly status: number;
  readonly raw: string;
  constructor(
    code: import('./auth/types').AuthErrorCode,
    message: string,
    status: number,
    raw: string,
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}

/** X-Maestro-Token injected into every state-changing request by
 *  fetchWithToken below. Read lazily from electronAPI (only set once
 *  main process fires 'sidecar-ready'). Empty string in dev mode → server
 *  guard falls back to permissive + warn.
 *
 *  Returns '' when no token is configured so callers (and tests) don't
 *  have to special-case undefined. */
function maestroToken(): string {
  if (typeof window === 'undefined') return '';
  const api = (window as { electronAPI?: { internalToken?: string } }).electronAPI;
  return api?.internalToken ?? '';
}

/** Single fetch wrapper that:
 *   1) injects `credentials: 'include'` so the session cookie travels
 *   2) injects `X-Maestro-Token` so RequireInternalTokenGuard lets the
 *      request through (B1)
 *   3) lets callers override or extend via the optional init.headers
 *
 *  Use this in place of bare `fetch(...)` for any call into the sidecar.
 *  GETs still get the token because the guard runs on all methods; this
 *  is intentional — some GETs mutate (e.g. /auth/spotify/redeem,
 *  /auth/logout) and we want one uniform header. */
export function fetchWithToken(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const tok = maestroToken();
  if (tok) headers.set('X-Maestro-Token', tok);
  return fetch(url, { ...init, headers, credentials: 'include' });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Try to lift a server-emitted AuthErrorCode out of the body so the
    // renderer hook can branch on typed codes instead of string-matching
    // status / messages. Body shape: { error: 'AUTH_*', message? }.
    let code: import('./auth/types').AuthErrorCode = 'AUTH_UNKNOWN';
    let msg = text;
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof parsed?.error === 'string') {
        const known: import('./auth/types').AuthErrorCode[] = [
          'AUTH_CANCELLED',
          'AUTH_TIMEOUT',
          'AUTH_INVALID',
          'AUTH_EXPIRED',
          'AUTH_PROTOCOL_MISSING',
          'AUTH_BACKEND_DOWN',
          'AUTH_UNKNOWN',
        ];
        if ((known as string[]).includes(parsed.error)) {
          code = parsed.error as import('./auth/types').AuthErrorCode;
        }
      }
      if (typeof parsed?.message === 'string') msg = parsed.message;
    } catch {
      /* body wasn't JSON — keep code=AUTH_UNKNOWN, message=raw text */
    }
    throw new AuthError(
      code,
      msg || `${res.status} ${res.statusText}`,
      res.status,
      text.slice(0, 400),
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchNextTrack(provider: MusicProvider, preset?: string): Promise<Track> {
  const qs = preset ? `&preset=${encodeURIComponent(preset)}` : '';
  return json<Track>(
    await fetchWithToken(`${API_BASE}/music/next?provider=${provider}${qs}`, {
      credentials: 'include',
    }),
  );
}

/** 跨平台匹配元数据：点 ❤ / 检测已红心时随请求带上，后端用它去其余已登录
 *  平台搜同名同时长的等价曲目，把红心真正同步过去（严格 duration ±3s）。 */
export interface LikeMeta {
  title: string;
  artist: string;
  duration: number;
}

export async function toggleLike(
  provider: MusicProvider,
  trackId: string,
  meta?: LikeMeta,
): Promise<{ success: boolean; liked: boolean }> {
  return json(
    await fetchWithToken(
      `${API_BASE}/music/like/${encodeURIComponent(trackId)}?provider=${provider}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta ? { meta } : {}),
      },
    ),
  );
}

/**
 * Heart fan-out：把一个 unified track 的 ❤ 一次性写到所有 hasCopyright 的平台。
 * sources 是 UnifiedSearchItem.sources 列表（去掉 hasCopyright=false 的）。
 *
 * 返回的 fannedOutTo：liked=true 时是当前 mergedId 心动过的**全部平台**
 * （含之前单独心过的），UI 角标直接用它的 length 表达"这首歌在几个平台有 ❤"；
 * liked=false 时是空数组。
 */
/**
 * 单曲 ❤ 数拉取（fire-and-forget）。server 端 QQ/网易云走公开匿名接口，
 * 5s 超时 + 30s/1h 缓存。失败/超时返回 null，HUD 显示 fallback。
 * Body: { platform: 'qq'|'netease', trackId: string }
 */
export async function fetchTrackLikeCount(
  platform: 'qq' | 'netease',
  trackId: string,
): Promise<{ count: number; display: string; source: 'qq' | 'netease' } | null> {
  try {
    const res = await fetchWithToken(`${API_BASE}/music/track/likeCount`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, trackId }),
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as { count: number; display: string; source: 'qq' | 'netease' };
  } catch {
    return null;
  }
}

/**
 * NL playlist intent schema（specs/nl-playlist/ §数据模型）。
 * 服务端 mirror：packages/server/src/reco/nl-intent.ts。
 */
export interface NLIntent {
  mood: string;
  genres: string[];
  tempo: 'slow' | 'medium' | 'fast' | 'any';
  language: 'zh' | 'en' | 'ja' | 'ko' | 'any';
  era?: { from?: number; to?: number };
  similar_artists: string[];
  similar_tracks: string[];
  exclude_artists: string[];
  exclude_genres: string[];
  /**
   * 流派 → 代表艺人（specs/nl-intent-retrieval/）。服务端拿它当**检索种子**：
   * 「来点爵士」→ 用 Miles Davis / Coltrane 去平台搜真实爵士曲。
   */
  genre_artists?: Array<{ genre: string; artists: string[] }>;
  target_count: number;
  rationale: string;
}

/**
 * POST /reco/parse-intent —— 把用户自然语言解析成 NLIntent。
 * 走 json() 统一出口：400 / 428 / 429 / 502 抛 AuthError（带 .status，
 * UI 据此分流——428 开 RecoKeyModal，其余走错误文案）。
 */
export async function parseIntent(text: string): Promise<{ intent: NLIntent; raw?: string }> {
  return json(
    await fetchWithToken(`${API_BASE}/reco/parse-intent`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  );
}

/* ── 本地歌单 CRUD（specs/nl-playlist/ A4+A5）────────────────── */

export interface Playlist {
  id: string;
  name: string;
  tracks: UnifiedSearchItem[];
  source: 'nl' | 'manual';
  prompt?: string;
  createdAt: number;
  updatedAt: number;
}

export async function listPlaylists(): Promise<Playlist[]> {
  return json(
    await fetchWithToken(`${API_BASE}/library/playlists`, {
      credentials: 'include',
    }),
  );
}

export async function createPlaylist(body: {
  name: string;
  tracks: UnifiedSearchItem[];
  prompt?: string;
  source?: 'nl' | 'manual';
}): Promise<Playlist> {
  return json(
    await fetchWithToken(`${API_BASE}/library/playlists`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function patchPlaylist(
  id: string,
  body: { name?: string; append?: UnifiedSearchItem[]; remove?: string[] },
): Promise<Playlist> {
  return json(
    await fetchWithToken(`${API_BASE}/library/playlists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function deletePlaylist(id: string): Promise<{ ok: true }> {
  return json(
    await fetchWithToken(`${API_BASE}/library/playlists/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    }),
  );
}

// ── 远端歌单（specs/remote-playlist）──────────────────────────────────────

/**
 * 远端歌单元信息。**镜像**，不是本地 `Playlist`（那个是 UnifiedSearchItem[]）。
 * 见 server 侧 `types.ts` 的同名类型。
 */
export interface RemotePlaylistMeta {
  provider: MusicProvider;
  id: string;
  name: string;
  coverUrl: string;
  /** 平台声明的曲目数，可能 > 实际返回（QQ 过滤失效歌曲 / Deezer 匿名截断） */
  trackCount: number;
  private: boolean;
}

export interface RemotePlaylist extends RemotePlaylistMeta {
  /** 保序，1:1 对应平台顺序 */
  tracks: Track[];
}

export interface RemotePlaylistListResult {
  provider: MusicProvider;
  /** 平台是否支持「列歌单目录」。QQ 只支持读、Deezer 匿名无「我的歌单」→ false */
  supported: boolean;
  items: RemotePlaylistMeta[];
}

export async function listRemotePlaylists(
  provider: MusicProvider,
  limit?: number,
): Promise<RemotePlaylistListResult> {
  // ⚠️ 这是**第二个**查询参数，分隔符必须是 `&` 不是 `?`（写 `?` 会得到
  // `?provider=netease?limit=30`，limit 被静默丢掉）。
  const q = limit ? `&limit=${limit}` : '';
  // ⚠️ `/music` 前缀不能省：远端歌单端点在 `music.controller.ts`
  // （`@Controller('music')`）。对比 `/library/playlists` —— 那个在
  // nl-playlist.controller.ts 里，`@Controller()` 无前缀，所以不需要。
  // 漏掉前缀时 server 会回 SPA 的 index.html，renderer 侧表现为
  // 「Unexpected token '<' … is not valid JSON」（首轮实测踩过）。
  return json(
    await fetchWithToken(`${API_BASE}/music/playlists?provider=${provider}${q}`, {
      credentials: 'include',
    }),
  );
}

/**
 * 拉远端歌单。
 *
 * 返回的 `items` 已经是 **1:1 保序、不合并**的 `UnifiedSearchItem[]`，可以直接
 * 喂队列播放器（`usePlayer` 的队列就是吃这个）。**不要**在前端再调一次
 * `buildUnifiedItems` 之类的合并逻辑 —— 那会按歌名折叠同名条目，让 227 首的
 * 歌单变 225 首。
 */
export async function getRemotePlaylist(
  provider: MusicProvider,
  playlistId: string,
  limit?: number,
): Promise<{ playlist: RemotePlaylist; items: UnifiedSearchItem[] }> {
  const q = limit ? `?limit=${limit}` : '';
  return json(
    await fetchWithToken(
      `${API_BASE}/music/playlists/${provider}/${encodeURIComponent(playlistId)}/tracks${q}`,
      { credentials: 'include' },
    ),
  );
}

/**
 * 从用户粘贴的内容里抠出歌单 id + 推断平台。
 *
 * 接受这些形态（用户多半是直接复制浏览器地址栏）：
 *  - path 形态  `https://y.qq.com/n/ryqq/playlist/8584177317`（QQ / Deezer）
 *  - path 形态  `https://music.163.com/playlist/123456`（网易云也支持）
 *  - hash 形态  `https://music.163.com/#/playlist?id=1562085694`（**网易云地址栏默认**）
 *  - hash 形态  `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`
 *                （Spotify 的 id 是 **base62 非数字**，单独走宽松分支 —— 只为让
 *                 UI 能回「Spotify 尚未接入」这句准确提示，而不是含糊的
 *                 「认不出这个链接」）
 *  - 裸 id      `8584177317`
 *
 * 平台识别靠**域名**，不靠用户手选——从 QQ 链接里推出一个 netease 的请求只会
 * 得到一句莫名其妙的 404。认不出的域名返回 `null`，由调用方让用户改用裸 id。
 */
export function parseRemotePlaylistInput(
  input: string,
): { provider: MusicProvider; playlistId: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  // 裸 id：纯数字（QQ / 网易云 / Deezer 的 id 都是数字）
  if (/^\d+$/.test(raw)) return { provider: 'qq', playlistId: raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');

  // ⚠️ 网易云的地址栏是 **hash 路由**：`music.163.com/#/playlist?id=1562085694`
  //   —— id 在 `?id=` 查询串里，**不在 path 段里**。所以先试 hash + search
  //   的 `id=`，再退回 path 的 `/playlist/<数字>` 形态（QQ / Deezer 都是后者，
  //   网易云也同时支持 `music.163.com/playlist/123`）。
  const fromQuery = /[?&]id=(\d+)/.exec(url.search) ?? /[?&]id=(\d+)/.exec(url.hash);
  const fromPath = /\/playlist\/(\d+)/.exec(url.pathname);

  // Spotify 的歌单 id 是 base62（如 37i9dQZF1DXcBWIGoYBM5M），不是数字。
  // 这里为它单独放宽：解析出来好让 UI 提示「Spotify 尚未接入」——那比
  // 「认不出这个链接」诚实得多。后端拿到也会回 playlist_unsupported。
  if (host.endsWith('spotify.com')) {
    const m = /\/playlist\/([A-Za-z0-9]+)/.exec(url.pathname);
    return m ? { provider: 'spotify', playlistId: m[1] } : null;
  }

  const id = fromQuery?.[1] ?? fromPath?.[1];
  if (!id) return null;

  if (host.endsWith('qq.com')) return { provider: 'qq', playlistId: id };
  if (host.endsWith('163.com')) return { provider: 'netease', playlistId: id };
  if (host.endsWith('deezer.com')) return { provider: 'deezer', playlistId: id };
  return null;
}

export async function fanOutLike(
  mergedId: string,
  sources: Array<{ platform: MusicProvider; trackId: string }>,
  liked: boolean,
  meta?: LikeMeta,
): Promise<{ success: boolean; liked: boolean; fannedOutTo: MusicProvider[] }> {
  return json(
    await fetchWithToken(`${API_BASE}/music/like/merged`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mergedId, sources, liked, meta }),
    }),
  );
}

/**
 * 切歌时的红心检测 + 自动同步：查这首统一 track 在各平台的红心情况，
 * 任一平台已红心 → 后端补齐其余平台并返回 liked=true + 完整平台列表。
 * 全没红心 → liked=false（不写任何东西）。
 */
export async function detectLiked(
  mergedId: string,
  sources: Array<{ platform: MusicProvider; trackId: string }>,
  meta?: LikeMeta,
): Promise<{
  liked: boolean;
  fannedOutTo: MusicProvider[];
  /**
   * true = 后台跨平台 discover 已落定，fannedOutTo 是最终值；
   * false = waitForSettled 超时（discover 还在跑 / 排着队），fannedOutTo 是
   * **中间态**——前端轮询绝不能把两个相同的中间值当成稳定，必须等到 true。
   */
  settled: boolean;
}> {
  return json(
    await fetchWithToken(`${API_BASE}/music/like/detect`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mergedId, sources, meta }),
    }),
  );
}

export async function dislike(
  provider: MusicProvider,
  trackId: string,
): Promise<{ success: boolean }> {
  return json(
    await fetchWithToken(
      `${API_BASE}/music/dislike/${encodeURIComponent(trackId)}?provider=${provider}`,
      { method: 'POST', credentials: 'include' },
    ),
  );
}

/**
 * 统一 track 的「踩」：取消这首歌在所有 fan-out 平台的红心（真正从各平台收藏
 * 移除）+ 标记不喜欢。用于统一搜索队列里的歌——单平台电台仍走 dislike()。
 */
export async function dislikeMerged(
  mergedId: string,
  sources: Array<{ platform: MusicProvider; trackId: string }>,
): Promise<{ success: boolean }> {
  return json(
    await fetchWithToken(`${API_BASE}/music/dislike/merged`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mergedId, sources }),
    }),
  );
}

export async function getLiked(provider: MusicProvider): Promise<Track[]> {
  return json<Track[]>(
    await fetchWithToken(`${API_BASE}/music/liked?provider=${provider}`, {
      credentials: 'include',
    }),
  );
}

export async function getAuthStatus(provider: MusicProvider): Promise<AuthStatus> {
  return json<AuthStatus>(
    await fetchWithToken(`${API_BASE}/auth/status?provider=${provider}`, {
      credentials: 'include',
    }),
  );
}

/** Extended status payload (only on QQ / Netease / Spotify paths). Includes
 *  the server-side lastValidatedAt hint so the renderer can probe when
 *  a logged-in session hasn't been validated for >24h. */
export interface AuthStatusExtended extends AuthStatus {
  lastValidatedAt: number | null;
  /**
   * 凭据三态（服务端权威）：还能不能调账号接口。
   * - 'valid'   → validate=1 的探针确认还活着
   * - 'expired' → 探针确认死了（该重新登录）
   * - 'unknown' → 没探 / 探针没结论 —— **不猜**
   */
  credential?: 'valid' | 'expired' | 'unknown';
  /**
   * 权益三态（服务端权威）：付费权益还有没有（能不能放全曲）。
   *
   * 这是**凭据有效但会员过期**那种情况的唯一判据 —— 客户端看不出来，
   * 而它和「凭据过期」要的用户动作完全相反：前者重登没用（要等会员恢复
   * 或换平台），后者重登就好。
   */
  entitlement?: 'valid' | 'expired' | 'unknown';
}

export async function getAuthStatusExtended(provider: MusicProvider): Promise<AuthStatusExtended> {
  return json<AuthStatusExtended>(
    await fetchWithToken(`${API_BASE}/auth/status?provider=${provider}&extended=1`, {
      credentials: 'include',
    }),
  );
}

/**
 * 带登录态校验的 status（spec: specs/auth-resilience Phase 10）。
 *
 * `validate=1` 让服务端**真的**跑一次探针，而不是只检查 cookie 在不在。
 * 这是唯一能区分「从没登录」和「登录已过期」的路径 —— 默认的 status 只看
 * cookie 是否存在，一个早就失效的 cookie 也会被报成 loggedIn:true。
 *
 * 代价：会多打一次平台请求（服务端有 10min session 级缓存，不是每次都打）。
 * 所以只在「确实需要判断」时调用（启动重校验 / 播放失败兜底），
 * 不要放进常规轮询。
 */
export async function getAuthStatusValidated(provider: MusicProvider): Promise<AuthStatusExtended> {
  return json<AuthStatusExtended>(
    await fetchWithToken(`${API_BASE}/auth/status?provider=${provider}&validate=1&extended=1`, {
      credentials: 'include',
    }),
  );
}

/** Cancel any in-flight Spotify PKCE flow tied to the current session.
 *  Used when the renderer detects a stuck login or the user backs out
 *  of the OAuth browser tab. */
export async function cancelSpotifyAuth(): Promise<{ ok: boolean }> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/spotify/cancel`, {
      method: 'POST',
      credentials: 'include',
    }),
  );
}

/** One-shot auth telemetry. Sent once per attempt's terminal state
 *  (ok / fail / cancel). Server logs at info / warn level; nothing
 *  user-visible. */
export async function reportAuthEvent(evt: {
  provider: MusicProvider;
  attemptId: string;
  outcome: 'ok' | 'fail' | 'cancel';
  durationMs: number;
  errorCode?: string;
}): Promise<{ ok: boolean }> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/event`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
    }),
  );
}

/**
 * 启动 Spotify OAuth PKCE 流程：服务端生成 code_verifier / state 并缓存，
 * 返回授权 URL。renderer 拿到后用 shell.openExternal 在系统浏览器打开，
 * 用户登录后 Spotify 跳回 redirect_uri（默认是 renderer 的
 * /auth/spotify/callback），后端在那里用 verifier 换 token 存进 session。
 * 之后调 `getAuthStatus('spotify')` 就能看到 loggedIn=true。
 *
 * 注意：调用前必须已经通过 POST /auth/spotify/client-id 设过 client_id，
 * 否则会返回 400。useAuth 在调用前会先检查 hasClientId。
 */
export async function startSpotify(redirectUri?: string): Promise<{
  authorizeUrl: string;
  state: string;
}> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/spotify/start`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(redirectUri ? { redirectUri } : {}),
    }),
  );
}

/** Electron 自定义协议回调：main process 收 maestro:// URL 后 IPC 传 code+state
 *  给 renderer，renderer 调此端点直接把 session cookie 写进自己 cookie jar。
 *  不需要 popup 或 cookie 共享。 */
export async function redeemSpotifyCode(
  code: string,
  state: string,
): Promise<{ ok: boolean; profile: { id: string; displayName: string } }> {
  return json(
    await fetchWithToken(
      `${API_BASE}/auth/spotify/redeem?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { credentials: 'include' },
    ),
  );
}

/** 检查 Spotify client_id 是否已设（不返回 id 本身）。 */
export async function getSpotifyStatus(): Promise<{
  hasClientId: boolean;
  loggedIn: boolean;
  /** Cached Spotify product tier, populated at login from /v1/me's `product`
   * field. Drives the WPS-vs-preview routing decision. null = not logged in
   * or tier not yet known. */
  tier: 'premium' | 'free' | 'open' | null;
}> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/spotify/status`, {
      credentials: 'include',
    }),
  );
}

/** 拿当前有效的 Spotify access_token 给 WPS SDK 用。server 会自动 refresh。 */
export async function getSpotifyToken(): Promise<{
  accessToken: string;
  expiresAt: number;
  tier: 'premium' | 'free' | 'open' | null;
}> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/spotify/token`, {
      credentials: 'include',
    }),
  );
}

/** 拿 Spotify /me 缓存（id / displayName / tier）。用于 SourceSelect 等 UI 显名。 */
export async function getSpotifyMe(): Promise<{
  id: string;
  displayName: string;
  tier: 'premium' | 'free' | 'open';
}> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/spotify/me`, {
      credentials: 'include',
    }),
  );
}

/** 设置 Spotify OAuth client_id（用户在 Spotify Developer 后台创建应用拿到的）。 */
export async function setSpotifyClientId(clientId: string): Promise<{ ok: true; tail: string }> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/spotify/client-id`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    }),
  );
}

/**
 * QQ 音乐 cookie 登录。cookie 由 Electron 内嵌登录窗口捕获后透传;浏览器
 * 调试时也可手动传入。
 */
export async function loginQqCookie(
  cookie: string,
  uin?: string,
  extraCookies?: Record<string, string>,
): Promise<{ success: boolean; user: AuthUser }> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/qq/cookie`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie, uin, extraCookies }),
    }),
  );
}

/** 按关键词搜索(歌手 / 歌名)。当前仅 QQ 支持。 */
export async function searchTracks(provider: MusicProvider, q: string): Promise<Track[]> {
  const res = await json<{ items: Track[] }>(
    await fetchWithToken(
      `${API_BASE}/music/search?provider=${provider}&q=${encodeURIComponent(q)}`,
      { credentials: 'include' },
    ),
  );
  return res.items;
}

/** 付费分类层级（镜像 server/types.ts 的 VipCategory）。SourceChip 据此显示
 *  [P]/[NP] 标签：paid-album → 黄色（QQ）/ 红色（netease）背景 + tag。 */
export type VipCategory = 'paid-album' | 'paid-track' | 'vip-only' | 'vip-month';

/** 单平台 ❤ 计数（前端镜像 server SourceInfo.likeCount）。HUD D.1 累加用。 */
export interface SourceLikeCount {
  /** 精确数字（QQ 来自 m_numbers；网易云来自 likedCount） */
  count: number;
  /** UI 显示字符串（QQ 来自 m_show；网易云 = count.toLocaleString()） */
  display: string;
  /** 平台名（debug / 上标 tooltip 用） */
  source: 'qq' | 'netease';
}

/** 跨平台 ❤ 累加（server UnifiedSearchItem.crossPlatformLikeTotal 镜像）。
 *  HUD 紧凑显示：`QQ 数字¹ + 网易云 数字²`。
 *  undefined = 全部 source 都没 likeCount（避免和"0"混淆）。 */
export interface CrossPlatformLikeTotal {
  count: number;
  display: string;
  /** 累加来源平台列表（顺序 = sources 顺序），用于上标 ¹/² 渲染 */
  platforms: Array<'qq' | 'netease'>;
  /** 逐项展示串。HUD 要 `5700w+¹ + 2,500²`——上标紧跟各自分数；display 那条
   *  拼好的串做不到（会渲染成 `5700w+ + 2,500¹²`，上标全粘末尾）。
   *  顺序 = sources 序。老数据可能没有（服务端未升级）→ HUD 兜回单块 display。 */
  parts?: Array<{ platform: 'qq' | 'netease'; display: string }>;
}

/** 统一搜索结果里每个平台的源信息（服务端 SourceInfo 的前端镜像）。 */
export interface UnifiedSourceInfo {
  platform: MusicProvider;
  trackId: string;
  hasCopyright: boolean;
  url: string;
  mediaMid?: string;
  /** 当前会话大概率放不了全曲（VIP 独占 / 付费 / 只给试听）。服务端已据此选
   *  bestSource；客户端跨平台降级/升级时也可用它避开锁源。 */
  vipLocked?: boolean;
  /** 付费分类（付费专辑 / 付费单曲 / VIP 独占 / 会员月费）。和 vipLocked 配对：
   *  - vipLocked=true → chip 加 [NP]（未购）
   *  - vipLocked=false + paid-album → chip 加 [P]（已购或 VIP 解锁，tooltip 说明）
   *  - 其他 vipLocked=0 → 不加标签 */
  vipCategory?: VipCategory;
  /**
   * 这条源**没有任何可播放音频**（跟 vipLocked 的"只给 30s"不是一回事）。
   * Spotify 自 2024-11 起对多数应用停发 `preview_url`，这类曲目走
   * `/music/stream/spotify/:id` 必定 502，`<audio>` 静默卡在 00:00。
   * Premium + WPS 已连时另有全曲通道 → 见 `isPlayableEntry(entry, wpsReady)`。
   */
  noPreview?: boolean;
  /** 歌曲在该平台被 ❤ 数（公开匿名拉）。只 QQ + 网易云会填；详见
   *  `specs/cross-platform-likes`。 */
  likeCount?: SourceLikeCount;
}

/** 统一搜索结果（去重合并后）单条。 */
/** 单一录音版本（同 (key, type) 内一个 duration cluster = 一个版本）。镜像 server。 */
export interface VersionEntry {
  id: string;
  duration: number;
  sources: UnifiedSourceInfo[];
  bestSource: MusicProvider | null;
  /** UI 标签（Phase 3 可加）。Phase 2 留空。 */
  label?: string;
  /** 该版本的原始元数据（server: cluster 内 PLAY_PRIORITY 代表 track）。
   *  UI 展开多版本时逐行显示，让用户能区分 `盲选 1:20` / `盲选 (Live) 4:47`。
   *  可选：老缓存 / 单平台搜索路径没有这些字段，UI 回退到 item 级元数据。 */
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
}

export interface UnifiedSearchItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  sources: UnifiedSourceInfo[];
  bestSource: MusicProvider | null;
  /** 录音版本类型（[LIVE] / [ACOUSTIC] / [REMIX] / [INSTRUMENTAL]）。
   *  studio 不显示角标。 */
  versionType: 'studio' | 'live' | 'acoustic' | 'remix' | 'instrumental';
  /** Phase 2：同 (key, type) 内的多个录音版本（不同 duration / 不同录音 master）。
   *  默认折叠时 item.sources/bestSource/duration = versions[0]（最短版本）；UI
   *  toggle "显示所有版本" 打开后展开每个 version 为可独立播放的一行。 */
  versions: VersionEntry[];
  /** UI 角标显示用：用户在哪些平台 ❤ 了这首歌（import + 运行时 fanOut 合并）。
   *  缺失时回退到 sources.map(s => s.platform)。 */
  likedPlatforms?: MusicProvider[];
  /** 跨平台 ❤ 累加 = QQ + 网易云 likeCount 之和。HUD D.1 紧凑加号 + 上标读这个。
   *  详见 `specs/cross-platform-likes`。undefined = 全部 source 都没拉到。 */
  crossPlatformLikeTotal?: CrossPlatformLikeTotal;
}

/** 统一搜索的整页响应。 */
export interface UnifiedSearchResult {
  q: string;
  total: number;
  page: number;
  pageSize: number;
  items: UnifiedSearchItem[];
}

/**
 * 跨平台统一搜索。服务端同时查 QQ / 网易云 / Deezer，合并去重后分页返回。
 * 单平台失败不阻塞其他平台——items 仍可能非空，errors 在 server log 里有。
 *
 * 取消支持：传入 AbortSignal 即可中断进行中的请求。debounce 重新触发时
 * 把上一次的 controller abort() 掉，避免旧响应覆盖新结果。
 */
export async function searchUnified(
  q: string,
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<UnifiedSearchResult> {
  const params = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
  });
  return json<UnifiedSearchResult>(
    await fetchWithToken(`${API_BASE}/music/search?${params.toString()}`, {
      credentials: 'include',
      signal,
    }),
  );
}

// ── 专辑搜索（spec: specs/album-search） ───────────────────────

/** 单个平台上的一个专辑（服务端 `AlbumSource` 的前端镜像）。 */
export interface AlbumSource {
  platform: MusicProvider;
  albumId: string;
  title: string;
  artist: string;
  coverUrl: string;
  /** 曲目数。0 = 平台没给，不是"空专辑"。 */
  trackCount: number;
  /** 发行年份。0 = 未知。 */
  year: number;
  rank: number;
}

/** 跨平台合并后的专辑卡片（服务端 `UnifiedAlbum` 的前端镜像）。 */
export interface UnifiedAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  trackCount: number;
  year: number;
  sources: AlbumSource[];
  /**
   * 各平台曲目数分歧 >50% → 未跨平台合并。UI 要打角标提示"这可能是不同版本"。
   * 见 specs/album-search「跨平台合并」节。
   */
  variantMismatch?: boolean;
  /**
   * 用户在哪些平台**收藏了这张专辑**（spec: specs/album-fanout）。
   *
   * 只含真实写入成功的平台 —— 结构性跳过（没能力 / 未登录）不在其中。
   * undefined = 没收藏过。
   *
   * 服务端注入走两路：item.id 精确 key + sources 的 platform:albumId 重合
   * （兜住 mergedId 漂移）。已按平台去重，可直接当角标数字用。
   */
  savedPlatforms?: MusicProvider[];
}

export interface UnifiedAlbumSearchResult {
  q: string;
  total: number;
  page: number;
  pageSize: number;
  items: UnifiedAlbum[];
  /** 失败的平台。缺席（未实现/未登录）不在此列。 */
  errors?: Partial<Record<MusicProvider, string>>;
}

/**
 * 跨平台专辑搜索。契约与 `searchUnified` 一致：单平台失败仍返 200 +
 * `errors` 字段，缺席的平台不算失败。
 */
export async function searchAlbums(
  q: string,
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<UnifiedAlbumSearchResult> {
  const params = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
  });
  return json<UnifiedAlbumSearchResult>(
    await fetchWithToken(`${API_BASE}/music/albums/search?${params.toString()}`, {
      credentials: 'include',
      signal,
    }),
  );
}

/**
 * 拉一张专辑的曲目，**服务端已跨平台合并**成 `UnifiedSearchItem[]`
 * （含 versions/bestSource）—— renderer 不再自己合并，否则等于把
 * buildUnifiedItems 的逻辑复制一份到前端。
 *
 * 只有 qq / deezer 支持（网易云被 -462 反爬挡住、Spotify 缺 token，
 * 见 specs/album-search 阻塞项 B1/B2），其余平台服务端返 400。
 */
export async function fetchAlbumTracks(
  provider: MusicProvider,
  albumId: string,
  signal?: AbortSignal,
): Promise<UnifiedSearchItem[]> {
  const res = await json<{ items: UnifiedSearchItem[] }>(
    await fetchWithToken(
      `${API_BASE}/music/albums/${provider}/${encodeURIComponent(albumId)}/tracks`,
      { credentials: 'include', signal },
    ),
  );
  return res.items;
}

/**
 * 专辑 fan-out：把「收藏这张专辑」写到所有有收藏专辑能力且已登录的平台。
 *
 * `fannedOutTo` 的粒度是平台：收藏方向 = 真实写入成功的平台；取消方向 =
 * **该平台名下记录全部撤干净**的平台（同平台可能挂多条 albumId —— 平台侧
 * 换了专辑 id —— 撤一半不算取消成功，角标不能灭）。
 *
 * 结构性跳过（没能力 / 未登录）不在里面，所以 UI 角标不能拿它当"已收藏
 * 平台数"用，得用搜索结果里的 `savedPlatforms`。
 */
export async function fanOutAlbumSave(
  mergedAlbumId: string,
  sources: Array<{
    platform: MusicProvider;
    albumId: string;
    title?: string;
    artist?: string;
    year?: number;
    /**
     * 该平台这张专辑的曲目数。服务端用它做**曲目数分歧守卫**（同名同艺人
     * 同年份但曲目数差 >50% = EP vs LP / 豪华版 → 不是同一张专辑）。
     * 不传 = 服务端不判分歧（可能选错专辑）。
     */
    trackCount?: number;
  }>,
  saved: boolean,
): Promise<{ success: boolean; saved: boolean; fannedOutTo: MusicProvider[] }> {
  return json(
    await fetchWithToken(`${API_BASE}/music/album/save/merged`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mergedAlbumId, sources, saved }),
    }),
  );
}

/**
 * 单平台专辑收藏/取消收藏（不走 fan-out）。
 *
 * ⚠️ **raw 操作，不落账**：单平台端点拿不到统一专辑键 → 写完远端没有本地
 * 记录 → 角标不亮、也无法用 fan-out 端点撤销。**优先用 `fanOutAlbumSave()`**。
 * 本仓库 UI 目前只用 fan-out 版本，这条留着给将来的单平台入口用。
 */
export async function toggleAlbumSave(
  provider: MusicProvider,
  albumId: string,
  saved: boolean,
): Promise<{ success: boolean; saved: boolean }> {
  return json(
    await fetchWithToken(
      `${API_BASE}/music/album/save/${encodeURIComponent(albumId)}?provider=${provider}&saved=${saved}`,
      { method: 'POST', credentials: 'include' },
    ),
  );
}

/**
 * 单平台搜索。返回的是服务端 Track[]，转成 UnifiedSearchItem[] 让 SearchPanel
 * 渲染管线不用分支。sources 仅含选中的那一个平台。
 *
 * 用例：SearchPanel 顶部 source 切换条选了某个平台时只走单平台，不再 fan-out。
 */
export async function searchOne(
  provider: MusicProvider,
  q: string,
  signal?: AbortSignal,
): Promise<UnifiedSearchItem[]> {
  const params = new URLSearchParams({ provider, q });
  const res = await json<{ items: Track[] }>(
    await fetchWithToken(`${API_BASE}/music/search?${params.toString()}`, {
      credentials: 'include',
      signal,
    }),
  );
  return res.items.map((t): UnifiedSearchItem => {
    const source: UnifiedSourceInfo = {
      platform: t.provider,
      trackId: t.id,
      hasCopyright: true,
      url: t.audioUrl,
      ...(t.mediaMid ? { mediaMid: t.mediaMid } : {}),
      ...(t.vipLocked !== undefined ? { vipLocked: t.vipLocked } : {}),
      ...(t.noPreview ? { noPreview: true } : {}),
    };
    return {
      id: `${t.provider}:${t.id}`,
      title: t.title,
      artist: t.artist,
      album: t.album,
      coverUrl: t.coverUrl,
      duration: t.duration,
      bestSource: t.provider,
      // 单平台搜索结果没有 versionType 分类（接口返回原始 Track），默认 studio。
      // 跨平台 searchUnified 由服务端 classifyVersion 标注。
      versionType: 'studio',
      // 单平台结果没有多版本概念，versions 填一条指向自己。注意不能留空：
      // SearchPanel.handleRowClick 播的是 item.versions[0]（不变量 =
      // versions[0] 即主版本），空数组会让行点击静默无效（单曲结果点不播）。
      versions: [
        {
          id: `${t.provider}:${t.id}:v0`,
          duration: t.duration,
          sources: [source],
          bestSource: t.provider,
          title: t.title,
          artist: t.artist,
          album: t.album,
          coverUrl: t.coverUrl,
        },
      ],
      sources: [source],
    };
  });
}

/**
 * 实时跨平台匹配：当前 track（provider + 元数据）播放失败（code=4）时，请求
 * 服务端去其余已登录平台搜同名同时长的等价曲目，拿一个可直接播放的 source
 * 回来。找不到返回 null。严格匹配（歌名+歌手+时长 ±3s）在服务端做。
 *
 * `excludeId`（当前挂掉的曲目 id）：服务端会先做「同平台换版本」兜底——同一
 * 首歌常有多个 songmid（专辑版需单购 vs 单曲版可播），排除死 mid 重新匹配
 * 并实探过流后才返回。
 *
 * `reason`：找不到时附带的失败分类，前端据此给分级文案：
 *  - vip-locked：找到了歌但全部候选都是 VIP 锁
 *  - stream-failed：同平台换到版本但实探不出流
 *  - no-match：其它平台连候选都没搜到
 */
export type EquivalentFailReason = 'vip-locked' | 'stream-failed' | 'no-match';

export interface EquivalentSourceResult {
  source: UnifiedSourceInfo | null;
  reason: EquivalentFailReason | null;
}

export async function findEquivalentSource(
  provider: MusicProvider,
  meta: LikeMeta,
  excludeId?: string,
): Promise<EquivalentSourceResult> {
  const params = new URLSearchParams({
    provider,
    title: meta.title,
    artist: meta.artist,
    duration: String(meta.duration),
  });
  if (excludeId) params.set('trackId', excludeId);
  const res = await json<{
    source: UnifiedSourceInfo | null;
    reason?: EquivalentFailReason | null;
  }>(
    await fetchWithToken(`${API_BASE}/music/equivalents?${params.toString()}`, {
      credentials: 'include',
    }),
  );
  return { source: res.source ?? null, reason: res.reason ?? null };
}

/**
 * 把 UnifiedSearchItem 解析成可播放的 Track：按 bestSource（已有版权 + 优先级
 * 最高）取对应的 source，把 platform-specific 的 id / audioUrl / mediaMid
 * 拼回标准 Track 形状。bestSource 为 null 表示「所有平台都无版权」，返回
 * null 让 UI 走灰色不可播放态。
 */
/**
 * 这条源在 `<audio>` 里能不能出声。
 *
 * `hasCopyright=false` 是"平台没这首歌的版权"；`noPreview=true` 是"有这首歌，
 * 但拿不到任何音频字节"——Spotify 停发 `preview_url` 后，代理只能回 502，
 * `<audio>` 连 MediaError 都不一定给，UI 就停在 00:00 假装在播。
 *
 * `wpsReady`（Premium + Web Playback SDK 已连）时 Spotify 走 SDK 全曲流、
 * 不经 `<audio>`，此时 noPreview 不影响可播性。
 */
export function isSourcePlayable(
  src: Pick<UnifiedSourceInfo, 'platform' | 'hasCopyright' | 'noPreview'>,
  wpsReady = false,
): boolean {
  if (!src.hasCopyright) return false;
  if (src.platform === 'spotify' && src.noPreview && !wpsReady) return false;
  return true;
}

/**
 * item（或某个 version）在当前运行态下有没有能出声的源。
 *
 * **SearchPanel 的行可点性与 `parsePlayableQueue` 的丢弃判定必须共用它**——
 * 两边口径一旦分裂就会出现「行看起来能点、点了队列里却没有这首」的静默失败
 * （正是 Spotify 独占行点了没反应的那类 bug）。
 *
 * 第一条分支对齐 `parsePlayableQueue`：WPS 已连时 Spotify 源优先接管，
 * 服务端给的 bestSource 是 `<audio>` 路径的选择，这里不用看。
 */
export function isPlayableEntry(
  entry: Pick<UnifiedSearchItem, 'bestSource' | 'sources'>,
  wpsReady = false,
): boolean {
  return playableReason(entry, wpsReady) === null;
}

/** 不可播的原因（决定 SearchPanel 怎么跟用户解释）。 */
export type UnplayableReason = 'no-copyright' | 'spotify-no-preview' | 'no-source';

/** 这条为什么不可播的人类可读原因（与 isSourcePlayable 同一条流水线）。 */
const UNPLAYABLE_TEXT: Record<UnplayableReason, string> = {
  'no-copyright': '所有平台都无版权',
  'spotify-no-preview': '只有 Spotify 源且无 30s 预览：需切到 Spotify 音源用 Premium 全曲播放',
  'no-source': '当前没有可播的音源',
};

/**
 * 不可播原因（null = 可播）。
 *
 * **为什么要有它**：SearchPanel 的行置灰和 tooltip 文案必须来自**同一个**判定。
 * 之前两者各判一次（`isPlayableEntry` 判真假、`bestSource !== null` 猜原因），
 * 于是"QQ 源无版权"也会被说成"只有 Spotify 源"—— 文案与事实不符。现在
 * `isPlayableEntry` 是本函数的薄封装，判定与解释天然同源。
 */
export function playableReason(
  entry: Pick<UnifiedSearchItem, 'bestSource' | 'sources'>,
  wpsReady = false,
): UnplayableReason | null {
  if (wpsReady && entry.sources.some((s) => s.platform === 'spotify')) {
    return null;
  }
  const src = entry.bestSource
    ? entry.sources.find((s) => s.platform === entry.bestSource)
    : undefined;
  if (src) {
    // 先分无版权：它比"没音频"更基础，且与平台无关
    if (!src.hasCopyright) return 'no-copyright';
    if (src.platform === 'spotify' && src.noPreview && !wpsReady) {
      return 'spotify-no-preview';
    }
    return null;
  }
  // 定位不到 bestSource（为 null，或指向一个不存在的源）→ 不可播，但原因要分清：
  // 所有源都无版权 → 说"无版权"（这是更常见也更该解释的那个）；否则才是"没源"。
  if (entry.sources.length > 0 && entry.sources.every((s) => !s.hasCopyright)) {
    return 'no-copyright';
  }
  return 'no-source';
}

/** 不可播原因的用户可见文案；可播时返回 null。 */
export function unplayableText(
  entry: Pick<UnifiedSearchItem, 'bestSource' | 'sources'>,
  wpsReady = false,
): string | null {
  const reason = playableReason(entry, wpsReady);
  return reason === null ? null : UNPLAYABLE_TEXT[reason];
}

export function pickPlayableTrack(item: UnifiedSearchItem): Track | null {
  if (!item.bestSource) return null;
  const src = item.sources.find((s) => s.platform === item.bestSource);
  if (!src) return null;
  return {
    id: src.trackId,
    provider: src.platform,
    title: item.title,
    artist: item.artist,
    album: item.album,
    coverUrl: item.coverUrl,
    audioUrl: src.url,
    duration: item.duration,
    liked: false,
    mediaMid: src.mediaMid,
  };
}

export interface DeezerEditorial {
  id: number;
  name: string;
  region?: string;
}

export async function fetchDeezerEditorials(): Promise<DeezerEditorial[]> {
  const res = await fetchWithToken(`${API_BASE}/music/deezer/editorials`, {
    credentials: 'include',
  });
  const json_ = (await res.json()) as { items: DeezerEditorial[] };
  return json_.items;
}

export async function logout(provider: MusicProvider): Promise<void> {
  await fetchWithToken(`${API_BASE}/auth/logout?provider=${provider}`, {
    credentials: 'include',
  });
}

/** DeepSeek 推荐相关 API（v1：BYO key + 跑一次推荐）。 */
export interface RecoStatus {
  configured: boolean;
  librarySize: number;
}

export interface RecoRequest {
  count?: number;
  language?: 'zh' | 'en' | 'ja' | 'auto' | string;
  mood?: string;
  /**
   * Songs to keep OUT of this batch (on top of the always-excluded library).
   * Used by the auto-continue path so the next batch doesn't replay tracks
   * already in the reco queue. Server merges these into its dedup set.
   */
  exclude?: Array<{ title: string; artist: string }>;
  /** "放点像这首的"：以某首歌为种子开推荐。 */
  seed?: { title: string; artist: string };
  /**
   * NL playlist 路径（specs/nl-playlist/ A3）：parse-intent 的产物直接喂进
   * reco.run，跳过二次意图解析。target_count / language / mood /
   * similar_artists / 排除项都从 intent 派生。
   */
  intent?: NLIntent;
  /** 按标题排除（soft，落 prompt hint）。 */
  exclude_titles?: string[];
  /** 按艺人排除（soft，落 prompt hint）。 */
  exclude_artists?: string[];
}

export interface RecoRunResult {
  items: UnifiedSearchItem[];
  model: string;
  runAt: number;
  raw?: string; // 调试用，模型原始响应（截断）
  /** 'select' = 走目录锚定候选池挑选（v2 主路径）；
   *  'generate' = 候选池不足时回退的自由生成。调试/效果对比用。 */
  mode?: 'select' | 'generate';
  /** 候选池规模（0 = 没建成池，走了自由生成）。 */
  candidateCount?: number;
}

export async function fetchRecoStatus(): Promise<RecoStatus> {
  return json(await fetchWithToken(`${API_BASE}/reco/status`, { credentials: 'include' }));
}

export async function runReco(req: RecoRequest = {}): Promise<RecoRunResult> {
  return json(
    await fetchWithToken(`${API_BASE}/reco/run`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
}

/** 行为信号类型（与服务端 `reco/signals.ts` 对齐）。 */
export type RecoSignalType = 'play' | 'complete' | 'skip' | 'like' | 'dislike' | 'seed';

/**
 * 上报一次播放行为信号（播放/完播/跳过/红心/踩）。
 *
 * **fire-and-forget**：推荐质量依赖这些信号，但播放体验绝不依赖上报是否成功
 * ——失败静默吞掉，不 setError、不阻塞切歌。
 */
export function reportRecoSignal(signal: {
  type: RecoSignalType;
  title: string;
  artist: string;
  progress?: number;
}): void {
  if (!signal.title || !signal.artist) return;
  void fetchWithToken(`${API_BASE}/reco/signal`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  }).catch(() => {
    // 静默：上报失败不该让用户看到任何东西。
  });
}

export async function saveRecoKey(apiKey: string): Promise<{ ok: true; tail: string }> {
  return json(
    await fetchWithToken(`${API_BASE}/reco/key`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    }),
  );
}

/** §5 Settings「DeepSeek key」：清掉用户存在服务端的 API key。返回 { ok: true }。 */
export async function resetRecoKey(): Promise<{ ok: true }> {
  return json(
    await fetchWithToken(`${API_BASE}/reco/key/reset`, {
      method: 'POST',
      credentials: 'include',
    }),
  );
}

/** §6.2 渠道优先级：拿当前用户的优先级 + 缺省值（renderer 首帧兜底用）。 */
export async function getChannelPriority(): Promise<{
  priority: MusicProvider[];
  default: MusicProvider[];
}> {
  return json(
    await fetchWithToken(`${API_BASE}/music/channel-priority`, {
      credentials: 'include',
    }),
  );
}

/** §6.2 渠道优先级：保存新的顺序。重复 / 未知 provider 会被服务端 400。 */
export async function setChannelPriority(
  priority: MusicProvider[],
): Promise<{ ok: true; priority: MusicProvider[] }> {
  return json(
    await fetchWithToken(`${API_BASE}/music/channel-priority`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    }),
  );
}

/** §6.2 渠道优先级：重置到 PLAY_PRIORITY（删 pref key）。 */
export async function resetChannelPriority(): Promise<{
  ok: true;
  priority: MusicProvider[];
}> {
  return json(
    await fetchWithToken(`${API_BASE}/music/channel-priority`, {
      method: 'DELETE',
      credentials: 'include',
    }),
  );
}

/** §5 源连接健康：每个平台近 24h 成功率 + 最近失败时间戳（进程内 Map）。 */
export async function fetchSourceHealth(): Promise<{
  items: Array<{
    provider: MusicProvider;
    total: number;
    successRate: number;
    lastFailureAt: number | null;
  }>;
}> {
  return json(
    await fetchWithToken(`${API_BASE}/music/source-health`, {
      credentials: 'include',
    }),
  );
}

/** §5 Settings「库管理」：清空某平台在库里的所有 liked 贡献。deezer → 400。 */
export async function clearProviderLibrary(
  provider: MusicProvider,
): Promise<{ ok: true; removed: number }> {
  return json(
    await fetchWithToken(`${API_BASE}/music/library/${encodeURIComponent(provider)}/clear`, {
      method: 'POST',
      credentials: 'include',
    }),
  );
}

/** §5 Settings「库管理」：一键清空整库（含各平台的 likeSync 队列）。 */
export async function clearAllLibraries(): Promise<{ ok: true }> {
  return json(
    await fetchWithToken(`${API_BASE}/music/library`, {
      method: 'DELETE',
      credentials: 'include',
    }),
  );
}

/** §5 Settings「平台账号」：批量拉 4 个平台的登录态 + lastValidatedAt。失败平台
 *  默认 loggedIn=false + user=null + lastValidatedAt=null，不抛错。 */
export async function fetchAuthStatusAll(): Promise<Record<MusicProvider, AuthStatusExtended>> {
  const providers: MusicProvider[] = ['qq', 'netease', 'deezer', 'spotify'];
  const out = {} as Record<MusicProvider, AuthStatusExtended>;
  await Promise.all(
    providers.map(async (p) => {
      try {
        out[p] = await getAuthStatusExtended(p);
      } catch {
        out[p] = {
          provider: p,
          loggedIn: false,
          user: null,
          lastValidatedAt: null,
        };
      }
    }),
  );
  return out;
}

/** 单个平台的"我的喜欢"导入状态。count=0 且有 error 表示该平台没拉到。 */
export interface LibrarySource {
  provider: MusicProvider;
  count: number;
  error?: string;
}

export interface LibraryImportResult {
  items: UnifiedSearchItem[];
  sources: LibrarySource[];
  importedAt: number;
}

/**
 * 触发"我的喜欢"导入：后端从各平台拉取已 ❤ 列表，合并去重后落地，返回
 * 合并结果 + 每个平台的导入状态。AI 推荐需要先有库，UI 在库为空时调它。
 */
export async function importLibrary(): Promise<LibraryImportResult> {
  return json<LibraryImportResult>(
    await fetchWithToken(`${API_BASE}/music/library/import`, {
      method: 'POST',
      credentials: 'include',
    }),
  );
}

/** 读最近一次导入的库；未导入过返回 null（后端 404）。 */
export async function getLibrary(): Promise<LibraryImportResult | null> {
  const res = await fetchWithToken(`${API_BASE}/music/library`, {
    credentials: 'include',
  });
  if (res.status === 404) return null;
  return json<LibraryImportResult>(res);
}

/** 真·扫码登录第一步：拿二维码（key + dataURL 图片）。 */
export async function startNeteaseQr(): Promise<NeteaseQrStart> {
  return json<NeteaseQrStart>(
    await fetchWithToken(`${API_BASE}/auth/netease/qr/start`, {
      method: 'POST',
      credentials: 'include',
    }),
  );
}

/** 真·扫码登录第二步：轮询扫码状态，803 时服务端已入 session。 */
export async function checkNeteaseQr(key: string): Promise<NeteaseQrCheck> {
  return json<NeteaseQrCheck>(
    await fetchWithToken(`${API_BASE}/auth/netease/qr/check?key=${encodeURIComponent(key)}`, {
      credentials: 'include',
    }),
  );
}

/**
 * Log in by submitting a MUSIC_U cookie (and optional __csrf) the user copied
 * from music.163.com DevTools. extraCookies (from Electron) carries the rest
 * of NetEase's cookies so the backend's weapi call looks identical to a real
 * browser request.
 */
export async function loginNeteaseCookie(
  musicU: string,
  csrfToken?: string,
  extraCookies?: Record<string, string>,
): Promise<{ success: boolean; user: AuthUser }> {
  return json(
    await fetchWithToken(`${API_BASE}/auth/netease/cookie`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicU, csrfToken, extraCookies }),
    }),
  );
}

export interface LyricLine {
  time: number;
  text: string;
}

/** 歌词来源——平台源或 lyrics.ovh 第三方兜底。 */
export type LyricsSource = MusicProvider | 'lyricsovh';

export interface LyricsResult {
  lines: LyricLine[];
  /** false = 纯文本歌词（无时间戳），面板不做滚动高亮/点击跳转 */
  synced: boolean;
  /** 主来源（优先级最高的贡献者） */
  source: LyricsSource;
  /** 实际贡献了行的来源（优先级降序）。length > 1 = 发生了多源合并。 */
  mergedFrom: LyricsSource[];
  /** 低优先级源补进来的行数（并集增量） */
  added: number;
  /** 文本重复被去重丢弃的行数 */
  dropped: number;
}

function sourcesParam(sources: Array<{ platform: MusicProvider; trackId: string }>): string {
  return sources.map((s) => `${s.platform}:${s.trackId}`).join(',');
}

/**
 * 多源聚合歌词（默认「合并」模式）：服务端并行拉 QQ / NetEase / Deezer 的
 * 候选源 → LRC 合并去重（并集 + 时间容差去重 + 错位源整源丢弃）→ 平台
 * 全落空才走 lyrics.ovh 兜底。
 *
 * title/artist 供第三方兜底检索；sources 是这首歌在其他平台的等价曲目。
 * `merge: false` 让服务端走旧快路径（第一个命中即返回）。
 */
export async function fetchLyrics(
  provider: MusicProvider,
  trackId: string,
  opts?: {
    title?: string;
    artist?: string;
    sources?: Array<{ platform: MusicProvider; trackId: string }>;
    merge?: boolean;
  },
): Promise<LyricsResult | null> {
  const params = new URLSearchParams({ provider, trackId });
  if (opts?.title) params.set('title', opts.title);
  if (opts?.artist) params.set('artist', opts.artist);
  if (opts?.sources && opts.sources.length > 0) {
    params.set('sources', sourcesParam(opts.sources));
  }
  if (opts?.merge === false) params.set('merge', '0');
  const res = await fetchWithToken(`${API_BASE}/music/lyrics?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    lyrics: LyricLine[] | null;
    synced?: boolean;
    source?: LyricsSource | null;
    mergedFrom?: LyricsSource[];
    added?: number;
    dropped?: number;
  };
  if (!data.lyrics || data.lyrics.length === 0) return null;
  const source = data.source ?? provider;
  return {
    lines: data.lyrics,
    synced: data.synced ?? true,
    source,
    mergedFrom: data.mergedFrom ?? [source],
    added: data.added ?? 0,
    dropped: data.dropped ?? 0,
  };
}

/** 搜索结果行的歌词可用性探测（只查平台源，命中即停，服务端有缓存）。 */
export async function fetchLyricsAvailability(
  sources: Array<{ platform: MusicProvider; trackId: string }>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (sources.length === 0) return false;
  const res = await fetchWithToken(
    `${API_BASE}/music/lyrics/availability?sources=${encodeURIComponent(sourcesParam(sources))}`,
    { credentials: 'include', signal },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { available: boolean };
  return data.available;
}

/**
 * 「换个源找歌词」按钮触发：按歌名+歌手去每个有歌词 API 的平台搜同名同 duration
 * 曲目，拿其歌词。返回 null 表示所有平台都找不到。
 */
export async function fetchLyricsByName(
  title: string,
  artist: string,
  duration: number,
): Promise<LyricsResult | null> {
  if (!title || !artist) return null;
  const params = new URLSearchParams({ title, artist });
  if (duration > 0) params.set('duration', String(duration));
  const res = await fetchWithToken(`${API_BASE}/music/lyrics/search?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    lyrics: LyricLine[] | null;
    synced?: boolean;
    source?: LyricsSource | null;
    mergedFrom?: LyricsSource[];
  };
  if (!data.lyrics || data.lyrics.length === 0) return null;
  const source = data.source ?? 'lyricsovh';
  return {
    lines: data.lyrics,
    synced: data.synced ?? true,
    source,
    mergedFrom: data.mergedFrom ?? [source],
    added: 0,
    dropped: 0,
  };
}

// ── 会话快照 备份/导出/导入 ──────────────────────────────────────────────

/** 拉整个服务端 state.json（导出时和 localStorage 一起加密打包）。 */
export async function getStateSnapshot(): Promise<{
  stateJson: Record<string, unknown>;
}> {
  return json(await fetchWithToken(`${API_BASE}/storage/state`, { credentials: 'include' }));
}

/** 把解密出来的 state.json 合并进服务端（additive，不覆盖已有红心/登录态）。 */
export async function importState(
  stateJson: Record<string, unknown>,
): Promise<{ merged: string[] }> {
  return json(
    await fetchWithToken(`${API_BASE}/storage/import`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateJson }),
    }),
  );
}

/** 立即触发一次本地备份。 */
export async function triggerBackup(): Promise<{ path: string; count: number }> {
  return json(
    await fetchWithToken(`${API_BASE}/storage/backup`, {
      method: 'POST',
      credentials: 'include',
    }),
  );
}

/** 备份目录 + 现有份数（Settings 显示用）。 */
export async function getBackupInfo(): Promise<{
  backupDir: string;
  backupCount: number;
}> {
  return json(await fetchWithToken(`${API_BASE}/storage/info`, { credentials: 'include' }));
}

/** 跨平台 ❤ 累加重算（client 镜像 — server/src/music/search.util.ts:recomputeCrossPlatformLikeTotal）。
 *  fire-and-forget 拉完 likeCount 后调一次，更新 item.crossPlatformLikeTotal。 */
export function recomputeCrossPlatformLikeTotal(item: {
  sources: Array<{ platform: string; likeCount?: SourceLikeCount }>;
  crossPlatformLikeTotal?: CrossPlatformLikeTotal;
}): void {
  const buckets = item.sources
    .filter((s) => (s.platform === 'qq' || s.platform === 'netease') && s.likeCount)
    .map((s) => s.likeCount!);
  if (buckets.length === 0) {
    delete item.crossPlatformLikeTotal;
    return;
  }
  const count = buckets.reduce((a, b) => a + b.count, 0);
  const display = buckets.map((b) => b.display).join(' + ');
  const platforms = buckets.map((b) => b.source);
  // parts 与 display 同源但保留逐项切分——HUD 要把上标插回每个数字后面。
  // ⚠️ 这份是 server/src/music/search.util.ts 的**镜像**：server 侧加字段时
  // 必须同步加，否则 fire-and-forget 走 client 路径填出来的对象没有 parts，
  // HUD 会静默退化成"一个数字 + 一串上标"。见 CLAUDE.md 跨包归一工具的约定。
  const parts = buckets.map((b) => ({ platform: b.source, display: b.display }));
  item.crossPlatformLikeTotal = { count, display, platforms, parts };
}
