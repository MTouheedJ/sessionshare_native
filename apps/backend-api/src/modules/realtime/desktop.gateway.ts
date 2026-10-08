import { Logger, OnModuleDestroy, UseFilters, UsePipes } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BaseWsExceptionFilter,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { Not, Repository } from 'typeorm';
import {
  SessionLog,
  TokenStatus,
  TokenType,
  UserStatus,
} from '../../database/entities';
import type {
  DesktopJwtPayload,
  JwtPayload,
} from '../auth/interfaces/jwt-payload.interface';
import {
  ClientConnectDto,
  ClientHeartbeatDto,
} from './dto/desktop-messages.dto';
import { PresenceService } from './presence.service';
import { RealtimeEventsService } from './realtime-events.service';
import {
  DesktopClientEvents,
  DesktopControlPayload,
  DesktopServerEvents,
  HEARTBEAT_INTERVAL_MS,
  SessionAction,
  SessionEvent,
} from './realtime.events';
import { TokenStatusService } from './token-status.service';
import { wsValidationPipe } from './ws-validation.pipe';

const AUTH_TIMEOUT_MS = 10_000;
const TERMINAL_STATUSES: ReadonlySet<TokenStatus> = new Set([
  TokenStatus.REVOKED,
  TokenStatus.EXPIRED,
]);

interface DesktopIdentity {
  tokenId: string;
  tokenType: TokenType;
  ownerId: string;
  sessionId: string | null;
  hwid: string;
  ip: string | null;
}

interface DesktopSocketData {
  identity?: DesktopIdentity;
  authTimer?: NodeJS.Timeout;
}

type DesktopSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  DesktopSocketData
>;

const tokenRoom = (tokenId: string): string => `token:${tokenId}`;
const sessionRoom = (sessionId: string): string => `session:${sessionId}`;

