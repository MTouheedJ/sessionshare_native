import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { AppModule, ObserveInstrument } from './app.module';
import { APP_CONFIG } from './config/config.module';
import type { AppConfig } from './config/env';
import { CorsIoAdapter } from './modules/realtime/cors-io.adapter';

const VAULT_UPLOAD_PATH = '/api/v1/owner/vault/upload';
// Large enough to carry a bundled portable app binary (zero-install model).
const VAULT_BODY_LIMIT = process.env.VAULT_BODY_LIMIT ?? '256mb';
const DEFAULT_BODY_LIMIT = '100kb';

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
    bodyParser: false,
  });
  // Only the vault upload (encrypted profile + seed files) gets a large body limit.
  app.use(VAULT_UPLOAD_PATH, json({ limit: VAULT_BODY_LIMIT }));
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // REST CORS for the desktop app webview (the dashboard uses a same-origin proxy).
  app.enableCors({
    origin: [...config.desktopOrigins, ...config.dashboardOrigins],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'ngrok-skip-browser-warning',
    ],
    maxAge: 86_400,
  });
  app.useWebSocketAdapter(
    new CorsIoAdapter(app, [
      ...config.dashboardOrigins,
      ...config.desktopOrigins,
    ]),
  );
  app.enableShutdownHooks();
  await app.listen(config.port);
}
void bootstrap();
