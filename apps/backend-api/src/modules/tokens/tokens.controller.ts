import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentOwner } from '../auth/decorators/current-owner.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedOwner } from '../auth/interfaces/jwt-payload.interface';
import { CreateOwnerTokenDto } from './dto/create-owner-token.dto';
import { CreateUserTokenDto } from './dto/create-user-token.dto';
import { UpdateTokenStatusDto } from './dto/update-token-status.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import {
  OwnerTokenCreatedResponse,
  TokensService,
  UserTokenResponse,
  ValidateTokenResponse,
} from './tokens.service';

@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<UserTokenResponse[]> {
    return this.tokensService.listUserTokens(owner.id);
  }

  /** `generate` per api_specifications.md; `user` kept from Step 1. */
  @Post(['generate', 'user'])
  @UseGuards(JwtAuthGuard)
  createUserToken(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Body() dto: CreateUserTokenDto,
  ): Promise<UserTokenResponse> {
    return this.tokensService.createUserToken(owner.id, dto);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  updateStatus(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTokenStatusDto,
  ): Promise<UserTokenResponse> {
    return this.tokensService.updateUserTokenStatus(owner.id, id, dto.status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  remove(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.tokensService.deleteUserToken(owner.id, id);
  }

  /** Kept from Step 1; prefer `POST /owner/tokens`. */
  @Post('owner')
  @UseGuards(JwtAuthGuard)
  createOwnerToken(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Body() dto: CreateOwnerTokenDto,
  ): Promise<OwnerTokenCreatedResponse> {
    return this.tokensService.createOwnerToken(owner.id, dto);
  }

  /** Public: called by the desktop app with an Owner or User token. */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(
    @Body() dto: ValidateTokenDto,
    @Ip() ip: string,
  ): Promise<ValidateTokenResponse> {
    return this.tokensService.validate(dto, ip || null);
  }
}
