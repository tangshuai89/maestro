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
