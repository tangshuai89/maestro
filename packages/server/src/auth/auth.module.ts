import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { QqAuthStrategy } from './qq.strategy';
import { NeteaseAuthStrategy } from './netease-auth.strategy';
import { RefreshCoordinator } from './refresh-coordinator';
import { CommonModule } from '../common/common.module';
import { MusicModule } from '../music/music.module';

@Global()
@Module({
  imports: [CommonModule, MusicModule],
  controllers: [AuthController],
  providers: [QqAuthStrategy, NeteaseAuthStrategy, RefreshCoordinator],
  exports: [QqAuthStrategy, NeteaseAuthStrategy, RefreshCoordinator],
})
export class AuthModule {}