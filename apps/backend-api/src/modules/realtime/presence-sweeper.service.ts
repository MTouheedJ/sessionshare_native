import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import {
  SessionLog,
  TokenStatus,
  TokenType,
  UserStatus,
  UserToken,
} from '../../database/entities';
import { DesktopGateway } from './desktop.gateway';
import { PresenceService } from './presence.service';
import { RealtimeEventsService } from './realtime-events.service';
import { HEARTBEAT_INTERVAL_MS, SessionAction } from './realtime.events';
import { TokenStatusService } from './token-status.service';

/**
 * Every heartbeat interval:
 *  - marks ONLINE sessions whose presence key expired (3 missed heartbeats) as OFFLINE;
 *  - moves tokens past `expires_at` to EXPIRED and terminates their clients.
 * Safe to run on several instances: updates are conditional, so each change is published once.
 */
@Injectable()
export class PresenceSweeperService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PresenceSweeperService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(SessionLog)
    private readonly sessions: Repository<SessionLog>,
    @InjectRepository(UserToken)
    private readonly userTokens: Repository<UserToken>,
    private readonly presence: PresenceService,
    private readonly events: RealtimeEventsService,
    private readonly tokenStatus: TokenStatusService,
    private readonly gateway: DesktopGateway,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweepStaleSessions();
      await this.expireTokens();
    } catch (error: unknown) {
      this.logger.error('Sweep failed', error);
    } finally {
      this.running = false;
    }
  }

  private async sweepStaleSessions(): Promise<void> {
    const online = await this.sessions.find({
      where: { status: UserStatus.ONLINE },
      relations: { userToken: true },
    });
    if (online.length === 0) return;

    const alive = await this.presence.alive(online.map((s) => s.id));
    const stale = online.filter((s) => !alive.has(s.id));

    for (const session of stale) {
      const result = await this.sessions.update(
        { id: session.id, status: UserStatus.ONLINE },
        { status: UserStatus.OFFLINE, disconnectedAt: new Date() },
      );
      if (!result.affected || !session.userToken) continue;
      await this.events.publishDashboard({
        type: 'session.updated',
        ownerId: session.userToken.ownerId,
        sessionId: session.id,
        tokenId: session.userTokenId,
        status: UserStatus.OFFLINE,
      });
    }
    this.gateway.disconnectStaleSessions(stale.map((s) => s.id));
  }

  private async expireTokens(): Promise<void> {
    const due = await this.userTokens.find({
      where: {
        status: In([TokenStatus.ACTIVE, TokenStatus.PAUSED]),
        expiresAt: LessThanOrEqual(new Date()),
      },
    });
    for (const token of due) {
      const result = await this.userTokens.update(
        { id: token.id, status: In([TokenStatus.ACTIVE, TokenStatus.PAUSED]) },
        { status: TokenStatus.EXPIRED },
      );
      if (!result.affected) continue;
      await this.tokenStatus.set(token.id, TokenStatus.EXPIRED);
      await this.events.publishSession({
        action: SessionAction.REVOKE,
        ownerId: token.ownerId,
        tokenId: token.id,
        sessionId: null,
        reason: TokenStatus.EXPIRED,
      });
      await this.events.publishDashboard({
        type: 'token.updated',
        ownerId: token.ownerId,
        tokenId: token.id,
        tokenType: TokenType.USER,
      });
    }
  }
}
