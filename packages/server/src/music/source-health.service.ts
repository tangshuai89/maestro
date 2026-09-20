import { Injectable } from '@nestjs/common';
import { MUSIC_PROVIDERS, type MusicProvider } from '../common/provider';

const WINDOW_MS = 24 * 3600 * 1000;

interface ProviderCounts {
  /** 并行时间戳数组（每次 record push 当前 epoch ms），snapshot 时裁剪 >24h。 */
  ok: number[];
  fail: number[];
}

/**
 * §5 「源连接健康」：每个平台近 24h 成功 / 失败计数。
 *
 * 设计要点：
 *  - 进程内 Map，不持久化（重启清零 — desktop app 可接受；接口契约里
 *    total=0 表示"近 24h 无请求"，renderer 把它展示成"近 24h 无请求"）。
 *  - 滑动窗口用并行时间戳数组实现，简单可靠；snapshot 时再做一次 in-place
 *    头部裁剪（小于 cutoff 的 pop）。单 provider 24h 内合理量级 <1k 条，
 *    shift 不会成为热点；后续真要换环形 buffer 也兼容。
 *  - 当前接入点：`MusicService.searchOneProvider` 的统一搜索包装（覆盖
 *    全平台日常拉取）；其它路径（library import、lyrics search）暂不记
 *    ——它们要么走单平台自己重试、要么已有自己的 success/fail 信号。
 */
@Injectable()
export class SourceHealthService {
  private readonly counts = new Map<MusicProvider, ProviderCounts>();

  /** 记一次请求结果。成功 = true，失败 = false（包括超时 / 平台报错）。 */
  record(provider: MusicProvider, ok: boolean): void {
    if (!MUSIC_PROVIDERS.includes(provider)) return;
    const c = this.counts.get(provider) ?? { ok: [], fail: [] };
    (ok ? c.ok : c.fail).push(Date.now());
    this.counts.set(provider, c);
  }

  /** 列出每个平台的统计。snapshot 时裁剪过期时间戳，所以频繁 GET 是 O(P)
   *  + 每平台头部裁剪（少量），不需要再后台跑定期任务。 */
  snapshot(): Array<{
    provider: MusicProvider;
    total: number;
    successRate: number;
    lastFailureAt: number | null;
  }> {
    const cutoff = Date.now() - WINDOW_MS;
    return MUSIC_PROVIDERS.map((p) => {
      const c = this.counts.get(p) ?? { ok: [], fail: [] };
      while (c.ok.length && c.ok[0] < cutoff) c.ok.shift();
      while (c.fail.length && c.fail[0] < cutoff) c.fail.shift();
      const total = c.ok.length + c.fail.length;
      return {
        provider: p,
        total,
        successRate: total === 0 ? 1 : c.ok.length / total,
        lastFailureAt: c.fail.length ? c.fail[c.fail.length - 1] : null,
      };
    });
  }

  /** 清零（仅测试用） */
  resetForTests(): void {
    this.counts.clear();
  }
}