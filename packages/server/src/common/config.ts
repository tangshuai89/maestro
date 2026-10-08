import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Centralised env loading. Everything has a sensible default so the dev
 * experience is "clone → npm install → npm run dev". Production values come
 * from the actual env.
 */
@Injectable()
export class ConfigService {
  readonly port = Number(process.env.PORT ?? 3200);

  /**
   * 允许的 renderer origin（CORS allowlist）。
   *
   * ⚠️ 必须**同时**包含 5173 和 dev 端口探测的结果：renderer 撞到 5173 被占
   * 时会自动改用别的端口（见 packages/renderer/scripts/dev-port.mjs），
   * 这里若只认死端口，换端口后所有 /music /auth 请求都会被 CORS 拒掉，
   * 症状是"页面能开但什么都是 undefined"。
   */
  readonly rendererOrigins = (
    process.env.RENDERER_ORIGINS ??
    [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      // dev 端口自动避让后的实际端口，一并放行（5173-5199）
      ...Array.from({ length: 27 }, (_, i) => `http://localhost:${5173 + i}`),
      ...Array.from({ length: 27 }, (_, i) => `http://127.0.0.1:${5173 + i}`),
    ].join(',')
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  readonly rendererBase =
    process.env.RENDERER_BASE ??
    (process.env.RENDERER_PORT
      ? `http://127.0.0.1:${process.env.RENDERER_PORT}`
      : 'http://127.0.0.1:5173');

  readonly sessionSecret =
    process.env.SESSION_SECRET ?? 'dev-only-secret-change-me';
  readonly sessionTtlMs =
    Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 3600 * 1000);

  readonly storageDir = process.env.STORAGE_DIR ?? path.resolve('.storage');

  // Auto-backup target. On macOS the packaged app resolves this to
  // ~/Library/Application Support/Maestro/backups via the STORAGE_BACKUP_DIR
  // env (set by Electron main); dev falls back to <storageDir>/backups.
  readonly backupDir =
    process.env.STORAGE_BACKUP_DIR ?? path.join(this.storageDir, 'backups');
  readonly backupRetention = Number(process.env.STORAGE_BACKUP_RETENTION ?? 7);

  // QQ 音乐:走内嵌登录窗口捕获 cookie，无需 appid/secret（QQ 互联那套已废弃）

  // 网易云（没有公开 OAuth，用 cookie / 扫码）
  readonly neteaseMusicU = process.env.NETEASE_MUSIC_U ?? '';
  readonly neteaseQrPollIntervalMs = Number(
    process.env.NETEASE_QR_POLL_MS ?? 1500,
  );

  // DeepSeek（AI 推荐引擎，用户自带 Key，仅本地使用，不上传）
  readonly deepSeekApiKey = process.env.DEEPSEEK_API_KEY ?? '';

  // 内部 token：Electron main 每次启动生成一个随机 token，通过
  // MAESTRO_INTERNAL_TOKEN 环境变量传给 NestJS sidecar。RequireInternalTokenGuard
  // 用它验证来自 renderer 的 state-changing 请求。dev 模式（没传 env）→ 空字符串
  // → guard 进入"宽松模式"+ 警告日志，便于本地不依赖 Electron 跑 server。
  readonly internalToken = process.env.MAESTRO_INTERNAL_TOKEN ?? '';

  constructor() {
    fs.mkdirSync(this.storageDir, { recursive: true });
  }
}