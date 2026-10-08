import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentDesktop,
  DesktopAuthGuard,
} from '../auth/guards/desktop-auth.guard';
import type { DesktopIdentity } from '../auth/interfaces/jwt-payload.interface';
import { UploadVaultDto } from './dto/vault-payload.dto';
import {
  VaultFetchResponse,
  VaultMetadata,
  VaultService,
} from './vault.service';

/** Desktop-only endpoints, authenticated with the hardware-bound desktop JWT. */
@Controller('owner/vault')
@UseGuards(DesktopAuthGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  upload(
    @CurrentDesktop() identity: DesktopIdentity,
    @Body() dto: UploadVaultDto,
  ): Promise<VaultMetadata> {
    return this.vaultService.upload(identity, dto.payload);
  }

  @Get('fetch')
  fetch(
    @CurrentDesktop() identity: DesktopIdentity,
  ): Promise<VaultFetchResponse> {
    return this.vaultService.fetch(identity);
  }
}
