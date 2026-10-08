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
import { CreateOwnerTokenDto } from './dto/create-owner-token.dto';
import {
  OwnerTokenCreatedResponse,
  OwnerTokenView,
  TokensService,
} from './tokens.service';

@Controller('owner/tokens')
@UseGuards(JwtAuthGuard)
export class OwnerTokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get()
  list(@CurrentOwner() owner: AuthenticatedOwner): Promise<OwnerTokenView[]> {
    return this.tokensService.listOwnerTokens(owner.id);
  }

  @Post()
  create(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Body() dto: CreateOwnerTokenDto,
  ): Promise<OwnerTokenCreatedResponse> {
    return this.tokensService.createOwnerToken(owner.id, dto);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnerTokenView> {
    return this.tokensService.revokeOwnerToken(owner.id, id);
  }
}
