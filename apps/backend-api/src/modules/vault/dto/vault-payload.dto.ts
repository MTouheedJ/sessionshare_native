import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBase64,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Relative path inside the sandbox: no drive letters, no leading slash, no `..` segments. */
const SAFE_RELATIVE_PATH =
  /^(?![\\/])(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\0<>:"|?*]+$/;

export class VaultAppDto {
  /**
   * Either an absolute path installed on the client, or a path relative to the
   * sandbox when the binary is bundled in `files` (zero-install). `..` traversal
   * is rejected either way.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  @Matches(/^(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/, {
    message: 'executable must not contain ".." path segments',
  })
  executable: string;

  /** `{sandbox}` is replaced with the client's sandbox directory. */
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  args: string[];

  @IsOptional()
  @IsString()
  @MaxLength(256)
  windowTitleHint?: string;
}

export class VaultPolicyDto {
  @IsBoolean()
  captureProtection: boolean;

  @IsBoolean()
  blockClipboard: boolean;
}

export class VaultFileDto {
  @Matches(SAFE_RELATIVE_PATH, {
    message: 'files.path must be a safe relative path',
  })
  @MaxLength(512)
  path: string;

  @IsBase64()
  data: string;
}

/** A large artifact stored in object storage (ciphertext). Carries the client-held key. */
export class VaultObjectArtifactDto {
  /**
   * When `archive` is false (default) this is the sandbox-relative file path the
   * decrypted bytes are written to. When `archive` is true it is the sandbox-
   * relative directory the decrypted ZIP is extracted into (preserving its tree).
   */
  @Matches(SAFE_RELATIVE_PATH, {
    message: 'objectArtifacts.path must be a safe relative path',
  })
  @MaxLength(512)
  path: string;

  /** True if the object is a ZIP archive to extract (folder-preserving bundle). */
  @IsOptional()
  @IsBoolean()
  archive?: boolean;

  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]{8,198}$/, {
    message: 'invalid objectKey',
  })
  @Matches(/^(?!.*(?:^|\/)\.\.(?:\/|$)).+$/, {
    message: 'objectKey must not contain ".."',
  })
  objectKey: string;

  /** base64 AES-256 key (32 bytes). */
  @IsBase64()
  key: string;

  /** base64 96-bit nonce. */
  @IsBase64()
  nonce: string;

  /** hex SHA-256 of the plaintext. */
  @Matches(/^[a-f0-9]{64}$/, { message: 'sha256 must be hex' })
  sha256: string;

  @IsInt()
  @Min(0)
  size: number;

  /** Populated server-side on fetch (ephemeral signed URL); never uploaded. */
  @IsOptional()
  @IsString()
  downloadUrl?: string;
}

export class VaultPayloadDto {
  @IsInt()
  @Equals(1)
  version: 1;

  @ValidateNested()
  @Type(() => VaultAppDto)
  app: VaultAppDto;

  @ValidateNested()
  @Type(() => VaultPolicyDto)
  policy: VaultPolicyDto;

  /** Small files inlined directly in the vault. */
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => VaultFileDto)
  files: VaultFileDto[];

  /** Large files stored in object storage (ciphertext), referenced by key. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => VaultObjectArtifactDto)
  objectArtifacts?: VaultObjectArtifactDto[];
}

export class UploadVaultDto {
  @ValidateNested()
  @Type(() => VaultPayloadDto)
  payload: VaultPayloadDto;
}

export class PresignDownloadDto {
  /** Object key `<ownerId>/<uuid>`; ownership is re-checked server-side. */
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]{8,198}$/, {
    message: 'invalid objectKey',
  })
  @Matches(/^(?!.*(?:^|\/)\.\.(?:\/|$)).+$/, {
    message: 'objectKey must not contain ".."',
  })
  objectKey: string;
}
