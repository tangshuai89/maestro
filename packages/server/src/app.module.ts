import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { MusicModule } from './music/music.module';
import { CommonModule } from './common/common.module';
import { RecoModule } from './reco/reco.module';
import { BackupModule } from './common/backup/backup.module';

@Module({
  imports: [CommonModule, AuthModule, MusicModule, RecoModule, BackupModule],
})
export class AppModule {}