import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG } from '../../config/config.module';
import { AppConfig } from '../../config/env';
import { User } from '../../database/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { DesktopJwtStrategy } from './desktop-jwt.strategy';
import { DesktopAuthGuard } from './guards/desktop-auth.guard';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.secret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.jwt.expiresInSeconds,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    DesktopJwtStrategy,
    JwtAuthGuard,
    DesktopAuthGuard,
  ],
  exports: [JwtModule, JwtAuthGuard, DesktopAuthGuard],
})
export class AuthModule {}
