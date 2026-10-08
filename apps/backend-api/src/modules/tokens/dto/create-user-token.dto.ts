import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateUserTokenDto {
  /** Number of successful desktop logins allowed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxUses?: number;

  /** Lifetime in hours; omitted = no expiry. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number;
}
