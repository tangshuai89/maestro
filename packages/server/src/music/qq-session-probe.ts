import { randomBytes } from 'node:crypto';
import { withTimeout } from '../common/timeout';

/**
 * QQ 登录态探针（spec: specs/auth-resilience Phase 10）。
 *
 * ## 为什么不靠错误码判据
 *
 * 实测（2026-10-08，见 spec 附录）：cookie 失效时 GetVkey 返回
 * `result=104003` / `errtype=""` / `purl=""` / `vkey=""`，而且**免费歌和
 * VIP 歌的响应逐字段完全相同**，与「完全不带 cookie」时的响应也一致。
 * 也就是说单靠 GetVkey 响应**无法**区分「登录态失效」与「内容受限」。
 * spec 原文写的判据是「QQ 返回 1000」，与现实对不上。
 *
 * 所以改用**探针歌判据**：拿确定免费的歌打 GetVkey，能拿到 `purl` 或
 * `vkey` 任一非空 → 登录态可用；两者皆空 → 判定失效。
 *
 * 好处：不依赖任何未文档化的错误码语义；判错的最坏后果只是"误报一次需要
 * 重新登录"，**不影响用户数据**。
 *
 * ## 多歌共识（Phase 11，P11-1）
 *
 * 单首探针歌是单点：它被下架 / 转 VIP / 分区域受限时，**有效会话**会被
 * 误判成失效；用户重登后立刻又被探死 → 锁死在「重新登录」循环里。
 * 改成一次请求批量打 3 首免费歌（songmid 本就是数组，不增请求数），
 * **全部探针歌皆空才判失效**；任一存活即 alive。三首歌刻意分属不同
 * 歌手/厂牌，降低「同一版权方集中变更」的相关性。
 * （2026-10-10 用有效 cookie 实测三首 `pay_play=0` 且均返回 purl/vkey。）
 *
 * ## 保守原则
 *
 * 网络异常 / 超时 / 非 JSON / 解析失败 **一律返回 alive:true**。
 * 宁可漏报（退回今天的行为）也不误报（打断正常使用）。
 */

const PROBE_SONGMIDS = [
  '004Gq0xE1YC8xp', // 周杰伦《晴天》—— F0 实测免费
  '0002g2BF46I7K7', // 薛之谦《演员》—— 实测 pay_play=0
  '003ypljX44Gq1I', // 苏打绿《小情歌》—— 实测 pay_play=0
] as const;
const PROBE_SONGMID_SET = new Set<string>(PROBE_SONGMIDS);
const PROBE_TIMEOUT_MS = 5_000;

export type ProbeReason =
  'purl_present' | 'vkey_present' | 'no_vkey' | 'no_cookie' | 'network_error';

export interface SessionProbeResult {
  /** 登录态是否仍可用。true = 没问题（**保守默认**）。 */
  alive: boolean;
  /** 仅用于日志定位，不进任何响应体、不含 cookie。 */
  reason: ProbeReason;
  /** 本次是否真的发了请求（false = 命中缓存）。 */
  fetched: boolean;
}

interface VkeyProbeResponse {
  req_0?: {
    data?: {
      midurlinfo?: Array<{
        songmid?: string;
        purl?: string;
        vkey?: string;
        errtype?: string | number;
        result?: number;
      }>;
    };
  };
}

/**
 * 打一次 GetVkey 探针。**不解析任何错误码** —— 只看 purl / vkey 是否非空。
 *
 * 不传 `filename`：不指定音质时 QQ 走默认 m4c，对免费歌最宽松，最不容易
 * 因为音质/权限差异误判成"失效"。
 */
