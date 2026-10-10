/**
 * Phase 11 P11-2 熔断：登录成功后的宽限期（10min，与服务端探针缓存 TTL 对齐）。
 *
 * 探针报 expired 的两种成因无法区分：「会话真死」vs「探针本身坏了」。
 * 若用户**刚登录成功**探针又报死——让用户立刻再登一次是 strictly worse UX
 * （探针故障时会把人锁死在「重登→立刻又被探死→再重登」循环里）。宽限期
 * 内 mark_expired 一律压成 warn 日志；宽限过后恢复正常判定。有界降级：
 * 宽限内若会话真死，播放失败仍走通用错误提示，不会完全没反馈。
 *
 * 模块级 Map（不随 hook remount 重置），per-provider 记录最后一次登录
 * 成功时间。只应被 `markLoginOk` 写入 —— useAuth 在 reducer 进入
 * `authenticated` 相位时埋点，即一次真实登录尝试的 succeed，而不是
 * set_status 的被动同步。
 */
import type { MusicProvider } from '../api';

export const RELOGIN_GRACE_MS = 10 * 60 * 1000;

const lastLoginOkAt = new Map<MusicProvider, number>();

/** 登录成功埋点。useAuth 在 phase 进入 authenticated 时调用。 */
export function markLoginOk(provider: MusicProvider, now: number = Date.now()): void {
  lastLoginOkAt.set(provider, now);
}

/**
 * 该 provider 是否仍在登录宽限期内 —— true 时探针报 expired 应被拦成
 * warn，不落 mark_expired（探针误报保护）。边界取严格小于：距登录恰好
 * 满 RELOGIN_GRACE_MS 即视为宽限结束。
 */
export function inReloginGrace(provider: MusicProvider, now: number = Date.now()): boolean {
  const t = lastLoginOkAt.get(provider);
  return t != null && now - t < RELOGIN_GRACE_MS;
}

/** 测试专用：清空登录时间记录。生产代码不应调用。 */
export function __resetReloginGrace(): void {
  lastLoginOkAt.clear();
}
