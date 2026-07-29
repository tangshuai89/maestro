import {
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { StorageService } from './storage';
import { ConfigService } from './config';
import { MusicProvider } from './provider';

export interface ProviderSession {
  // QQ 音乐（真登录 cookie，来自内嵌登录窗口；不是 QQ 互联 OAuth token）
  qqCookie?: string; // 完整 "k=v; k=v" cookie header
  qqUin?: string; // 归一化后的纯数字 uin，用于 musicu.fcg
  /**
   * 解析后的 cookie map（qqmusic_key / qm_keyst / skey / p_skey / p_uin /
   * uin / …）。与 qqCookie 共存：qqCookie 是拼好的请求头，qqCookies 是按
   * 名访问的 map（g_tk 计算 / 后续端点按名取值都用这个）。
   * 老 session 里可能只有 qqCookie，没有 qqCookies —— 缺字段时直接兜底
   * '5381'（DJB2 of ""），favorites 仍能走（cookie 才是真鉴权）。
   */
  qqCookies?: Record<string, string>;
  /**
   * 是否 QQ 音乐绿钻会员（VIP）。登录时 best-effort 拉一次存下来。
   * 决定 pay_play=1 的歌是否标 vipLocked：绿钻能播全曲 → 不锁；非绿钻 → 锁。
   * `undefined` = 未知（老 session / 拉取失败）→ 按非会员处理（pay_play 生效），
   * 与本功能上线前的行为一致，重新登录后会填上。 */
  qqVip?: boolean;
  // NetEase
  musicU?: string;
  csrfToken?: string;
  /**
   * 是否网易云 VIP（黑胶/SVIP）。登录时 best-effort 拉一次 `vip_info` 缓存。
   * 决定 privileges 数组里**漏掉**的歌（pl 缺失）算不算 VIP 锁：黑胶/SVIP
   * 仍可能放全曲 → 不锁；非 VIP → 锁。
   * `undefined` = 未知（老 session / 拉取失败）→ 按非会员处理（与 QQ `qqVip`
   * 同口径，重新登录后会填上）。见 netease-auth.strategy.fetchVipStatus。 */
  neteaseVip?: boolean;
  // Spotify (OAuth PKCE)
  spotify?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // ms epoch
    /** Cached Spotify product tier, captured during exchangeCode from /v1/me's
     * `product` field. Used by the renderer to decide whether to route
     * playback through the Web Playback SDK (premium) or fall back to the
     * 30s preview path (free). Optional so old persisted sessions still
     * load; the next /me call fills it in lazily. */
    tier?: 'premium' | 'free' | 'open';
    /** Cached profile info from the most recent /v1/me. Same lazy fill as tier. */
    spotifyUserId?: string;
    spotifyDisplayName?: string;
  };
  // Profile (shared)
  nickname?: string;
  avatarUrl?: string;
}

export interface Session {
  id: string;
  createdAt: number;
  /** Last access (ms epoch) for sliding TTL. Defaults to createdAt for
   *  legacy sessions that predate this field. */
  lastAccessedAt: number;
  providers: Partial<Record<MusicProvider, ProviderSession>>;
  /** Per-session UI prefs (e.g. the Deezer preset). Anonymous providers
   * don't have a ProviderSession, so this is where we stash their
   * state. */
  prefs?: Record<string, string>;
}

const COOKIE_NAME = 'mb_session';
const SESSION_KEY = 'sessions';

interface SessionBlob {
  byId: Record<string, Session>;
}

@Injectable()
export class SessionService implements OnModuleDestroy {
  private blob: SessionBlob = { byId: {} };

  constructor(
    private readonly storage: StorageService,
    private readonly cfg: ConfigService,
  ) {
    const persisted = this.storage.get<SessionBlob>(SESSION_KEY);
    if (persisted) {
      this.blob = persisted;
      // Migration: legacy sessions predate lastAccessedAt → default to
      // createdAt so they don't immediately look "stale" and so existing
      // users don't get logged out on upgrade.
      for (const s of Object.values(this.blob.byId)) {
        if (typeof (s as Session).lastAccessedAt !== 'number') {
          (s as Session).lastAccessedAt = (s as Session).createdAt;
        }
      }
      this.evictExpired();
    }
  }

