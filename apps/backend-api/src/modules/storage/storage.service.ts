import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
 * Brokers Cloudflare R2 (S3-compatible) signed URLs so large vault artifacts
 * move directly between the desktop client and object storage — never through
 * this backend. R2 credentials stay server-side; clients only ever receive
 * short-lived presigned URLs. Stored objects are AES-GCM ciphertext (encrypted
 * on the client). R2 has no per-file size cap and zero egress fees.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.storage.enabled;
  }

  get inlineMaxBytes(): number {
    return this.config.storage.inlineMaxBytes;
  }

  private s3(): S3Client {
    if (!this.client) {
      const s = this.config.storage;
      this.client = new S3Client({
        region: 'auto',
        endpoint: s.endpoint,
        credentials: {
          accessKeyId: s.accessKeyId,
          secretAccessKey: s.secretAccessKey,
        },
        // R2 rejects the AWS SDK's default trailing-checksum headers on
        // presigned URLs; only compute them when the operation requires it.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    }
    return this.client;
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Object storage is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY)',
      );
    }
  }

  /** Allocates an object key for an owner and returns a signed upload URL. */
  async createSignedUpload(ownerId: string): Promise<SignedUpload> {
    this.assertEnabled();
    const objectKey = `${ownerId}/${randomUUID()}`;
    const expiresIn = this.config.storage.signedUrlTtlSeconds;
    try {
      const uploadUrl = await getSignedUrl(
        this.s3(),
        new PutObjectCommand({
          Bucket: this.config.storage.bucket,
          Key: objectKey,
        }),
        { expiresIn },
      );
      return { objectKey, uploadUrl, method: 'PUT', expiresIn };
    } catch (err) {
      this.logger.error(`presign upload failed: ${String(err)}`);
      throw new ServiceUnavailableException('Could not create upload URL');
    }
  }

  /** Returns a signed download URL for an existing object. */
  async createSignedDownload(objectKey: string): Promise<string> {
    this.assertEnabled();
    try {
      return await getSignedUrl(
        this.s3(),
        new GetObjectCommand({
          Bucket: this.config.storage.bucket,
          Key: objectKey,
        }),
        { expiresIn: this.config.storage.signedUrlTtlSeconds },
      );
    } catch (err) {
      this.logger.error(`presign download failed: ${String(err)}`);
      throw new ServiceUnavailableException('Could not create download URL');
    }
  }

  /** Best-effort deletion of objects (e.g. when a vault is replaced/deleted). */
  async deleteObjects(objectKeys: readonly string[]): Promise<void> {
    if (!this.enabled || objectKeys.length === 0) return;
    try {
      await this.s3().send(
        new DeleteObjectsCommand({
          Bucket: this.config.storage.bucket,
          Delete: {
            Objects: objectKeys.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    } catch (err) {
      this.logger.warn(`orphan artifact cleanup failed: ${String(err)}`);
    }
  }
}
