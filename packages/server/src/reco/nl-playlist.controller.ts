/**
 * NL playlist controller（specs/nl-playlist/ commit 1 = A1+A2）。
 *
 * POST /reco/parse-intent —— 客户端给一句人话，DeepSeek 解析成 NLIntent。
 * 后续 commit 2 (A3) 才把 Intent 拼进 reco.run 扩展入参。
 */
import {
  Body,
  Controller,
  Delete,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Get,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RecoService } from './reco.service';
import { MusicService } from '../music/music.service';
import { SessionService } from '../common/session';
import { PlaylistService, type Playlist } from '../library/playlist.service';
import { RequireInternalTokenGuard } from '../common/guards/require-internal-token.guard';
import {
  buildParseIntentPrompt,
  parseIntentResponse,
  pickLibrarySample,
  validateParseIntentInput,
  type NLIntent,
} from './nl-intent';

const log = new Logger('NLPlaylistController');

interface ParseIntentRequest {
  text: string;
}

interface ParseIntentResponse {
  intent: NLIntent;
  raw?: string;
}

/** All routes here are CSRF-gated by RequireInternalTokenGuard —— 与其余
 *  controller 同一条审计基线（audit 1.1）；parse-intent 会消耗用户的
 *  DeepSeek token，绝不能裸奔。 */
@UseGuards(RequireInternalTokenGuard)
@Controller()  // 路由前缀各方法自填（@Post('reco/parse-intent') 等）
export class NLPlaylistController {
  constructor(
    private readonly reco: RecoService,
    private readonly music: MusicService,
    private readonly sessionService: SessionService,
    private readonly playlists: PlaylistService,
  ) {}

  @Post('reco/parse-intent')
  async parseIntent(
    @Body() body: ParseIntentRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ParseIntentResponse> {
    const text = validateParseIntentInput(body?.text);
    const session = this.sessionService.resolve(req, res);

    // 1. 必须有 DeepSeek key（沿用 reco 的 PRECONDITION_REQUIRED 路径）
    if (!this.reco.isConfigured()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PRECONDITION_REQUIRED,
          error: 'deepseek_key_not_configured',
          message: '请先在设置里填入 DeepSeek API key',
        },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }

    // 2. 拉库上下文（空库也能跑，仅是锚点为空）
    const lib = this.music.getLibrary(session);
    const sample = pickLibrarySample(lib, 50);

    // 3. 调 DeepSeek（沿用 RecoService.callDeepSeek；走同一超时 + 5xx/429 抛错逻辑）
    const apiKey = process.env.DEEPSEEK_API_KEY ?? ''; // isConfigured 已验过
    const messages = buildParseIntentPrompt(text, sample);
    let raw = '';
    try {
      raw = await this.reco.callDeepSeekForParse(apiKey, messages, {
        maxTokens: 800, // Intent JSON 体小，封顶 800 防模型啰嗦
      });
    } catch (e) {
      // callDeepSeek 已把 429/5xx 转 HttpException；网络错误转 502
      // 这里只补一条日志，原样抛
      log.warn(`parseIntent: upstream failed: ${(e as Error).message}`);
      throw e;
    }

    // 4. 解析 + 校验（parseIntentResponse 失败 → 502 + raw）
    const { intent } = parseIntentResponse(raw);
    log.log(
      `parseIntent: text=${text.length}c lib=${sample.length} ` +
        `→ genres=${intent.genres.length} tempo=${intent.tempo} lang=${intent.language} ` +
        `target=${intent.target_count}`,
    );
    return { intent, raw };
  }

  // ── 歌单 CRUD（specs/nl-playlist/ §Task A4+A5）──────────────

  @Post('library/playlists')
  createPlaylist(
    @Body() body: { name: string; tracks: any[]; prompt?: string; source?: 'nl' | 'manual' },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Playlist {
    const session = this.sessionService.resolve(req, res);
    return this.playlists.create(session.id, body);
  }

  @Get('library/playlists')
  listPlaylists(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Playlist[] {
    const session = this.sessionService.resolve(req, res);
    return this.playlists.list(session.id);
  }

  @Get('library/playlists/:id')
  getPlaylist(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Playlist {
    const session = this.sessionService.resolve(req, res);
    return this.playlists.get(session.id, id);
  }

  @Delete('library/playlists/:id')
  deletePlaylist(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): { ok: true } {
    const session = this.sessionService.resolve(req, res);
    return this.playlists.delete(session.id, id);
  }

  @Patch('library/playlists/:id')
  patchPlaylist(
    @Param('id') id: string,
    @Body() body: { name?: string; append?: any[]; remove?: string[] },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Playlist {
    const session = this.sessionService.resolve(req, res);
    return this.playlists.patch(session.id, id, body);
  }
}
