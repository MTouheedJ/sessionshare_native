import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import type {
  DesktopIdentity,
  JwtPayload,
} from './interfaces/jwt-payload.interface';

/** Accepts only the hardware-bound desktop JWTs issued by `POST /tokens/validate`. */
@Injectable()
export class DesktopJwtStrategy extends PassportStrategy(
  Strategy,
  'desktop-jwt',
) {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
      algorithms: ['HS256'],
    });
  }

  validate(payload: JwtPayload): DesktopIdentity {
    if (payload.scope !== 'desktop') {
      throw new UnauthorizedException();
    }
    return {
      tokenId: payload.sub,
      tokenType: payload.tokenType,
      ownerId: payload.ownerId,
      hwid: payload.hwid,
      sessionId: payload.sessionId,
    };
  }
}
