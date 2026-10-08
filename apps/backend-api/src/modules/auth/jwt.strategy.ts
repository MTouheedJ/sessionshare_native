import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import {
  AuthenticatedOwner,
  JwtPayload,
} from './interfaces/jwt-payload.interface';

/** Accepts only owner-scoped JWTs; desktop session JWTs are rejected here. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
      algorithms: ['HS256'],
    });
  }

  validate(payload: JwtPayload): AuthenticatedOwner {
    if (payload.scope !== 'owner') {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, email: payload.email };
  }
}
