import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { MusicService } from './music.service';
import { normalizeProvider } from '../common/provider';

@Controller('music')
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  @Get('next')
  getNextTrack(@Query('provider') provider: string) {
    return this.musicService.getNextTrack(normalizeProvider(provider));
  }

  @Post('like/:trackId')
  likeTrack(
    @Param('trackId') trackId: string,
    @Query('provider') provider: string,
  ) {
    return this.musicService.likeTrack(normalizeProvider(provider), trackId);
  }

  @Get('liked')
  getLikedTracks(@Query('provider') provider: string) {
    return this.musicService.getLikedTracks(normalizeProvider(provider));
  }
}
