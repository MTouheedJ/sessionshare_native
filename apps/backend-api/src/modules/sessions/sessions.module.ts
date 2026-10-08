import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionLog } from '../../database/entities';
import { RealtimeModule } from '../realtime/realtime.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([SessionLog]), RealtimeModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
