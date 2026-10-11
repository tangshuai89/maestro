/**
 * 日志脱敏（Phase 11 P11-7）。
 *
 * QQ uin 是持久账号标识（不是会话 token），明文进日志后，日志被贴到
 * issue / 群聊时会顺带泄露账号。统一只保留首尾各 2 位：
 *   81295659 → "81***59"
 * 足够让「同一个人的两次日志」对上号，又不足以还原完整 uin。
 *
 * 规则：
 *  - 空 / undefined → "?"
 *  - ≤4 位（异常短 uin）→ "***"（首尾保留反而等于没打码）
 */
export function maskUin(uin: string | null | undefined): string {
  if (!uin) return '?';
  const s = String(uin);
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}
