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
