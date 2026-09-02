import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ConfigService } from './common/config';
import { StorageService } from './common/storage';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const cfg = app.get(ConfigService);

  // T10 (consistency-fixes G1)：SIGTERM 时立即 flush 存储。
  // 旧实现：Electron 退出前 sidecar.kill('SIGTERM') 不等 flush，
  // 200ms debounce 内的红心/登录丢失。新实现：Electron 发 SIGTERM 后
  // 同步等 ≤500ms，这里收到信号立刻 flushSync 再退出。
  const storage = app.get(StorageService);
  const flushAndExit = (): void => {
    try {
      storage.flushSync();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGTERM', flushAndExit);
  process.on('SIGINT', flushAndExit);

  app.use(cookieParser(cfg.sessionSecret));
  // CORS: allow the X-Maestro-Token header on all routes that the
  // renderer calls. allowlist is `cfg.rendererOrigins` (dev:5173, etc).
  // Without this, the browser would refuse the custom header at
  // preflight and the guard would 401 everything.
  app.enableCors({
    origin: cfg.rendererOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Maestro-Token'],
    exposedHeaders: ['X-Maestro-Token'],
  });

  await app.listen(cfg.port);
  // 用 NestJS Logger 而非 console.log（项目约定：日志统一走 Logger）。
  new Logger('Bootstrap').log(
    `Server running on http://localhost:${cfg.port}` +
      (cfg.internalToken ? ' (X-Maestro-Token guard armed)' : ' (dev: token guard permissive)'),
  );
}
bootstrap();