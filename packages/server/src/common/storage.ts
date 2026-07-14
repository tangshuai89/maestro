import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';

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
        fs.writeFileSync(this.file, JSON.stringify(this.cache, null, 2));
      } catch (err) {
        this.logger.error(`Failed to write storage: ${(err as Error).message}`);
      }
    }, 200);
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
      fs.writeFileSync(this.file, JSON.stringify(this.cache, null, 2));
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
    queue: Array.isArray(existing.queue) ? existing.queue : incoming.queue ?? [],
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