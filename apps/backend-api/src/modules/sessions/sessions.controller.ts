import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentOwner } from '../auth/decorators/current-owner.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedOwner } from '../auth/interfaces/jwt-payload.interface';
import { TerminateSessionDto } from './dto/terminate-session.dto';
import { SessionsService, SessionView } from './sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  list(@CurrentOwner() owner: AuthenticatedOwner): Promise<SessionView[]> {
    return this.sessionsService.list(owner.id);
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  terminate(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateSessionDto,
  ): Promise<SessionView> {
    return this.sessionsService.terminate(owner.id, id, dto.block ?? false);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionView> {
    return this.sessionsService.unblock(owner.id, id);
  }
}
