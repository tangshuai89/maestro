import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Track } from './types';
import { ProviderSession } from '../common/session';
import { type LyricLine, parseLrc } from '../common/lyrics';
import { randomBytes } from 'node:crypto';
import { encryptRequest, decryptResponse, zzcSign } from './qq-crypto';

/** QQ 音质档位。standard=m4a(默认)，high=320mp3，lossless=flac（需会员）。 */
export type QqQuality = 'standard' | 'high' | 'lossless';
export const QQ_QUALITIES: QqQuality[] = ['standard', 'high', 'lossless'];

/**
 * QQ 音乐电台 + 流地址。
 *
 * 关键技术点：
 *   - 电台列表：c.y.qq.com 的 /radio/cgi-bin/radio_radio_user_list.fcg
 *     返回 songmid 列表
 *   - 元数据：c.y.qq.com 的 /song/fcgi-bin/song_detail_v2.fcg?songmid=xxx
 *   - 流地址：u.y.qq.com 的 /cgi-bin/musicu.fcg 走 GetVkey 命令返回 purl，
 *     拼接 ws.stream.qqmusic.qq.com/{purl}
 *
 * 注意：QQ 音乐 API 经常改版且无官方文档，下面的字段名（vkey, guid 等）来自
 * 社区逆向。本实现按当前主流模式编写；若线上行为变化，主要看
 * `getStreamUrl` 这一处。
 */

interface RadioSong {
  id: number;
  mid: string;
  name: string;
  title: string;
  subtitle?: string;
  singer?: { name: string; mid: string }[];
  album?: { name: string; mid: string };
  time_public?: string;
}

interface RadioResponse {
  code: number;
  data?: {
    songList?: RadioSong[];
  };
}

interface MusicuVkeyResponse {
  code?: number;
  req_0?: {
    code?: number;
    data?: {
      midurlinfo?: Array<{
        songmid: string;
        purl?: string;
        vkey?: string;
        errtype?: number;
      }>;
      sip?: string[];
    };
  };
}

interface SearchResponse {
  code: number;
  data?: {
    song?: {
      list?: Array<{
        mid: string;
        name?: string;
        title?: string;
        singer?: { name: string; mid: string }[];
        album?: { name: string; mid: string };
        interval?: number; // 时长（秒）
        // file.strMediaMid 是取流用的 media_mid（可能 ≠ songmid），
        // 高音质 filename 必须用它拼接。size_* 反映各音质是否可用。
        file?: {
          strMediaMid?: string;
          media_mid?: string;
          size_320mp3?: number;
          size_flac?: number;
        };
        // 付费信息：pay_play=1 表示需绿钻才能完整播放（非会员只给试听）。
        // 字段名两种写法都见过，都兜住；拿不到就当不锁（不回归）。
        pay?: { pay_play?: number; payplay?: number };
      }>;
    };
  };
}

@Injectable()
export class QqMusicProvider {
  private readonly logger = new Logger(QqMusicProvider.name);

  /** 所有 QQ 请求统一 UA（与现有 search / fetchVkey / getLyrics 保持一致）。 */
  private static readonly UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

  /** 种子电台的关键词池——老的 radio_radio_user_list.fcg 已返回 HTML 报废，
   * 改用「随机热门关键词 + 搜索」来喂一个类电台的随机流。 */
  private static readonly RADIO_SEEDS = [
    '周杰伦',
    '林俊杰',
    '邓紫棋',
    '陈奕迅',
    '李荣浩',
    '毛不易',
    '华语流行',
    '经典老歌',
    'Taylor Swift',
    '抖音热歌',
  ];

  isConfigured(session: ProviderSession | undefined): boolean {
    return Boolean(session?.qqCookie);
  }

