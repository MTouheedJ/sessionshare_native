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
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Relative path inside the sandbox: no drive letters, no leading slash, no `..` segments. */
const SAFE_RELATIVE_PATH =
  /^(?![\\/])(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\0<>:"|?*]+$/;

export class VaultAppDto {
  /** Absolute path of the executable on client machines. */
  @IsString()
  @MinLength(3)
  @MaxLength(1024)
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

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => VaultFileDto)
  files: VaultFileDto[];
}

export class UploadVaultDto {
  @ValidateNested()
  @Type(() => VaultPayloadDto)
  payload: VaultPayloadDto;
}
