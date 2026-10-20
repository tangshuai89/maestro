import { MusicProvider } from '../common/provider';
import type { ProviderSession } from '../common/session';
import type { Track } from './types';

/**
 * 专辑维度的类型。放独立文件而不是塞进 `types.ts` —— `types.ts` 是纯
 * Track/SourceInfo 家族，专辑是独立聚合根，混进去会让所有 import `types.ts`
 * 的地方都无谓地拖上专辑类型。
 *
 * 对应 spec: specs/album-search/spec.md「类型」节。
 */

/** 单个平台上的一个专辑（未跨平台合并）。 */
export interface AlbumSource {
  platform: MusicProvider;
  /** 平台内专辑 id：QQ=albumMID / 网易云=album.id / Deezer=id。 */
  albumId: string;
  /** 平台返回的专辑名（未归一；跨平台合并后取代表项的）。 */
  title: string;
  artist: string;
  coverUrl: string;
  /**
   * 曲目数。**0 = 平台没给**（不是"空专辑"）——合并算分歧时要先把 0 排除在
   * 分母外，否则"某平台没给曲目数"会被误判成"版本分歧"。
   */
  trackCount: number;
  /** 发行年份。0 = 未知。 */
  year: number;
  /** 该平台自己给的排序位次（0-based），供同分 tie-break。 */
  rank: number;
}

/** 跨平台合并后的专辑卡片。 */
export interface UnifiedAlbum {
  /** `merged-${normalizeKey(title, artist)}` 截断 —— 稳定、可做 React key。 */
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  /**
   * 各源曲目数的**中位数**（偶数取下中位）。
   * 为什么不用最大：再版/豪华版会虚高，11 首原版会被 19 首豪华版污染。
   */
  trackCount: number;
  /** 各源最早的非零年份（合辑常见 0）。 */
  year: number;
  /** 合并命中的平台。len === 1 表示平台独占。 */
  sources: AlbumSource[];
  /**
   * 各平台曲目数分歧 >50% 时置位。
   *
   * 这不只是 UI 角标：**这类专辑不参与跨平台合并**（同平台内各自成卡片），
   * 因为合并错 = 整张专辑的曲目列表是错的。实测搜「叶惠美」QQ=周杰伦 11 首 /
   * 网易云=王珏子乔 18 首（翻唱）/ Deezer=19 首，不守卫就会把翻唱并进原版。
   */
  variantMismatch?: boolean;
  /**
   * 用户当前在哪些平台**收藏了这张专辑**（fan-out 结果，spec: album-fanout）。
   *
   * 语义对齐 track 侧的 `likedPlatforms`：**只列真实写入成功的平台**。
   * 结构性跳过（平台没收藏专辑能力 / 未登录）不写 state → 不会出现在这里，
   * 避免角标虚高（"3❤"其实是 1 个平台）。
   *
   * 注入走两路（music.service.ts `searchAlbumsUnified`）：item.id 精确 key +
   * sources 的 platform:albumId 重合 —— 后者兜住 mergedId 漂移（记录在老
   * key 下）。已按平台去重。
   */
  savedPlatforms?: MusicProvider[];
}

export interface UnifiedAlbumSearchResult {
  q: string;
  total: number;
  page: number;
  pageSize: number;
  items: UnifiedAlbum[];
  /** 失败的平台。key=platform，value=错误摘要。缺席（未实现/未登录）不在此列。 */
  errors?: Partial<Record<MusicProvider, string>>;
}

/** 专辑曲目 = Track + 曲序信息。 */
export interface AlbumTrack extends Track {
  /**
   * 专辑内曲序。**undefined = 平台没给**（Deezer 就是这样）。
   *
   * 排序策略是「可得即用、缺失保序」：有 trackNumber 的按它升序，没有的
   * 保持 API 返回序。**不要**为了跨平台对齐去重排缺失方 —— 那是它在那个
   * 平台上的真实编曲顺序。
   */
  trackNumber?: number;
  /** 碟号（1-based）。0/undefined = 单碟或未给。 */
  discNumber?: number;
}

