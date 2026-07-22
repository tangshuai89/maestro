import { config } from 'dotenv';
import { resolve } from 'path';
// `cd packages/server && nest start` → cwd = packages/server/，但 .env 在
// 项目根目录。优先看 cwd（本地常见 = packages/server/），找不到再看看
// 父目录（monorepo 根下的 .env）。两个都没 → 继续（靠系统 env）。
config();
if (!process.env.SPOTIFY_CLIENT_ID) {
  config({ path: resolve(process.cwd(), '../.env') });
}
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
  app.enableCors({
    origin: cfg.rendererOrigins,
    credentials: true,
  });

  await app.listen(cfg.port);
  // 用 NestJS Logger 而非 console.log（项目约定：日志统一走 Logger）。
  new Logger('Bootstrap').log(`Server running on http://localhost:${cfg.port}`);
}
bootstrap();