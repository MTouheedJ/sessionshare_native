import { Module } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/env';
import { ENTITIES, MIGRATIONS, MIGRATIONS_TABLE } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TypeOrmModuleOptions => ({
        type: 'postgres',
        host: config.db.host,
        port: config.db.port,
        username: config.db.username,
        password: config.db.password,
        database: config.db.database,
        ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
        entities: ENTITIES,
        migrations: MIGRATIONS,
        migrationsTableName: MIGRATIONS_TABLE,
        uuidExtension: 'pgcrypto',
        // Never auto-sync in production; apply schema via migrations instead.
        synchronize: config.db.synchronize,
        migrationsRun: config.db.runMigrations,
        logging:
          config.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
      }),
    }),
  ],
})
export class DatabaseModule {}
