import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OwnerToken, SessionLog, UserToken } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { OwnerTokensController } from './owner-tokens.controller';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OwnerToken, UserToken, SessionLog]),
    AuthModule,
    RealtimeModule,
  ],
  controllers: [TokensController, OwnerTokensController],
  providers: [TokensService],
})
export class TokensModule {}
