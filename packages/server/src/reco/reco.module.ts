import { Module } from '@nestjs/common';
import { RecoService } from './reco.service';
import { RecoController } from './reco.controller';
import { NLPlaylistController } from './nl-playlist.controller';
import { MusicModule } from '../music/music.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule, MusicModule],
  controllers: [RecoController, NLPlaylistController],
  providers: [RecoService],
  exports: [RecoService],
})
export class RecoModule {}
