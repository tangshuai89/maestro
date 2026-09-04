import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '../config';
import { SKIP_INTERNAL_TOKEN } from '../decorators/skip-internal-token.decorator';

/**
 * Guards state-changing endpoints from CSRF / cross-process abuse.
 *
 * Background (audit 1.1): every state-changing endpoint in the server
 * (POST/PUT/DELETE plus a few GETs like /auth/spotify/redeem and
 * /auth/logout) was reachable from any localhost process. Combined with
 * `enableCors({credentials:true})` and signed-cookie auth, a malicious
 * page or another local app could mutate state without the user's consent.
 *
 * Mitigation: Electron main generates a random per-launch token, passes it
 * to the NestJS sidecar via env (MAESTRO_INTERNAL_TOKEN), and exposes it
 * to the renderer through preload's contextBridge. The renderer fetches with
 * an `X-Maestro-Token` header. This guard verifies that header matches the
 * configured token.
 *
 * When MAESTRO_INTERNAL_TOKEN is empty (dev mode — running `npm run
 * dev:server` without Electron), the guard logs a warning per request but
 * allows the request through. Production Electron always sets the token.
 *
 * Audit A1 (consistency-fixes T1): media GET routes (`/music/stream/*`,
 * `/music/cover-proxy`, `/music/lyrics*`, `/music/deezer/editorials`) are
 * read-only and cannot carry an `X-Maestro-Token` header — `<audio>` /
 * `<img>` don't allow custom headers. They opt out via
 * `@SkipInternalToken()` and rely on the signed session cookie for
 * identity (HttpOnly + SameSite=Strict makes cross-process forgery hard).
 * State-changing routes (POST/PUT/DELETE plus auth/login/redeem) keep
 * the strict token check.
 */
@Injectable()
export class RequireInternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(RequireInternalTokenGuard.name);

  constructor(
    private readonly cfg: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Audit A1: allow media-only GET endpoints to bypass the token gate.
    // Check both the handler method and the controller class metadata.
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_INTERNAL_TOKEN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const expected = this.cfg.internalToken;
    if (!expected) {
      // No token configured — dev mode. Allow but warn.
      this.logger.warn(
        `${req.method} ${req.url} accepted without internal token ` +
          '(MAESTRO_INTERNAL_TOKEN not set; dev mode?)',
      );
      return true;
    }

    const got = this.headerValue(req.headers['x-maestro-token']);
    if (got !== expected) {
      this.logger.warn(
        `${req.method} ${req.url} rejected: bad/missing X-Maestro-Token`,
      );
      throw new UnauthorizedException('X-Maestro-Token mismatch');
    }
    return true;
  }

  private headerValue(v: string | string[] | undefined): string | undefined {
    if (Array.isArray(v)) return v[0];
    return v;
  }
}
