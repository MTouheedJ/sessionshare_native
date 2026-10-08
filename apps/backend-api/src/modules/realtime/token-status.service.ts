import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import {
  OwnerToken,
  TokenStatus,
  TokenType,
  UserToken,
} from '../../database/entities';
import { RedisKeys } from '../../redis/redis-keys';
import { REDIS_CLIENT } from '../../redis/redis.module';

const STATUSES: ReadonlySet<string> = new Set<string>(
  Object.values(TokenStatus),
);

/** `token:status:{tokenId}` cache with PostgreSQL as the source of truth. */
@Injectable()
export class TokenStatusService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(UserToken)
    private readonly userTokens: Repository<UserToken>,
    @InjectRepository(OwnerToken)
    private readonly ownerTokens: Repository<OwnerToken>,
  ) {}

  async set(tokenId: string, status: TokenStatus): Promise<void> {
    await this.redis.set(RedisKeys.tokenStatus(tokenId), status);
  }

  async remove(tokenId: string): Promise<void> {
    await this.redis.del(RedisKeys.tokenStatus(tokenId));
  }

  /** Returns null when the token no longer exists. */
  async resolve(
    tokenId: string,
    tokenType: TokenType,
  ): Promise<TokenStatus | null> {
    const cached = await this.redis.get(RedisKeys.tokenStatus(tokenId));
    if (cached !== null && STATUSES.has(cached)) {
      return cached as TokenStatus;
    }
    const status = await this.loadFromDatabase(tokenId, tokenType);
    if (status !== null) {
      await this.set(tokenId, status);
    }
    return status;
  }

  private async loadFromDatabase(
    tokenId: string,
    tokenType: TokenType,
  ): Promise<TokenStatus | null> {
    if (tokenType === TokenType.OWNER) {
      const token = await this.ownerTokens.findOne({ where: { id: tokenId } });
      if (!token) return null;
      return token.isActive ? TokenStatus.ACTIVE : TokenStatus.REVOKED;
    }
    const token = await this.userTokens.findOne({ where: { id: tokenId } });
    return token?.status ?? null;
  }
}
