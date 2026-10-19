import { MusicProvider } from '../common/provider';
import type { ProviderSession } from '../common/session';

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
  /**
   * 具体付费分类，给 chip 渲染 [P]/[NP] 标签用。和 vipLocked 一起返回：
   *  - vipLocked=true：用户当前被锁，需要哪种付费才能解锁
   *    （paid-album=数字专辑、paid-track=付费单曲、vip-only=VIP 独占、vip-month=会员月费）
   *  - vipLocked=false：用户当前可播，但来源仍标着历史付费类型（chip 显示 [P] 表示
   *    「是数字专辑但已购买或 VIP 解锁」——网易云这里和「真的购买」不完全等同，可能
   *    是黑胶 VIP 解锁；tooltip 解释）
   * undefined = 未知 / 免费，不显示 [P]/[NP] 标签。 */
  vipCategory?: VipCategory;
  /** 这条源**一个字节的音频都拿不到**（不是"只给 30s"，是"没有音频"）。见
   *  SourceInfo.noPreview。 */
  noPreview?: boolean;
}

/** 付费分类层级 —— 比 vipLocked 二元更细。SourceChip 用它决定加什么标签。
 *  - paid-album    : 数字专辑（QQ=price_album / pay_album；netease=fee===1）
 *  - paid-track    : 付费单曲（QQ=price_track / pay_track；netease=fee===4 或 8）
 *  - vip-only      : 平台 VIP 独占（QQ=pay_play；netease=privilege.pl≤0 且无 fee）
 *  - vip-month     : 会员月费独占（QQ=pay_month=1） */
export type VipCategory = 'paid-album' | 'paid-track' | 'vip-only' | 'vip-month';

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
  /** 付费分类（见 Track.vipCategory）。buildUnifiedItems 从 track 透传到 SourceInfo，
   * 前端 SourceChip 据此决定是否加 [P]/[NP] 标签。 */
  vipCategory?: VipCategory;
  /**
   * 这条源**没有任何可播放音频**——跟 vipLocked（"能出声但只有 30s / 音质受限"）
   * 是两回事。
   *
   * 目前唯一来源：Spotify 自 2024-11 起对多数应用停发 `preview_url`，search
   * 返回 `preview_url: null` 的曲目走 `/music/stream/spotify/:id` 必定
   * 502 `spotify_no_preview`——`<audio>` 只会静悄悄卡在 00:00（连
   * MediaError 都可能不给），用户看到的就是"点了没反应"。
   *
   * 服务端只记录事实、不做策略：Premium 用户的 WPS 全曲通道不经 `<audio>`，
   * 该源仍然能播，所以要不要把它当"不可播"由渲染端按 `wpsReady` 决定
   * （`api.ts:isPlayableEntry`）。
   */
  noPreview?: boolean;
  /**
   * 歌曲在该平台被收藏/喜欢的总数。**只** QQ + 网易云填；Deezer/Spotify 留
   * undefined（这两家平台不暴露 ❤ 公开字段——Deezer 只有 rank、Spotify 只有
   * popularity 0-100）。
   *
   * 数据源：
   *   - QQ      → `music.musicasset.SongFavRead / GetSongFansNumberById` 公开匿名
   *               接口，返回 `m_numbers`（精确）+ `m_show`（UI 格式如 "5700w+"）。
   *   - 网易云  → `/api/song/detail?ids=[id]` 公开匿名，返回 `likedCount`。
   *
   * `undefined` = 未知/未拉到（与"0"区别开）。`search.util.buildUnifiedItems`
   * 不会主动去拉，是 `music.service.searchUnified` 在返回结果后异步 fire-and-forget
   * 调 provider 的 getTrackFavCount/getTrackLikeCount 填充（带 5s 超时 + 30s/1h 缓存）。
   */
  likeCount?: {
    /** 精确数字（QQ 来自 m_numbers；网易云来自 likedCount） */
    count: number;
    /** UI 显示字符串（QQ 来自 m_show；网易云 = count.toLocaleString()） */
    display: string;
    /** 平台名（debug / 上标 tooltip 用） */
    source: 'qq' | 'netease';
  };
}

