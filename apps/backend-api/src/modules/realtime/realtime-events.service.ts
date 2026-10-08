import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { RedisChannels } from '../../redis/redis-keys';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from '../../redis/redis.module';
import type { DashboardEvent, SessionEvent } from './realtime.events';

/**
 * Bridges Redis Pub/Sub to in-process streams. Every API instance subscribes, so
 * an action published on any instance reaches sockets connected to all instances.
 */
@Injectable()
export class RealtimeEventsService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeEventsService.name);
  private readonly sessionSubject = new Subject<SessionEvent>();
  private readonly dashboardSubject = new Subject<DashboardEvent>();

  readonly sessionEvents$: Observable<SessionEvent> =
    this.sessionSubject.asObservable();
  readonly dashboardEvents$: Observable<DashboardEvent> =
    this.dashboardSubject.asObservable();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber.on('message', (channel: string, message: string) =>
      this.dispatch(channel, message),
    );
    await this.subscriber.subscribe(
      RedisChannels.sessionEvents,
      RedisChannels.dashboardEvents,
    );
  }

  async publishSession(event: Omit<SessionEvent, 'at'>): Promise<void> {
    const payload: SessionEvent = { ...event, at: new Date().toISOString() };
    await this.redis.publish(
      RedisChannels.sessionEvents,
      JSON.stringify(payload),
    );
  }

  async publishDashboard(event: DashboardEvent): Promise<void> {
    await this.redis.publish(
      RedisChannels.dashboardEvents,
      JSON.stringify(event),
    );
  }

  private dispatch(channel: string, message: string): void {
    try {
      if (channel === RedisChannels.sessionEvents) {
        this.sessionSubject.next(JSON.parse(message) as SessionEvent);
      } else if (channel === RedisChannels.dashboardEvents) {
        this.dashboardSubject.next(JSON.parse(message) as DashboardEvent);
      }
    } catch (error: unknown) {
      this.logger.error(`Dropping malformed message on ${channel}`, error);
    }
  }
}
