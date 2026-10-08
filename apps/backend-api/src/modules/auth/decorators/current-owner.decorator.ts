import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedOwner } from '../interfaces/jwt-payload.interface';

export const CurrentOwner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedOwner => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedOwner }>();
    return request.user;
  },
);