  onModuleDestroy(): void {
    this.storage.set(SESSION_KEY, this.blob);
    this.storage.flushSync();
  }

  onModuleInit(): void {
    // Hourly reaper so the cookie's sliding window doesn't accumulate
    // orphan sessions in memory. unref() lets the timer not block process
    // exit.
    const t = setInterval(() => this.evictExpired(), 60 * 60_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t as any).unref?.();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, s] of Object.entries(this.blob.byId)) {
      const last = s.lastAccessedAt ?? s.createdAt;
      if (now - last > this.cfg.sessionTtlMs) {
        delete this.blob.byId[id];
      }
    }
  }

  private persist(): void {
    this.storage.set(SESSION_KEY, this.blob);
  }

  /** Read or create a session based on the request cookie. */
  resolve(req: Request, res: Response): Session {
    let id = (req as Request & { signedCookies?: Record<string, string> }).signedCookies?.[
      COOKIE_NAME
    ];
    let session = id ? this.blob.byId[id] : undefined;
    if (!session) {
      id = randomBytes(24).toString('hex');
      const now = Date.now();
      session = { id, createdAt: now, lastAccessedAt: now, providers: {} };
      this.blob.byId[id] = session;
      res.cookie(COOKIE_NAME, id, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: this.cfg.sessionTtlMs,
        // secure: true in production (requires HTTPS)
        secure: false,
        // Signed with cfg.sessionSecret → lands in req.signedCookies and
        // can't be tampered client-side. Must match the read side, which
        // reads signedCookies (see above).
        signed: true,
      });
      this.persist();
    } else {
      // Slide TTL.
      session.lastAccessedAt = Date.now();
    }
    return session;
  }

  /** Require an existing session, otherwise 401. */
  require(req: Request, res: Response): Session {
    const id = (req as Request & { signedCookies?: Record<string, string> }).signedCookies?.[
      COOKIE_NAME
    ];
    const session = id ? this.blob.byId[id] : undefined;
    if (!session) {
      throw new UnauthorizedException('No active session');
    }
    // Slide TTL on every call.
    session.lastAccessedAt = Date.now();
    // Refresh the cookie sliding window.
    res.cookie(COOKIE_NAME, id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: this.cfg.sessionTtlMs,
      secure: false,
      // Sign the cookie with cfg.sessionSecret so it lands in
      // req.signedCookies and can't be forged/tampered client-side.
      // (Previously the secret was passed to cookieParser but never used
      // because cookies were unsigned — dead config.)
      signed: true,
    });
    return session;
  }

  getProvider(
    session: Session,
    provider: MusicProvider,
  ): ProviderSession | undefined {
    return session.providers[provider];
  }

  setProvider(
    session: Session,
    provider: MusicProvider,
    data: ProviderSession,
  ): void {
    session.providers[provider] = { ...session.providers[provider], ...data };
    this.persist();
  }

  clearProvider(session: Session, provider: MusicProvider): void {
    delete session.providers[provider];
    this.persist();
  }

  /**
   * Persist a refreshed Spotify token via setProvider so the change lands
   * in state.json (the previous implementation mutated session.spotify
   * in place and never called persist → token refresh was lost across
   * server restarts until the next refresh attempt).
   */
  persistSpotify(sessionId: string, providerSession: ProviderSession): void {
    const s = this.blob.byId[sessionId];
    if (!s) return;
    s.providers.spotify = providerSession.spotify
      ? { ...s.providers.spotify, ...providerSession }
      : providerSession;
    this.persist();
  }

  /** Last successful server-side validation for a provider's credentials
   *  (ms epoch). null = never validated. */
  getLastValidatedAt(session: Session, provider: MusicProvider): number | null {
    const v = (session.prefs ?? {})[`lastValidatedAt:${provider}`];
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  setLastValidatedAt(
    session: Session,
    provider: MusicProvider,
    ts: number,
  ): void {
    session.prefs = { ...(session.prefs ?? {}), [`lastValidatedAt:${provider}`]: String(ts) };
    this.persist();
  }

  destroy(req: Request, res: Response): void {
    const id = (req as Request & { signedCookies?: Record<string, string> }).signedCookies?.[
      COOKIE_NAME
    ];
    if (id) delete this.blob.byId[id];
    res.clearCookie(COOKIE_NAME);
    this.persist();
  }
}