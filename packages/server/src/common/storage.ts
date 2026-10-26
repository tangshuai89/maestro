import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';

/**
 * Session-scoped storage key prefixes —— 前缀后面那截就是 session id。
 * 与三处写入点一一对应：
 *   - `music:${sessionId}`     → music.service.ts
 *   - `library:${sessionId}`   → music.service.ts
 *   - `playlists:${sessionId}` → library/playlist.service.ts
 *   - `history:${sessionId}`   → music.service.ts（播放历史，specs/play-history）
 * 键名知识集中在这里，GC 时不用去各业务模块猜。
 */
const SESSION_SCOPED_PREFIXES = ['music:', 'library:', 'playlists:', 'history:'] as const;

/**
 * Persists opaque blobs (sessions, cached tokens, pending QR keys) to a
 * single JSON file. Good enough for a desktop client; swap for SQLite when
 * the data set grows or needs queries.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly file: string;
  private cache: Record<string, unknown> = {};
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cfg: ConfigService) {
    this.file = path.join(cfg.storageDir, 'state.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.cache = JSON.parse(raw);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        this.logger.warn(`Failed to load storage: ${e.message}`);
      }
      this.cache = {};
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      try {
        this.writeLocked();
      } catch (err) {
        this.logger.error(`Failed to write storage: ${(err as Error).message}`);
      }
    }, 200);
  }

  /**
   * 写 storage 文件并 chmod 0o600（owner 读写 only）。ISSUES.md §4.1：
   * QQ cookie / NetEase MUSIC_U / Spotify token 全是明文；多用户 macOS
   * 或备份到外置盘时默认 umask 创建太松。每次写都收紧一次，覆盖历史
   * 文件的旧权限。Windows 上 fs.chmodSync 仅作 best-effort（不抛错）。
   */
  private writeLocked(): void {
    // ⚠️ **原子写**：先写临时文件，再 rename 覆盖。
    //
    // 原地 `writeFileSync(file, …)` 是「**先截断再写**」→ 进程在写的过程中
    // 被杀（dev 模式的 watch 重启、用户直接关 app、机器断电）→ 文件停在
    // 半截 → 下次启动 `JSON.parse` 失败 → **整个状态被清空**（红心/登录态
    // 「莫名消失」）。load() 有兜底不会崩，但用户看到的是"我的歌单空了"。
    //
    // `rename` 在同一文件系统上是**原子**的 → 读到的永远要么是旧的完整内容、
    // 要么是新的完整内容，**不会有半截**。
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
      // chmod 打在**临时文件**上 → rename 之后最终文件就是 0600
      // （rename 保留 inode 的权限位）。
      try {
        fs.chmodSync(tmp, 0o600);
      } catch (err) {
        // Windows 或只读盘上 chmod 可能失败——日志降级到 debug，不阻塞写。
        this.logger.debug(`storage chmod 0o600 skipped: ${(err as Error).message}`);
      }
      fs.renameSync(tmp, this.file);
    } catch (err) {
      // 写失败 → 别把半截的临时文件留在磁盘上（下次写会覆盖它，但留个垃圾
      // 文件让人困惑）。
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  get<T>(key: string): T | undefined {
    return this.cache[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.cache[key] = value;
    this.scheduleWrite();
  }

  delete(key: string): void {
    delete this.cache[key];
    this.scheduleWrite();
  }

  /**
   * 回收「会话已经不在了、但数据还留着」的孤儿键。
   *
   * 背景：会话被 TTL 回收后，`sessions` blob 里那条没了，可
   * `music:<id>` / `library:<id>` / `playlists:<id>` 还躺在 store 里没人管。
   * 实测用户机器上 48 个 `music:` 键里 **46 个是孤儿** —— state.json 里
   * 1.9MB / 5.55MB 是纯垃圾，而且会被原样抄进**每一份备份**（7 份 × 8.9MB）。
   *
   * 只按「session id 不在 liveIds 里」判断，不看内容 —— 孤儿键的定义就是
   * 归属的会话没了。回收是幂等的：跑多次不会伤到活着的会话数据。
   *
   * @param liveIds 仍然活着的 session id
   * @returns 被回收的键数量
   */
  gcSessionScoped(liveIds: Iterable<string>): number {
    const live = new Set(liveIds);
    let removed = 0;
    for (const key of Object.keys(this.cache)) {
      const prefix = SESSION_SCOPED_PREFIXES.find((p) => key.startsWith(p));
      if (!prefix) continue;
      const id = key.slice(prefix.length);
      // 后缀为空（键名畸形）→ 不动它，交给人看
      if (!id || live.has(id)) continue;
      delete this.cache[key];
      removed++;
    }
    if (removed) this.scheduleWrite();
    return removed;
  }

  /** Shallow snapshot of the whole store. Used by the backup/export path to
   *  serialize every key (sessions, music state, secrets, library) at once. */
  getAll(): Record<string, unknown> {
    // Return a copy so callers can't mutate the live cache by reference.
    return { ...this.cache };
  }

  /**
   * Merge an imported snapshot into the current store. Additive-biased so an
   * import never destroys data the user already has locally:
   *  - `sessions`      : union by session id (keep existing blobs; add new ids)
   *  - `music:*`       : per-provider union of liked/disliked sets + fanOut;
   *                      queue is left as-is (existing wins)
   *  - `library:*`     : union of items by id
   *  - `secrets:*`     : only fill when the local value is absent (never
   *                      overwrite a key the user already configured here)
   *  - anything else   : only fill when absent
   * Returns the list of top-level keys that were touched.
   */
  mergeFrom(snapshot: Record<string, unknown>): string[] {
    const touched: string[] = [];
    for (const [key, incoming] of Object.entries(snapshot ?? {})) {
      if (incoming == null) continue;
      const existing = this.cache[key];
      let next: unknown;
      if (key === 'sessions') {
        next = mergeSessions(existing, incoming);
      } else if (key.startsWith('music:')) {
        next = mergeMusicState(existing, incoming);
      } else if (key.startsWith('library:')) {
        next = mergeLibrary(existing, incoming);
      } else if (key.startsWith('secrets:')) {
        // Never overwrite a secret the user already set locally.
        if (existing !== undefined) continue;
        next = incoming;
      } else {
        // Unknown key: fill only when absent.
        if (existing !== undefined) continue;
        next = incoming;
      }
      this.cache[key] = next;
      touched.push(key);
    }
    if (touched.length) this.scheduleWrite();
    return touched;
  }

  /** Force-flush pending writes. Call before process exit. */
  flushSync(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      this.writeLocked();
    } catch (err) {
      this.logger.error(`Failed to flush storage: ${(err as Error).message}`);
    }
  }
}