@WebSocketGateway({ namespace: '/ws/session' })
@UsePipes(wsValidationPipe)
@UseFilters(new BaseWsExceptionFilter())
export class DesktopGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(DesktopGateway.name);
  private eventsSubscription?: { unsubscribe(): void };

  @WebSocketServer()
  private readonly server: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly events: RealtimeEventsService,
    private readonly tokenStatus: TokenStatusService,
    private readonly presence: PresenceService,
    @InjectRepository(SessionLog)
    private readonly sessions: Repository<SessionLog>,
  ) {}

  afterInit(): void {
    this.eventsSubscription = this.events.sessionEvents$.subscribe((event) => {
      void this.applySessionEvent(event);
    });
  }

  onModuleDestroy(): void {
    this.eventsSubscription?.unsubscribe();
  }

  handleConnection(socket: DesktopSocket): void {
    socket.data.authTimer = setTimeout(() => {
      if (!socket.data.identity) this.reject(socket, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);
  }

  async handleDisconnect(socket: DesktopSocket): Promise<void> {
    clearTimeout(socket.data.authTimer);
    const identity = socket.data.identity;
    if (!identity?.sessionId) return;
    // Another socket for the same session (e.g. a quick reconnect) keeps it online.
    const stillConnected = await this.server
      .in(sessionRoom(identity.sessionId))
      .fetchSockets();
    if (stillConnected.length > 0) return;

    await this.presence.clear(identity.sessionId);
    const result = await this.sessions.update(
      { id: identity.sessionId, status: Not(UserStatus.BLOCKED) },
      { status: UserStatus.OFFLINE, disconnectedAt: new Date() },
    );
    if (result.affected) {
      await this.publishSessionUpdate(identity, UserStatus.OFFLINE);
    }
  }

  @SubscribeMessage(DesktopClientEvents.connect)
  async onClientConnect(
    @ConnectedSocket() socket: DesktopSocket,
    @MessageBody() dto: ClientConnectDto,
  ): Promise<void> {
    const payload = await this.verifyDesktopToken(dto.token);
    if (!payload || payload.hwid !== dto.hwid) {
      this.reject(socket, 'Invalid or expired desktop token');
      return;
    }

    const status = await this.tokenStatus.resolve(
      payload.sub,
      payload.tokenType,
    );
    if (status === null || TERMINAL_STATUSES.has(status)) {
      this.terminate(
        socket,
        payload.sub,
        payload.sessionId,
        status ?? 'DELETED',
      );
      return;
    }

    const identity: DesktopIdentity = {
      tokenId: payload.sub,
      tokenType: payload.tokenType,
      ownerId: payload.ownerId,
      sessionId: payload.sessionId,
      hwid: payload.hwid,
      ip: socket.handshake.address || null,
    };

    if (identity.sessionId) {
      const session = await this.sessions.findOne({
        where: {
          id: identity.sessionId,
          userTokenId: identity.tokenId,
          hwid: identity.hwid,
        },
      });
      if (!session || session.status === UserStatus.BLOCKED) {
        this.terminate(socket, identity.tokenId, identity.sessionId, 'BLOCKED');
        return;
      }
      const now = new Date();
      await this.sessions.update(
        { id: session.id },
        {
          status: UserStatus.ONLINE,
          connectedAt: now,
          lastHeartbeat: now,
          disconnectedAt: null,
          ipAddress: identity.ip,
          ...(dto.version !== undefined && { clientVersion: dto.version }),
        },
      );
      await this.presence.touch(
        session.id,
        { ip: identity.ip, hwid: identity.hwid, status: UserStatus.ONLINE },
        now,
      );
      await socket.join(sessionRoom(session.id));
      await this.publishSessionUpdate(identity, UserStatus.ONLINE);
    }

    clearTimeout(socket.data.authTimer);
    socket.data.identity = identity;
    await socket.join(tokenRoom(identity.tokenId));

    socket.emit(DesktopServerEvents.connectionAck, {
      tokenId: identity.tokenId,
      tokenType: identity.tokenType,
      sessionId: identity.sessionId,
      status,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    });
    if (status === TokenStatus.PAUSED) {
      socket.emit(
        DesktopServerEvents.pause,
        this.controlPayload(identity.tokenId, identity.sessionId, 'PAUSED'),
      );
    }
  }

  @SubscribeMessage(DesktopClientEvents.heartbeat)
  async onHeartbeat(
    @ConnectedSocket() socket: DesktopSocket,
    @MessageBody() dto: ClientHeartbeatDto,
  ): Promise<void> {
    const identity = socket.data.identity;
    if (
      !identity ||
      identity.tokenId !== dto.tokenId ||
      identity.hwid !== dto.hwid
    ) {
      this.reject(socket, 'Heartbeat does not match authenticated session');
      return;
    }

    const status = await this.tokenStatus.resolve(
      identity.tokenId,
      identity.tokenType,
    );
    if (status === null || TERMINAL_STATUSES.has(status)) {
      this.terminate(
        socket,
        identity.tokenId,
        identity.sessionId,
        status ?? 'DELETED',
      );
      return;
    }
    if (!identity.sessionId) return;

    const now = new Date();
    const result = await this.sessions.update(
      { id: identity.sessionId, status: Not(UserStatus.BLOCKED) },
      { status: UserStatus.ONLINE, lastHeartbeat: now, disconnectedAt: null },
    );
    if (!result.affected) {
      this.terminate(socket, identity.tokenId, identity.sessionId, 'BLOCKED');
      return;
    }
    await this.presence.touch(
      identity.sessionId,
      { ip: identity.ip, hwid: identity.hwid, status: UserStatus.ONLINE },
      now,
    );
    await this.events.publishDashboard({
      type: 'session.heartbeat',
      ownerId: identity.ownerId,
      sessionId: identity.sessionId,
      tokenId: identity.tokenId,
      lastHeartbeat: now.toISOString(),
      ipAddress: identity.ip,
    });
  }

  /** Disconnects local sockets of sessions that missed their heartbeat window. */
  disconnectStaleSessions(sessionIds: readonly string[]): void {
    for (const id of sessionIds) {
      this.server.in(sessionRoom(id)).disconnectSockets(true);
    }
  }

  private async applySessionEvent(event: SessionEvent): Promise<void> {
    const room = event.sessionId
      ? sessionRoom(event.sessionId)
      : event.tokenId
        ? tokenRoom(event.tokenId)
        : null;
    if (!room) return;
    const payload = this.controlPayload(
      event.tokenId,
      event.sessionId,
      event.reason,
    );
    try {
      switch (event.action) {
        case SessionAction.PAUSE:
          this.server.to(room).emit(DesktopServerEvents.pause, payload);
          break;
        case SessionAction.RESUME:
          this.server.to(room).emit(DesktopServerEvents.resume, payload);
          break;
        case SessionAction.REVOKE:
        case SessionAction.TERMINATE:
          this.server.to(room).emit(DesktopServerEvents.terminate, payload);
          // Packets flush in order, so the terminate payload is delivered before the close.
          this.server.in(room).disconnectSockets(true);
          break;
      }
    } catch (error: unknown) {
      this.logger.error(`Failed to apply ${event.action} to ${room}`, error);
    }
  }

  private async verifyDesktopToken(
    token: string,
  ): Promise<DesktopJwtPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return payload.scope === 'desktop' ? payload : null;
    } catch {
      return null;
    }
  }

  private async publishSessionUpdate(
    identity: DesktopIdentity,
    status: UserStatus,
  ): Promise<void> {
    if (!identity.sessionId) return;
    await this.events.publishDashboard({
      type: 'session.updated',
      ownerId: identity.ownerId,
      sessionId: identity.sessionId,
      tokenId: identity.tokenId,
      status,
    });
  }

  private controlPayload(
    tokenId: string | null,
    sessionId: string | null,
    reason: string,
  ): DesktopControlPayload {
    return { tokenId, sessionId, reason, at: new Date().toISOString() };
  }

  private terminate(
    socket: DesktopSocket,
    tokenId: string,
    sessionId: string | null,
    reason: string,
  ): void {
    socket.emit(
      DesktopServerEvents.terminate,
      this.controlPayload(tokenId, sessionId, reason),
    );
    socket.disconnect(true);
  }

  private reject(socket: DesktopSocket, message: string): void {
    socket.emit(DesktopServerEvents.error, { message });
    socket.disconnect(true);
  }
}
