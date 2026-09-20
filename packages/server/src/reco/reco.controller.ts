import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RecoService } from './reco.service';
import { SessionService } from '../common/session';
import { RequireInternalTokenGuard } from '../common/guards/require-internal-token.guard';

/** All routes here are CSRF-gated by RequireInternalTokenGuard. */
@UseGuards(RequireInternalTokenGuard)
@Controller('reco')
export class RecoController {
  constructor(
    private readonly reco: RecoService,
    private readonly sessionService: SessionService,
  ) {}

  /** 当前是否已设 DeepSeek key + 库规模。给前端 UI 决定按钮是否可点。 */
  @Get('status')
  status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = this.sessionService.resolve(req, res);
    return this.reco.status(session);
  }

  /** 跑一次推荐。 */
  @Post('run')
  async run(
    @Body()
    body: {
      count?: number;
      language?: string;
      mood?: string;
      exclude?: Array<{ title?: string; artist?: string }>;
      /** 以某首歌为种子（"放点像这首的"）。 */
      seed?: { title?: string; artist?: string };
    } = {},
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = this.sessionService.resolve(req, res);
    // 宽松清洗 exclude：只留有 title+artist 的项，其余丢弃（脏数据不 400）。
    const exclude = Array.isArray(body?.exclude)
      ? body.exclude
          .filter(
            (e): e is { title: string; artist: string } =>
              !!e &&
              typeof e.title === 'string' &&
              typeof e.artist === 'string',
          )
          .slice(0, 200)
      : undefined;
    // 种子宽松清洗：title + artist 都齐才算数（否则忽略，走普通推荐）。
    const seed =
      body?.seed &&
      typeof body.seed.title === 'string' &&
      typeof body.seed.artist === 'string' &&
      body.seed.title.trim() &&
      body.seed.artist.trim()
        ? { title: body.seed.title.trim(), artist: body.seed.artist.trim() }
        : undefined;
    return this.reco.run(session, { ...(body ?? {}), exclude, seed });
  }

  /**
   * 上报播放行为信号（播放/完播/跳过/红心/踩）。
   *
   * 兼容两种 body：单条 `{ type, title, artist, progress? }`，
   * 或批量 `{ signals: [...] }`。脏数据丢弃、返回 stored = 当前累计条数，
   * **永远 200**——上报失败不该影响播放。
   */
  @Post('signal')
  signal(
    @Body() body: Record<string, unknown> = {},
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = this.sessionService.resolve(req, res);
    const list = Array.isArray(body?.signals) ? body.signals : [body];
    return this.reco.recordSignals(session, list);
  }

  /**
   * 离线评测（留一法）——本地诊断用，`pool` 模式不消耗 DeepSeek token。
   * 详见 `reco/eval.ts` 与 CLI `npm run reco:eval`。
   */
  @Post('eval')
  async evaluate(
    @Body()
    body: {
      holdoutSize?: number;
      count?: number;
      mode?: string;
      runs?: number;
      seed?: number;
    } = {},
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = this.sessionService.resolve(req, res);
    const numeric = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    return this.reco.evaluate(session, {
      holdoutSize: numeric(body?.holdoutSize),
      count: numeric(body?.count),
      runs: numeric(body?.runs),
      seed: numeric(body?.seed),
      mode: body?.mode === 'llm' ? 'llm' : 'pool',
    });
  }

  /** 写 key 到 .storage/secrets.json。 */
  @Post('key')
  async saveKey(
    @Body() body: { apiKey?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.apiKey || typeof body.apiKey !== 'string') {
      throw new BadRequestException('apiKey 必填');
    }
    return this.reco.setApiKey(body.apiKey);
  }

  /** §5 Settings：清掉用户的 DeepSeek key。无 body 参数。 */
  @Post('key/reset')
  resetKey() {
    return this.reco.resetApiKey();
  }
}
