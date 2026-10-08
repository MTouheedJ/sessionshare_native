import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { DataSource, DataSourceOptions } from 'typeorm';
import {
  OwnerToken,
  SessionLog,
  SessionVault,
  User,
  UserToken,
} from './entities';

/**
 * Standalone TypeORM DataSource used by the migration CLI
 * (`npm run migration:generate` / `migration:run`). The NestJS runtime builds
 * its own options from validated config but reuses ENTITIES and MIGRATIONS below.
 */

export const ENTITIES = [User, OwnerToken, UserToken, SessionLog, SessionVault];

// __dirname is src/database under ts-node (generate) and dist/database at runtime,
// so the brace glob matches the right extension in each context.
export const MIGRATIONS = [join(__dirname, 'migrations', '*.{ts,js}')];
export const MIGRATIONS_TABLE = 'migrations';

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Enable TLS for managed providers (Supabase, RDS, …) via DB_SSL, defaulting on
 * in production. `rejectUnauthorized: false` accepts the provider's chain.
 */
export function sslOption(): false | { rejectUnauthorized: boolean } {
  const useSsl = envBool('DB_SSL', process.env.NODE_ENV === 'production');
  return useSsl ? { rejectUnauthorized: false } : false;
}

export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: env('DB_HOST', 'localhost'),
    port: Number.parseInt(env('DB_PORT', '5432'), 10),
    username: env('DB_USER', 'admin'),
    password: env('DB_PASSWORD', 'secretpassword'),
    database: env('DB_NAME', 'sessionshare'),
    ssl: sslOption(),
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: MIGRATIONS_TABLE,
    uuidExtension: 'pgcrypto',
    synchronize: false,
  };
}

// Load .env so the CLI picks up DB credentials without a process manager.
if (existsSync('.env')) {
  loadEnvFile('.env');
}

export default new DataSource(buildDataSourceOptions());
