/**
 * 「凭据有效」与「音乐权益有效」——两个正交状态（见 ADR-110）。
 *
 *   - **凭据**（MUSIC_U / QQ qm_keyst / OAuth token）决定能否调账号接口（QQ 72h 票据可由
 *     60d psrf_qqrefresh_token 自动续期；续期仍失败才算凭据失效 `expired`）；
 *   - **权益**（网易云黑胶 / QQ 音乐绿钻）决定付费曲能否播全曲；
 *   - **单曲版权**受逐首地区 / 下架 / 数字专辑单购影响。
 */

/** 权益 / 凭据三态。`unknown` 是合法且重要的答案。 */
export type TriState = 'valid' | 'expired' | 'unknown';

/** 权益快照的 TTL：会员状态不会秒变，但也不该每次搜索都打一次账号接口。 */
export const ENTITLEMENT_TTL_MS = 5 * 60 * 1000;

export interface EntitlementSnapshot {
  /** 凭据还能不能用（能否成功调账号接口）。 */
  credential: TriState;
  /** 付费权益（黑胶 / 绿钻）。`unknown` = 没查到可靠接口或查询失败。 */
  entitlement: TriState;
  /** 实测时间（ms epoch）。 */
  checkedAt: number;
}

/**
 * 播放失败该怎么向用户解释 —— 纯函数，白盒可测。
 *
 * 三类处置方式完全不同，混成一句「音频加载失败」就是把用户送去瞎试：
 *
 * | 结论 | 含义 | 用户该做什么 |
 * |---|---|---|
 * | `relogin` | 凭据失效 | **重新登录**（有用） |
 * | `entitlement` | 凭据有效但付费权益没了 | **重登没用**，等会员恢复或换平台/换歌 |
 * | `no-license` | 这首歌取不到流 | **换歌**（重登无用） |
 * | `unknown` | 说不清 | 泛化提示 + 建议换歌，**不要断言原因** |
 */
export type PlaybackFailureKind = 'relogin' | 'entitlement' | 'no-license' | 'unknown';

export function classifyPlaybackFailure(input: {
  /** 服务端判定的凭据状态（`expired` = 确实该重登）。 */
  credential?: TriState;
  /** 服务端判定的权益状态。 */
  entitlement?: TriState;
  /** 该平台是否有可靠的权益判据（QQ = false → 只能说到 no-license 那一层）。 */
  hasEntitlementSignal?: boolean;
}): PlaybackFailureKind {
  // 凭据失效是唯一「重登有用」的情况，优先级最高。
  if (input.credential === 'expired') return 'relogin';
  // 凭据有效 + 权益明确失效 → 会员问题
  if (input.credential === 'valid' && input.entitlement === 'expired') return 'entitlement';
  // 有权益信号但没过期 → 是"这首歌"的问题，不是账号的问题
  if (input.entitlement === 'valid') return 'no-license';
  // 完全没有权益信号（QQ）：只能说这首歌取不到流
  if (input.hasEntitlementSignal === false) return 'no-license';
  return 'unknown';
}

/** 各平台「取不到流」时的用户提示。文案必须和上面的处置对得上。 */
export function playbackFailureMessage(kind: PlaybackFailureKind, providerLabel: string): string {
  switch (kind) {
    case 'relogin':
      return `${providerLabel}登录已过期，请重新登录`;
    case 'entitlement':
      return `${providerLabel}会员已失效，这首歌是付费曲 —— 重新登录没用，等会员恢复或换个平台`;
    case 'no-license':
      return `${providerLabel}取不到这首歌的播放地址（会员 / 版权 / 地区限制），建议换一首或换个平台`;
    default:
      return `音频加载失败，建议换一首或换个平台`;
  }
}