  /**
   * 拉取用户的"我喜欢"收藏歌曲。
   *
   * 2026-08-26 重写：旧的两步走（fcg_user_created_diss 找 dirid=201 的 tid →
   * fcg_ucc_getcdinfo_byids_cp 拉歌）在 QQ 音乐 2025+ 的新登录体系下已不可靠：
   * 实测用户的 created_diss 列表里「我喜欢」不再是 dirid=201（返回 1/31~57/205
   * 等编号），旧代码直接 `return []` → 导入 QQ 恒 0 首。
   *
   * 新实现走 y.qq.com 现网 web 端自己用的 `CgiGetDiss`（musicu.fcg）：
   * `disstid=0 + dirid=201 + enc_host_uin=<euin>` 一次直达「我喜欢」歌单，
   * 不需要先找 dissid。参考 l-1124/QQMusicApi 的 UserApi.get_fav_song。
   * 实测用户 1216 首全量可翻页拉回（song_begin/song_num + hasmore）。
   *
   * euin 从登录窗口捕获的 cookie jar 里拿（`euin` cookie，形如 Ne6ANK4s7KE*）。
   * 老 session 没有 qqCookies 时从 qqCookie 字符串抠。
   *
   * 失败模式：
   *  - req_0.code === 1000 / 301 → cookie 失效 → `throw 'not_logged_in'`
   *  - 其他非零 code → 抛错让上层兜底
   *
   * 硬上限 maxTracks（默认 1000，与 NetEase 对齐）。
   */
  async fetchLiked(
    session: ProviderSession,
    maxTracks = 1000,
  ): Promise<Track[]> {
    if (!this.isConfigured(session)) return [];

    const cookie = session.qqCookie ?? '';
    const euin =
      session.qqCookies?.euin ??
      /(?:^|;\s*)euin=([^;]+)/.exec(cookie)?.[1] ??
      '';

    interface CgiGetDissSong {
      mid?: string;
      name?: string;
      title?: string;
      singer?: { name: string; mid: string }[];
      album?: { name: string; mid: string };
      interval?: number;
      file?: { media_mid?: string; strMediaMid?: string };
      pay?: { pay_play?: number; payplay?: number };
    }

    const PAGE = 1000;
    const collected: Track[] = [];
    let begin = 0;
    for (;;) {
      if (collected.length >= maxTracks) break;
      const num = Math.min(PAGE, maxTracks - collected.length);
      const body = {
        comm: { ct: 24, cv: 0 },
        req_0: {
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: {
            disstid: 0,
            dirid: 201,
            tag: true,
            song_begin: begin,
            song_num: num,
            userinfo: true,
            orderlist: true,
            enc_host_uin: euin,
          },
        },
      };
      const r = await fetch(
        'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&inCharset=utf8&outCharset=utf-8',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': QqMusicProvider.UA,
            Referer: 'https://y.qq.com/',
            Cookie: cookie,
          },
          body: JSON.stringify(body),
        },
      );
      const j = (await r.json()) as {
        code?: number;
        req_0?: {
          code?: number;
          data?: {
            songlist?: CgiGetDissSong[];
            hasmore?: boolean;
            total_song_num?: number;
          };
        };
      };
      const reqCode = j.req_0?.code ?? j.code;
      if (reqCode === 1000 || reqCode === 301) {
        throw new BadRequestException('not_logged_in');
      }
      if (reqCode !== 0) {
        throw new BadRequestException(
          `QQ CgiGetDiss failed: code=${reqCode}`,
        );
      }
      const songlist = j.req_0?.data?.songlist ?? [];
      if (songlist.length === 0) break;
      collected.push(
        ...songlist
          .filter((s) => s.mid)
          .map((s) => ({
            id: s.mid as string,
            provider: 'qq' as const,
            title: s.name ?? s.title ?? '未知歌曲',
            artist: s.singer?.map((x) => x.name).join(' / ') ?? '未知艺人',
            album: s.album?.name ?? '',
            coverUrl: s.album?.mid
              ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${s.album.mid}.jpg`
              : '',
            audioUrl: '', // 由 getStreamPath 在播放时动态获取
            duration: s.interval ?? 0,
            liked: true, // 来源就是"我喜欢"，全部视为已 ❤
            mediaMid: s.file?.media_mid ?? s.file?.strMediaMid ?? '',
          })),
      );
      const hasmore = j.req_0?.data?.hasmore ?? false;
      // 注意：不能用 `songlist.length < num` 判末页——QQ 会过滤失效歌曲
      // （响应里的 filtered_song / invalid_song），请求 1000 可能只回几百首但
      // hasmore 仍为 true。只信 hasmore + 空页两个信号。
      if (songlist.length === 0 || !hasmore) break; // 末页
      // song_begin 是按「请求页大小」推进的偏移（与 l-1124/QQMusicApi 的
      // OffsetStrategy 同口径），不是按实际返回数——否则过滤后再翻页会漏歌。
      begin += num;
    }

    this.logger.log(`QQ fetchLiked → ${collected.length} 首`);
    return collected.slice(0, maxTracks);
  }

  /**
   * QQ g_tk = DJB2(skey)。公式：hash = 5381; hash = hash*33 + charCode;
   * unsigned 32-bit via >>> 0。参考 Tencent web_player 的 `getHash`。
   * 如果 skey 为空（未登录 / 老 session 无 qqCookies） → 返回 '5381'
   * （即 DJB2 of ""），与 `getLyrics` 已用的字面值一致。
   */
  private computeGtk(skey: string): string {
    let hash = 5381;
    for (let i = 0; i < skey.length; i++) {
      hash = ((hash << 5) + hash + skey.charCodeAt(i)) >>> 0;
    }
    return String(hash);
  }

  private getGtk(session: ProviderSession): string {
    const skey = session.qqCookies?.skey ?? session.qqCookies?.p_skey;
    return skey ? this.computeGtk(skey) : '5381';
  }

  // ── 收藏「我喜欢」（写操作，走加密通道） ─────────────────────

  /** 从 cookie 里取 qm_keyst（加密通道鉴权用）。 */
  private getQmKeyst(session: ProviderSession): string | undefined {
    if (session.qqCookies?.qm_keyst) return session.qqCookies.qm_keyst;
    // 兜底：从拼好的 cookie 头里抠
    const m = /(?:^|;\s*)qm_keyst=([^;]+)/.exec(session.qqCookie ?? '');
    return m?.[1];
  }

  /**
   * 走 QQ 音乐 web 端的加密+签名通道调 musics.fcg（写操作专用）。
   * 明文 musicu.fcg 对写操作返回 500026，只有这条加密通道能通。
   * 返回解密后的 req_0（{ code, data }）。
   */
  private async musicsEncPost(
    session: ProviderSession,
    module: string,
    method: string,
    param: Record<string, unknown>,
    tsMs: number,
  ): Promise<{ code?: number; data?: unknown } | undefined> {
    const uin = session.qqUin ?? '';
    const qmKeyst = this.getQmKeyst(session);
    const reqData = {
      comm: {
        cv: 4747474,
        ct: 24,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 1,
        uin: Number(uin) || 0,
        g_tk_new_20200303: 1083888122,
        g_tk: 1083888122,
      },
      req_0: { module, method, param },
    };
    const json = JSON.stringify(reqData);
    const sign = zzcSign(json);
    const body = encryptRequest(reqData);
    const url =
      `https://u6.y.qq.com/cgi-bin/musics.fcg?_=${tsMs}` +
      `&encoding=ag-1&sign=${sign}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Accept: 'application/octet-stream',
        'User-Agent': QqMusicProvider.UA,
        Referer: 'https://y.qq.com/',
        Cookie: `qm_keyst=${qmKeyst ?? ''}; uin=${uin}`,
      },
      body,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = decryptResponse(buf);
    const parsed = JSON.parse(text) as {
      req_0?: { code?: number; data?: unknown };
    };
    return parsed.req_0;
  }

  /**
   * 把 songmid 解析成数字 songId（加密写接口要 songId，而我们播放队列里
   * 存的是 songmid）。走 musicu 的 song_detail 模块。失败返回 null。
   */
  async resolveSongId(
    session: ProviderSession,
    songmid: string,
  ): Promise<number | null> {
    const body = {
      comm: { ct: 24, cv: 0 },
      req_0: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_mid: songmid },
      },
    };
    try {
      const r = await fetch(
        'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&inCharset=utf8&outCharset=utf-8',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': QqMusicProvider.UA,
            Referer: 'https://y.qq.com/',
            Cookie: session.qqCookie ?? '',
          },
          body: JSON.stringify(body),
        },
      );
      const j = (await r.json()) as {
        req_0?: { data?: { track_info?: { id?: number } } };
      };
      return j.req_0?.data?.track_info?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `QQ resolveSongId failed for ${songmid}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 收藏一首歌到「我喜欢」（dirId=201）。幂等：已收藏的再调也无害。
   * @param songmid 播放队列里的 QQ trackId（songmid）
   * @param tsMs    时间戳（签名 URL 用；由调用方传入，便于测试/复现）
   */
  async like(
    session: ProviderSession,
    songmid: string,
    tsMs: number,
  ): Promise<boolean> {
    return this.setFav(session, songmid, true, tsMs);
  }

  /** 从「我喜欢」移除一首歌（DelSonglist）。 */
  async unlike(
    session: ProviderSession,
    songmid: string,
    tsMs: number,
  ): Promise<boolean> {
    return this.setFav(session, songmid, false, tsMs);
  }

  private async setFav(
    session: ProviderSession,
    songmid: string,
    fav: boolean,
    tsMs: number,
  ): Promise<boolean> {
    const songId = await this.resolveSongId(session, songmid);
    if (!songId) {
      this.logger.warn(`QQ setFav: cannot resolve songId for ${songmid}`);
      return false;
    }
    const req = await this.musicsEncPost(
      session,
      'music.musicasset.PlaylistDetailWrite',
      fav ? 'AddSonglist' : 'DelSonglist',
      { dirId: 201, v_songInfo: [{ songType: 0, songId }] },
      tsMs,
    );
    const ok = req?.code === 0;
    if (!ok) {
      this.logger.warn(
        `QQ setFav(${fav}) ${songmid} → req code=${req?.code ?? 'n/a'}`,
      );
    }
    return ok;
  }

  /**
   * 拉「我喜欢」里所有 songmid 的集合（给 isLiked 检查用）。复用 fetchLiked。
   * 注意：调用方应缓存，别每次切歌都拉（1000+ 首）。
   */
  async fetchLikedMidSet(session: ProviderSession): Promise<Set<string>> {
    const tracks = await this.fetchLiked(session, 2000);
    return new Set(tracks.map((t) => t.id));
  }

  /**
   * 取一批"电台"歌曲。老的电台接口已废（返回 HTML），这里退化为
   * 「随机热门关键词 → 搜索 → 打乱」的种子电台，保证 /music/next 恒有结果。
   */
  async fetchRadioBatch(
    session: ProviderSession,
    _radioId?: number,
    count = 10,
    // ISSUES.md §3.3：rng 注入让单测断言「种子 X → 列表 Y」；不传时
    // 退化为 Math.random（生产路径行为不变）。
    rng: () => number = Math.random,
  ): Promise<Track[]> {
    const seeds = QqMusicProvider.RADIO_SEEDS;
    const seed = seeds[Math.floor(rng() * seeds.length)];
    const tracks = await this.search(session, seed, 20);
    QqMusicProvider.shuffle(tracks, rng);
    this.logger.log(`QQ radio(seed="${seed}") → ${tracks.length} 首`);
    return tracks.slice(0, count).map((t) => ({
      ...t,
      audioUrl: '', // 由 getStreamUrl 在播放时动态获取
    }));
  }

  /**
   * Fisher–Yates in-place 打乱。可注入 rng 让单测断言顺序；不传时用
   * Math.random（生产路径行为不变）。ISSUES.md §3.3。
   */
  private static shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 按关键词（歌手 / 歌名）搜索。这是产品核心入口：搜歌手 → 出歌单 →
   * 点播放走 getStreamPath 出全曲流。搜索本身不强制登录态，但带上 cookie
   * 无害（会影响个性化结果）。
   */
  async search(
    session: ProviderSession,
    keyword: string,
    count = 20,
  ): Promise<Track[]> {
    const url = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp');
    url.searchParams.set('w', keyword);
    url.searchParams.set('p', '1');
    url.searchParams.set('n', String(count));
    url.searchParams.set('format', 'json');
    url.searchParams.set('cr', '1'); // 中文
    url.searchParams.set('t', '0'); // 0 = 单曲
    url.searchParams.set('flag_qc', '0');
    url.searchParams.set('new_json', '1'); // 返回结构化 data.song.list

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://y.qq.com/',
        Cookie: session.qqCookie ?? '',
      },
    });
    const json = (await res.json()) as SearchResponse;
    if (json.code !== 0) {
      throw new BadRequestException(`QQ search failed: code=${json.code}`);
    }
    const list = json.data?.song?.list ?? [];
    this.logger.log(`QQ search "${keyword}" → ${list.length} 首`);
    return list.map((s) => ({
      id: s.mid,
      provider: 'qq' as const,
      title: s.name ?? s.title ?? '未知歌曲',
      artist: s.singer?.map((x) => x.name).join(' / ') ?? '未知艺人',
      album: s.album?.name ?? '',
      coverUrl: s.album?.mid
        ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${s.album.mid}.jpg`
        : '',
      audioUrl: '', // 播放时由 getStreamPath 动态获取
      duration: s.interval ?? 0,
      liked: false,
      mediaMid: s.file?.strMediaMid ?? s.file?.media_mid ?? '',
      // pay_play=1 = 这首需绿钻才能完整播放。但能不能播全曲取决于**当前用户**是不是
      // 绿钻：绿钻用户照样全曲 → 不标锁；非绿钻（或未知/未登录）→ 标 vipLocked，选源时避开。
      vipLocked:
        (s.pay?.pay_play ?? s.pay?.payplay) === 1 && session.qqVip !== true,
    }));
  }

  /**
   * 取歌曲的播放 URL。QQ 的播放 URL 几分钟就过期，所以**必须**在用户
   * 即将播放时实时拉，不缓存。返回相对路径 /music/stream/qq/{mid}，
   * 让前端统一走后端代理，前端永远拿不到 raw URL。
   */
  /** 音质档位 → GetVkey filename 的前缀 / 扩展名。standard 用默认 m4a。 */
  private static readonly QUALITY: Record<
    QqQuality,
    { prefix: string; ext: string } | null
  > = {
    standard: null, // 默认 C400 m4a，不传 filename
    high: { prefix: 'M800', ext: '.mp3' }, // 320 kbps
    lossless: { prefix: 'F000', ext: '.flac' }, // flac 无损
  };

  async getStreamPath(
    session: ProviderSession,
    songmid: string,
    mediaMid?: string,
    quality: QqQuality = 'standard',
  ): Promise<string> {
    // 高音质需要 media_mid 拼 filename；没有就退回默认 m4a。
    const spec = QqMusicProvider.QUALITY[quality];
    const filename =
      spec && mediaMid ? [`${spec.prefix}${mediaMid}${spec.ext}`] : undefined;

    let vkey = await this.fetchVkey(session, [songmid], filename);
    let info = vkey?.data?.midurlinfo?.[0];

    // 请求了高音质但没权限/该音质不存在（purl 空）→ 回退默认音质再试一次。
    if (!info?.purl && filename) {
      this.logger.warn(
        `QQ ${quality} 无 purl(errtype=${info?.errtype})，回退默认音质：${songmid}`,
      );
      vkey = await this.fetchVkey(session, [songmid]);
      info = vkey?.data?.midurlinfo?.[0];
    }

    if (!info?.purl) {
      // errtype 常见含义：无版权 / 需付费 / 登录态失效。日志留痕便于排查。
      this.logger.warn(
        `QQ GetVkey 无 purl: mid=${songmid}, errtype=${info?.errtype}, ` +
          `hasCookie=${Boolean(session.qqCookie)}, uin=${session.qqUin ?? '?'}`,
      );
      throw new BadRequestException(
        `QQ vkey missing purl for ${songmid}: errtype=${info?.errtype}（可能无版权/需会员/登录态失效）`,
      );
    }
    const upstreamHost =
      vkey?.data?.sip?.[0] ?? 'https://ws.stream.qqmusic.qq.com/';
    return upstreamHost.replace(/\/$/, '/') + info.purl;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async fetchVkey(
    session: ProviderSession,
    songmids: string[],
    filenames?: string[],
  ): Promise<MusicuVkeyResponse['req_0']> {
    const guid = this.randomGuid();
    const param: Record<string, unknown> = {
      guid,
      songmid: songmids,
      songtype: songmids.map(() => 0),
      uin: session.qqUin ?? '',
      loginflag: 1,
      platform: '20',
      h5guid: guid,
    };
    // 指定 filename 才会返回对应音质的流地址（否则默认 m4a）。
    if (filenames) param.filename = filenames;
    const body = {
      comm: {
        cv: 4747474,
        ct: 24,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 1,
        uin: session.qqUin ?? '',
      },
      req_0: {
        module: 'music.vkey.GetVkey',
        method: 'UrlGetVkey',
        param,
      },
    };

    const res = await fetch(
      'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&inCharset=utf8&outCharset=utf-8',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Referer: 'https://y.qq.com/',
          Cookie: session.qqCookie ?? '',
        },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json()) as MusicuVkeyResponse;
    return json.req_0;
  }

  private randomGuid(): string {
    // ISSUES.md §3.2：改用 crypto.randomBytes(16) 替代 Math.random × 32。
    // 128 bit 真随机（等价 UUIDv4 强度），每次调用唯一，碰撞概率 2^-128，
    // 不需要 Date.now() 前缀。QQ 鉴权对单次唯一性没要求。
    return randomBytes(16).toString('hex');
  }

  /**
   * Fetch synced lyrics for a QQ song. Endpoint:
   *   GET c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg
   *       ?songmid={mid}&format=json&nobase64=1&g_tk=5381
   *
   * The `Referer: y.qq.com` header is mandatory — without it QQ returns
   * code 2001 (invalid request). `nobase64=1` asks for a plain LRC body
   * instead of base64; we still base64-decode as a fallback in case the
   * flag is ignored. The response is occasionally JSONP-wrapped
   * (`MusicJsonCallback({...})`) even with format=json, so we strip any
   * callback wrapper before parsing.
   *
   * Returns null when the song has no lyrics or the request fails — the
   * controller/service treats null as "暂无歌词".
   */
  async getLyrics(
    session: ProviderSession,
    songmid: string,
  ): Promise<LyricLine[] | null> {
    const url = new URL(
      'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
    );
    url.searchParams.set('songmid', songmid);
    url.searchParams.set('format', 'json');
    url.searchParams.set('nobase64', '1');
    url.searchParams.set('g_tk', '5381');

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://y.qq.com/',
        Cookie: session.qqCookie ?? '',
      },
    });
    const text = await res.text();
    // Strip a JSONP callback wrapper if present: `foo({...})` → `{...}`.
    const jsonStr = text.replace(/^[^{]*(\{[\s\S]*\})[^}]*$/, '$1');
    let data: { code?: number; lyric?: string };
    try {
      data = JSON.parse(jsonStr) as { code?: number; lyric?: string };
    } catch {
      this.logger.warn(`QQ lyric parse failed for ${songmid}`);
      return null;
    }
    if (!data.lyric) return null;
    // nobase64=1 should give plain LRC, but if we still got base64
    // (no '[' timestamp brackets, looks like base64), decode it.
    let lrc = data.lyric;
    if (!lrc.includes('[') && /^[A-Za-z0-9+/=\s]+$/.test(lrc)) {
      try {
        lrc = Buffer.from(lrc, 'base64').toString('utf-8');
      } catch {
        /* leave as-is */
      }
    }
    return parseLrc(lrc);
  }
}