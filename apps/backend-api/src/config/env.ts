export interface AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly username: string;
    readonly password: string;
    readonly database: string;
    /** Enable TLS (managed providers like Supabase/RDS). */
    readonly ssl: boolean;
    /** Auto-create/update schema from entities. Must be false in production. */
    readonly synchronize: boolean;
    /** Run pending migrations automatically on application boot. */
    readonly runMigrations: boolean;
  };
  readonly redisUrl: string;
  /** 32-byte AES-256-GCM key (base64) for the session vault. */
  readonly vaultKey: Buffer;
  readonly dashboardOrigins: readonly string[];
  /** Origins allowed to call the REST API directly (desktop app webview). */
  readonly desktopOrigins: readonly string[];
  readonly jwt: {
    readonly secret: string;
    readonly expiresInSeconds: number;
    readonly desktopExpiresInSeconds: number;
    readonly wsTicketExpiresInSeconds: number;
  };
  /** Cloudflare R2 (S3-compatible) object storage for large vault artifacts. */
  readonly storage: {
    /** True only when the account id + access key + secret are all configured. */
    readonly enabled: boolean;
    /** Cloudflare account id (used to derive the default endpoint). */
    readonly accountId: string;
    /** R2 access key id (server-only; never sent to clients). */
    readonly accessKeyId: string;
    /** R2 secret access key (server-only; never sent to clients). */
    readonly secretAccessKey: string;
    /** S3 API endpoint, e.g. https://<account>.r2.cloudflarestorage.com. */
    readonly endpoint: string;
    readonly bucket: string;
    /** Files at or below this size are inlined in the vault instead of object storage. */
    readonly inlineMaxBytes: number;
    /** Lifetime of signed upload/download URLs. */
    readonly signedUrlTtlSeconds: number;
  };
}

function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function toInt(key: string, fallback: number): number {
  const parsed = Number.parseInt(optional(key, String(fallback)), 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer`);
  }
  return parsed;
}

function vaultKey(): Buffer {
  const key = Buffer.from(required('VAULT_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) {
    throw new Error('VAULT_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

function toBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function csv(key: string, fallback: string): string[] {
  return optional(key, fallback)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

export function loadConfig(): AppConfig {
  const nodeEnv = optional('NODE_ENV', 'development');
  return {
    nodeEnv,
    port: toInt('PORT', 3000),
    db: {
      host: optional('DB_HOST', 'localhost'),
      port: toInt('DB_PORT', 5432),
      username: optional('DB_USER', 'admin'),
      password: optional('DB_PASSWORD', 'secretpassword'),
      database: optional('DB_NAME', 'sessionshare'),
      ssl: toBool('DB_SSL', nodeEnv === 'production'),
      // Production must never auto-sync; it defaults off there and on in dev.
      synchronize: toBool('DB_SYNCHRONIZE', nodeEnv !== 'production'),
      runMigrations: toBool('DB_MIGRATIONS_RUN', false),
    },
    redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),
    vaultKey: vaultKey(),
    dashboardOrigins: csv('DASHBOARD_ORIGINS', 'http://localhost:3001'),
    desktopOrigins: csv(
      'DESKTOP_ORIGINS',
      // Tauri webview origins (dev + Windows/macOS/Linux packaged) that call the API directly.
      'http://localhost:1420,http://tauri.localhost,https://tauri.localhost,tauri://localhost',
    ),
    jwt: {
      secret: required('JWT_SECRET'),
      expiresInSeconds: toInt('JWT_EXPIRES_IN_SECONDS', 3600),
      desktopExpiresInSeconds: toInt('JWT_DESKTOP_EXPIRES_IN_SECONDS', 900),
      wsTicketExpiresInSeconds: toInt('JWT_WS_TICKET_EXPIRES_IN_SECONDS', 60),
    },
    storage: (() => {
      const accountId = optional('R2_ACCOUNT_ID', '');
      const accessKeyId = optional('R2_ACCESS_KEY_ID', '');
      const secretAccessKey = optional('R2_SECRET_ACCESS_KEY', '');
      return {
        enabled:
          accountId !== '' && accessKeyId !== '' && secretAccessKey !== '',
        accountId,
        accessKeyId,
        secretAccessKey,
        endpoint: optional(
          'R2_ENDPOINT',
          accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '',
        ).replace(/\/$/, ''),
        bucket: optional('R2_BUCKET', 'vault-artifacts'),
        inlineMaxBytes: toInt('VAULT_INLINE_MAX_BYTES', 5 * 1024 * 1024),
        signedUrlTtlSeconds: toInt('VAULT_SIGNED_URL_TTL_SECONDS', 600),
      };
    })(),
  };
}
