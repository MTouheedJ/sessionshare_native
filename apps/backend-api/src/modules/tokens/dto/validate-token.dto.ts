import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ValidateTokenDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  token: string;

  /** SHA256(CPU_ID + MOTHERBOARD_SERIAL + MAC_ADDR), hex-encoded. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(/^[a-f0-9]{64}$/, {
    message: 'hwid must be a hex-encoded SHA-256 hash',
  })
  hwid: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  clientVersion?: string;
}
