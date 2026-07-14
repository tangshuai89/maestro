import {
  Controller,
  Get,
  Post,
  Body,
  Logger,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { StorageService } from '../storage';
import { ConfigService } from '../config';

/**
 * 会话快照导出 / 导入 + 每日本地自动备份。
 *
 * - `GET  /storage/state`  → 整个 state.json 的 JSON（renderer 端加密后导出）
 * - `POST /storage/import` → 把快照合并进当前 store（不覆盖已有红心/登录态）
 * - `POST /storage/backup` → 立即触发一次本地备份（同自动备份逻辑）
 *
 * 自动备份：进程起来后每 24h 把 state.json 拷一份到 backupDir，保留最近 N 份。
 * 备份是**明文**（跑在用户自己机器的固定目录里）；加密只在用户主动"导出"到
 * 外部文件那条路径上做（backup-crypto.ts）。
 */
const DAY_MS = 24 * 3600 * 1000;

@Controller('storage')
export class BackupController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupController.name);
  private autoTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly storage: StorageService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit(): void {
    // 起来先备一份，之后每 24h 一次。unref 让它不拖住进程退出。
    this.runBackup('startup');
    this.autoTimer = setInterval(() => this.runBackup('daily'), DAY_MS);
    this.autoTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  /** 整个 store 的快照（renderer 端和 localStorage 一起加密后导出）。 */
  @Get('state')
  getState(): { stateJson: Record<string, unknown> } {
    return { stateJson: this.storage.getAll() };
  }

  /** 备份目录 + 现有份数，给 Settings UI 显示。 */
  @Get('info')
  info(): { backupDir: string; backupCount: number } {
    return {
      backupDir: this.cfg.backupDir,
      backupCount: this.listBackups().length,
    };
  }

  /**
   * 合并导入。body: { stateJson }。合并策略在 StorageService.mergeFrom：
   * additive，不覆盖已有红心/登录态。返回被触碰的 top-level key。
   */
  @Post('import')
  importState(
    @Body() body: { stateJson?: Record<string, unknown> },
  ): { merged: string[] } {
    const snapshot = body?.stateJson;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new BadRequestException('stateJson 必须是对象');
    }
    const merged = this.storage.mergeFrom(snapshot);
    this.logger.log(`imported snapshot, merged ${merged.length} keys`);
    // 立刻落盘，别等 200ms debounce（导入后用户可能马上重启）。
    this.storage.flushSync();
    return { merged };
  }

  /** 手动触发一次本地备份。返回落盘路径 + 当前备份目录里的份数。 */
  @Post('backup')
  backupNow(): { path: string; count: number } {
    const p = this.runBackup('manual');
    if (!p) throw new BadRequestException('备份失败，见服务端日志');
    const count = this.listBackups().length;
    return { path: p, count };
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  /** 拷一份 state.json 到 backupDir，命名带时间戳，然后修剪到 retention 份。 */
  private runBackup(reason: string): string | null {
    try {
      fs.mkdirSync(this.cfg.backupDir, { recursive: true });
      const snapshot = this.storage.getAll();
      // 空 store 不值得备份（首启还没任何登录）。
      if (Object.keys(snapshot).length === 0) return null;
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      const dest = path.join(this.cfg.backupDir, `backup-${stamp}.json`);
      fs.writeFileSync(dest, JSON.stringify(snapshot, null, 2));
      this.prune();
      this.logger.log(`[${reason}] backup written: ${dest}`);
      return dest;
    } catch (err) {
      this.logger.error(`backup failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** backupDir 里所有 backup-*.json，按文件名（含时间戳）降序。 */
  private listBackups(): string[] {
    try {
      return fs
        .readdirSync(this.cfg.backupDir)
        .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /** 只留最近 retention 份，删掉更旧的。 */
  private prune(): void {
    const files = this.listBackups();
    const keep = Math.max(1, this.cfg.backupRetention);
    for (const stale of files.slice(keep)) {
      try {
        fs.unlinkSync(path.join(this.cfg.backupDir, stale));
      } catch {
        // ignore — 下次再删
      }
    }
  }
}
