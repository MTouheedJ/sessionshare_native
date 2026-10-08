import { IsIn } from 'class-validator';
import { TokenStatus } from '../../../database/entities';

export const SETTABLE_STATUSES = [
  TokenStatus.ACTIVE,
  TokenStatus.PAUSED,
  TokenStatus.REVOKED,
] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export class UpdateTokenStatusDto {
  @IsIn(SETTABLE_STATUSES)
  status: SettableStatus;
}