/**
 * 专辑能力的 provider 形状。**方法全部可选** —— 没实现 = 该平台在专辑
 * 搜索里缺席，service 层用 feature detection 判定。
 *
 * 为什么是独立 interface 而不是往 `common/provider.ts` 塞：
 * 那个文件里 `MusicProvider` 是一个字符串 union（`'qq'|'netease'|…`），
 * **根本没有 interface 可以扩展**。spec 原写法在此处不成立。
 * （已回写 spec「Provider 接口扩展」节）
 */
export interface AlbumProvider {
  searchAlbums?(session: ProviderSession, keyword: string, count: number): Promise<AlbumSource[]>;
  getAlbumTracks?(session: ProviderSession, albumId: string): Promise<AlbumTrack[]>;
}

/**
 * 专辑**收藏写**能力的 provider 形状（spec: specs/album-fanout）。
 *
 * 与 `AlbumProvider` 同构：**方法全部可选** —— 没实现 = 该平台在专辑收藏里
 * 缺席，service 层用 feature detection 判定（`typeof ap.saveAlbum === 'function'`）。
 *
 * 为什么不设 `hasAlbumSaveApi` 静态字段（album-fanout spec 原写法）：
 * 静态标志位与"方法是否真的实现了"会漂移 —— 改方法名/删实现时标志位不会跟着变，
 * 就会出现"声称支持但调用会崩"。feature detection 只有一种真相。
 *
 * 平台能力矩阵（2026-10）：
 *   - NetEase ✅ 收藏/取消收藏专辑（`/api/album/sub`，需登录 cookie）
 *   - QQ     ❌ 只有「收藏歌单」，没有「收藏专辑」API
 *   - Deezer ❌ 无 per-user album save API（红心也是同样原因缺席）
 *   - Spotify ⬜ 有 `PUT/DELETE /v1/me/albums`，但**未实现专辑搜索** →
 *     拿不到 Spotify 的 albumId，本期不实现（留位，等 OAuth token 到位）
 */
export interface AlbumSaveProvider {
  /**
   * 收藏 / 取消收藏一张专辑。
   *
   * 语义：这是**确保为目标态**（幂等），不是翻转 —— 重复调同一方向应返回
   * 成功（远端返回 405「操作频繁」= 目标态已达成，provider 应视为成功）。
   *
   * @param albumId 平台内的专辑 id（网易云 = 数字 id 的字符串形式）
   * @param saved true = 收藏，false = 取消收藏
   * @returns 是否达成目标态（false = 写失败，调用方据此决定是否计入角标）
   */
  saveAlbum?(session: ProviderSession, albumId: string, saved: boolean): Promise<boolean>;
}

/** 专辑 fan-out 的持久化条目：某张统一专辑在某个平台上的收藏态。
 *
 * ⚠️ 同一平台在同一个 key 下**可能出现多条不同 albumId** 的条目 —— 平台侧
 * 换了专辑 id（再版/换源）时，每一条都是我们真实写过的远端对象；取消收藏
 * 按 (platform, albumId) 逐条撤，按平台合并会制造远端孤儿（远端仍收藏、
 * 记录却没了）。角标计数时要按 platform 去重。 */
export interface AlbumFanOutEntry {
  platform: MusicProvider;
  /** 该平台内的专辑 id —— 取消收藏时要用它反写，缺了就没法撤。 */
  albumId: string;
}

/** 专辑 fan-out 端点的响应体。 */
export interface FanOutAlbumSaveResponse {
  success: boolean;
  saved: boolean;
  /**
   * 本次**真实写入/清除成功**的平台。
   *
   * 结构性跳过（平台没收藏专辑能力 / 未登录）与写失败都不在里面 —— 角标
   * 只能反映"确实收藏了"，不能虚高。
   */
  fannedOutTo: MusicProvider[];
}
