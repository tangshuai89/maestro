import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '../config';

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
 * to the NestJS sidecar via env (MAESTRO_INTERNAL_TOKEN), and exposes it to
 * the renderer through preload's contextBridge. The renderer fetches with
 * an `X-Maestro-Token` header. This guard verifies that header matches the
 * configured token.
 *
 * When MAESTRO_INTERNAL_TOKEN is empty (dev mode — running `npm run
 * dev:server` without Electron), the guard logs a warning per request but
 * allows the request through. Production Electron always sets the token.
 *
 * The guard runs on EVERY method (POST/PUT/DELETE/GET) when the token is
 * configured. Some endpoints are read-only GETs — they don't strictly need
 * the token — but adding the check uniformly means a forgotten endpoint
 * (e.g. /auth/logout that mutates session) still gets protected.
 */
@Injectable()
export class RequireInternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(RequireInternalTokenGuard.name);

  constructor(private readonly cfg: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
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