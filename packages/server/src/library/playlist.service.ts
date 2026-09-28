/**
 * 本地歌单 CRUD（specs/nl-playlist/ Phase A commit 3 = A4+A5）。
 *
 * 存储：StorageService 里 `playlists:{sessionId}` key（落在 `.storage/state.json`，
 * 按 session 隔离，与 `library:{id}` 同层；沿用 StorageService 的 debounce 写盘）。
 *
 * 命名冲突：同名自动追加 `-2`、`-3`（spec §风险）。
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StorageService } from '../common/storage';
import type { UnifiedSearchItem } from '../music/types';

export interface Playlist {
  id: string;
  name: string;
  tracks: UnifiedSearchItem[];
  source: 'nl' | 'manual';
  /** NL 路径创建时保留（intent / 原始 prompt），便于 UI 一键再生。 */
  prompt?: string;
  createdAt: number;
  updatedAt: number;
}

const MAX_NAME = 60;
const MAX_PROMPT = 2000;
const MAX_TRACKS = 500; // 单歌单曲目上限（防失控）
const NAME_RE = /^\s*(\S.*?)\s*$/; // trim 后必须非空

@Injectable()
export class PlaylistService {
  private readonly logger = new Logger(PlaylistService.name);
  constructor(private readonly storage: StorageService) {}

  // ── 存储键 ────────────────────────────────────────────
  private key(sessionId: string): string {
    return `playlists:${sessionId}`;
  }

  private readAll(sessionId: string): Playlist[] {
    return this.storage.get<Playlist[]>(this.key(sessionId)) ?? [];
  }

  private writeAll(sessionId: string, list: Playlist[]): void {
    this.storage.set(this.key(sessionId), list);
  }

  // ── 校验 ─────────────────────────────────────────────
  private normalizeName(input: unknown, existing: Playlist[]): string {
    if (typeof input !== 'string') {
      throw new BadRequestException('name 必填（string）');
    }
    const trimmed = input.trim();
    if (!trimmed) {
      throw new BadRequestException('name 不能为空');
    }
    if (trimmed.length > MAX_NAME) {
      throw new BadRequestException({
        error: 'playlist_name_too_long',
        max: MAX_NAME,
        len: trimmed.length,
      });
    }
    // 唯一性：同名追加 -2、-3 ... 避免冲突（spec §风险）
    const taken = new Set(existing.map((p) => p.name));
    if (!taken.has(trimmed)) return trimmed;
    let i = 2;
    while (taken.has(`${trimmed}-${i}`)) i++;
    return `${trimmed}-${i}`;
  }

  private validateTracks(tracks: unknown): UnifiedSearchItem[] {
    if (!Array.isArray(tracks)) {
      throw new BadRequestException('tracks 必填（array）');
    }
    if (tracks.length === 0) {
      throw new BadRequestException('tracks 不能为空（至少 1 首）');
    }
    if (tracks.length > MAX_TRACKS) {
      throw new BadRequestException({
        error: 'playlist_too_many_tracks',
        max: MAX_TRACKS,
        len: tracks.length,
      });
    }
    return tracks as UnifiedSearchItem[];
  }

  // ── CRUD ──────────────────────────────────────────────
  list(sessionId: string): Playlist[] {
    return [...this.readAll(sessionId)].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  get(sessionId: string, id: string): Playlist {
    const found = this.readAll(sessionId).find((p) => p.id === id);
    if (!found) {
      throw new NotFoundException({
        error: 'playlist_not_found',
        id,
      });
    }
    return found;
  }

  create(
    sessionId: string,
    body: { name: string; tracks: UnifiedSearchItem[]; prompt?: string; source?: 'nl' | 'manual' },
  ): Playlist {
    const existing = this.readAll(sessionId);
    const name = this.normalizeName(body?.name, existing);
    const tracks = this.validateTracks(body?.tracks);
    let prompt: string | undefined;
    if (body?.prompt !== undefined) {
      if (typeof body.prompt !== 'string' || body.prompt.length > MAX_PROMPT) {
        throw new BadRequestException({
          error: 'playlist_prompt_too_long',
          max: MAX_PROMPT,
        });
      }
      prompt = body.prompt;
    }
    const now = Date.now();
    const p: Playlist = {
      id: crypto.randomUUID(),
      name,
      tracks,
      source: body?.source === 'nl' ? 'nl' : 'manual',
      ...(prompt ? { prompt } : {}),
      createdAt: now,
      updatedAt: now,
    };
    existing.push(p);
    this.writeAll(sessionId, existing);
    this.logger.log(`create: ${p.id} (${p.name}, ${p.tracks.length} tracks)`);
    return p;
  }

  delete(sessionId: string, id: string): { ok: true } {
    const list = this.readAll(sessionId);
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw new NotFoundException({ error: 'playlist_not_found', id });
    }
    list.splice(idx, 1);
    this.writeAll(sessionId, list);
    this.logger.log(`delete: ${id}`);
    return { ok: true };
  }

  patch(
    sessionId: string,
    id: string,
    body: { name?: string; append?: UnifiedSearchItem[]; remove?: string[] },
  ): Playlist {
    const list = this.readAll(sessionId);
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw new NotFoundException({ error: 'playlist_not_found', id });
    }
    const cur = list[idx];

    // name 改名
    if (body?.name !== undefined) {
      cur.name = this.normalizeName(body.name, list.filter((p) => p.id !== id));
    }
    // append 追加曲目（去重 by UnifiedSearchItem.id + sources[0]）
    if (body?.append !== undefined) {
      const add = this.validateTracks(body.append);
      const seen = new Set(
        cur.tracks.map((t) => this.trackKey(t)),
      );
      let added = 0;
      for (const t of add) {
        const k = this.trackKey(t);
        if (!seen.has(k)) {
          cur.tracks.push(t);
          seen.add(k);
          added++;
        }
      }
      this.logger.log(`patch: ${id} append ${added} (skip dups)`);
    }
    // remove 删除曲目
    if (body?.remove !== undefined) {
      if (!Array.isArray(body.remove)) {
        throw new BadRequestException('remove 必填（string[]）');
      }
      const drop = new Set(body.remove as string[]);
      const before = cur.tracks.length;
      cur.tracks = cur.tracks.filter(
        (t) => !drop.has(t.id) && !drop.has(`${t.sources?.[0]?.platform}:${t.sources?.[0]?.trackId}`),
      );
      this.logger.log(`patch: ${id} remove ${before - cur.tracks.length} tracks`);
    }
    if (cur.tracks.length > MAX_TRACKS) {
      throw new BadRequestException({
        error: 'playlist_too_many_tracks_after_patch',
        max: MAX_TRACKS,
      });
    }
    cur.updatedAt = Date.now();
    list[idx] = cur;
    this.writeAll(sessionId, list);
    return cur;
  }

  private trackKey(t: UnifiedSearchItem): string {
    const s = t.sources?.[0];
    return s ? `${s.platform}:${s.trackId}` : t.id;
  }
}
