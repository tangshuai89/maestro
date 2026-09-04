import { Injectable, Logger } from '@nestjs/common';

/**
 * Per-session single-flight refresh coordinator. When the Spotify access
 * token is expired (or about to be), multiple concurrent calls (search,
 * like, fetchLiked) may notice simultaneously. Without coordination, each
 * one would POST to /api/token — wasting quota and racing the in-memory
 * `session.spotify` mutation. This module:
 *
 *  - Caches the in-flight Promise per sessionId.
 *  - Subsequent callers `await` the same Promise.
 *  - On completion (success or failure), the entry is removed so the
 *    next call starts a fresh refresh.
 *
 * The actual token mutation is the caller's responsibility (so this
 * class is platform-agnostic — only the Spotify refresh uses it today,
 * but if we ever add a second OAuth platform with similar semantics,
 * the coordinator is reusable).
 */
@Injectable()
export class RefreshCoordinator {
  private readonly logger = new Logger(RefreshCoordinator.name);
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Run `doRefresh` with single-flight per sessionId. `doRefresh` is the
   * platform-specific network call + token mutation. The returned Promise
   * resolves to whatever `doRefresh` resolves to (typically a new
   * accessToken, or null on failure).
   *
   * Map is typed `Promise<unknown>` (not the generic `T`) so we don't have
   * to cast back when reading the in-flight entry — both the inserter and
   * the reader agree on `unknown`, and `T` is only on the return signature.
   */
  run<T>(
    provider: string,
    sessionId: string,
    doRefresh: () => Promise<T>,
  ): Promise<T> {
    const key = `${provider}:${sessionId}`;
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.logger.log(`refresh: sharing in-flight promise for ${key}`);
      return existing;
    }
    const p: Promise<T> = doRefresh().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  /** For tests: number of currently in-flight refreshes. */
  size(): number {
    return this.inflight.size;
  }

  /** For tests: drop all in-flight entries (does not cancel the work). */
  reset(): void {
    this.inflight.clear();
  }
}
