import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionLog, SessionVault } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionVault, SessionLog]),
    AuthModule,
    RealtimeModule,
  ],
  controllers: [VaultController],
  providers: [VaultService],
})
export class VaultModule {}