export async function probeQqSessionUncached(
  cookie: string,
  uin: string,
): Promise<SessionProbeResult> {
  if (!cookie || !uin) {
    // 没有凭据 = 没登录过，不是"过期"。交给上层按未登录处理。
    return { alive: false, reason: 'no_cookie', fetched: false };
  }
  const guid = randomBytes(16).toString('hex');
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
      uin,
    },
    req_0: {
      module: 'music.vkey.GetVkey',
      method: 'UrlGetVkey',
      param: {
        guid,
        songmid: [...PROBE_SONGMIDS],
        songtype: PROBE_SONGMIDS.map(() => 0),
        uin,
        loginflag: 1,
        platform: '20',
        h5guid: guid,
      },
    },
  };

  // ⚠️ `withTimeout` 只兜超时，**不 catch reject**（见 common/timeout.ts 注释）。
  // fetch throw / r.json() 抛错（QQ 改结构、返回 HTML 错误页）都会冒出来。
  // 整段包 try/catch，把一切异常归为 network_error → alive:true，
  // 保证「探针自己出问题」永远不会被当成「登录过期」。
  let res: SessionProbeResult | null = null;
  try {
    res = await withTimeout<SessionProbeResult>(async () => {
      const r = await fetch(
        'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&inCharset=utf8&outCharset=utf-8',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            Referer: 'https://y.qq.com/',
            Cookie: cookie,
          },
          body: JSON.stringify(body),
        },
      );
      const json = (await r.json()) as VkeyProbeResponse;
      // 按 songmid 精确匹配出**所有**探针歌条目 —— 异常响应可能给多条或
      // 缺条，取错会读到别人的空 purl。
      const list = json?.req_0?.data?.midurlinfo;
      const infos = Array.isArray(list)
        ? list.filter((x) => x?.songmid && PROBE_SONGMID_SET.has(x.songmid))
        : [];
      // ⚠️ 结构对不上（midurlinfo 缺失 / 非数组 / 一条探针歌都没回声）时
      // **不能**判成「失效」——那是「探针自己没读懂响应」，属于探针故障，
      // 按保守原则当 alive。只有明确读到探针歌条目、且**全部** purl/vkey
      // 都空，才判 no_vkey（多歌共识：一首歌受限不再能单独判死会话）。
      if (!infos.length) {
        return { alive: true, reason: 'network_error' as const, fetched: true };
      }
      if (infos.some((i) => i?.purl)) {
        return { alive: true, reason: 'purl_present' as const, fetched: true };
      }
      // purl 空但 vkey 有：拿不到流地址，但 QQ 认这个登录态 —— 判为可用，
      // 避免把「这首歌恰好受限」误报成「登录过期」。
      if (infos.some((i) => i?.vkey)) {
        return { alive: true, reason: 'vkey_present' as const, fetched: true };
      }
      return { alive: false, reason: 'no_vkey' as const, fetched: true };
    }, PROBE_TIMEOUT_MS);
  } catch {
    // fetch 抛错 / JSON 解析失败 / 结构完全对不上 → 保守当作可用
    return { alive: true, reason: 'network_error', fetched: true };
  }

  // 超时（withTimeout resolve null）→ 同样保守当作可用
  if (res === null) {
    return { alive: true, reason: 'network_error', fetched: true };
  }
  return res;
}

/**
 * 探针结果缓存：per-session，TTL 10 分钟。
 *
 * 为什么必须有：一次播放失败会走「同源重试 → 跨平台 fallback → 兜底探针」
 * 多条路径，没有缓存就会对 QQ 连打好几发。
 *
 * 进程内 Map，不持久化（重启清零）—— 判定本来就只对当下有效，持久化一个
 * 会过期的结论等于把 bug 从运行时搬到磁盘。
 */
export class SessionProbeCache {
  private readonly store = new Map<string, { result: SessionProbeResult; at: number }>();
  private readonly inflight = new Map<string, Promise<SessionProbeResult>>();

  constructor(
    private readonly ttlMs: number = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 取缓存；未命中或已过期返回 null。 */
  peek(key: string): SessionProbeResult | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (this.now() - hit.at > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return { ...hit.result, fetched: false };
  }

  /**
   * 取缓存或发起探针。**同一 key 并发只发一个请求**（单飞）——
   * 播放失败的多个兜底路径可能同时问。
   */
  async resolve(key: string, fn: () => Promise<SessionProbeResult>): Promise<SessionProbeResult> {
    const cached = this.peek(key);
    if (cached) return cached;
    const running = this.inflight.get(key);
    if (running) return { ...(await running), fetched: false };
    const p = fn()
      .then((result) => {
        this.store.set(key, { result, at: this.now() });
        return result;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  /** 仅测试用：清空。 */
  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  /** 实际缓存条数（仅测试 / 诊断用）。 */
  get size(): number {
    return this.store.size;
  }
}
