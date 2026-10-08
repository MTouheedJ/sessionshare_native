import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OwnerToken, SessionLog, UserToken } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { DashboardGateway } from './dashboard.gateway';
import { DesktopGateway } from './desktop.gateway';
import { PresenceSweeperService } from './presence-sweeper.service';
import { PresenceService } from './presence.service';
import { RealtimeEventsService } from './realtime-events.service';
import { TokenStatusService } from './token-status.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OwnerToken, UserToken, SessionLog]),
    AuthModule,
  ],
  providers: [
    RealtimeEventsService,
    TokenStatusService,
    PresenceService,
    DesktopGateway,
    DashboardGateway,
    PresenceSweeperService,
  ],
  exports: [RealtimeEventsService, TokenStatusService, PresenceService],
})
export class RealtimeModule {}
