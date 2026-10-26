import { STORAGE_KEYS } from './storage';

/**
 * 首次启动引导（specs/first-run-guide）的状态读写。
 *
 * ## 为什么放 localStorage 而不是服务端
 *
 * 「看过引导」是**本机使用痕迹**，不是用户资产 —— 跟搜索历史同款。
 * ⇒ 不进服务端的 session 分片（`history:` / `library:` 那套）、
 *   不进加密备份里的 ❤ 库/歌单。清掉 localStorage ⇒ 下次启动重新看到引导
 *   （可接受：那不是 bug，是「这台机器上还没引导过」）。
 *
 * ## 全部 try/catch
 *
 * 隐私模式 / 配额满 → localStorage 会**抛异常**。引导只是个「说明」，
 * 它的 flag 写失败绝不能把 App 掀翻（写失败的后果只是：下次还会看到引导）。
 */

/** 已经看过引导了吗？ */
export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.onboardingDone) === '1';
  } catch {
    // 读不到 ⇒ 当作没看过（最多多看一次引导，不会出事）
    return false;
  }
}

/** 标记「已看过」（完成或跳过都调它）。 */
export function markOnboardingDone(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.onboardingDone, '1');
  } catch {
    /* 写不进去 ⇒ 下次还会看到引导（可接受） */
  }
}

/** 清掉标记 —— 设置里的「重新看引导」用。 */
export function clearOnboardingDone(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.onboardingDone);
  } catch {
    /* 同上 */
  }
}

/**
 * 该不该现在弹引导？
 *
 * - `hasProvider`：**选完音源**才弹。
 *   选音源那步**已经有了**（`!player.provider` → `SourceSelect` 全屏页），
 *   引导接在它**后面**，不重复造、不挡在它前面。
 * - 看过 → 不弹（**不再打扰**）。
 */
export function shouldShowOnboarding(hasProvider: boolean): boolean {
  return hasProvider && !isOnboardingDone();
}
