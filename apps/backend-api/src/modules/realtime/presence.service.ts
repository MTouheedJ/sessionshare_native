import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { UserStatus } from '../../database/entities';
import { PRESENCE_TTL_SECONDS, RedisKeys } from '../../redis/redis-keys';
import { REDIS_CLIENT } from '../../redis/redis.module';

export interface PresenceInfo {
  ip: string | null;
  hwid: string;
  status: UserStatus;
}

/** Heartbeat-driven presence. A key that outlives 3 missed heartbeats (15s) expires. */
@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async touch(sessionId: string, info: PresenceInfo, at: Date): Promise<void> {
    const key = RedisKeys.presence(sessionId);
    await this.redis
      .multi()
      .hset(key, {
        ip: info.ip ?? '',
        hwid: info.hwid,
        status: info.status,
        last_heartbeat: at.toISOString(),
      })
      .expire(key, PRESENCE_TTL_SECONDS)
      .exec();
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(RedisKeys.presence(sessionId));
  }

  /** Returns the subset of session ids that still have a live presence key. */
  async alive(sessionIds: readonly string[]): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set();
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) pipeline.exists(RedisKeys.presence(id));
    const results = (await pipeline.exec()) ?? [];
    const alive = new Set<string>();
    results.forEach(([error, exists], index) => {
      // On a Redis error, treat as alive rather than kicking a healthy client.
      if (error !== null || exists === 1) alive.add(sessionIds[index]);
    });
    return alive;
  }
}
