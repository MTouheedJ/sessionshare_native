import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionLog, TokenStatus, UserStatus } from '../../database/entities';
import { PresenceService } from '../realtime/presence.service';
import { RealtimeEventsService } from '../realtime/realtime-events.service';
import { SessionAction } from '../realtime/realtime.events';

export interface SessionView {
  id: string;
  tokenId: string;
  token: string;
  tokenStatus: TokenStatus;
  hwid: string;
  ipAddress: string | null;
  clientVersion: string | null;
  status: UserStatus;
  connectedAt: Date;
  lastHeartbeat: Date;
  disconnectedAt: Date | null;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(SessionLog)
    private readonly sessions: Repository<SessionLog>,
    private readonly events: RealtimeEventsService,
    private readonly presence: PresenceService,
  ) {}

  async list(ownerId: string): Promise<SessionView[]> {
    const rows = await this.sessions.find({
      where: { userToken: { ownerId } },
      relations: { userToken: true },
      order: { lastHeartbeat: 'DESC' },
    });
    return rows.map(toSessionView);
  }

  /** Kicks the device. With `block`, the device also can't re-validate or reconnect. */
  async terminate(
    ownerId: string,
    id: string,
    block: boolean,
  ): Promise<SessionView> {
    const session = await this.findOwned(ownerId, id);
    const status =
      block || session.status === UserStatus.BLOCKED
        ? UserStatus.BLOCKED
        : UserStatus.OFFLINE;
    await this.sessions.update({ id }, { status, disconnectedAt: new Date() });
    await this.presence.clear(id);
    await this.events.publishSession({
      action: SessionAction.TERMINATE,
      ownerId,
      tokenId: session.userTokenId,
      sessionId: id,
      reason: block ? 'BLOCKED' : 'TERMINATED_BY_OWNER',
    });
    await this.publishUpdate(ownerId, session, status);
    session.status = status;
    return toSessionView(session);
  }

  async unblock(ownerId: string, id: string): Promise<SessionView> {
    const session = await this.findOwned(ownerId, id);
    if (session.status !== UserStatus.BLOCKED) return toSessionView(session);
    await this.sessions.update({ id }, { status: UserStatus.OFFLINE });
    await this.publishUpdate(ownerId, session, UserStatus.OFFLINE);
    session.status = UserStatus.OFFLINE;
    return toSessionView(session);
  }

  private async findOwned(ownerId: string, id: string): Promise<SessionLog> {
    const session = await this.sessions.findOne({
      where: { id, userToken: { ownerId } },
      relations: { userToken: true },
    });
    if (!session?.userToken) throw new NotFoundException('Session not found');
    return session;
  }

  private async publishUpdate(
    ownerId: string,
    session: SessionLog,
    status: UserStatus,
  ): Promise<void> {
    await this.events.publishDashboard({
      type: 'session.updated',
      ownerId,
      sessionId: session.id,
      tokenId: session.userTokenId,
      status,
    });
  }
}

function toSessionView(session: SessionLog): SessionView {
  const token = session.userToken;
  if (!token) throw new Error(`Session ${session.id} has no token loaded`);
  return {
    id: session.id,
    tokenId: token.id,
    token: token.tokenValue,
    tokenStatus: token.status,
    hwid: session.hwid,
    ipAddress: session.ipAddress,
    clientVersion: session.clientVersion,
    status: session.status,
    connectedAt: session.connectedAt,
    lastHeartbeat: session.lastHeartbeat,
    disconnectedAt: session.disconnectedAt,
  };
}
