import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import type { DesktopIdentity } from '../interfaces/jwt-payload.interface';

@Injectable()
export class DesktopAuthGuard extends AuthGuard('desktop-jwt') {}

export const CurrentDesktop = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DesktopIdentity =>
    ctx.switchToHttp().getRequest<Request & { user: DesktopIdentity }>().user,
);
