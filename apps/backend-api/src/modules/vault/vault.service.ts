import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { Repository } from 'typeorm';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import {
  SessionLog,
  SessionVault,
  TokenStatus,
  TokenType,
  UserStatus,
} from '../../database/entities';
import type { DesktopIdentity } from '../auth/interfaces/jwt-payload.interface';
import { TokenStatusService } from '../realtime/token-status.service';
import { SignedUpload, StorageService } from '../storage/storage.service';
import type { VaultPayloadDto } from './dto/vault-payload.dto';

const FORMAT_PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface VaultMetadata {
  checksum: string;
  updatedAt: Date;
  sizeBytes: number;
}

export interface VaultFetchResponse {
  payload: VaultPayloadDto;
  checksum: string;
  updatedAt: Date;
}

@Injectable()
export class VaultService {
  constructor(
    @InjectRepository(SessionVault)
    private readonly vaults: Repository<SessionVault>,
    @InjectRepository(SessionLog)
    private readonly sessions: Repository<SessionLog>,
    private readonly tokenStatus: TokenStatusService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Owner-only: allocates a signed URL to upload one large (encrypted) artifact. */
  async presignUpload(identity: DesktopIdentity): Promise<SignedUpload> {
    if (identity.tokenType !== TokenType.OWNER) {
      throw new ForbiddenException('Only owner tokens can upload artifacts');
    }
    await this.assertTokenActive(identity);
    return this.storage.createSignedUpload(identity.ownerId);
  }

  /** Signed URL to download an artifact that belongs to this identity's owner. */
  async presignDownload(
    identity: DesktopIdentity,
    objectKey: string,
  ): Promise<{ url: string }> {
    await this.assertTokenActive(identity);
    // An object key is namespaced `<ownerId>/<uuid>`; callers may only read their owner's objects.
    if (!objectKey.startsWith(`${identity.ownerId}/`)) {
      throw new ForbiddenException('Artifact does not belong to this owner');
    }
    return { url: await this.storage.createSignedDownload(objectKey) };
  }

  async upload(
    identity: DesktopIdentity,
    payload: VaultPayloadDto,
  ): Promise<VaultMetadata> {
    if (identity.tokenType !== TokenType.OWNER) {
      throw new ForbiddenException('Only owner tokens can upload the vault');
    }
    await this.assertTokenActive(identity);

    // Collect the previous publish's object keys so we can delete them after replacing.
    const staleKeys = await this.existingObjectKeys(identity.ownerId);

    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const checksum = createHash('sha256').update(plaintext).digest('hex');
    const encryptedPayload = this.encrypt(plaintext, identity.ownerId);

    await this.vaults.upsert(
      {
        ownerId: identity.ownerId,
        encryptedPayload,
        checksum,
        updatedAt: new Date(),
      },
      { conflictPaths: ['ownerId'] },
    );
    // Best-effort: remove orphaned artifacts from the previous publish.
    await this.storage.deleteObjects(staleKeys);
    return { checksum, updatedAt: new Date(), sizeBytes: plaintext.length };
  }

  async fetch(identity: DesktopIdentity): Promise<VaultFetchResponse> {
    await this.assertTokenActive(identity);
    if (identity.tokenType === TokenType.USER) {
      const session = identity.sessionId
        ? await this.sessions.findOne({
            where: {
              id: identity.sessionId,
              userTokenId: identity.tokenId,
              hwid: identity.hwid,
            },
          })
        : null;
      if (!session || session.status === UserStatus.BLOCKED) {
        throw new ForbiddenException('Device is not authorised');
      }
    }

    const vault = await this.vaults.findOne({
      where: { ownerId: identity.ownerId },
    });
    if (!vault) {
      throw new NotFoundException(
        'The owner has not published a session profile yet',
      );
    }
    const plaintext = this.decrypt(vault.encryptedPayload, identity.ownerId);
    const payload = JSON.parse(plaintext.toString('utf8')) as VaultPayloadDto;
    await this.attachDownloadUrls(payload);
    return { payload, checksum: vault.checksum, updatedAt: vault.updatedAt };
  }

  /** Object keys referenced by the owner's current vault (for cleanup on replace). */
  private async existingObjectKeys(ownerId: string): Promise<string[]> {
    const vault = await this.vaults.findOne({ where: { ownerId } });
    if (!vault) return [];
    try {
      const prev = JSON.parse(
        this.decrypt(vault.encryptedPayload, ownerId).toString('utf8'),
      ) as VaultPayloadDto;
      return (prev.objectArtifacts ?? []).map((a) => a.objectKey);
    } catch {
      return [];
    }
  }

  /** Mints a fresh signed download URL for each object-backed artifact. */
  private async attachDownloadUrls(payload: VaultPayloadDto): Promise<void> {
    const artifacts = payload.objectArtifacts ?? [];
    for (const artifact of artifacts) {
      artifact.downloadUrl = await this.storage.createSignedDownload(
        artifact.objectKey,
      );
    }
  }

  private async assertTokenActive(identity: DesktopIdentity): Promise<void> {
    const status = await this.tokenStatus.resolve(
      identity.tokenId,
      identity.tokenType,
    );
    if (status !== TokenStatus.ACTIVE) {
      throw new ForbiddenException(`Token is ${status ?? 'DELETED'}`);
    }
  }

  /** The owner id is bound as AAD so a ciphertext can't be replayed into another owner's row. */
  private encrypt(plaintext: Buffer, ownerId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.config.vaultKey, iv);
    cipher.setAAD(Buffer.from(ownerId, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return (
      FORMAT_PREFIX +
      Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
    );
  }

  private decrypt(stored: string, ownerId: string): Buffer {
    if (!stored.startsWith(FORMAT_PREFIX)) {
      throw new Error('Unsupported vault format');
    }
    const raw = Buffer.from(stored.slice(FORMAT_PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.config.vaultKey, iv);
    decipher.setAAD(Buffer.from(ownerId, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  }
}
