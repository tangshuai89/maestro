import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ConfigService } from './common/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const cfg = app.get(ConfigService);

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