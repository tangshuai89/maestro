import { MusicProvider } from '../common/provider';

/**
 * 单条 track 元数据。统一各 provider search / fetchLiked / radio 返回形状，
 * 放 `types.ts` 而不是 `music.service.ts`（CLAUDE.md 要求类型定义放各自模块的
 * types.ts；service 文件不应被 providers 单纯为了拿 Track 类型而 import）。
 */
export interface Track {
  id: string;
  provider: MusicProvider;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  /** `/music/stream/{provider}/{id}` 相对路径，不是真实 URL —— 真实 URL 走服务端代理。 */
  audioUrl: string;
  duration: number;
  liked: boolean;
  /** QQ 取流用的 media_mid（可能 ≠ songmid），高音质 filename 需要它。 */
  mediaMid?: string;
  /** 当前会话大概率放不了全曲（VIP 独占 / 付费 / 只给试听）。见 SourceInfo.vipLocked。 */
  vipLocked?: boolean;
}

/** 单个平台上的搜索结果条目。 */
export interface SourceInfo {
  platform: MusicProvider;
  trackId: string;
  hasCopyright: boolean;
  url: string;
  /** QQ 高音质取流用 media_mid（standard 不需要，high/lossless 必须）。 */
  mediaMid?: string;
  /**
   * 当前会话在这个源上大概率**放不了全曲**（VIP 独占 / 付费 / 只给试听片段）。
   * 由 provider 从接口的付费/权限字段解析：
   *  - netease：`privilege.pl <= 0`（用户维度可播位率为 0 → 试听/无权限）
   *  - QQ：`pay.pay_play === 1`（需绿钻才能完整播放）
   * `undefined` = 未知（按可播处理）。selectBestSource 会**优先避开** vipLocked 的源，
   * 只有全部源都锁时才退回它，避免"选了 VIP 源播成 30s 试听"。 */
  vipLocked?: boolean;
}

/** 去重合并后的一条搜索结果。 */
export interface UnifiedSearchItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  sources: SourceInfo[];
  /** 推荐播放平台（按优先级 + hasCopyright 选出）。 */
  bestSource: MusicProvider | null;
  /**
   * UI 角标显示用：用户在哪些平台 ❤ 了这首歌（来自 sources.import + 运行时 fanOut）。
   * 与 `sources` 的区别：sources = 这首歌在哪些平台有可播放版本（catalog 维
   * 度，由搜索/import 决定），likedPlatforms = 用户实际 ❤ 的平台（user
   * 维度，由 import + 运行时跨平台同步决定）。两者在 import 时一致——拉的就
   * 是 ❤ 列表——但运行时 detect → fanOutLike 把 ❤ 同步到其他平台后，sources
   * 不会更新，likedPlatforms 会。库 badge 必须用 likedPlatforms 否则会
   * 漏掉运行时新增的 ❤ 平台（用户场景：Lydia 库里只显示 QQ 角标，但播放后
   * 通过 detect 已 ❤ 三端，badge 却看不到）。
   *
   * `undefined` / 缺失 = 视为 sources 平台列表（搜索结果里兼容老路径）。
   * 库（library）总是显式填好。 */
  likedPlatforms?: MusicProvider[];
}

export interface UnifiedSearchResult {
  q: string;
  total: number;
  page: number;
  pageSize: number;
  items: UnifiedSearchItem[];
}

/** 单个平台的搜索结果（provider 内部返回的 raw list + 总数）。 */
export interface ProviderSearchRaw {
  platform: MusicProvider;
  tracks: Track[];
  total: number;
  error?: string;
}

/** Heart fan-out 请求体。sources 是搜索结果里这个 merged track 的所有平台源；
 *  liked=true 时把 sources 里全部 hasCopyright=true 的写入；false 时按持久化的
 *  fanOut[mergedId] 列表反写——这样可以幂等清除，避免对"已经没喜欢的平台"误调
 *  unlike。 */
export interface FanOutLikeRequest {
  mergedId: string;
  sources: Array<{ platform: MusicProvider; trackId: string }>;
  liked: boolean;
}

/** Heart fan-out 响应。
 *  - liked=true 时 fannedOutTo = 当前 mergedId 心动过的**全部平台**（含之前
 *    单独心过的，非仅本次 flip）——UI 角标直接用它的 length，语义 = 这首歌
 *    在几个平台有 ❤。
 *  - liked=false 时 fannedOutTo = []（全部清掉）。 */
export interface FanOutLikeResponse {
  success: boolean;
  liked: boolean;
  fannedOutTo: MusicProvider[];
}