/** 单一录音版本（同 (key, type) 内一个 duration cluster = 一个版本）。 */
export interface VersionEntry {
  id: string;
  duration: number;
  sources: SourceInfo[];
  bestSource: MusicProvider | null;
  /** UI 标签（Phase 3 可加：从 main.album/title 提取"短版"/"长版"）。Phase 2 留空。 */
  label?: string;
  /**
   * 该版本的原始元数据（cluster 内按 PLAY_PRIORITY 选出的代表 track）。
   *
   * 为什么要存：UI 展开多版本时必须让用户**看清每个版本是什么**——同名同 type
   * 不代表元数据相同（`盲选` vs `盲选 (Live)`、不同专辑、不同歌手合作版、时长
   * 1:20 vs 6:07）。只显示 "v2 / 2:35" 用户没法选（用户反馈："太蠢了，把原歌名
   * 之类的都放出来"）。
   */
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
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
  /** 录音版本类型（Phase 1 of unified-search dedup redesign）：
   *  buildUnifiedItems 按 (normalizeKey, versionType) 二元组合并，同 version
   *  多个 mid/平台合并成 1 条 item；不同 version（studio/live/acoustic/remix/
   * instrumental）各自成条。UI 用 versionTypeBadge() 显示 [LIVE] 等角标。 */
  versionType: 'studio' | 'live' | 'acoustic' | 'remix' | 'instrumental';
  /** Phase 2：同 (key, type) 内的多个录音版本（不同 duration / 不同录音 master）。
   *  默认折叠时 item.sources/bestSource/duration = versions[0]（最短版本）；UI
   *  toggle "显示所有版本" 打开后展开每个 version 为可独立播放的一行。 */
  versions: VersionEntry[];
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
  /**
   * 跨平台 ❤ 累加 = Σ source.likeCount.count（只算 likeable 平台）。
   * 派生字段，不持久化——每次 `buildUnifiedItems` / `getLibrary` 时现算。
   *
   * `undefined` = 全部 source 都没 likeCount（避免和"0"混淆）。
   * HUD 读这个字段（D.1 样式：QQ + 网易云紧凑加号 + 上标）。
   * 见 `specs/cross-platform-likes`。 */
  crossPlatformLikeTotal?: {
    count: number;
    /** 全部累加项拼起来的 UI 串（"5700w+ + 2,500"），tooltip / 非 HUD 场景用 */
    display: string;
    /** 累加来源平台列表（顺序 = sources 顺序），用于上标渲染 */
    platforms: Array<'qq' | 'netease'>;
    /**
     * 逐项展示串。HUD 要的是 `5700w+¹ + 2,500²`——**每个数字后面紧跟自己的
     * 上标**，所以光有拼好的 display + platforms 无法把上标插回中间（会渲染成
     * `5700w+ + 2,500¹²`，上标全粘末尾，违反 spec 验收标准）。
     */
    parts: Array<{ platform: 'qq' | 'netease'; display: string }>;
  };
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

/**
 * 电台/榜单候选（reco 候选池用）：只要展示元信息，**不带播放源**。
 *
 * 为什么不复用 `Track`：候选池里的歌来自"别人的口味"（平台 FM / 榜单 / 相邻
 * 艺人），最终能不能在我们这边播，要由统一搜索去 QQ/网易云/Deezer 现查再回填
 * `bestSource`（reco 的填源阶段）。这里少带字段能让候选池和 provider 解耦。
 */
export interface RadioCandidate {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  provider: MusicProvider;
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

// ── 远端歌单（specs/remote-playlist）────────────────────────────────────────

/**
 * 远端歌单元信息（列表页用，不含曲目）。
 *
 * ⚠️ 刻意**不复用** `library/playlist.service.ts` 的 `Playlist`，也不复用
 * `UnifiedSearchItem`：远端歌单是「用户明确排好的、有序的、单平台的列表」，
 * 而 `UnifiedSearchItem` 是 `mergeLibrary` 跨平台去重后的**集合**语义——把歌单
 * 过一遍合并管线会打散顺序、折叠重复项，结果就不是用户那个歌单了。
 * 详见 specs/remote-playlist/spec.md §核心架构决策。
 */
export interface RemotePlaylistMeta {
  provider: MusicProvider;
  /** 平台内歌单 id（网易云 / Deezer 数字 id、QQ disstid、Spotify base62）。 */
  id: string;
  name: string;
  coverUrl: string;
  /**
   * 平台声明的总曲目数。**可能 > 实际返回条数**——QQ 会过滤失效歌曲
   * （见 `qq.provider.ts` fetchLiked 里对 `hasmore` 的注释），网易云匿名被反爬
   * 时也会少给。这里记平台口径，不记 `tracks.length`。
   */
  trackCount: number;
  /** 私有歌单（网易云 `privacy === 10`）。Deezer/Spotify 未实现时留 false。 */
  private: boolean;
}

/** 远端歌单详情 = 元信息 + **保序**曲目（顺序 === 平台返回顺序）。 */
export interface RemotePlaylist extends RemotePlaylistMeta {
  tracks: Track[];
}

/**
 * 平台歌单能力契约 —— **两个方法各自独立可选**。
 *
 * 为什么拆成两个 interface 而不是要求成对实现：QQ 只能实现读、不能实现列
 * （2026-10-15 登录态实测：8 个列目录候选 module.method 全 `500003`，见
 * specs/remote-playlist/spec.md §Phase 2 实证）。若契约要求成对，QQ 会被整
 * 个判为「不支持」，连它确实能做的读歌单也一起废掉。
 *
 * service 分别探测（`typeof p.listPlaylists === 'function'` /
 * `typeof p.fetchPlaylistTracks === 'function'`），缺失时降级而不是 500。
 */
export interface PlaylistListerProvider {
  /**
   * 列当前用户的歌单目录。未登录 → 抛 `not_logged_in`。
   * @param limit 最多返回多少个歌单（平台侧可能有自己的上限）。
   */
  listPlaylists(session: ProviderSession, limit?: number): Promise<RemotePlaylistMeta[]>;
}

export interface PlaylistReaderProvider {
  /**
   * 拉单个歌单的曲目（保序）。歌单不存在 → 抛 `playlist_not_found`。
   * @param maxTracks 硬上限。歌单容量各平台不同（网易云/QQ 1000、Spotify 10000、
   *   Deezer 5000），调用方按需 clamp。
   */
  fetchPlaylistTracks(
    session: ProviderSession,
    playlistId: string,
    maxTracks?: number,
  ): Promise<RemotePlaylist>;
}

/** 两种能力都实现的 provider（如网易云）。 */
export type PlaylistCapableProvider = PlaylistListerProvider & PlaylistReaderProvider;
