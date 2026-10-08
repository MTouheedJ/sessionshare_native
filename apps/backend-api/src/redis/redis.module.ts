import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';

/** General-purpose command connection. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
/** Dedicated connection in subscriber mode (cannot issue regular commands). */
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');

function createClient(config: AppConfig, name: string): Redis {
  const logger = new Logger(`Redis:${name}`);
  const client = new Redis(config.redisUrl, {
    connectionName: `sessionshare-${name}`,
  });
  client.on('error', (error: Error) => logger.error(error.message));
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis => createClient(config, 'client'),
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis =>
        createClient(config, 'subscriber'),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.subscriber.quit()]);
  }
}
