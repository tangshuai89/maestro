import { Module } from '@nestjs/common';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';
import { QqMusicProvider } from './qq.provider';
import { NeteaseMusicProvider } from './netease.provider';
import { DeezerMusicProvider } from './deezer.provider';
import { CommonModule } from '../common/common.module';
import { MatchService } from '../match/match.service';

@Module({
  imports: [CommonModule],
  controllers: [MusicController],
  providers: [
    MusicService,
    MatchService,
    QqMusicProvider,
    NeteaseMusicProvider,
    DeezerMusicProvider,
  ],
  exports: [MusicService, MatchService],
})
export class MusicModule {}