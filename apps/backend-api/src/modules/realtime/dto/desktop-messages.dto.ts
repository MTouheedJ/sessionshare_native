import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const HWID_PATTERN = /^[a-f0-9]{64}$/;
const lowerTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class ClientConnectDto {
  /** Desktop access token returned by `POST /tokens/validate`. */
  @IsString()
  @MaxLength(2048)
  token: string;

  @Transform(lowerTrim)
  @Matches(HWID_PATTERN)
  hwid: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;
}

export class ClientHeartbeatDto {
  @IsUUID()
  tokenId: string;

  @Transform(lowerTrim)
  @Matches(HWID_PATTERN)
  hwid: string;

  @IsOptional()
  @IsInt()
  timestamp?: number;
}
