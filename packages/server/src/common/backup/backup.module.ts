import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';

/**
 * 导出/导入 + 自动备份。StorageService / ConfigService 由 @Global 的
 * CommonModule 提供，这里只挂 controller。
 */
@Module({
  controllers: [BackupController],
})
export class BackupModule {}
