import { IsBoolean, IsOptional } from 'class-validator';

export class TerminateSessionDto {
  /** Also block the device so it cannot re-validate the token. */
  @IsOptional()
  @IsBoolean()
  block?: boolean;
}
