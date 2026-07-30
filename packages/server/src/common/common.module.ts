import { Module, Global } from '@nestjs/common';
import { ConfigService } from './config';
import { StorageService } from './storage';
import { SessionService } from './session';
import { RequireInternalTokenGuard } from './guards/require-internal-token.guard';

@Global()
@Module({
  providers: [
    ConfigService,
    StorageService,
    SessionService,
    RequireInternalTokenGuard,
  ],
  exports: [ConfigService, StorageService, SessionService, RequireInternalTokenGuard],
})
export class CommonModule {}