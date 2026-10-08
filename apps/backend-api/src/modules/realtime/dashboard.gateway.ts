import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RealtimeEventsService } from './realtime-events.service';
import { DASHBOARD_EVENT, DashboardEvent } from './realtime.events';

type DashboardSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { ownerId?: string }
>;

const ownerRoom = (ownerId: string): string => `owner:${ownerId}`;

/**
 * Read-only live feed for the web dashboard. Clients authenticate during the handshake with
 * a short-lived `dashboard-ws` ticket from `POST /auth/ws-ticket` and only join their own room.
 */
@WebSocketGateway({ namespace: '/ws/dashboard' })
export class DashboardGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  private readonly logger = new Logger(DashboardGateway.name);
  private eventsSubscription?: { unsubscribe(): void };

  @WebSocketServer()
  private readonly server: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly events: RealtimeEventsService,
  ) {}

  afterInit(): void {
    this.eventsSubscription = this.events.dashboardEvents$.subscribe(
      (event: DashboardEvent) => {
        const { ownerId, ...payload } = event;
        this.server.to(ownerRoom(ownerId)).emit(DASHBOARD_EVENT, payload);
      },
    );
  }

  onModuleDestroy(): void {
    this.eventsSubscription?.unsubscribe();
  }

  async handleConnection(socket: DashboardSocket): Promise<void> {
    const ticket: unknown = (socket.handshake.auth as Record<string, unknown>)
      .token;
    const ownerId =
      typeof ticket === 'string' ? await this.verifyTicket(ticket) : null;
    if (!ownerId) {
      socket.emit('dashboard:error', { message: 'Unauthorized' });
      socket.disconnect(true);
      return;
    }
    socket.data.ownerId = ownerId;
    await socket.join(ownerRoom(ownerId));
    this.logger.debug(`Dashboard connected for owner ${ownerId}`);
  }

  private async verifyTicket(ticket: string): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(ticket);
      return payload.scope === 'dashboard-ws' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
