import { SetMetadata } from '@nestjs/common';

/**
 * 媒体路由 token 豁免装饰器（Audit A1, consistency-fixes spec T1）。
 *
 * 背景：RequireInternalTokenGuard 类级装饰 `@UseGuards(...)` 覆盖
 * MusicController 全部路由，导致 `<audio src="/music/stream/...">` 和
 * `<img src="/music/cover-proxy?...">` 在打包版（token 已配置）下全部
 * 401 —— 浏览器/HTML 标签无法带自定义 header；dev 模式 token 未配置 →
 * guard 直接放行掩盖了问题。
 *
 * 修复：媒体只读 GET 路由（stream/cover-proxy/lyrics/deezer/editorials）
 * 加 `@SkipInternalToken()` 方法级标记，guard 里用 Reflector 查 metadata
 * 后放行。依赖签名 session cookie 保护写路径（cookie 是 HttpOnly +
 * SameSite=Strict，跨进程无法伪造）。
 *
 * 用法：
 * ```ts
 * @SkipInternalToken()
 * @Get('stream/:provider/:trackId')
 * async stream(...) { ... }
 * ```
 */
export const SKIP_INTERNAL_TOKEN = 'skip-internal-token';

export const SkipInternalToken = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_INTERNAL_TOKEN, true);