// ── merge helpers (module-private) ──────────────────────────────────────────
//
// The blobs are opaque `unknown` to StorageService, so these helpers defensively
// duck-type each shape and fall back to "keep existing" when the incoming data
// doesn't look right. An import must never corrupt the local store.

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** sessions blob = { byId: { [id]: Session } }. Union by id, existing wins. */
function mergeSessions(existing: unknown, incoming: unknown): unknown {
  if (!isObj(incoming)) return existing ?? incoming;
  if (!isObj(existing)) return incoming;
  const exById = isObj(existing.byId) ? existing.byId : {};
  const inById = isObj(incoming.byId) ? incoming.byId : {};
  // Existing ids win (don't clobber a live login with a stale backup).
  return { ...incoming, byId: { ...inById, ...exById } };
}

/** music:<id> = { providers: {qq,netease,deezer,spotify}, fanOut }. Union
 *  liked/disliked (arrays), union fanOut entries; existing queue wins. */
function mergeMusicState(existing: unknown, incoming: unknown): unknown {
  if (!isObj(incoming)) return existing ?? incoming;
  if (!isObj(existing)) return incoming;
  const exProviders = isObj(existing.providers) ? existing.providers : {};
  const inProviders = isObj(incoming.providers) ? incoming.providers : {};
  const providers: Record<string, unknown> = { ...exProviders };
  for (const [platform, inState] of Object.entries(inProviders)) {
    const exState = exProviders[platform];
    providers[platform] = mergeProviderState(exState, inState);
  }
  const fanOut = mergeFanOut(existing.fanOut, incoming.fanOut);
  return { ...existing, providers, fanOut };
}

function mergeProviderState(existing: unknown, incoming: unknown): unknown {
  if (!isObj(incoming)) return existing ?? incoming;
  if (!isObj(existing)) return incoming;
  return {
    // Existing queue wins (the live one is more current than a backup's).
    queue: Array.isArray(existing.queue) ? existing.queue : (incoming.queue ?? []),
    liked: unionArray(existing.liked, incoming.liked),
    disliked: unionArray(existing.disliked, incoming.disliked),
  };
}

/** fanOut = { [mergedId]: FanOutEntry[] }. Union per mergedId by trackId. */
function mergeFanOut(existing: unknown, incoming: unknown): unknown {
  if (!isObj(incoming)) return existing ?? {};
  if (!isObj(existing)) return incoming;
  const out: Record<string, unknown> = { ...existing };
  for (const [mergedId, inEntries] of Object.entries(incoming)) {
    if (!Array.isArray(inEntries)) continue;
    const exEntries = Array.isArray(out[mergedId]) ? (out[mergedId] as unknown[]) : [];
    const seen = new Set(
      exEntries.map((e) => (isObj(e) ? `${e.platform}:${e.trackId}` : String(e))),
    );
    const merged = [...exEntries];
    for (const e of inEntries) {
      const k = isObj(e) ? `${e.platform}:${e.trackId}` : String(e);
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(e);
      }
    }
    out[mergedId] = merged;
  }
  return out;
}

/** library:<id> = { importedAt, items: [], sources: [] }. Union items by id. */
function mergeLibrary(existing: unknown, incoming: unknown): unknown {
  if (!isObj(incoming)) return existing ?? incoming;
  if (!isObj(existing)) return incoming;
  const exItems = Array.isArray(existing.items) ? existing.items : [];
  const inItems = Array.isArray(incoming.items) ? incoming.items : [];
  const seen = new Set(exItems.map((it) => (isObj(it) ? String(it.id) : String(it))));
  const items = [...exItems];
  for (const it of inItems) {
    const id = isObj(it) ? String(it.id) : String(it);
    if (!seen.has(id)) {
      seen.add(id);
      items.push(it);
    }
  }
  return { ...incoming, ...existing, items };
}

/** Union two "array of primitives" (liked/disliked track-id lists). */
function unionArray(a: unknown, b: unknown): unknown[] {
  const arrA = Array.isArray(a) ? a : [];
  const arrB = Array.isArray(b) ? b : [];
  return Array.from(new Set([...arrA, ...arrB]));
}
