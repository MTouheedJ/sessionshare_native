import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';

export interface SignedUpload {
  /** Object path inside the bucket; persisted in the vault metadata. */
  objectKey: string;
  /** Absolute URL the client PUTs the (encrypted) bytes to. */
  uploadUrl: string;
  /** HTTP method to use for the upload. */
  method: 'PUT';
  /** Seconds until the URL expires. */
  expiresIn: number;
}

/**
 * Brokers Supabase Storage signed URLs so large vault artifacts move directly
 * between the desktop client and object storage — never through this backend.
 * The service-role key stays server-side; clients only ever receive short-lived
 * signed URLs. Stored objects are AES-GCM ciphertext (encrypted on the client).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.storage.enabled;
  }

  get inlineMaxBytes(): number {
    return this.config.storage.inlineMaxBytes;
  }

  private base(): string {
    return `${this.config.storage.supabaseUrl}/storage/v1`;
  }

  private headers(): Record<string, string> {
    const key = this.config.storage.serviceRoleKey;
    return { apikey: key, Authorization: `Bearer ${key}` };
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Object storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)',
      );
    }
  }

  /** Allocates an object key for an owner and returns a signed upload URL. */
  async createSignedUpload(ownerId: string): Promise<SignedUpload> {
    this.assertEnabled();
    const objectKey = `${ownerId}/${randomUUID()}`;
    const bucket = this.config.storage.bucket;
    const endpoint = `${this.base()}/object/upload/sign/${bucket}/${objectKey}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: this.headers(),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      this.logger.error(
        `presign upload failed (${res.status}): ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException('Could not create upload URL');
    }
    // Supabase returns a relative URL like "/object/upload/sign/<bucket>/<key>?token=..."
    const relative = (body as { url?: string }).url;
    if (!relative) {
      throw new ServiceUnavailableException(
        'Storage did not return an upload URL',
      );
    }
    return {
      objectKey,
      uploadUrl: `${this.base()}${relative}`,
      method: 'PUT',
      expiresIn: this.config.storage.signedUrlTtlSeconds,
    };
  }

  /** Returns a signed download URL for an existing object. */
  async createSignedDownload(objectKey: string): Promise<string> {
    this.assertEnabled();
    const bucket = this.config.storage.bucket;
    const endpoint = `${this.base()}/object/sign/${bucket}/${objectKey}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expiresIn: this.config.storage.signedUrlTtlSeconds,
      }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      this.logger.error(
        `presign download failed (${res.status}): ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException('Could not create download URL');
    }
    const relative = (body as { signedURL?: string }).signedURL;
    if (!relative) {
      throw new ServiceUnavailableException(
        'Storage did not return a download URL',
      );
    }
    return `${this.base()}${relative}`;
  }

  /** Best-effort deletion of objects (e.g. when a vault is replaced/deleted). */
  async deleteObjects(objectKeys: readonly string[]): Promise<void> {
    if (!this.enabled || objectKeys.length === 0) return;
    const bucket = this.config.storage.bucket;
    await Promise.allSettled(
      objectKeys.map((key) =>
        fetch(`${this.base()}/object/${bucket}/${key}`, {
          method: 'DELETE',
          headers: this.headers(),
        }),
      ),
    );
  }
}
